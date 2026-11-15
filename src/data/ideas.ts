import type { IdeaPlan, LineState, Orchestration, PlanDoc, PlanLine, PlanSection, TaskDraft, WorkItem } from "./types";

// 事项方案的纯逻辑：按轮更新同一份方案（保护用户编辑）、生成任务草稿、修订影响。
// 影响分析只依据“任务来源段落”的显式关联，不做语义推断。

export type PlanOp =
  | { op: "add"; section: string; line: Omit<PlanLine, "round"> }
  | { op: "set"; line: string; text?: string; state?: LineState }
  | { op: "remove"; line: string };

export interface ScriptStep {
  ai: string;
  ops: PlanOp[];
  options?: { label: string; action?: "drafts" }[];
  compare?: { cols: [string, string]; rows: [string, string, string][]; note?: string };
  conflict?: { text: string; parentLine: string };
}

export interface DraftTemplate {
  key: string;
  title: string;
  expected: (doc: PlanDoc) => string;
  deps: string[];
  owner: TaskDraft["owner"];
  agentId?: string;
  lineIds: string[];
  /** 这些条目必须已确定才可加入 */
  requires: string[];
  phase: string;
  parentKey?: string;
  minDays?: number;
}

export function cloneDoc(doc: PlanDoc): PlanDoc {
  return JSON.parse(JSON.stringify(doc));
}

export function findLine(doc: PlanDoc, id: string): { section: PlanSection; line: PlanLine } | null {
  for (const section of doc.sections) {
    const line = section.lines.find((l) => l.id === id);
    if (line) return { section, line };
  }
  return null;
}

/** 应用一轮更新：用户编辑过的条目不改不删，记入 kept */
export function applyOps(doc: PlanDoc, ops: PlanOp[], round: number) {
  const next = cloneDoc(doc);
  const counts = new Map<string, { added: number; changed: number; removed: number }>();
  const bump = (section: string, k: "added" | "changed" | "removed") => {
    const c = counts.get(section) ?? { added: 0, changed: 0, removed: 0 };
    c[k]++;
    counts.set(section, c);
  };
  const kept: string[] = [];
  for (const op of ops) {
    if (op.op === "add") {
      const sec = next.sections.find((s) => s.id === op.section);
      if (!sec || findLine(next, op.line.id)) continue;
      sec.lines.push({ ...op.line, round });
      bump(sec.title, "added");
    } else {
      const hit = findLine(next, op.line);
      if (!hit) continue;
      if (hit.line.userEdited) {
        kept.push(hit.line.text);
        continue;
      }
      if (op.op === "remove") {
        hit.section.lines = hit.section.lines.filter((l) => l.id !== op.line);
        bump(hit.section.title, "removed");
      } else {
        if (op.text != null) hit.line.text = op.text;
        if (op.state) hit.line.state = op.state;
        hit.line.round = round;
        bump(hit.section.title, "changed");
      }
    }
  }
  const changes = [...counts.entries()].map(([section, c]) => ({ section, ...c }));
  return { doc: next, changes, kept };
}

export function countOpen(doc: PlanDoc) {
  return doc.sections.reduce((n, s) => n + s.lines.filter((l) => l.state === "open").length, 0);
}

export function daysOf(doc: PlanDoc | null | undefined): number | null {
  const t = doc ? findLine(doc, "l-days")?.line.text : null;
  const m = t?.match(/(\d+)\s*天/);
  return m ? Number(m[1]) : null;
}

/** 由方案生成任务草稿：只有来源已确定的部分默认加入；已加入过的标记为不会重复 */
export function buildDrafts(doc: PlanDoc, templates: DraftTemplate[], orch: Orchestration | null): TaskDraft[] {
  const days = daysOf(doc);
  return templates
    .filter((t) => !t.minDays || days == null || days >= t.minDays)
    .map((t) => {
      const missing = t.requires.filter((id) => findLine(doc, id)?.line.state !== "fixed");
      const added = orch ? Object.values(orch.items).some((w) => w.draftKey === t.key) : false;
      return {
        key: t.key,
        title: t.title,
        expected: t.expected(doc),
        deps: t.deps,
        owner: t.owner,
        agentId: t.agentId,
        lineIds: t.lineIds,
        phase: t.phase,
        parentKey: t.parentKey,
        minDays: t.minDays,
        include: missing.length === 0 && !added,
        notReady: missing.length ? "来源仍有待定项" : undefined,
      };
    });
}

/** 两个版本之间被改动的条目（文本、状态、增删） */
export function changedLines(a: PlanDoc, b: PlanDoc) {
  const map = (d: PlanDoc) => new Map(d.sections.flatMap((s) => s.lines.map((l) => [l.id, l] as const)));
  const ma = map(a);
  const mb = map(b);
  const ids = new Set<string>();
  for (const [id, l] of mb) {
    const o = ma.get(id);
    if (!o || o.text !== l.text || o.state !== l.state) ids.add(id);
  }
  for (const id of ma.keys()) if (!mb.has(id)) ids.add(id);
  return ids;
}

export interface RevisionImpact {
  fromVersion: number;
  changed: string[];
  update: WorkItem[];
  running: WorkItem[];
  done: WorkItem[];
  obsolete: WorkItem[];
}

/** 方案修订对已加入任务的影响：只看来源段落是否改动，按任务状态分类 */
export function revisionImpact(
  plan: IdeaPlan,
  orch: Orchestration | null,
  allPlans: IdeaPlan[],
): RevisionImpact | null {
  if (!plan.adopted || !orch) return null;
  const changed = changedLines(plan.adopted.doc, plan.draft);
  if (!changed.size) return null;
  const days = daysOf(plan.draft);
  const planIds = new Set([plan.id, ...allPlans.filter((p) => p.taskId === plan.taskId).map((p) => p.id)]);
  const adoptedV = plan.adopted.version;
  // 已按更新版本加入的任务不算受影响
  const items = Object.values(orch.items).filter(
    (w) => w.source && planIds.has(w.source.planId) && !(w.source.planId === plan.id && w.source.version > adoptedV),
  );
  const hit = (w: WorkItem) => w.source!.lineIds.some((id) => changed.has(id));
  const obsolete = items.filter((w) => w.minDays && days != null && days < w.minDays && w.status !== "cancelled");
  const rest = items.filter((w) => hit(w) && !obsolete.includes(w) && w.status !== "cancelled");
  return {
    fromVersion: plan.adopted.version,
    changed: [...changed],
    update: rest.filter((w) => w.status === "not_started" || w.status === "blocked" || w.status === "queued"),
    running: rest.filter((w) => ["running", "waiting_reply", "waiting_permission", "failed"].includes(w.status)),
    done: rest.filter((w) => w.status === "done" || w.status === "review"),
    obsolete,
  };
}
