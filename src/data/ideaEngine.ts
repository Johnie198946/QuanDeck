import { applyOps, buildDrafts, cloneDoc, daysOf, findLine, revisionImpact } from "./ideas";
import type { DraftTemplate, ScriptStep } from "./ideas";
import {
  DAILY_STEPS,
  DAILY_TEMPLATES,
  GENERIC_TEMPLATES,
  INHERITED_LINES,
  TRAVEL_SECTION_REPLIES,
  TRAVEL_STEPS,
  TRAVEL_TEMPLATES,
  dailySkeleton,
  genericSkeleton,
  genericSteps,
  isTravelIdea,
  rootSkeleton,
} from "./ideaScripts";
import type { IdeaPlan, Orchestration, PlanDoc, Snapshot, TaskDraft, WorkItem } from "./types";
import { adoptedConclusionsAt } from "./discussion";

// 事项工作区的状态变更（作用于快照草稿）。仓库负责持久化与演示延时；演示阶段构建复用同一套函数。

type Uid = (prefix: string) => string;

export const rootPlanId = (taskId: string) => `plan-${taskId}`;
export const localPlanId = (taskId: string, itemId: string) => `plan-${taskId}-${itemId}`;

export function rootPlanOf(d: Snapshot, taskId: string) {
  return d.ideaPlans?.[rootPlanId(taskId)] ?? null;
}

function stepsFor(p: IdeaPlan): ScriptStep[] {
  if (p.script === "travel") return TRAVEL_STEPS;
  if (p.script === "daily") return DAILY_STEPS;
  if (p.script === "generic-local")
    return [
      {
        ai: "已带入上级的目标和已确定条件。演示版只为“整理每日行程”预置了局部讨论；你可以直接编辑这份局部方案，或整理为子任务。",
        options: [{ label: "整理为子任务", action: "drafts" }],
        ops: [{ op: "add", section: "s-goal", line: { id: "l-local-goal", text: p.title, state: "fixed" } }],
      },
    ];
  return genericSteps(p.title);
}

function templatesFor(p: IdeaPlan): DraftTemplate[] {
  if (p.script === "travel") return TRAVEL_TEMPLATES;
  if (p.script === "daily") return DAILY_TEMPLATES;
  return GENERIC_TEMPLATES(p.title);
}

/** 普通事项按现有内容整理候选，不把演示模板当作真实 Agent 的拆解结果。 */
function contentDrafts(p: IdeaPlan, orch: Orchestration | null): TaskDraft[] {
  const conclusion = [...(p.discussion?.conclusions ?? [])].reverse().find(c => c.scopeId === 'root' && c.tasks?.length);
  // Discussion prose describes decisions, not work. Never turn every fact/question into a task.
  if (!conclusion?.tasks) return [];
  const keys = new Map(conclusion.tasks.map(t => [t.key, `plan-${p.id}-${t.key}`]));
  return conclusion.tasks.map(t => ({ ...t, key: keys.get(t.key)!, parentKey: t.parentKey ? keys.get(t.parentKey) : undefined, deps: t.deps.map(key => keys.get(key)!), include: !Object.values(orch?.items ?? {}).some(w => w.draftKey === keys.get(t.key)), lineIds: p.draft.sections.flatMap(s => s.lines).filter(l => l.state === 'fixed').map(l => l.id) }));
}

/** 局部方案用于判断的完整文档：带入的上级条目（按上级已采用版本，没有则用草稿）+ 本地草稿 */
export function docWithInherit(d: Snapshot, p: IdeaPlan): PlanDoc {
  if (!p.itemId || !p.inherit?.length) return p.draft;
  const root = rootPlanOf(d, p.taskId);
  const src = root?.adopted?.doc ?? root?.draft;
  const lines = p.inherit.map((id) => (src ? findLine(src, id)?.line : null)).filter(Boolean) as PlanDoc["sections"][number]["lines"];
  return { sections: [{ id: "s-inherit", title: "继承", kind: "key", lines }, ...p.draft.sections] };
}

function emptyOrch(taskId: string, label: string, now: string): Orchestration {
  return {
    taskId,
    label,
    startedAt: now,
    syncedAt: now,
    coordinationTokens: 0,
    phases: ["准备", "整理", "成稿"],
    executors: {},
    items: {},
    itemOrder: [],
    attempts: {},
    capabilities: { subAgents: true, steps: true, tokens: true, permissionEvents: false },
  };
}

