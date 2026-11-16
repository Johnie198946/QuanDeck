import type { WorkdeckDataSource } from "./repository";
import type { Snapshot } from "./types";

export interface SnapshotEnvelope { revision: number; snapshot: Snapshot }
export interface CommandEnvelope<T = unknown> { result: T; revision: number; snapshot: Snapshot }

/** Same business interface as the sample store. The backend owns state and acknowledgements. */
export function createHttpDataSource(baseUrl: string): WorkdeckDataSource & { navigateToDate(date: string): Promise<void> } {
  const base = baseUrl.replace(/\/$/, "");
  const listeners = new Set<(snapshot: Snapshot) => void>();
  let revision = -1;
  let current: Snapshot | null = null;
  let stream: EventSource | null = null;
  let refreshing: Promise<Snapshot> | null = null;
  let scopeEpoch = 0;
  const ingest = (payload: SnapshotEnvelope, allowProjectChange = false) => {
    const s = payload?.snapshot;
    if (!Number.isSafeInteger(payload?.revision) || payload.revision < 0 || typeof s?.project?.id !== "string" ||
      !Array.isArray(s?.agents) || !Array.isArray(s?.journal?.blocks) || !s?.tasks || !s?.sessions)
      throw new Error("服务返回的工作台数据不完整");
    if (current && current.project.id !== s.project.id) {
      if (!allowProjectChange) return current;
      current = null; revision = -1;
    }
    if (payload.revision < revision && current) return current;
    if (payload.revision === revision && current) return current;
    revision = payload.revision;
    current = s;
    for (const listener of listeners) listener(s);
    return s;
  };
  const request = async (path: string, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${base}/v1/${path}`, { credentials: "include", ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`工作台服务请求失败（${response.status}）`);
      return await response.json();
    } finally { clearTimeout(timer); }
  };
  const load = () => {
    if (!refreshing) {
      const epoch = scopeEpoch;
      refreshing = request("snapshot").then(payload => epoch !== scopeEpoch && current ? current : ingest(payload, !current)).finally(() => { refreshing = null; });
    }
    return refreshing;
  };
  const reportConnection = (connected: boolean) => {
    window.dispatchEvent(new CustomEvent("quandeck:runtime-status", { detail: { connected } }));
  };
  const commands = [
    "getQualityCostReport", "exportTaskRevisions", "previewTaskRevisions", "importTaskRevisions",
    "integrate", "reviewIntegration", "queryTaskMemory", "readTaskEvidence",
    "createProject", "switchProject", "updateProject", "deleteProject", "deleteTask", "createTaskWithAttachments", "setTaskAttachments", "saveTaskOutput", "deleteTaskOutput", "addManualSubtask", "setTaskOwner", "collaborate", "startReview", "summarizeTaskTitle", "submitIntake", "retryIntake", "resolveSuggestion", "refreshProjectSummary",
    "updateJournal", "addBlock", "updateText", "deleteBlock", "updateTaskTitle", "convertTextToTask",
    "dispatch", "cancelDispatch", "reconcile", "retryDispatch", "handoffSession", "completeTask", "reopenTask", "resumeAutoFollow", "linkSession", "createTaskFromSession",
    "setTracked", "toggleStar", "togglePin", "setDefaultAgent", "registerAgent", "scanAgent", "createIdea", "ensureTaskPlan", "setDiscussionAgent",
    "recordDiscussionConclusion", "adoptDiscussionConclusion", "approvePlan", "recordPlanConfirmation", "recordDiscussionFeedback", "editPlanLine", "generateDrafts", "updateDraft", "removeDraft",
    "mergeDraftUp", "indentDraft", "addDraftsToTasks", "openLocalPlan", "resolveConflict", "setWorkOwner", "setWorkStatus",
    "dispatchWork", "applyRevision", "addCustomAgent", "updateCustomAgent", "removeCustomAgent", "addPlan", "removePlan", "setPlanTimer", "applyPlanMoves", "manageNow", "applyExecutionEvent",
  ] as const satisfies readonly (keyof WorkdeckDataSource)[];
  const command = async (name: string, args: unknown[]) => {
    const changesProject = name === "switchProject" || name === "createProject" || name === "deleteProject";
    const epoch = changesProject ? ++scopeEpoch : scopeEpoch;
    const projectId = current?.project.id ?? null;
    const payload: CommandEnvelope = await request(`commands/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ args, expectedRevision: revision, projectId }),
    });
    if (epoch === scopeEpoch) ingest(payload, changesProject);
    return payload.result;
  };
  return {
    mode: "live",
    load,
    listProjects: async () => {
      const payload = await request("projects");
      if (!Array.isArray(payload?.projects) || payload.projects.some((snapshot: Snapshot) => !snapshot?.project?.id || !snapshot.tasks || !snapshot.sessions)) throw new Error("项目列表数据不完整");
      return payload.projects;
    },
    subscribe(listener: (snapshot: Snapshot) => void) {
      listeners.add(listener);
      if (!stream) {
        stream = new EventSource(`${base}/v1/events`, { withCredentials: true });
        stream.addEventListener("snapshot", (event) => {
          try { ingest(JSON.parse((event as MessageEvent).data)); reportConnection(true); }
          catch { reportConnection(false); }
        });
        // Reconnect always reconciles a fresh snapshot; a dropped event cannot silently lose state.
        stream.onopen = () => { void load().then(() => reportConnection(true)).catch(() => reportConnection(false)); };
        stream.onerror = () => reportConnection(false);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { stream?.close(); stream = null; }
      };
    },
    navigateToDate: async (date: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日记日期无效");
      await command("navigateToDate", [date]);
    },
    ...Object.fromEntries(commands.map((name) => [name, (...args: unknown[]) => command(name, args)])),
  } as WorkdeckDataSource & { navigateToDate(date: string): Promise<void> };
}
