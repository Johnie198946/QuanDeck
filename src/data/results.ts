import type { DiscussionConclusion, IdeaPlan, Orchestration, PlanDoc, Snapshot, WorkItem, OutputAttachment } from "./types";
import { latestAttempt, pathOf, summarize } from "./orchestration";
import { rootPlanOf } from "./ideaEngine";
import { taskView } from "./derive";
import { adoptedConclusionsAt } from "./discussion";

export interface ResultRecord {
  id: string;
  title: string;
  text: string;
  at: string;
  origin?: "human" | "agent";
  outputId?: string;
  links?: { label: string; url: string }[];
  attachments?: OutputAttachment[];
  agentId?: string;
  attemptId?: string;
  sessionId?: string;
  itemId?: string;
}

export interface TaskMethod {
  plan: IdeaPlan | null;
  doc: PlanDoc | null;
  version: number | null;
  adopted: boolean;
  inherited: boolean;
  unavailableVersion: number | null;
  conclusions: DiscussionConclusion[];
}

export function methodFor(snap: Snapshot, taskId: string, item: WorkItem | null): TaskMethod {
  const root = rootPlanOf(snap, taskId);
  const local = Object.values(snap.ideaPlans ?? {}).find(plan => plan.taskId === taskId && plan.itemId === item?.id);
  const plan = item?.source ? snap.ideaPlans?.[item.source.planId] : local ?? root;
  if (item?.source && (!plan || plan.taskId !== taskId)) {
    return { plan: null, doc: null, version: item.source.version, adopted: false, inherited: false, unavailableVersion: item.source.version, conclusions: [] };
  }
  if (!plan) return { plan: null, doc: null, version: null, adopted: false, inherited: false, unavailableVersion: null, conclusions: [] };
  const version = item?.source?.version ?? plan.adopted?.version ?? plan.draftVersion;
  const adopted = plan.adopted?.version === version ? plan.adopted : null;
  let doc = adopted ? adopted.doc : !item?.source && plan.draftVersion === version ? plan.draft : null;
  const unavailableVersion = doc ? null : version;
  // Task method versions and editable draft versions are separate sequences.
  // Legacy snapshots without a mapping keep the method body, never a guessed summary.
  const sourceDraftVersion = adopted ? adopted.draftVersion ?? null : plan.draftVersion;
  const conclusions = !doc ? [] : adopted?.conclusionIds ? (plan.discussion?.conclusions ?? []).filter(conclusion => adopted.conclusionIds!.includes(conclusion.id)) : sourceDraftVersion == null ? [] : adoptedConclusionsAt(plan, sourceDraftVersion);
  if (doc && item?.source?.lineIds.length) {
    const lines = new Set(item.source.lineIds);
    doc = { sections: doc.sections.map(section => ({ ...section, lines: section.lines.filter(line => lines.has(line.id)) })).filter(section => section.lines.length) };
  }
  return { plan, doc, version, adopted: !!adopted, inherited: !!item && plan.itemId !== item.id, unavailableVersion, conclusions };
}

export function workBranch(o: Orchestration, itemId: string | null) {
  const values = Object.values(o.items);
  return itemId ? values.filter(item => pathOf(o, item.id).some(parent => parent.id === itemId)) : values;
}

/** Completed reports keep their exact attempt identity. Ongoing replies remain progress. */
export function completedResults(snap: Snapshot, taskId: string, itemId: string | null): ResultRecord[] {
  const orchestration = snap.orchestrations?.[taskId];
  let reports: ResultRecord[] = [];
  if (!snap.tasks[taskId]) return [];
  const scope = new Set(orchestration ? workBranch(orchestration, itemId).map(item => item.id) : []);
  const manual: ResultRecord[] = Object.values(snap.outputs ?? {}).filter(output => output.taskId === taskId && output.status === "published" && (!itemId || !!output.workItemId && scope.has(output.workItemId))).map(output => ({
    id: `output:${output.id}`, outputId: output.id, title: output.title, text: output.body, at: output.updatedAt,
    origin: output.origin, itemId: output.workItemId ?? undefined, links: output.links, attachments: output.attachments,
  }));
  if (orchestration) {
    reports = workBranch(orchestration, itemId).flatMap(item => {
      const attempt = latestAttempt(orchestration, item);
      const round = attempt?.rounds.at(-1);
      if (item.status !== "done" || !round || !attempt || attempt.status !== "done") return [];
      return [{ origin: "agent" as const, id: attempt.id, title: item.title, text: round.reply, at: round.at,
        agentId: orchestration.executors[attempt.executorId]?.agentId,
        attemptId: attempt.id, itemId: item.id, sessionId: attempt.sessionId }];
    });
  }
  if (itemId) return [...reports, ...manual];
  // A main task also owns the final coordinator report and merged external sessions.
  // Child sessions already represented by attempts must not appear twice; embedded
  // child calls may share the main session, whose final report remains independent.
  const childSessions = new Set(Object.values(orchestration?.attempts ?? {}).map(attempt => attempt.sessionId).filter(id => id && id !== orchestration?.mainSessionId));
  const sessions = [...new Set(snap.tasks[taskId]?.sessionIds ?? [])].flatMap(id => {
    if (childSessions.has(id)) return [];
    const session = snap.sessions[id];
    const round = session?.rounds.at(-1);
    if (!session || session.status !== "archived" || !round) return [];
    return [{ origin: "agent" as const, id: session.id, title: session.title, text: round.reply, at: round.at, agentId: session.agentId, sessionId: session.id }];
  });
  // Transfer snapshots stay in the old task's history; they are not counted as a second deliverable.
  return [...sessions, ...reports, ...manual];
}

export function taskOverviewRows(snap: Snapshot) {
  return Object.values(snap.tasks).map(task => {
    const orchestration = snap.orchestrations?.[task.id];
    const summary = orchestration && Object.keys(orchestration.items).length ? summarize(snap, orchestration) : null;
    const status = task.completion ? "done" : summary?.overall.status ?? taskView(snap, task);
    return {
      task, status,
      running: status !== "done" && (summary ? summary.running > 0 : status === "running"),
      waiting: status !== "done" && (status === "review" || (summary ? summary.pending.length > 0 : ["waiting_reply", "waiting_permission"].includes(status))),
    };
  });
}

export function reportMarkdown(record: ResultRecord) {
  return [`# ${record.title}`, '', record.text, '', ...(record.links ?? []).map(link => `[${link.label || link.url}](${link.url})`), ...(record.attachments ?? []).map(file => `- 附件：${file.name}（${file.size} bytes）`), '', `${record.origin === 'human' ? '人工提交' : 'Agent 回报'} · ${record.at}`].join('\n');
}

export function resultComposition(records: ResultRecord[]) {
  return { total: records.length, human: records.filter(record => record.origin === 'human').length, agent: records.filter(record => record.origin !== 'human').length,
    text: records.filter(record => record.text.trim()).length, links: records.reduce((sum, record) => sum + (record.links?.length ?? 0), 0),
    files: records.reduce((sum, record) => sum + (record.attachments?.length ?? 0), 0) };
}

export function resultTime(at: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at)) return at;
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : at;
}
