import { retainMaterializedGoalPlan } from "./retainedGoalPlan";
import { readAgentConclusion } from "./discussionConclusion";
import { discussionScopeBrief, seedTaskDirection, scopedBreakdownIssue } from "./scopedDiscussion";
import { findLine } from "./ideas";
import type { DiscussionConclusion, IdeaPlan, PlanLine, Snapshot } from "./types";

export function hasDiscussionText(text: string): boolean {
  return /[^\s\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(text);
}

/** The newest adopted conclusion in each scope, bounded by the source draft revision. */
export function adoptedConclusionsAt(plan: IdeaPlan, draftVersion: number): DiscussionConclusion[] {
  const scopes = new Map<string, DiscussionConclusion>();
  for (const conclusion of plan.discussion?.conclusions ?? []) {
    if (!conclusion.adopted || conclusion.adoptedDraftVersion == null || conclusion.adoptedDraftVersion > draftVersion) continue;
    const previous = scopes.get(conclusion.scopeId);
    if (!previous || conclusion.adoptedDraftVersion >= previous.adoptedDraftVersion!) scopes.set(conclusion.scopeId, conclusion);
  }
  return [...scopes.values()];
}

/** 只返回准确范围的结论，不把上级或其他段落的结果冒充当前段落。 */
export function latestConclusion(plan: IdeaPlan, scope: string): DiscussionConclusion | null {
  const list = plan.discussion?.conclusions ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].scopeId === scope) return list[i];
  }
  return null;
}

/** Resume the last discussion only while its scope exists in this document. */
export function lastDirectionScope(snapshot: Snapshot, plan?: IdeaPlan): string {
  if (!plan) return 'root';
  const scopeExists = (scope: string) => scope === 'root' || plan.draft.sections.some(section => section.id === scope);
  const recent = snapshot.sessions[plan.discussion?.sessionId ?? ''];
  const rt = recent?.runtime;
  if (rt?.purpose === 'discussion' && rt.projectId === snapshot.project.id && rt.planId === plan.id &&
      !recent.linkedAsHistory && recent.dispatchPhase === 'acknowledged' &&
      !['archived', 'cancelled', 'failed'].includes(recent.status) && rt.scope && scopeExists(rt.scope)) return rt.scope;
  return [...(plan.discussion?.conclusions ?? [])].reverse().find(conclusion => scopeExists(conclusion.scopeId))?.scopeId ?? 'root';
}

function contentSummary(confirmed: string[], open: string[], tentative: string[] = []): string {
  return [
    confirmed.length ? `已确定：${confirmed.slice(0, 3).join("；")}` : "",
    !confirmed.length && tentative.length ? `方案暂定：${tentative.slice(0, 3).join("；")}` : "",
    open.length ? `待确认：${open.slice(0, 2).join("；")}` : "",
  ].filter(Boolean).join("。") + "。";
}

/** 本次只接受用户提供的无凭据 HTTP(S) 会话链接，不推测客户端协议。 */
export function safeDiscussionUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** 准备供用户复制到 Agent 的上下文；此函数不发送、不创建会话。 */
export function buildDiscussionBrief(snapshot: Snapshot, plan: IdeaPlan, scope: string): string {
  const root = Object.values(snapshot.ideaPlans ?? {}).find((p) => p.taskId === plan.taskId && !p.itemId);
  const section = scope === "root" ? null : plan.draft.sections.find((s) => s.id === scope);
  const selected = scope === "root" ? plan.draft.sections : section ? [section] : [];
  const taskTitle = snapshot.tasks[plan.taskId]?.title ?? root?.title ?? plan.title;
  const path = [taskTitle, plan.itemId ? plan.title : null, section?.title].filter(Boolean).join(" › ");
  const lines = selected.flatMap((s) => s.lines);
  const parentDoc = root?.adopted?.doc ?? root?.draft;
  const inherited = plan.itemId && parentDoc
    ? (plan.inherit ?? []).map((id) => findLine(parentDoc, id)?.line).filter((x): x is PlanLine => !!x)
    : [];
  const globalContext = !plan.itemId && scope !== "root"
    ? plan.draft.sections.filter((s) => s.kind === "key" && s.id !== scope).flatMap((s) => s.lines)
    : [];
  const bullet = (items: string[]) => items.length ? items.map((s) => `- ${s}`).join("\n") : "- 尚未记录";
  const source = latestConclusion(plan, scope);
  const out = [
    "讨论范围：" + path,
    discussionScopeBrief(snapshot, plan, scope),
    "本次只讨论，不据此启动业务任务或更改已有执行。",
    "当前方案草稿版本：" + plan.draftVersion + (plan.adopted ? `；已采用 v${plan.adopted.version}` : "；尚未采用"),
  ];
  if (inherited.length) out.push("继承的上级内容（修改前请提出差异）：\n" + bullet(inherited.map((l) => `[${l.state === "fixed" ? "已确定" : l.state === "open" ? "待定" : "暂定"}] ${l.text}`)));
  if (globalContext.length) out.push("全局目标与约束（只读背景；本次仅讨论所选段落，若需改变请先提出差异）：\n" + bullet(globalContext.map((l) => `[${l.state === "fixed" ? "已确定" : l.state === "open" ? "待定" : "暂定"}] ${l.text}`)));
  out.push("已确定：\n" + bullet(lines.filter((l) => l.state === "fixed").map((l) => l.text)));
  out.push("暂定：\n" + bullet(lines.filter((l) => l.state === "tentative").map((l) => l.text)));
  out.push("待确认：\n" + bullet(lines.filter((l) => l.state === "open").map((l) => l.text)));
  if (source) out.push(`最近记录的结论（${source.source === "sample" ? "演示快照" : source.source === 'agent' ? 'Agent 回传' : "手动带回"}）：\n${source.summary}`);
  if (scope !== "root" && !section) out.push("所选段落已不存在，请先确认范围，不要推测缺失内容。");

  return out.join("\n\n");
}

