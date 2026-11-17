import { idleSessionDelivery, sessionSubmissionIssue as submissionIssue } from './sessionDelivery';
import { discussionSummary } from './discussionSnippets';
import { latestAttempt } from "./orchestration";
import type { Session, Snapshot, Step } from "./types";
import type { SourceReference } from "../integration/contracts";
import { pendingSessionStatus } from './derive';
import { redactRuntimeText } from './runtimePresentation';
import { settledDiscussion } from './settledDiscussion';

export type ActivityState = "running" | "queued" | "waiting_reply" | "waiting_permission" | "failed";
export interface ActivityCounts { running: number; queued: number; waitingReply: number; waitingPermission: number; failed: number }
export interface ProjectActivityEntry {
  id: string;
  title: string;
  state: ActivityState;
  agentId?: string;
  taskId?: string;
  itemId?: string;
  attemptId?: string;
  sessionId?: string;
  parentSessionId?: string;
  subAgentId?: string;
  source?: SourceReference;
  detail?: string;
  step?: Step | null;
  percent?: number | null;
}
export interface ProjectActivityGroup {
  id: string;
  title: string;
  taskId?: string;
  counts: ActivityCounts;
  entries: ProjectActivityEntry[];
}
export interface ProjectActivity {
  projectId: string;
  counts: ActivityCounts;
  groups: ProjectActivityGroup[];
  entries: ProjectActivityEntry[];
  asOf: string;
}
const states: ActivityState[] = ["running", "queued", "waiting_reply", "waiting_permission", "failed"];
const relevant = (value: string): value is ActivityState => states.includes(value as ActivityState);
const priority: Record<ActivityState, number> = { waiting_permission: 0, waiting_reply: 1, failed: 2, running: 3, queued: 4 };
export const countActivity = (entries: ProjectActivityEntry[]): ActivityCounts => entries.reduce((counts, entry) => {
  const field = entry.state === "waiting_reply" ? "waitingReply" : entry.state === "waiting_permission" ? "waitingPermission" : entry.state;
  counts[field]++;
  return counts;
}, { running: 0, queued: 0, waitingReply: 0, waitingPermission: 0, failed: 0 });
export const waitingCount = (counts: ActivityCounts) => counts.waitingReply + counts.waitingPermission;
export const needsAttention = (entry: ProjectActivityEntry) =>
  entry.state === 'waiting_permission' || entry.state === 'waiting_reply' || entry.state === 'failed';

const inactiveSession = (session?: Session) => !!session && (session.linkedAsHistory || session.status === 'cancelled' || session.status === 'archived');
// The task ledger deliberately groups source waits under "paused". A concrete source
// question must remain actionable even when that coarser task projection is paused.
const sessionAttention = (session?: Session): ActivityState | undefined => {
  if (!session || inactiveSession(session)) return;
  const pending = session.status !== 'archived' ? pendingSessionStatus(session) : null;
  if (pending) return pending;
  if (submissionIssue(session)) return 'failed';
  if (session.runtime?.incident?.status === 'open' && session.runtime.incident.kind === 'failure') return 'failed';
  if (session.status === 'waiting_permission' || session.status === 'waiting_reply') return session.status;
  if (session.status === 'failed') return 'failed';
};
const sessionDetail = (session?: Session) => {
  if (!session) return;
  const requests = Object.values(session.runtime?.requests ?? (session.runtime?.request ? { [session.runtime.request.id]: session.runtime.request } : {}));
  const request = requests.find(request => request.kind === 'permission') ?? requests.at(-1);
  if (session.status !== 'archived' && request) return request.prompt;
  if (submissionIssue(session)) return submissionIssue(session);
  if (session.runtime?.incident?.status === 'open' && session.runtime.incident.kind === 'failure') return session.runtime.incident.message;
  if (session.status === 'failed') return (session.runtime?.incident?.status === 'open' ? session.runtime.incident.message : undefined) || session.waitingReason || session.step?.label;
  return session.waitingQuestion || session.waitingReason || (session.runtime?.incident?.status === 'open' ? session.runtime.incident.message : undefined);
};

/**
 * Unique active execution units, not the number of rendered cards.
 * An orchestration root is a roll-up when it has active child work; its main-session card is then omitted.
 * Different child sessions are distinct executions; duplicate references to the same session count once.
 * Queued, blocked, waiting, failed, and human-owned work never count as running Agents.
 */