export function createIdeaIn(
  d: Snapshot,
  text: string,
  ids: { taskId: string; blockId: string },
  newTask: (id: string, raw: string, now: string) => Snapshot["tasks"][string],
  demo?: string,
) {
  const travel = isTravelIdea(text);
  const label = travel ? "旅行计划" : text.length > 10 ? `${text.slice(0, 10)}…` : text;
  d.tasks[ids.taskId] = newTask(ids.taskId, text, d.now);
  d.journal.blocks.unshift({ id: ids.blockId, kind: "task", taskId: ids.taskId });
  d.orchestrations ??= {};
  d.orchestrations[ids.taskId] = emptyOrch(ids.taskId, label, d.now);
  d.ideaPlans ??= {};
  const planId = rootPlanId(ids.taskId);
  d.ideaPlans[planId] = {
    id: planId,
    taskId: ids.taskId,
    itemId: null,
    title: label,
    script: travel ? "travel" : "generic",
    step: 0,
    round: 0,
    thinking: false,
    draft: travel ? rootSkeleton() : genericSkeleton(),
    draftVersion: 1,
    adopted: null,
    turns: [{ id: `${planId}-u0`, role: "user", scope: "root", at: d.now, text }],
    drafts: [],
    demo,
    discussion: { agentId: d.defaultAgent, conclusions: [] },
  };
  if (!demo && text.trim()) {
    d.ideaPlans[planId].draft.sections.find((s) => s.id === "s-goal")?.lines.push({
      id: `${planId}-user-intent`, text: text.trim(), state: "fixed", userEdited: true,
    });
  }
  if (!travel) d.ideaPlans[planId].title = text;
  return planId;
}

export function pushUser(d: Snapshot, planId: string, text: string, scope: string, uid: Uid) {
  const p = d.ideaPlans![planId];
  p.turns.push({ id: uid("turn"), role: "user", scope, at: d.now, text });
  p.thinking = true;
}

/** 演示 AI 的一轮：按预设脚本更新同一份方案，返回本轮修改范围；段落范围只改该段 */
export function aiStepIn(d: Snapshot, planId: string, scope: string, uid: Uid) {
  const p = d.ideaPlans![planId];
  p.thinking = false;
  const sectionScoped = scope !== "root" && p.script === "travel";
  const step = sectionScoped ? TRAVEL_SECTION_REPLIES[scope] : stepsFor(p)[p.step];
  if (!step) {
    p.turns.push({
      id: uid("turn"),
      role: "ai",
      scope,
      at: d.now,
      text: "演示脚本已到这里：可以直接编辑方案，或整理为任务。",
    });
    return;
  }
  if (!sectionScoped) p.step++;
  p.round++;
  const r = applyOps(p.draft, step.ops, p.round);
  p.draft = r.doc;
  if (r.changes.length) p.draftVersion++;
  p.turns.push({
    id: uid("turn"),
    role: "ai",
    scope,
    at: d.now,
    text: step.ai,
    options: step.options,
    compare: step.compare,
    changes: r.changes,
    kept: r.kept.length ? r.kept : undefined,
    conflict: step.conflict ? { ...step.conflict } : undefined,
  });
}

export function editLineIn(d: Snapshot, planId: string, lineId: string, patch: { text?: string; state?: "fixed" | "tentative" | "open" }) {
  const p = d.ideaPlans![planId];
  const hit = findLine(p.draft, lineId);
  if (!hit) return false;
  if (patch.text != null && patch.text.trim() && patch.text !== hit.line.text) hit.line.text = patch.text.trim();
  if (patch.state) hit.line.state = patch.state;
  hit.line.userEdited = true;
  p.draftVersion++;
  return true;
}

/** 生成或更新草稿：保留用户对已有草稿的编辑与删除，不重复生成整棵树 */
export function generateDraftsIn(d: Snapshot, planId: string) {
  const p = d.ideaPlans![planId];
  const o = d.orchestrations?.[p.taskId] ?? null;
  const fresh = (p.demo === "travel"
    ? buildDrafts(docWithInherit(d, p), templatesFor(p), o)
    : contentDrafts(p, o)).filter(
    (x) => !(p.dismissed ?? []).includes(x.key),
  );
  const prev = new Map(p.drafts.map((x) => [x.key, x]));
  p.drafts = fresh.map((x) => {
    const old = prev.get(x.key);
    if (!old?.edited) return { ...x, include: x.include && old?.include !== false };
    return { ...x, title: old.title, expected: old.expected, owner: old.owner, agentId: old.agentId, parentKey: old.parentKey, edited: true, include: x.include && old.include !== false };
  });
}

function itemIdFor(p: IdeaPlan, key: string) {
  return p.itemId ? `${p.itemId}-${key}` : `w-${key}`;
}

function insertAfterSubtree(o: Orchestration, parentId: string, id: string) {
  const desc = new Set<string>([parentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of o.itemOrder) if (!desc.has(x) && desc.has(o.items[x]?.parentTaskId)) (desc.add(x), (changed = true));
  }
  let at = -1;
  o.itemOrder.forEach((x, i) => desc.has(x) && (at = i));
  if (at < 0) o.itemOrder.push(id);
  else o.itemOrder.splice(at + 1, 0, id);
}

