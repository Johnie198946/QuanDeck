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
  const ingest = (payload: SnapshotEnvelope) => {
    const s = payload?.snapshot;
    if (!Number.isSafeInteger(payload?.revision) || payload.revision < 0 || !s?.project?.id ||
      !Array.isArray(s?.agents) || !Array.isArray(s?.journal?.blocks) || !s?.tasks || !s?.sessions)
      throw new Error("服务返回的工作台数据不完整");
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
    if (!refreshing) refreshing = request("snapshot").then(ingest).finally(() => { refreshing = null; });
    return refreshing;
  };
  const reportConnection = (connected: boolean) => {
    window.dispatchEvent(new CustomEvent("quandeck:runtime-status", { detail: { connected } }));
  };
  const commands = [
    "updateJournal", "addBlock", "updateText", "deleteBlock", "updateTaskTitle", "convertTextToTask",
    "dispatch", "cancelDispatch", "reconcile", "retryDispatch", "completeTask", "reopenTask", "resumeAutoFollow", "linkSession",
    "setTracked", "toggleStar", "togglePin", "setDefaultAgent", "registerAgent", "scanAgent", "createIdea", "ensureTaskPlan", "setDiscussionAgent",
    "recordDiscussionConclusion", "adoptDiscussionConclusion", "editPlanLine", "generateDrafts", "updateDraft", "removeDraft",
    "mergeDraftUp", "indentDraft", "addDraftsToTasks", "openLocalPlan", "resolveConflict", "setWorkOwner", "setWorkStatus",
    "dispatchWork", "applyRevision", "addCustomAgent", "updateCustomAgent", "removeCustomAgent", "addPlan", "applyExecutionEvent",
  ] as const satisfies readonly (keyof WorkdeckDataSource)[];
  const command = async (name: string, args: unknown[]) => {
    const payload: CommandEnvelope = await request(`commands/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ args, expectedRevision: revision }),
    });
    ingest(payload);
    return payload.result;
  };
  return {
    mode: "live",
    load,
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