export function deriveProjectActivity(snapshot: Snapshot): ProjectActivity {
  const entries = new Map<string, ProjectActivityEntry>();
  const deliveredIdle = (session?: Session) => !!idleSessionDelivery(snapshot, session);
  const represented = new Set<string>();
  const rollups = new Set<string>();
  const keyFor = (agentId: string | undefined, sessionId: string, source?: SourceReference) => source
    ? JSON.stringify(["runtime", source.connectionId, source.tool, source.childSessionId ?? source.sessionId, source.childSessionId ? "" : source.childCallId ?? ""])
    : JSON.stringify(["business", agentId ?? "unknown", sessionId]);
  const add = (entry: ProjectActivityEntry) => {
    if (entry.detail) entry = { ...entry, detail: redactRuntimeText(discussionSummary(entry.detail)) };
    const key = entry.sessionId ? keyFor(entry.agentId, entry.sessionId, entry.source) : entry.id;
    const existing = entries.get(key);
    if (!existing || priority[entry.state] < priority[existing.state]) entries.set(key, entry);
  };
  for (const orchestration of Object.values(snapshot.orchestrations ?? {})) {
    let hasChildActivity = false;
    for (const item of Object.values(orchestration.items)) {
      const attempt = latestAttempt(orchestration, item);
      const agentId = (attempt && orchestration.executors[attempt.executorId]?.agentId) || (item.executorId && orchestration.executors[item.executorId]?.agentId) || item.suggestedAgentId || undefined;
      const source = attempt?.source ?? (attempt?.sessionId ? snapshot.sessions[attempt.sessionId]?.source : undefined);
      if (attempt?.sessionId && (attempt.sessionId !== orchestration.mainSessionId || relevant(item.status))) represented.add(keyFor(agentId, attempt.sessionId, source));
      const session = attempt?.sessionId ? snapshot.sessions[attempt.sessionId] : undefined;
      const state = sessionAttention(session) ?? item.status;
      if (item.owner === "me" || inactiveSession(session) || deliveredIdle(session) || settledDiscussion(snapshot, session) || !relevant(state)) continue;
      // An unassigned human planning item is not an Agent queue.
      if (!agentId && !attempt) continue;
      hasChildActivity = true;
      add({ id: `work:${orchestration.taskId}:${item.id}`, title: item.title, state, agentId, taskId: orchestration.taskId, itemId: item.id, attemptId: attempt?.id, sessionId: attempt?.sessionId, source, step: attempt?.step, percent: attempt?.sessionId ? snapshot.sessions[attempt.sessionId]?.percent : undefined, detail: sessionDetail(session) || item.waiting?.question || item.statusReason || attempt?.step?.label });
    }
    if (hasChildActivity && orchestration.mainSessionId) rollups.add(keyFor(orchestration.mainAgentId, orchestration.mainSessionId, snapshot.sessions[orchestration.mainSessionId]?.source));
  }
  for (const session of Object.values(snapshot.sessions)) {
    if (inactiveSession(session)) continue;
    const key = keyFor(session.agentId, session.id, session.source);
    let childActive = false;
    for (const child of session.subAgents) {
      const childKey = keyFor(session.agentId, child.sessionRef, child.source);
      if (!relevant(child.status) || represented.has(childKey)) continue;
      childActive = true;
      add({ id: `sub:${session.id}:${child.id}`, title: child.title, state: child.status, agentId: session.agentId, taskId: session.taskId ?? undefined, sessionId: child.sessionRef, parentSessionId: session.id, subAgentId: child.id, source: child.source });
    }
    const state = sessionAttention(session) ?? (session.status === "pending" && session.dispatchPhase === "acknowledged" ? "queued" : session.status);
    if (!relevant(state) || deliveredIdle(session) || settledDiscussion(snapshot, session) || session.linkedAsHistory || represented.has(key) || (rollups.has(key) && state === "running")) continue;
    // A parent in an observed session aggregates its running children; a concrete question still needs attention.
    if (childActive && session.status === "running") continue;
    add({ id: `session:${session.id}`, title: session.title, state, agentId: session.agentId, taskId: session.taskId ?? undefined, sessionId: session.id, source: session.source, step: session.step, percent: session.percent, detail: sessionDetail(session) || session.step?.label });
  }
  const result = [...entries.values()].sort((a, b) => priority[a.state] - priority[b.state] || a.title.localeCompare(b.title));
  const groups = new Map<string, ProjectActivityGroup>();
  for (const entry of result) {
    const id = entry.taskId ?? "unlinked";
    let group = groups.get(id);
    if (!group) {
      group = { id, taskId: entry.taskId, title: entry.taskId ? (snapshot.tasks[entry.taskId]?.title ?? snapshot.orchestrations?.[entry.taskId]?.label ?? "关联任务") : "未关联会话", counts: countActivity([]), entries: [] };
      groups.set(id, group);
    }
    group.entries.push(entry);
  }
  for (const group of groups.values()) group.counts = countActivity(group.entries);
  return { projectId: snapshot.project.id, counts: countActivity(result), groups: [...groups.values()], entries: result, asOf: snapshot.lastSync };
}

/** Optional server-calculated aggregate. The wire shape is the same as deriveProjectActivity. */
export interface ProjectActivityBackend {
  getActivity(projectId: string, signal?: AbortSignal): Promise<ProjectActivity>;
}
export function createHttpActivityBackend(baseUrl: string): ProjectActivityBackend {
  return { async getActivity(projectId, signal) {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/v1/activity`, typeof location === "undefined" ? "http://localhost" : location.origin);
    url.searchParams.set("projectId", projectId);
    const response = await fetch(url, { signal, credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`项目状态暂不可用（${response.status}）`);
    const value = await response.json() as ProjectActivity;
    if (value.projectId !== projectId || !Array.isArray(value.groups) || !Array.isArray(value.entries) || !value.counts || !Object.values(value.counts).every(n => Number.isInteger(n) && n >= 0)) throw new Error("项目状态响应格式不正确");
    return value;
  } };
}