/** 前置未完成 → 等待前置；前置完成 → 未开始（只作用于人工方案生成的任务树） */
export function refreshBlocked(o: Orchestration) {
  if (o.mainAgentId) return;
  for (const w of Object.values(o.items)) {
    if (w.status !== "blocked" && w.status !== "not_started") continue;
    const ready = w.dependsOnTaskIds.every((id) => {
      const dep = o.items[id];
      return !dep || dep.status === "done" || dep.status === "cancelled";
    });
    w.status = ready ? "not_started" : "blocked";
  }
}

/** 加入任务：幂等（按草稿键），采用当前方案版本作为来源；不启动 Agent */
export function addDraftsIn(d: Snapshot, planId: string) {
  const p = d.ideaPlans![planId];
  d.orchestrations ??= {};
  const o = d.orchestrations[p.taskId] ??= emptyOrch(p.taskId, p.title, d.now);
  const chosen = p.drafts.filter((x) => x.include);
  const changed = !p.adopted || JSON.stringify(p.adopted.doc) !== JSON.stringify(p.draft);
  const version = changed ? (p.adopted?.version ?? 0) + 1 : p.adopted!.version;
  // 修订会影响已加入的任务时不静默采用：新任务记为待采用版本，已采用版本保持，由修订影响面板处理
  const impact = p.adopted && changed ? revisionImpact(p, o, Object.values(d.ideaPlans ?? {})) : null;
  const affected = impact ? impact.update.length + impact.running.length + impact.done.length + impact.obsolete.length : 0;
  if (changed && !affected) p.adopted = { version, doc: cloneDoc(p.draft), at: d.now, draftVersion: p.draftVersion, conclusionIds: adoptedConclusionsAt(p, p.draftVersion).map(conclusion => conclusion.id) };
  let added = 0;
  let existing = 0;
  const byKey = (key: string) => Object.values(o.items).find((w) => w.draftKey === key);
  for (const x of chosen) {
    if (byKey(x.key)) {
      existing++;
      x.include = false;
      continue;
    }
    const id = itemIdFor(p, x.key);
    const parent = x.parentKey ? (byKey(x.parentKey)?.id ?? itemIdFor(p, x.parentKey)) : (p.itemId ?? p.taskId);
    const parentItem = o.items[parent];
    const item: WorkItem = {
      id,
      rootTaskId: p.taskId,
      parentTaskId: parentItem || parent === p.taskId ? parent : (p.itemId ?? p.taskId),
      title: x.title,
      phase: parentItem?.phase ?? x.phase,
      dependsOnTaskIds: x.deps.map((k) => byKey(k)?.id ?? itemIdFor(p, k)).filter((k) => k !== id),
      owner: x.owner,
      suggestedAgentId: x.owner === "agent" ? (x.agentId ?? "claude") : undefined,
      status: "not_started",
      attemptIds: [],
      expected: x.expected,
      source: { planId, version, lineIds: x.lineIds },
      minDays: x.minDays,
      draftKey: x.key,
    };
    o.items[id] = item;
    if (item.parentTaskId === p.taskId) o.itemOrder.push(id);
    else insertAfterSubtree(o, item.parentTaskId, id);
    x.include = false;
    added++;
  }
  // 依赖指向未加入的草稿时去掉，避免悬空
  for (const w of Object.values(o.items)) w.dependsOnTaskIds = w.dependsOnTaskIds.filter((id) => o.items[id]);
  refreshBlocked(o);
  return { added, existing, version };
}

export function openLocalPlanIn(d: Snapshot, taskId: string, itemId: string) {
  d.ideaPlans ??= {};
  const id = localPlanId(taskId, itemId);
  if (d.ideaPlans[id]) return { id, created: false };
  const o = d.orchestrations?.[taskId];
  const item = o?.items[itemId];
  const daily = item?.draftKey === "daily";
  const root = rootPlanOf(d, taskId);
  const fixedIds = root ? (root.adopted?.doc ?? root.draft).sections.find((s) => s.id === "s-fixed")?.lines.map((l) => l.id) ?? [] : [];
  d.ideaPlans[id] = {
    id,
    taskId,
    itemId,
    title: item?.title ?? "子任务",
    script: daily ? "daily" : "generic-local",
    step: 0,
    round: 0,
    thinking: false,
    draft: daily ? dailySkeleton() : { sections: [{ id: "s-goal", title: "目标", kind: "key", lines: [] }, { id: "s-open", title: "待决定", kind: "key", lines: [] }] },
    draftVersion: 1,
    adopted: null,
    turns: [],
    drafts: [],
    inherit: daily ? INHERITED_LINES : fixedIds,
    demo: root?.demo,
    discussion: { agentId: root?.discussion?.agentId ?? d.defaultAgent, conclusions: [] },
  };
  return { id, created: true };
}

