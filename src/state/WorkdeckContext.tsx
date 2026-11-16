import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { WorkdeckDataSource, SessionLinkOptions } from "../data/repository";
import type { Agent, AgentId, CommandResult, Snapshot } from "../data/types";
import { configuredAgentIdentity, getConfiguredAgents } from "../integration/configuredAgents";
import { gateway } from "../integration/gateway";
import type { SourceReference } from "../integration/contracts";
import { desktopHost } from '../integration/desktop';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export type DragPayload =
  | { type: "task"; taskId: string }
  | { type: "session"; sessionId: string }
  | null;

export type RailPanel = "agents" | "stats" | "recent" | null;

/** 事项工作区：思路（方案 + Agent 结论）/ 任务（任务树 + 执行详情） */
export interface WorkspaceState {
  taskId: string;
  view: "plan" | "tasks" | "results";
  /** 讨论范围：root 或正文段落 id */
  scope: string;
  /** 局部方案对应的子任务；null 为事项根方案 */
  itemId: string | null;
  /** 中栏：方案正文 / 任务草稿 / 修订影响 */
  mode: "doc" | "drafts" | "revision";
  /** 任务视图选中的子任务 */
  selected: string | null;
  /** 收起螺旋时间线，专注思考 */
  focus: boolean;
  /** 窄屏：方案 / 结论 */
  pane: "main" | "side";
  note: boolean;
}

/** 执行栏任务范围：主任务 + 当前选中的子任务（日记与执行栏共用同一 taskId） */
export interface WorkScope {
  taskId: string;
  itemId: string | null;
}

/** 一次成功关联的过渡：源行快照收起、缩略副本飞向目标记录、目标记录展开并浅高亮淡出 */
export interface MergeFx {
  key: number;
  sessionId: string;
  taskId: string;
  agentId: AgentId;
  title: string;
  /** 缩略副本起点（视口坐标）；源行不可见时为 null，只做原位收起 + 目标显现 */
  from: { x: number; y: number } | null;
  /** 源行在“正在关联”时的静态快照，用于平滑收起高度 */
  snapshot: string | null;
  height: number;
  /** 收起占位插在哪个块之后；null 表示列表最前 */
  afterBlockId: string | null;
  reduced: boolean;
}

interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "error";
}

interface WorkdeckContextValue {
  snap: Snapshot;
  projectSnapshots: Snapshot[];
  refreshProjects: () => Promise<void>;
  switchProject: (id: string) => Promise<boolean>;
  api: WorkdeckDataSource;
  agentOf: (id: AgentId) => Agent;
  toast: (message: string, tone?: "info" | "error", ms?: number) => void;
  toasts: ToastItem[];
  /** 在日记中定位同一 Task（跨区域相互定位） */
  locateTask: (taskId: string) => void;
  locatedTask: string | null;
  registerTaskNode: (taskId: string, node: HTMLElement | null) => void;
  drag: DragPayload;
  setDrag: (payload: DragPayload) => void;
  railPanel: RailPanel;
  setRailPanel: (panel: RailPanel) => void;
  hoverPlan: string | null;
  setHoverPlan: (id: string | null) => void;
  openSourceSession: (sessionId: string) => void;
  /** 进行中的关联：sessionId → taskId（拖放与菜单／键盘入口共用，防重复提交） */
  linking: Record<string, string>;
  mergeErrors: Record<string, { taskId: string; message: string }>;
  mergeFx: MergeFx | null;
  linkWithFx: (sessionId: string, taskId: string, options?: SessionLinkOptions) => Promise<CommandResult>;
  endMergeFx: () => void;
  scope: WorkScope | null;
  /** 进入主任务范围并选中子任务（itemId 为 null 时只进入范围） */
  selectWork: (taskId: string, itemId: string | null) => void;
  leaveScope: () => void;
  subtasksOpen: Record<string, boolean>;
  setSubtasksOpen: (taskId: string, open: boolean) => void;
  /** 展开日记中的子任务列表并定位到该子任务 */
  locateWorkItem: (taskId: string, itemId: string) => void;
  /** 回到某次执行所在的准确源会话（演示模式只说明目标，不假装跳转） */
  openAttemptSource: (taskId: string, attemptId: string) => void;
  workspace: WorkspaceState | null;
  openWorkspace: (taskId: string, patch?: Partial<WorkspaceState>) => void;
  patchWorkspace: (patch: Partial<WorkspaceState>) => void;
  closeWorkspace: () => void;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const omit = <T,>(m: Record<string, T>, k: string) => {
  const next = { ...m };
  delete next[k];
  return next;
};

const WorkdeckContext = createContext<WorkdeckContextValue | null>(null);

export function WorkdeckProvider({
  source,
  children,
  fallback,
}: {
  source: WorkdeckDataSource;
  children: ReactNode;
  fallback: ReactNode;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [projectSnapshots, setProjectSnapshots] = useState<Snapshot[]>([]);
  const projectRequest = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [locatedTask, setLocatedTask] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragPayload>(null);
  const [railPanel, setRailPanel] = useState<RailPanel>(null);
  const [hoverPlan, setHoverPlan] = useState<string | null>(null);
  const [linking, setLinking] = useState<Record<string, string>>({});
  const [mergeErrors, setMergeErrors] = useState<Record<string, { taskId: string; message: string }>>({});
  const [mergeFx, setMergeFx] = useState<MergeFx | null>(null);
  const [scope, setScope] = useState<WorkScope | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [subtasksOpen, setSubtasksOpenState] = useState<Record<string, boolean>>({});
  const [rebind, setRebind] = useState<{ sessionId: string; taskId: string; fromTaskId: string } | null>(null);
  const sourceBusy = useRef(false);
  const linkingRef = useRef(new Set<string>());
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;
  const nodes = useRef(new Map<string, HTMLElement>());
  const locateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let alive = true;
    setLoadError("");
    source.load().then((s) => alive && setSnap(s)).catch((error) => alive && setLoadError(error instanceof Error ? error.message : "暂时无法连接工作台服务"));
    const off = source.subscribe((s) => setSnap(s));
    return () => {
      alive = false;
      off();
    };
  }, [source, reload]);