/** schema 4 原地兼容：保留文档和历史，仅清除旧本地思考状态并标出演示结论。 */
export function normalizeDiscussionState(snapshot: Snapshot): boolean {
  let changed = false;
  for (const plan of Object.values(snapshot.ideaPlans ?? {})) {
    if (seedTaskDirection(snapshot, plan)) changed = true;
    if (plan.thinking) { plan.thinking = false; changed = true; }
    if (!plan.discussion) {
      plan.discussion = { agentId: snapshot.defaultAgent, conclusions: [] };
      changed = true;
    }
    for (const conclusion of plan.discussion.conclusions) {
      // Older builds stored a valid empty-task protocol object as summary text. Recover
      // its projection from that exact public reply; never rewrite adopted decisions.
      if (conclusion.source === 'agent' && !conclusion.adopted) {
        const recovered = readAgentConclusion(conclusion.summary);
        if (recovered.summary !== conclusion.summary) {
          const scopeIssue = scopedBreakdownIssue(snapshot, plan, conclusion.scopeId, recovered.tasks);
          if (scopeIssue) { recovered.tasks = []; recovered.deliverables = []; recovered.open = [...recovered.open, scopeIssue]; }
          Object.assign(conclusion, recovered); changed = true;
        }
      }
      if (conclusion.source === "sample" && conclusion.summary.startsWith("当前方案保留 ")) {
        const lines = plan.draft.sections.filter((s) => conclusion.scopeId === "root" || s.id === conclusion.scopeId).flatMap((s) => s.lines);
        conclusion.summary = contentSummary(conclusion.confirmed, conclusion.open, lines.filter((l) => l.state === "tentative").map((l) => l.text));
        changed = true;
      }
    }
    const latestTasks = [...plan.discussion.conclusions].reverse().find(conclusion => conclusion.scopeId === 'root' && conclusion.tasks !== undefined);
    if (latestTasks?.tasks?.length === 0 && plan.drafts.length) { plan.drafts = []; changed = true; }
    if (retainMaterializedGoalPlan(snapshot, plan)) changed = true;
    // 只有曾由旧脚本生成的快照才补演示记录；新建事项和手动结论不补假回传。
    if (plan.round <= 0 || plan.discussion.conclusions.length > 0) continue;
    const scopes = [
      { id: "root", lines: plan.draft.sections.flatMap((s) => s.lines) },
      ...plan.draft.sections.filter((s) => s.kind === "body").map((s) => ({ id: s.id, lines: s.lines })),
    ];
    for (const scope of scopes) {
      if (!scope.lines.length) continue;
      const confirmed = scope.lines.filter((l) => l.state === "fixed").map((l) => l.text);
      const open = scope.lines.filter((l) => l.state === "open").map((l) => l.text);
      const tentative = scope.lines.filter((l) => l.state === "tentative").map((l) => l.text);
      const summary = contentSummary(confirmed, open, tentative);
      plan.discussion.conclusions.push({
        id: `sample-conclusion-${plan.id}-${scope.id}`,
        agentId: plan.discussion.agentId,
        scopeId: scope.id,
        recordedAt: snapshot.now,
        summary,
        confirmed,
        open,
        source: "sample",
        adopted: true,
        adoptedAt: snapshot.now,
        adoptedDraftVersion: plan.draftVersion,
      });
      changed = true;
    }
  }
  return changed;
}
