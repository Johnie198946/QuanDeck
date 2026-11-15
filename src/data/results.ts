import type { DiscussionConclusion, IdeaPlan, Orchestration, PlanDoc, Snapshot, WorkItem } from "./types";
import { latestAttempt, pathOf, summarize } from "./orchestration";
import { rootPlanOf } from "./ideaEngine";
import { taskView } from "./derive";
import { adoptedConclusionsAt } from "./discussion";

export interface ResultRecord {
  id: string;
  title: string;
  text: string;
  at: string;
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
  if (orchestration) {
    reports = workBranch(orchestration, itemId).flatMap(item => {
      const attempt = latestAttempt(orchestration, item);
      const round = attempt?.rounds.at(-1);
      if (item.status !== "done" || !round || !attempt || attempt.status !== "done") return [];
      return [{ id: attempt.id, title: item.title, text: round.reply, at: round.at,
        agentId: orchestration.executors[attempt.executorId]?.agentId,
        attemptId: attempt.id, itemId: item.id, sessionId: attempt.sessionId }];
    });
  }
  if (itemId) return reports;
  // A main task also owns the final coordinator report and merged external sessions.
  // Child sessions already represented by attempts must not appear twice; embedded
  // child calls may share the main session, whose final report remains independent.
  const childSessions = new Set(Object.values(orchestration?.attempts ?? {}).map(attempt => attempt.sessionId).filter(id => id && id !== orchestration?.mainSessionId));
  const sessions = [...new Set(snap.tasks[taskId]?.sessionIds ?? [])].flatMap(id => {
    if (childSessions.has(id)) return [];
    const session = snap.sessions[id];
    const round = session?.rounds.at(-1);
    if (!session || session.status !== "archived" || !round) return [];
    return [{ id: session.id, title: session.title, text: round.reply, at: round.at, agentId: session.agentId, sessionId: session.id }];
  });
  return [...sessions, ...reports];
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