/** 局部建议与上级冲突：只能提交为上级“待决定”，不静默修改上级已确定条目 */
export function resolveConflictIn(d: Snapshot, planId: string, turnId: string, choice: "submitted" | "declined", uid: Uid) {
  const p = d.ideaPlans![planId];
  const t = p.turns.find((x) => x.id === turnId);
  if (!t?.conflict || t.conflict.resolved) return false;
  t.conflict.resolved = choice;
  if (choice === "submitted") {
    const root = rootPlanOf(d, p.taskId);
    const open = root?.draft.sections.find((s) => s.id === "s-open");
    if (root && open) {
      open.lines.push({ id: uid("l-q"), text: `是否允许：${t.conflict.text}？（来自：${p.title}）`, state: "open", round: root.round });
      root.draftVersion++;
    }
  }
  return true;
}

const AGENT_RESULT: Record<string, string> = {
  transport: "已整理高铁往返的时段与换乘要点（演示数据，不含实时价格与班次）。",
  note: "已按方案汇总图文计划笔记草稿；照片位使用参考图并注明来源。",
  pick: "每天 1 主 1 备的活动清单已整理。",
};
export const agentResult = (w: WorkItem) => AGENT_RESULT[w.draftKey ?? ""] ?? `已完成：${w.title}`;

/** 应用修订：未开始的更新来源版本；执行中保留当前版本并提示；已完成保留成果，可新建补充任务 */
export function applyRevisionIn(d: Snapshot, planId: string, supplement: string[], uid: Uid) {
  const p = d.ideaPlans![planId];
  const o = d.orchestrations![p.taskId];
  const impact = revisionImpact(p, o, Object.values(d.ideaPlans ?? {}));
  if (!impact || !p.adopted) return null;
  const version = p.adopted.version + 1;
  const oldDays = daysOf(p.adopted.doc);
  const newDays = daysOf(p.draft);
  const swapDays = (s?: string) =>
    s && oldDays != null && newDays != null ? s.replace(`${oldDays} 天`, `${newDays} 天`).replace(`共 ${oldDays * 3} 张`, `共 ${newDays * 3} 张`) : s;
  const live = (id: string) => o.items[id];
  for (const w of impact.update) {
    const x = live(w.id);
    x.expected = swapDays(x.expected);
    if (x.source?.planId === planId) x.source.version = version;
    x.reviewNote = x.source?.planId === planId ? undefined : `上级方案 v${version} 已修订，已按新条件更新`;
  }
  for (const w of impact.obsolete) {
    const x = live(w.id);
    if (x.status === "done") x.reviewNote = `方案 v${version}：${newDays} 天，此项成果保留但已不再需要`;
    else if (x.status === "not_started" || x.status === "blocked") {
      x.status = "cancelled";
      x.statusReason = `方案 v${version} 改为 ${newDays} 天，不再需要（记录保留）`;
    } else x.reviewNote = `方案 v${version} 改为 ${newDays} 天，此项可能不再需要；执行中未改动`;
  }
  for (const w of impact.running) live(w.id).reviewNote = `按 v${w.source?.version} 执行中；v${version} 已修订，完成后复核`;
  let created = 0;
  for (const w of impact.done) {
    const x = live(w.id);
    x.reviewNote = `成果按 v${w.source?.version} 完成，已保留`;
    if (!supplement.includes(w.id)) continue;
    const id = uid("w-sup");
    o.items[id] = {
      id,
      rootTaskId: p.taskId,
      parentTaskId: x.parentTaskId,
      title: `复核：${x.title}（按 v${version}）`,
      phase: x.phase,
      dependsOnTaskIds: [],
      owner: x.owner === "agent" || x.executorId ? "agent" : (x.owner ?? "me"),
      suggestedAgentId: x.executorId ? o.executors[x.executorId]?.agentId : x.suggestedAgentId,
      status: "not_started",
      attemptIds: [],
      expected: `按 ${newDays ?? "新"} 天复核“${x.title}”的成果`,
      source: { planId, version, lineIds: x.source?.lineIds ?? [] },
      draftKey: `${x.draftKey ?? x.id}-v${version}`,
    };
    insertAfterSubtree(o, x.id, id);
    created++;
  }
  p.adopted = { version, doc: cloneDoc(p.draft), at: d.now, draftVersion: p.draftVersion, conclusionIds: adoptedConclusionsAt(p, p.draftVersion).map(conclusion => conclusion.id) };
  refreshBlocked(o);
  return { version, updated: impact.update.length, obsolete: impact.obsolete.length, running: impact.running.length, done: impact.done.length, created };
}

export type { TaskDraft };