  const toast = useCallback((message: string, tone: "info" | "error" = "info", ms = 3600) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms);
  }, []);

  useEffect(() => {
    if (!snap) return;
    const missing = getConfiguredAgents().filter(config => !snap.agents.some(agent => agent.id === (config.agentId || config.tool) && agent.registered));
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      for (const config of missing) {
        if (cancelled) break;
        const result = await source.registerAgent(configuredAgentIdentity(config.tool, config));
        if (!result.ok) throw new Error(result.message ?? "Agent 身份登记失败");
      }
    })().catch(error => { if (!cancelled) toast(error instanceof Error ? error.message : "旧配置尚未同步，请重新保存 Agent 配置。", "error"); });
    return () => { cancelled = true; };
  }, [source, snap?.agents, toast]);

  const refreshProjects = useCallback(async () => {
    const request = ++projectRequest.current;
    const projects = await source.listProjects();
    if (request === projectRequest.current) setProjectSnapshots(projects);
  }, [source]);
  useEffect(() => {
    if (!snap) return;
    void refreshProjects().catch(error => toast(error instanceof Error ? error.message : "项目列表读取失败", "error"));
  }, [snap, refreshProjects, toast]);
  useEffect(() => {
    setWorkspace(current => current && snap?.tasks[current.taskId] ? current : null);
    setScope(current => current && snap?.tasks[current.taskId] ? current : null); setRailPanel(null); setLocatedTask(null);
    setDrag(null); setMergeFx(null); setRebind(null); setSubtasksOpenState({}); nodes.current.clear();
  }, [snap?.project.id]);
  useEffect(() => {
    if (!snap) return;
    setWorkspace(current => {
      if (!current || !snap.tasks[current.taskId]) return null;
      const items = snap.orchestrations?.[current.taskId]?.items ?? {};
      if (current.selected && !items[current.selected] || current.itemId && !items[current.itemId]) return { ...current, selected: null, itemId: null };
      return current;
    });
    setScope(current => current && (!snap.tasks[current.taskId] || current.itemId && !snap.orchestrations?.[current.taskId]?.items[current.itemId]) ? null : current);
  }, [snap?.tasks, snap?.orchestrations]);
  const switchProject = useCallback(async (id: string) => {
    try {
      const result = await source.switchProject(id);
      if (!result.ok) { toast(result.message ?? "切换项目失败", "error"); return false; }
      return true;
    } catch (error) { toast(error instanceof Error ? error.message : "切换项目失败", "error"); return false; }
  }, [source, toast]);

  const registerTaskNode = useCallback((taskId: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(taskId, node);
    else nodes.current.delete(taskId);
  }, []);

  const openSource = useCallback(async (reference: SourceReference | undefined, _title: string, fallbackId: string) => {
    if (sourceBusy.current) return;
    sourceBusy.current = true;
    try {
      const result = await gateway.openSource({ ...reference, mode: source.mode === "sample" ? "sample" : "live", sessionId: reference?.sessionId ?? fallbackId });
      toast(result.message, result.status === "unavailable" ? "error" : undefined);
    } catch (error) {
      toast(error instanceof Error ? error.message : "暂时无法打开会话，请重试。", "error");
    } finally { sourceBusy.current = false; }
  }, [source, toast]);

  const locateTask = useCallback((taskId: string) => {
    setWorkspace(null);
    window.dispatchEvent(new CustomEvent("quandeck:show-journal"));
    requestAnimationFrame(() => {
      const node = nodes.current.get(taskId);
      node?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      node?.focus({ preventScroll: true });
    });
    setLocatedTask(taskId);
    clearTimeout(locateTimer.current);
    locateTimer.current = setTimeout(() => setLocatedTask(null), 1400);
  }, []);

  useEffect(() => desktopHost()?.onNavigate(target => {
    void switchProject(target.projectId).then(ok => { if (ok && target.taskId) setTimeout(() => locateTask(target.taskId!), 100); });
  }), [switchProject, locateTask]);
  useEffect(() => {
    const report = (event: Event) => toast(String((event as CustomEvent).detail), 'error');
    window.addEventListener('quandeck:storage-error', report);
    return () => window.removeEventListener('quandeck:storage-error', report);
  }, [toast]);

  const linkWithFx = useCallback(
    async (sessionId: string, taskId: string, options?: SessionLinkOptions): Promise<CommandResult> => {
      if (linkingRef.current.has(sessionId))
        return { ok: false, message: "正在关联，已忽略重复操作" };
      linkingRef.current.add(sessionId);
      setLinking((m) => ({ ...m, [sessionId]: taskId }));
      setMergeErrors((m) => omit(m, sessionId));
      // 等“正在关联”渲染出来，再记录源行位置与快照
      await frame();
      await frame();
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const el = document.querySelector<HTMLElement>(`[data-session-entry="${sessionId}"]`);
      const blocks = snapRef.current?.journal.blocks ?? [];
      const idx = blocks.findIndex((b) => b.kind === "session" && b.sessionId === sessionId);
      const scroller = document.querySelector<HTMLElement>(".qd-journal-scroll");
      let from: MergeFx["from"] = null;
      if (el && scroller) {
        const t = (el.querySelector(".qd-task-title") ?? el).getBoundingClientRect();
        const v = scroller.getBoundingClientRect();
        if (t.top >= v.top && t.bottom <= v.bottom) from = { x: t.left, y: t.top + t.height / 2 };
      }
      const snapshot = el?.outerHTML ?? null;
      const height = el?.getBoundingClientRect().height ?? 0;
      const session = snapRef.current?.sessions[sessionId];

      let r: CommandResult;
      try { r = await source.linkSession(sessionId, taskId, options); }
      catch (error) { r = { ok: false, message: error instanceof Error ? error.message : '未能保存关联' }; }
      linkingRef.current.delete(sessionId);
      setLinking((m) => omit(m, sessionId));
      if (r.requiresRebind && r.fromTaskId) { setRebind({ sessionId, taskId, fromTaskId: r.fromTaskId }); return r; }
      if (!r.ok) {
        // 失败：源行保留，就地说明原因并可重试
        setMergeErrors((m) => ({ ...m, [sessionId]: { taskId, message: r.message ?? "关联失败" } }));
        toast(r.message ?? "关联失败", "error");
        return r;
      }
      setMergeFx({
        key: Date.now(),
        sessionId,
        taskId,
        agentId: session?.agentId ?? "",
        title: session?.title ?? "",
        from,
        snapshot: idx >= 0 ? snapshot : null,
        height: idx >= 0 ? height : 0,
        afterBlockId: idx > 0 ? blocks[idx - 1].id : null,
        reduced,
      });
      toast(r.message ?? "已关联");
      return r;
    },
    [source, toast],
  );

  const endMergeFx = useCallback(() => setMergeFx(null), []);

  const selectWork = useCallback((taskId: string, itemId: string | null) => {
    setRailPanel(null);
    setScope({ taskId, itemId });
    // 窄屏执行栏是独立标签页：切过去查看详情
    if (window.matchMedia("(max-width: 959px)").matches)
      window.dispatchEvent(new CustomEvent("quandeck:show-deck"));
  }, []);
  const leaveScope = useCallback(() => setScope(null), []);
  const openWorkspace = useCallback((taskId: string, patch?: Partial<WorkspaceState>) => {
    setScope(null);
    setWorkspace((w) => ({
      taskId,
      view: "plan",
      scope: "root",
      itemId: null,
      mode: "doc",
      selected: null,
      focus: w?.focus ?? false,
      pane: "main",
      note: false,
      ...patch,
    }));
  }, []);
  const patchWorkspace = useCallback(
    (patch: Partial<WorkspaceState>) => setWorkspace((w) => (w ? { ...w, ...patch } : w)),
    [],
  );
  const closeWorkspace = useCallback(() => setWorkspace(null), []);
  const setSubtasksOpen = useCallback(
    (taskId: string, open: boolean) => setSubtasksOpenState((m) => ({ ...m, [taskId]: open })),
    [],
  );
  const locateWorkItem = useCallback((taskId: string, itemId: string) => {
    setSubtasksOpenState((m) => ({ ...m, [taskId]: true }));
    window.dispatchEvent(new CustomEvent("quandeck:show-journal"));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-work-row="${itemId}"]`);
        row?.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
        row?.focus({ preventScroll: true });
      }),
    );
  }, []);

  const value = useMemo<WorkdeckContextValue | null>(() => {
    if (!snap) return null;
    return {
      snap, projectSnapshots, refreshProjects, switchProject,
      api: source,
      agentOf: (id) => snap.agents.find((a) => a.id === id) ?? { id, name: id ? "未配置的 Agent" : "选择 Agent", short: "Agent", color: "#7b8681", connection: "offline", connectionNote: "尚未配置", tracked: false, starred: false, pinned: false, today: { minutes: null, tokens: null, sessions: null }, daily14: [], scan: { state: "idle", lastAt: null } },
      toast,
      toasts,
      locateTask,
      locatedTask,
      registerTaskNode,
      drag,
      setDrag,
      railPanel,
      setRailPanel,
      hoverPlan,
      setHoverPlan,
      linking,
      mergeErrors,
      mergeFx,
      linkWithFx,
      endMergeFx,
      scope,
      selectWork,
      leaveScope,
      subtasksOpen,
      setSubtasksOpen,
      locateWorkItem,
      workspace,
      openWorkspace,
      patchWorkspace,
      closeWorkspace,
      openAttemptSource: (taskId, attemptId) => {
        const o = (snapRef.current ?? snap).orchestrations?.[taskId];
        const attempt = o?.attempts[attemptId];
        if (!o || !attempt) { toast("没有找到这次执行的源会话", "error"); return; }
        void openSource(attempt.source, o.items[attempt.workItemId]?.title ?? o.label, attempt.sessionId);
      },
      openSourceSession: (sessionId) => {
        const current = snapRef.current ?? snap;
        const session = current.sessions[sessionId];
        if (session) {
          void openSource(session.source, session.title, sessionId);
          return;
        }
        for (const o of Object.values(current.orchestrations ?? {})) {
          const attempt = Object.values(o.attempts).find(a => a.sessionId === sessionId);
          if (attempt) { void openSource(attempt.source, o.items[attempt.workItemId]?.title ?? o.label, sessionId); return; }
        }
        for (const parent of Object.values(current.sessions)) {
          const child = parent.subAgents.find(a => a.sessionRef === sessionId);
          if (child) { void openSource(child.source, `${parent.title} › ${child.title}`, sessionId); return; }
        }
        toast("未找到该会话的来源记录", "error");
      },
    };
  }, [
    snap, projectSnapshots, refreshProjects, switchProject,
    source,
    toast,
    toasts,
    locateTask,
    locatedTask,
    registerTaskNode,
    drag,
    railPanel,
    hoverPlan,
    linking,
    mergeErrors,
    mergeFx,
    linkWithFx,
    endMergeFx,
    scope,
    selectWork,
    leaveScope,
    subtasksOpen,
    setSubtasksOpen,
    locateWorkItem,
    workspace,
    openWorkspace,
    patchWorkspace,
    closeWorkspace,
    openSource,
  ]);

  if (!value && loadError) return <div className="qd-loading" role="alert"><p>{loadError}</p><button className="qd-btn ghost" onClick={() => setReload((n) => n + 1)}>重新连接</button></div>;
  if (!value) return <>{fallback}</>;
  return <WorkdeckContext.Provider value={value}>{children}
    {rebind && <ConfirmDialog title="改绑会话" text={`将「${value.snap.sessions[rebind.sessionId]?.title ?? '这条会话'}」从「${value.snap.tasks[rebind.fromTaskId]?.title ?? '原任务'}」移到「${value.snap.tasks[rebind.taskId]?.title ?? '所选任务'}」。原任务保留改绑前历史，不会重新执行。`} confirmLabel="确认改绑" onClose={() => setRebind(null)} onConfirm={() => { const pending = rebind; setRebind(null); void linkWithFx(pending.sessionId, pending.taskId, { replace: true, expectedTaskId: pending.fromTaskId }); }} />}
  </WorkdeckContext.Provider>;
}

export function useWorkdeck() {
  const ctx = useContext(WorkdeckContext);
  if (!ctx) throw new Error("useWorkdeck must be used inside WorkdeckProvider");
  return ctx;
}
