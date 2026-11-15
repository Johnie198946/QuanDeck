import { ensureTimeline, syncTimeline, reduceExecutionEvent, refreshTimelineStats, timeInZone, instant, type ExecutionEvent } from "./timeline";
import { createSampleSnapshot } from "./fixtures";
import { normalizeDiscussionState, safeDiscussionUrl } from "./discussion";
import {
  addDraftsIn,
  agentResult,
  aiStepIn,
  applyRevisionIn,
  createIdeaIn,
  editLineIn,
  generateDraftsIn,
  localPlanId,
  openLocalPlanIn,
  pushUser,
  refreshBlocked,
  resolveConflictIn,
  rootPlanId,
} from "./ideaEngine";
import {
  SEARCH_TASK_ID,
  createSearchMainSession,
  createSearchOrchestration,
} from "./orchestrationFixture";
import { fromMinutes, toMinutes } from "./format";
import type {
  Agent,
  AgentId,
  CommandResult,
  DemoAction,
  DemoScenario,
  DispatchOutcome,
  PlanItem,
  Session,
  Snapshot,
  Task,
  LineState,
  Owner,
  TaskDraft,
  DiscussionConclusionInput,
  PlanSection,
} from "./types";

/**
 * 可替换的数据访问层。真实实现应把这些命令映射到 QuanDeck 业务层 / Adapter，
 * 并以源端回执驱动状态；UI 只依赖本接口和 Snapshot。
 */
export interface WorkdeckDataSource {
  readonly mode: "sample" | "live";
  load(): Promise<Snapshot>;
  /** Idempotent adapter receipt. Does not infer completion from a turn ending. */
  applyExecutionEvent(event: ExecutionEvent): Promise<CommandResult>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;

  updateJournal(patch: { title?: string; summary?: string }): Promise<void>;
  addBlock(kind: "text" | "task", text: string): Promise<string>;
  updateText(blockId: string, text: string): Promise<void>;
  deleteBlock(blockId: string): Promise<void>;
  updateTaskTitle(taskId: string, title: string): Promise<void>;
  convertTextToTask(blockId: string): Promise<string>;

  dispatch(taskId: string, agentId: AgentId): Promise<CommandResult>;
  /** 仅在源端受理前可撤回；受理后须回源会话处理 */
  cancelDispatch(sessionId: string): Promise<CommandResult>;
  reconcile(sessionId: string): Promise<CommandResult>;
  retryDispatch(sessionId: string): Promise<CommandResult>;
  completeTask(taskId: string): Promise<void>;
  reopenTask(taskId: string): Promise<void>;
  resumeAutoFollow(taskId: string): Promise<void>;
  linkSession(sessionId: string, taskId: string): Promise<CommandResult>;

  setTracked(agentId: AgentId, tracked: boolean): Promise<void>;
  toggleStar(agentId: AgentId): Promise<CommandResult>;
  togglePin(agentId: AgentId): Promise<void>;
  setDefaultAgent(agentId: AgentId): Promise<void>;
  /** 幂等登记配置工具的基础身份，不建立连接、不派发、不替换现有执行记录。 */
  registerAgent(input: AgentRegistration): Promise<CommandResult & { agentId?: AgentId }>;
  scanAgent(agentId: AgentId): Promise<CommandResult>;
  // ---- 事项方案（思路）与任务草稿 ----
  /** 由日记输入创建事项与空方案；不会运行本地 AI 或启动 Agent。 */
  createIdea(text: string): Promise<{ taskId: string; planId: string }>;
  ensureTaskPlan(taskId: string): Promise<string>;
  setDiscussionAgent(planId: string, agentId: AgentId): Promise<CommandResult>;
  recordDiscussionConclusion(planId: string, scope: string, input: DiscussionConclusionInput): Promise<CommandResult>;
  adoptDiscussionConclusion(planId: string, id: string): Promise<CommandResult>;
  editPlanLine(planId: string, lineId: string, patch: { text?: string; state?: LineState }): Promise<void>;
  generateDrafts(planId: string): Promise<void>;
  updateDraft(planId: string, key: string, patch: Partial<TaskDraft>): Promise<void>;
  removeDraft(planId: string, key: string): Promise<void>;
  mergeDraftUp(planId: string, key: string): Promise<CommandResult>;
  indentDraft(planId: string, key: string, dir: 1 | -1): Promise<void>;
  /** 加入任务：幂等，只创建任务、不启动 Agent */
  addDraftsToTasks(planId: string): Promise<CommandResult & { added?: number }>;
  openLocalPlan(taskId: string, itemId: string): Promise<string>;
  resolveConflict(planId: string, turnId: string, choice: "submitted" | "declined"): Promise<CommandResult>;
  setWorkOwner(taskId: string, itemId: string, owner: Owner, agentId?: AgentId): Promise<void>;
  /** 人工任务：开始 / 完成 / 重新打开（不产生会话与 token） */
  setWorkStatus(taskId: string, itemId: string, status: "running" | "done" | "not_started"): Promise<void>;
  /** 委派子任务给 Agent：追加执行记录，不新建任务 */
  dispatchWork(taskId: string, itemId: string, agentId: AgentId): Promise<CommandResult>;
  applyRevision(planId: string, supplement: string[]): Promise<CommandResult>;

  /** 新增自定义 Agent：只保存配置，默认未连接／待配置，不派发 */
  addCustomAgent(input: CustomAgentInput): Promise<CommandResult & { agentId?: AgentId }>;
  /** 编辑自定义 Agent 的名称／头像／主题色／连接方式；不改变连接状态，不派发 */
  updateCustomAgent(agentId: AgentId, input: CustomAgentInput): Promise<CommandResult>;
  /** 只移除没有任何会话记录的自定义 Agent；有记录时拒绝，关联记录不会被删除 */
  removeCustomAgent(agentId: AgentId): Promise<CommandResult>;

  addPlan(plan: Omit<PlanItem, "id" | "actual">): Promise<void>;

  /** 仅示例数据源提供：用于逐项检查状态 */
  readonly demo?: DemoControls;
}

export interface AgentRegistration {
  id: AgentId;
  name: string;
  short: string;
  color: string;
  makeDefault?: boolean;
}

export interface CustomAgentInput {
  name: string;
  color: string;
  logo?: string | null;
  endpoint?: string;
}

export interface DemoControls {
  getNextOutcome(): DispatchOutcome;
  setNextOutcome(outcome: DispatchOutcome): void;
  setScenario(taskId: string, scenario: DemoScenario): void;
  /** 结束一轮／步骤 100%／子代理完成：均不会自动完成父任务 */
  runAction(taskId: string, action: DemoAction): CommandResult;
  simulateExternalSession(): void;
  /** 合并动效演示：新建一条标注为演示的外部会话，放在演示 TODO 上方；不改动用户已有数据 */
  prepareMergeDemo(): { sessionId: string; taskId: string };
  /** 主任务编排演示（全文搜索）：失败／重试／待权限／并行分支完成／全部结束／恢复 */
  orchestrate(action: OrchDemoAction): CommandResult;
  /** 旅行演示阶段：只替换演示事项，其余数据不动 */
  travelStage(stage: TravelStage): { taskId: string; planId: string; itemId?: string } | null;
  reset(): void;
}

export type TravelStage = "discuss" | "drafts" | "tree" | "local" | "revision" | "note";

export type OrchDemoAction =
  | "fail_nested"
  | "retry"
  | "permission"
  | "finish_parallel"
  | "finish_all"
  | "restore";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 100;
const uid = (prefix: string) => `${prefix}-${(seq++).toString(36)}`;

/** 演示数据持久化：刷新后保留日记、轮次、合并与完成状态（仅本机浏览器）。 */
const STORAGE_KEY = "quandeck.demo.v3";
const SCHEMA = 4;
interface Persisted {
  schema: number;
  state: Snapshot;
  /** 演示时钟起点（快照时刻）；旧数据为 20:45 */
  clockBase?: string;
  clockDate?: string;
  /** 仅内存标记：本次载入时由旧版升级，需立即写回 */
  migrated?: boolean;
  loadedAt: number;
  nextOutcome: DispatchOutcome;
  externalCount: number;
  seq: number;
}

function readPersisted(): Persisted | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Persisted;
    if (!data?.state?.tasks) return null;
    if (data.schema === SCHEMA) return data;
    // 旧版（schema 3）：原地升级，只给“全文搜索”补上主任务编排，保留其余日记、合并与自定义 Agent
    if (data.schema === 3) return migrateV3(data);
    return null;
  } catch {
    return null;
  }
}

function migrateV3(data: Persisted): Persisted {
  const s = data.state;
  s.orchestrations ??= {};
  const task = s.tasks[SEARCH_TASK_ID];
  if (task && !s.orchestrations[SEARCH_TASK_ID]) {
    const main = createSearchMainSession();
    s.sessions[main.id] = main;
    if (!task.sessionIds.includes(main.id)) task.sessionIds.unshift(main.id);
    task.completion = null;
    task.manualLock = false;
    s.orchestrations[SEARCH_TASK_ID] = createSearchOrchestration();
  }
  return { ...data, schema: SCHEMA, clockBase: data.clockBase ?? "20:45", migrated: true };
}

const MERGE_DEMO_TASK = "演示：合并动效目标";
const MERGE_DEMO_CLIENT = "演示客户端（合并动效）";

const REPLY_TEMPLATES = [
  (t: string) => `已梳理“${t}”的范围和输入材料。下一轮开始处理主体内容。`,
  () => "主体内容已处理约一半，中间结果已写回源会话。下一轮继续剩余部分。",
  () => "剩余部分已处理完毕，结果已写回源会话，等你确认是否收尾。",
];

export class SampleWorkdeckDataSource implements WorkdeckDataSource {
  readonly mode = "sample" as const;
  private state: Snapshot = createSampleSnapshot();
  private listeners = new Set<(s: Snapshot) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private loadedAt = Date.now();
  private clockBase = this.state.now;
  private clockDate = this.state.date;
  private nextOutcome: DispatchOutcome = "accept";
  private externalCount = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private resumed = false;
  private linking = new Set<string>();

  constructor() {
    const saved = readPersisted();
    if (saved) {
      this.state = saved.state;
      this.loadedAt = saved.loadedAt;
      this.clockBase = saved.clockBase ?? "20:45";
      this.clockDate = saved.clockDate ?? this.state.date;
      // 旧版数据升级后立即写回，之后按新版读取
      if (saved.migrated) this.persist();
      this.nextOutcome = saved.nextOutcome;
      this.externalCount = saved.externalCount;
      seq = Math.max(seq, saved.seq);
    }
    if (normalizeDiscussionState(this.state)) this.persist();
    ensureTimeline(this.state);
    refreshTimelineStats(this.state);
  }

  readonly demo: DemoControls = {
    getNextOutcome: () => this.nextOutcome,
    setNextOutcome: (o) => {
      this.nextOutcome = o;
      this.emit();
    },
    setScenario: (taskId, scenario) => this.applyScenario(taskId, scenario),
    runAction: (taskId, action) => this.applyAction(taskId, action),
    simulateExternalSession: () => this.addObservedSession(),
    prepareMergeDemo: () => this.prepareMergeDemo(),
    orchestrate: (action) => this.applyOrch(action),
    travelStage: (stage) => this.buildTravelStage(stage),
    reset: () => {
      this.timers.forEach(clearTimeout);
      this.timers.clear();
      try {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
      } catch {
        /* 存储不可用时只重置内存 */
      }
      // 自定义 Agent 是用户配置，不属于演示快照：重置时保留
      const custom = this.state.agents.filter((a) => a.custom);
      const configured = this.state.agents.filter(a => a.registered);
      const previousDefault = this.state.defaultAgent;
      this.state = createSampleSnapshot();
      this.state.agents.push(...custom);
      for (const agent of configured) {
        const existing = this.state.agents.find(a => a.id === agent.id);
        if (existing) existing.registered = true; else this.state.agents.push(agent);
      }
      if (configured.some(a => a.id === previousDefault)) this.state.defaultAgent = previousDefault;
      this.loadedAt = Date.now();
      this.clockBase = this.state.now;
      this.clockDate = this.state.date;
      this.nextOutcome = "accept";
      this.externalCount = 0;
      this.emit();
    },
  };

  async load() {
    if (!this.ticker) this.ticker = setInterval(() => this.tick(), 4000);
    if (!this.resumed) {
      this.resumed = true;
      this.resumePending();
    }
    await wait(240);
    this.state = { ...this.state, now: this.now() };
    syncTimeline(this.state, undefined, this.eventTime());
    return this.state;
  }

  /** 刷新后接续未完成的演示推进（提交中 → 受理 → 运行），不重复派发 */
  private resumePending() {
    for (const s of Object.values(this.state.sessions)) {
      if (s.dispatchPhase === "submitting") this.resolveDispatch(s.id, this.nextOutcome);
      else if (s.dispatchPhase === "acknowledged" && s.status === "queued")
        this.later(1500, () => this.startRunning(s.id));
      else if (s.status === "running" && s.step?.total === 5 && s.step.completed === 1)
        this.later(4200, () => this.advanceFirstStep(s.id));
    }
  }

  subscribe(listener: (s: Snapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------- 内部工具 ----------

  /** 示例时钟：从快照时刻开始随真实时间推进 */
  private now() {
    return fromMinutes(toMinutes(this.clockBase) + Math.floor((Date.now() - this.loadedAt) / 60000));
  }

  private eventTime() {
    return new Date(Date.parse(instant(this.clockBase, this.clockDate, this.state.project.timeZone ?? "Asia/Shanghai")) + Date.now() - this.loadedAt).toISOString();
  }

  private update(mutator: (draft: Snapshot) => void) {
    const draft = structuredClone(this.state);
    draft.now = this.now();
    mutator(draft);
    normalizeDiscussionState(draft);
    draft.version += 1;
    draft.now = this.now();
    draft.lastSync = draft.now;
    syncTimeline(draft, this.state, this.eventTime());
    this.state = draft;
    this.emit();
  }

  private emit() {
    this.persist();
    this.listeners.forEach((l) => l(this.state));
  }

  private persist() {
    try {
      const data: Persisted = {
        schema: SCHEMA,
        state: this.state,
        loadedAt: this.loadedAt,
        clockBase: this.clockBase,
        clockDate: this.clockDate,
        nextOutcome: this.nextOutcome,
        externalCount: this.externalCount,
        seq,
      };
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* 隐私模式或配额不足：仅保留内存状态 */
    }
  }

  /** token 增量同时计入会话、Agent 今日与总统计，保证三处一致 */
  private addTokens(d: Snapshot, s: Session, delta: number) {
    s.tokens = (s.tokens ?? 0) + delta;
    const ag = this.agent(d, s.agentId);
    if (ag.today.tokens != null) ag.today.tokens += delta;
    if (d.stats.tokens != null) d.stats.tokens += delta;
  }

  /** 每个会话只计入一次今日会话数；重试、对账、合并都不会重复计数 */
  private countSession(d: Snapshot, s: Session) {
    if (s.counted) return;
    s.counted = true;
    const ag = this.agent(d, s.agentId);
    if (ag.today.sessions != null) ag.today.sessions += 1;
    if (d.stats.sessions != null) d.stats.sessions += 1;
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private agent(draft: Snapshot, id: AgentId) {
    return draft.agents.find((a) => a.id === id) as Agent;
  }

  /** 所有关联会话归档且无手动锁时，按 source_lifecycle 自动收尾 */
  private settle(draft: Snapshot, taskId: string) {
    const task = draft.tasks[taskId];
    if (!task || task.manualLock) return;
    const sessions = task.sessionIds.map((id) => draft.sessions[id]);
    if (sessions.length && sessions.every((s) => s.status === "archived")) {
      task.completion ??= { reason: "all_archived", at: draft.now };
    } else if (task.completion?.reason === "all_archived") {
      task.completion = null;
    }
  }

  private tick() {
    const running = Object.values(this.state.sessions).filter((s) => s.status === "running");
    if (!running.length) { if(this.now() !== this.state.now) this.update(() => {}); return; }
    this.update((d) => {
      for (const s of running) {
        const ses = d.sessions[s.id];
        // 主任务编排的 token 按唯一执行记录聚合，演示时钟不再额外累加
        if (ses.taskId && d.orchestrations?.[ses.taskId]) continue;
        if (ses.tokens != null) this.addTokens(d, ses, 1200 + Math.round(Math.random() * 2400));
        ses.lastActivity = d.now;
      }
    });
  }

  /** Real adapters call this only with verified source events; UI state and timeline update atomically. */
  async applyExecutionEvent(event: ExecutionEvent): Promise<CommandResult> {
    if (event.projectId !== this.state.project.id) return { ok: false, message: "事件不属于当前项目" };
    const d = structuredClone(this.state);
    const timeline = ensureTimeline(d);
    const ses = d.sessions[event.sessionId];
    const orch = event.taskId ? d.orchestrations?.[event.taskId] : undefined;
    const attempt = event.attemptId ? orch?.attempts[event.attemptId] : undefined;
    if (!d.agents.some(a => a.id === event.agentId)) return { ok:false,message:"未知 Agent，先同步快照" };
    if (event.attemptId && (!attempt || attempt.sessionId !== event.sessionId || attempt.workItemId !== event.workItemId)) return {ok:false,message:"执行记录不匹配，先同步快照"};
    if (attempt && orch && orch.executors[attempt.executorId]?.agentId !== event.agentId) return {ok:false,message:"Agent 与执行记录不一致"};
    if (!event.attemptId && ses && (ses.agentId !== event.agentId || (event.taskId ?? null) !== ses.taskId)) return {ok:false,message:"会话所属 Agent 或任务不一致"};
    if (event.executionId !== (event.attemptId ? `attempt:${event.attemptId}` : `session:${event.sessionId}`)) return {ok:false,message:"执行键与会话记录不一致"};
    if (!event.attemptId && !ses) return {ok:false,message:"未知会话，先同步快照"};
    try {
      if (!reduceExecutionEvent(timeline, event)) return { ok:true, message:"重复或过期事件已忽略" };
    } catch(e) { return {ok:false,message:e instanceof Error ? e.message : "无效事件"}; }
    const at = timeInZone(Date.parse(event.at), d.project.timeZone ?? "Asia/Shanghai");
    if (attempt && orch && event.workItemId) {
      attempt.status = event.status;
      if (event.status !== "running") attempt.endedAt = at; else delete attempt.endedAt;
      if (event.step !== undefined) attempt.step = event.step;
      if (event.tokens !== undefined) attempt.tokens = event.tokens;
      if (event.reply && !attempt.rounds.some(r => r.id === event.reply!.id)) attempt.rounds.push({id:event.reply.id,at,reply:event.reply.text});
      const item = orch.items[event.workItemId];
      item.status = event.status;
      if(event.status !== "waiting_reply" && event.status !== "waiting_permission") delete item.waiting;
      orch.syncedAt = at;
    } else if(ses) {
      ses.status = event.status === "done" ? "archived" : event.status;
      ses.lastActivity = at;
      if(event.status === "done" || event.status === "cancelled" || event.status === "paused" || event.status === "failed") ses.endedAt = at;
      if(event.status === "running") delete ses.endedAt;
      if(event.step !== undefined) ses.step=event.step;
      if(event.tokens !== undefined) ses.tokens=event.tokens;
      if(event.reply && !ses.rounds.some(r=>r.id === event.reply!.id)) ses.rounds.push({id:event.reply.id,at,reply:event.reply.text});
      if(ses.taskId) this.settle(d,ses.taskId);
    }
    d.version += 1;
    d.lastSync=at;
    refreshTimelineStats(d);
    this.state=d;
    this.emit();
    return {ok:true};
  }

  // ---------- 日记 ----------

  async updateJournal(patch: { title?: string; summary?: string }) {
    this.update((d) => Object.assign(d.journal, patch));
  }

  async addBlock(kind: "text" | "task", text: string) {
    const blockId = uid("b");
    this.update((d) => {
      if (kind === "text") {
        d.journal.blocks.push({ id: blockId, kind: "text", text });
        return;
      }
      const taskId = uid("task");
      d.tasks[taskId] = this.newTask(taskId, text, d.now);
      d.journal.blocks.push({ id: blockId, kind: "task", taskId });
    });
    return blockId;
  }

  private newTask(id: string, raw: string, now: string): Task {
    const match = raw.match(/\s(\d{1,3})\s?(m|min|分钟)$/i);
    return {
      id,
      title: match ? raw.slice(0, match.index).trim() : raw.trim(),
      estimate: match ? Number(match[1]) : undefined,
      sessionIds: [],
      completion: null,
      manualLock: false,
      createdAt: now,
    };
  }

  async updateText(blockId: string, text: string) {
    this.update((d) => {
      const block = d.journal.blocks.find((b) => b.id === blockId);
      if (block?.kind === "text") block.text = text;
    });
  }

  async deleteBlock(blockId: string) {
    this.update((d) => {
      d.journal.blocks = d.journal.blocks.filter((b) => b.id !== blockId);
    });
  }

  async updateTaskTitle(taskId: string, title: string) {
    this.update((d) => {
      if (d.tasks[taskId]) d.tasks[taskId].title = title;
    });
  }

  async convertTextToTask(blockId: string) {
    const taskId = uid("task");
    this.update((d) => {
      const index = d.journal.blocks.findIndex((b) => b.id === blockId);
      const block = d.journal.blocks[index];
      if (!block || block.kind !== "text") return;
      d.tasks[taskId] = this.newTask(taskId, block.text, d.now);
      // 原位转换：沿用同一行位置，不搬家
      d.journal.blocks[index] = { id: block.id, kind: "task", taskId };
    });
    return taskId;
  }

  // ---------- 派发与生命周期 ----------

  async dispatch(taskId: string, agentId: AgentId): Promise<CommandResult> {
    const agent = this.state.agents.find((a) => a.id === agentId);
    const task = this.state.tasks[taskId];
    if (!agent || !task) return { ok: false, message: "任务或 Agent 不存在" };
    if (agent.connection !== "healthy")
      return { ok: false, message: `${agent.name} 未连接，未发送` };

    if (task.completion) return { ok: false, message: "任务已完成，先重新打开" };
    // 同一任务已有提交中的委派时复用，不重复派发（含快速连点、重复拖放）
    const inflight = task.sessionIds
      .map((id) => this.state.sessions[id])
      .find((s) => s?.dispatchPhase === "submitting");
    if (inflight) return { ok: true, message: "正在提交，已忽略重复操作" };

    const sessionId = uid("ses");
    const dispatchId = uid("dsp");
    this.update((d) => {
      const session: Session = {
        id: sessionId,
        agentId,
        title: task.title,
        origin: "dispatch",
        taskId,
        dispatchId,
        dispatchPhase: "submitting",
        status: "pending",
        startedAt: null,
        lastActivity: d.now,
        step: null,
        tokens: null,
        rounds: [],
        subAgents: [],
      };
      d.sessions[sessionId] = session;
      d.tasks[taskId].sessionIds.push(sessionId);
      d.tasks[taskId].completion = null;
      d.tasks[taskId].manualLock = false;
    });
    this.resolveDispatch(sessionId, this.nextOutcome);
    return { ok: true };
  }

  private resolveDispatch(sessionId: string, outcome: DispatchOutcome) {
    this.later(1100, () => {
      this.update((d) => {
        const s = d.sessions[sessionId];
        if (!s) return;
        const name = this.agent(d, s.agentId).name;
        if (outcome === "reject") {
          s.dispatchPhase = "rejected";
          s.status = "failed";
          s.failure = `${name} 拒绝受理：示例工作区未授权写入。原文已保留。`;
        } else if (outcome === "unknown") {
          s.dispatchPhase = "unknown";
          s.status = "pending";
          s.failure = "请求已发出但未收到受理回执。先对账，不会自动重发或改投其他 Agent。";
        } else {
          s.dispatchPhase = "acknowledged";
          s.status = "queued";
          s.failure = undefined;
        }
      });
      if (outcome === "accept") this.later(1500, () => this.startRunning(sessionId));
    });
  }

  async cancelDispatch(sessionId: string): Promise<CommandResult> {
    const s = this.state.sessions[sessionId];
    if (!s) return { ok: false, message: "会话不存在" };
    const name = this.state.agents.find((a) => a.id === s.agentId)?.name ?? "";
    if (s.dispatchPhase !== "submitting")
      return {
        ok: false,
        message: `${name} 已受理，请回源会话停止`,
      };
    this.update((d) => {
      delete d.sessions[sessionId];
      if (s.taskId && d.tasks[s.taskId])
        d.tasks[s.taskId].sessionIds = d.tasks[s.taskId].sessionIds.filter(
          (id) => id !== sessionId,
        );
    });
    return { ok: true, message: "已撤回" };
  }

  private startRunning(sessionId: string) {
    this.update((d) => {
      const s = d.sessions[sessionId];
      if (!s || s.status !== "queued") return;
      s.status = "running";
      s.startedAt = d.now;
      s.step = { completed: 1, total: 5, label: "读取日记上下文" };
      s.tokens = 0;
      this.addTokens(d, s, 8_000);
      this.countSession(d, s);
      d.activity.push({ agentId: s.agentId, start: d.now, end: "now" });
    });
    this.later(4200, () => this.advanceFirstStep(sessionId));
  }

  private advanceFirstStep(sessionId: string) {
    this.update((d) => {
      const s = d.sessions[sessionId];
      if (!s || s.status !== "running" || s.step?.completed !== 1) return;
      s.step = { completed: 2, total: 5, label: "梳理实现方案" };
      this.addTokens(d, s, 38_000);
      s.rounds.push({
        id: uid("r"),
        at: d.now,
        reply: `已读取任务原文和项目上下文，确认了范围。接下来开始处理“${s.title}”。`,
      });
    });
  }

  async reconcile(sessionId: string): Promise<CommandResult> {
    const s = this.state.sessions[sessionId];
    if (!s || s.dispatchPhase !== "unknown") return { ok: false, message: "当前无需对账" };
    this.update((d) => {
      d.sessions[sessionId].failure = "正在向源端查询受理回执…";
    });
    await wait(900);
    this.update((d) => {
      const ses = d.sessions[sessionId];
      ses.dispatchPhase = "acknowledged";
      ses.status = "queued";
      ses.failure = undefined;
    });
    this.later(1200, () => this.startRunning(sessionId));
    return { ok: true, message: "对账完成：已受理" };
  }

  async retryDispatch(sessionId: string): Promise<CommandResult> {
    const s = this.state.sessions[sessionId];
    if (!s || s.dispatchPhase !== "rejected")
      return { ok: false, message: "只有委派失败的请求可以重试" };
    this.update((d) => {
      const ses = d.sessions[sessionId];
      ses.dispatchPhase = "submitting";
      ses.status = "pending";
      ses.failure = undefined;
    });
    // 重试复用同一 dispatch_id
    this.resolveDispatch(sessionId, this.nextOutcome === "reject" ? "accept" : this.nextOutcome);
    return { ok: true };
  }

  async completeTask(taskId: string) {
    this.update((d) => {
      d.tasks[taskId].completion = { reason: "manual", at: d.now };
      d.tasks[taskId].manualLock = true;
    });
  }

  async reopenTask(taskId: string) {
    this.update((d) => {
      d.tasks[taskId].completion = null;
      d.tasks[taskId].manualLock = true;
    });
  }

  async resumeAutoFollow(taskId: string) {
    this.update((d) => {
      d.tasks[taskId].manualLock = false;
      d.tasks[taskId].completion = null;
      this.settle(d, taskId);
    });
  }

  async linkSession(sessionId: string, taskId: string): Promise<CommandResult> {
    const s = this.state.sessions[sessionId];
    const task = this.state.tasks[taskId];
    if (!s || !task) return { ok: false, message: "会话或待办不存在" };
    if (s.taskId === taskId) return { ok: true, message: "已在此待办下" };
    if (s.taskId) return { ok: false, message: "该会话已属于其他任务" };
    if (task.completion) return { ok: false, message: "任务已完成，先重新打开" };
    // 关联请求进行中：重复拖放／重复点击直接忽略，不会重复关联
    if (this.linking.has(sessionId)) return { ok: false, message: "正在关联，已忽略重复操作" };
    const history = s.status === "archived";
    this.linking.add(sessionId);
    try {
      await wait(500);
    } finally {
      this.linking.delete(sessionId);
    }
    // 绑定成功后才收起独立行；保留原 TODO ID／原文／预计时长与会话全部轮次、子代理层级；
    // 不派发、不重复计入统计（会话早已计数）
    this.update((d) => {
      const ses = d.sessions[sessionId];
      if (!ses || ses.taskId) return;
      ses.taskId = taskId;
      ses.mergedAt = d.now;
      if (history) ses.linkedAsHistory = true;
      d.tasks[taskId].sessionIds.push(sessionId);
      d.journal.blocks = d.journal.blocks.filter(
        (b) => !(b.kind === "session" && b.sessionId === sessionId),
      );
      // 关联归档会话只是补历史：不触发自动完成，也不改变仍在运行／等待的任务
      if (!history) this.settle(d, taskId);
    });
    return {
      ok: true,
      message: history
        ? "已关联为历史"
        : "已合并到待办",
    };
  }

  // ---------- Agent 管理（均不派发） ----------

  async setTracked(agentId: AgentId, tracked: boolean) {
    this.update((d) => {
      this.agent(d, agentId).tracked = tracked;
    });
  }

  async toggleStar(agentId: AgentId): Promise<CommandResult> {
    const a = this.state.agents.find((x) => x.id === agentId)!;
    if (!a.starred && this.state.agents.filter((x) => x.starred).length >= 2) {
      return { ok: false, message: "主力最多 2 个，请先取消一个" };
    }
    this.update((d) => {
      const ag = this.agent(d, agentId);
      ag.starred = !ag.starred;
    });
    return { ok: true };
  }

  async togglePin(agentId: AgentId) {
    this.update((d) => {
      const ag = this.agent(d, agentId);
      ag.pinned = !ag.pinned;
    });
  }

  async registerAgent(input: AgentRegistration): Promise<CommandResult & { agentId?: AgentId }> {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(input.id) || !input.name?.trim() || input.name.trim().length > 80 || !input.short?.trim() || !/^#[0-9a-f]{6}$/i.test(input.color)) {
      return { ok: false, message: "Agent 基础身份无效，未保存配置" };
    }
    const existing = this.state.agents.find(agent => agent.id === input.id);
    const makeDefault = input.makeDefault ?? !this.state.agents.some(agent => agent.registered);
    if (existing?.registered && (!makeDefault || this.state.defaultAgent === input.id)) return { ok: true, agentId: input.id };
    this.update(d => {
      const found = d.agents.find(agent => agent.id === input.id);
      if (found) found.registered = true;
      else d.agents.push({
        id: input.id, name: input.name.trim(), short: input.short.trim(), color: input.color, registered: true,
        connection: "offline", connectionNote: "已配置 · 需要验证", tracked: true, starred: false, pinned: false,
        today: { minutes: null, tokens: null, sessions: null }, daily14: [], scan: { state: "idle", lastAt: null },
      });
      if (makeDefault) {
        const previous = d.defaultAgent;
        d.defaultAgent = input.id;
        // Empty plans inherit the first configured identity. Historical conclusions retain their provenance.
        for (const plan of Object.values(d.ideaPlans ?? {})) {
          if (!plan.discussion) plan.discussion = { agentId: input.id, conclusions: [] };
          else if (plan.discussion.agentId === previous && plan.discussion.conclusions.length === 0) plan.discussion.agentId = input.id;
        }
      }
    });
    return { ok: true, agentId: input.id, message: "Agent 身份已登记，尚未派发任务" };
  }

  async setDefaultAgent(agentId: AgentId) {
    if (!this.state.agents.some(agent => agent.id === agentId)) throw new Error("Agent 尚未登记");
    this.update((d) => {
      d.defaultAgent = agentId;
    });
  }

  async scanAgent(agentId: AgentId): Promise<CommandResult> {
    const a = this.state.agents.find((x) => x.id === agentId)!;
    this.update((d) => {
      this.agent(d, agentId).scan = { ...a.scan, state: "scanning", note: "正在扫描近 7 天会话…" };
    });
    await wait(1400);
    if (a.connection !== "healthy") {
      this.update((d) => {
        this.agent(d, agentId).scan = {
          state: "failed",
          lastAt: a.scan.lastAt,
          note: "连接离线，扫描失败",
        };
      });
      return { ok: false, message: `${a.name} 未连接，扫描失败` };
    }
    const found = agentId === "codex" && this.externalCount === 0;
    this.update((d) => {
      this.agent(d, agentId).scan = {
        state: "idle",
        lastAt: d.now,
        note: found ? "发现 1 个新会话" : "没有新会话",
      };
    });
    if (found) this.addObservedSession();
    return {
      ok: true,
      message: found ? "扫描完成：1 个外部会话已记入日记" : "扫描完成：没有新会话",
    };
  }

  // ---------- 日程 ----------

  async addPlan(plan: Omit<PlanItem, "id" | "actual">) {
    if (!plan.title.trim()) throw new Error("请填写日程名称");
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(plan.start)) throw new Error("请选择有效的开始时间");
    if (!Number.isInteger(plan.minutes) || plan.minutes < 1 || plan.minutes > 1440)
      throw new Error("预计时长应为 1 至 1440 分钟");
    if (plan.kind !== "fixed" && plan.kind !== "flexible") throw new Error("请选择日程类型");
    if (plan.taskId && !this.state.tasks[plan.taskId]) throw new Error("关联的任务不存在");
    if (plan.workItemId && (!plan.taskId || !this.state.orchestrations?.[plan.taskId]?.items[plan.workItemId]))
      throw new Error("关联的子任务不存在");
    this.update((d) => {
      // Scheduling an existing task never creates another task. A repeated save
      // edits that task/scope's plan while retaining its identity and actuals.
      const existing = plan.taskId && d.plans.find(p => p.taskId === plan.taskId && p.workItemId === plan.workItemId);
      if (existing) Object.assign(existing, plan, { title: plan.title.trim() });
      else d.plans.push({ ...plan, title: plan.title.trim(), id: uid("p"), actual: [] });
      d.plans.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    });
  }

  async addCustomAgent(input: CustomAgentInput): Promise<CommandResult & { agentId?: AgentId }> {
    const name = input.name.trim();
    if (!name) return { ok: false, message: "请填写名称" };
    if (this.state.agents.some((a) => a.name === name))
      return { ok: false, message: `已存在名为“${name}”的 Agent` };
    const id = uid("custom");
    this.update((d) => {
      d.agents.push({
        id,
        name,
        short: name,
        color: input.color,
        connection: "offline",
        connectionNote: "待配置 · 尚未连接",
        tracked: true,
        starred: false,
        pinned: false,
        // 没有任何覆盖证据：全部为未覆盖，不计为 0
        today: { minutes: null, tokens: null, sessions: null },
        daily14: Array.from({ length: 14 }, () => null),
        scan: { state: "idle", lastAt: null, note: "尚未连接，无法扫描" },
        custom: true,
        logo: input.logo ?? null,
        endpoint: input.endpoint?.trim() || undefined,
      });
    });
    return { ok: true, agentId: id, message: `已添加 ${name} · 待配置` };
  }

  async updateCustomAgent(agentId: AgentId, input: CustomAgentInput): Promise<CommandResult> {
    const a = this.state.agents.find((x) => x.id === agentId);
    if (!a?.custom) return { ok: false, message: "只有自定义 Agent 可以编辑" };
    const name = input.name.trim();
    if (!name) return { ok: false, message: "请填写名称" };
    if (this.state.agents.some((x) => x.id !== agentId && x.name === name))
      return { ok: false, message: `已存在名为“${name}”的 Agent` };
    this.update((d) => {
      const ag = this.agent(d, agentId);
      ag.name = name;
      ag.short = name;
      ag.color = input.color;
      ag.logo = input.logo ?? null;
      ag.endpoint = input.endpoint?.trim() || undefined;
    });
    return { ok: true, message: `已更新 ${name}` };
  }

  async removeCustomAgent(agentId: AgentId): Promise<CommandResult> {
    const a = this.state.agents.find((x) => x.id === agentId);
    if (!a?.custom) return { ok: false, message: "内置 Agent 不能移除，可关闭追踪" };
    const used =
      Object.values(this.state.sessions).filter((s) => s.agentId === agentId).length +
      this.state.recent.filter((r) => r.agentId === agentId).length;
    if (used > 0)
      return {
        ok: false,
        message: `已有 ${used} 条会话记录，不能移除`,
      };
    this.update((d) => {
      d.agents = d.agents.filter((x) => x.id !== agentId);
      if (d.defaultAgent === agentId) d.defaultAgent = "claude";
    });
    return { ok: true, message: `已移除 ${a.name}` };
  }

  // ---------- 事项方案 ----------

  async ensureTaskPlan(taskId: string): Promise<string> {
    const task = this.state.tasks[taskId];
    if (!task) throw new Error("任务已不存在");
    const id = rootPlanId(taskId);
    if (this.state.ideaPlans?.[id]) return id;
    this.update(d => {
      d.ideaPlans ??= {};
      d.ideaPlans[id] = {
        id, taskId, itemId: null, title: task.title, script: "generic", step: 0, round: 0,
        draftVersion: 1, adopted: null, turns: [], drafts: [],
        draft: { sections: [
          { id: "s-goal", title: "目标", kind: "key", lines: [{ id: `${id}-user-intent`, text: task.title, state: "fixed", userEdited: true }] },
          { id: "s-fixed", title: "已确定", kind: "key", lines: [] },
          { id: "s-open", title: "待决定", kind: "key", lines: [] },
        ] },
        discussion: { agentId: d.defaultAgent, conclusions: [] },
      };
    });
    return id;
  }

  async createIdea(text: string) {
    const taskId = uid("task");
    let planId = "";
    this.update((d) => {
      planId = createIdeaIn(d, text.trim(), { taskId, blockId: uid("b") }, (id, raw, now) => this.newTask(id, raw, now));
    });
    return { taskId, planId };
  }

  async setDiscussionAgent(planId: string, agentId: AgentId): Promise<CommandResult> {
    const plan = this.state.ideaPlans?.[planId];
    if (!plan || !this.state.agents.some((a) => a.id === agentId)) return { ok: false, message: "方案或 Agent 不存在" };
    if (plan.discussion?.agentId === agentId) return { ok: true, message: "已选择此 Agent，未发送讨论" };
    this.update((d) => {
      const p = d.ideaPlans![planId];
      p.discussion ??= { agentId, conclusions: [] };
      p.discussion.agentId = agentId;
    });
    return { ok: true, message: "已更新讨论目标；旧结论来源保留，未发送或创建会话" };
  }

  async recordDiscussionConclusion(planId: string, scope: string, input: DiscussionConclusionInput): Promise<CommandResult> {
    const plan = this.state.ideaPlans?.[planId];
    if (!plan) return { ok: false, message: "方案不存在" };
    if (scope !== "root" && !plan.draft.sections.some((s) => s.id === scope)) return { ok: false, message: "所选范围已不存在，未记录结论" };
    const summary = input.summary.trim();
    if (!summary) return { ok: false, message: "请填写结论摘要" };
    const sourceUrl = input.sourceUrl?.trim() ? safeDiscussionUrl(input.sourceUrl) : null;
    if (input.sourceUrl?.trim() && !sourceUrl) return { ok: false, message: "会话链接只支持不含账号密码的 http 或 https 地址" };
    const clean = (items: string[]) => [...new Set(items.map((s) => s.trim()).filter(Boolean))];
    const confirmed = clean(input.confirmed);
    const open = clean(input.open);
    const normalize = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ");
    const confirmedKeys = new Set(confirmed.map(normalize));
    if (open.some((text) => confirmedKeys.has(normalize(text)))) return { ok: false, message: "同一条内容不能同时标为已确定和待定，请先核对结论" };
    const agentId = input.agentId ?? plan.discussion?.agentId ?? this.state.defaultAgent;
    if (!this.state.agents.some(agent => agent.id === agentId)) return { ok: false, message: "结论来源 Agent 尚未登记，请先保存配置" };
    const conclusions = plan.discussion?.conclusions ?? [];
    const last = conclusions[conclusions.length - 1];
    if (last?.source === "manual" && last.agentId === agentId && last.scopeId === scope && last.summary === summary && last.sourceUrl === (sourceUrl ?? undefined) && JSON.stringify(last.confirmed) === JSON.stringify(confirmed) && JSON.stringify(last.open) === JSON.stringify(open)) {
      return { ok: true, message: "相同结论已记录，未重复添加" };
    }
    this.update((d) => {
      const p = d.ideaPlans![planId];
      p.discussion ??= { agentId, conclusions: [] };
      p.discussion.conclusions.push({ id: uid("conclusion"), agentId, scopeId: scope, recordedAt: d.now, summary, confirmed, open, source: "manual", sourceUrl: sourceUrl ?? undefined });
    });
    return { ok: true, message: "已记录手动带回的结论；方案正文未改动" };
  }

  async adoptDiscussionConclusion(planId: string, id: string): Promise<CommandResult> {
    const plan = this.state.ideaPlans?.[planId];
    const conclusion = plan?.discussion?.conclusions.find((c) => c.id === id);
    if (!plan || !conclusion) return { ok: false, message: "结论不存在" };
    if (conclusion.adopted) return { ok: true, message: "此结论已采用，未重复添加" };
    if (conclusion.scopeId !== "root" && !plan.draft.sections.some((s) => s.id === conclusion.scopeId)) return { ok: false, message: "结论所属段落已不存在，未改动方案" };
    if (!conclusion.confirmed.length && !conclusion.open.length) return { ok: false, message: "这条记录只有摘要，没有可采用的确定或待定条目" };
    let added = 0;
    let updated = 0;
    let protectedCount = 0;
    this.update((d) => {
      const p = d.ideaPlans![planId];
      const c = p.discussion!.conclusions.find((x) => x.id === id)!;
      const scopeSections = c.scopeId === "root" ? p.draft.sections : p.draft.sections.filter((s) => s.id === c.scopeId);
      const normalize = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ");
      const target = (state: "fixed" | "open"): PlanSection => {
        const sectionId = c.scopeId === "root" ? state === "fixed" ? "s-fixed" : "s-open" : c.scopeId;
        let section = p.draft.sections.find((s) => s.id === sectionId);
        if (!section) {
          section = { id: sectionId, title: state === "fixed" ? "已确定" : "待决定", kind: "key", lines: [] };
          p.draft.sections.push(section);
        }
        return section;
      };
      for (const [state, texts] of [["fixed", c.confirmed], ["open", c.open]] as const) {
        texts.forEach((text, i) => {
          const key = normalize(text);
          const matches = scopeSections.flatMap((section) => section.lines.filter((line) => normalize(line.text) === key).map((line) => ({ section, line })));
          if (matches.length) {
            for (const { section, line } of matches) {
              if (line.state === state) continue;
              if (line.userEdited) { protectedCount++; continue; }
              line.state = state;
              // 全局已确定/待定区保持分类一致；正文段落中的条目留在原段。
              if (c.scopeId === "root" && (section.id === "s-fixed" || section.id === "s-open")) {
                const destination = target(state);
                if (destination !== section) {
                  section.lines = section.lines.filter((l) => l.id !== line.id);
                  destination.lines.push(line);
                }
              }
              updated++;
            }
            return;
          }
          target(state).lines.push({ id: `${c.id}-${state}-${i}`, text, state });
          added++;
        });
      }
      if (added || updated) p.draftVersion++;
      c.adopted = protectedCount === 0;
      c.adoptedAt = d.now;
      c.adoptedDraftVersion = p.draftVersion;
    });
    return { ok: true, message: `补充已写入：新增 ${added} 条，更新状态 ${updated} 条。${protectedCount ? `${protectedCount} 条人工编辑内容已保留，需核对后再采用。` : "请核对与原方案的差异。"}` };
  }

  async editPlanLine(planId: string, lineId: string, patch: { text?: string; state?: LineState }) {
    this.update((d) => {
      editLineIn(d, planId, lineId, patch);
    });
  }

  async generateDrafts(planId: string) {
    this.update((d) => generateDraftsIn(d, planId));
  }

  async updateDraft(planId: string, key: string, patch: Partial<TaskDraft>) {
    this.update((d) => {
      const x = d.ideaPlans?.[planId]?.drafts.find((y) => y.key === key);
      if (x) Object.assign(x, patch, patch.include === undefined ? { edited: true } : {});
    });
  }

  async removeDraft(planId: string, key: string) {
    this.update((d) => {
      const p = d.ideaPlans![planId];
      p.drafts = p.drafts.filter((x) => x.key !== key);
      p.dismissed = [...(p.dismissed ?? []), key];
      for (const x of p.drafts) {
        x.deps = x.deps.filter((k) => k !== key);
        if (x.parentKey === key) x.parentKey = undefined;
      }
    });
  }

  async mergeDraftUp(planId: string, key: string): Promise<CommandResult> {
    const p = this.state.ideaPlans?.[planId];
    const i = p?.drafts.findIndex((x) => x.key === key) ?? -1;
    if (!p || i <= 0) return { ok: false, message: "上方没有可合并的草稿" };
    this.update((d) => {
      const q = d.ideaPlans![planId];
      const a = q.drafts[i - 1];
      const b = q.drafts[i];
      a.title = `${a.title} + ${b.title}`;
      a.expected = `${a.expected}；${b.expected}`;
      a.lineIds = [...new Set([...a.lineIds, ...b.lineIds])];
      a.deps = [...new Set([...a.deps, ...b.deps])].filter((k) => k !== a.key && k !== b.key);
      a.edited = true;
      q.drafts.splice(i, 1);
      q.dismissed = [...(q.dismissed ?? []), b.key];
      for (const x of q.drafts) x.deps = [...new Set(x.deps.map((k) => (k === b.key ? a.key : k)))].filter((k) => k !== x.key);
    });
    return { ok: true, message: "已合并" };
  }

  async indentDraft(planId: string, key: string, dir: 1 | -1) {
    this.update((d) => {
      const q = d.ideaPlans![planId];
      const i = q.drafts.findIndex((x) => x.key === key);
      if (i < 0) return;
      const x = q.drafts[i];
      if (dir === -1) x.parentKey = undefined;
      else {
        const prev = q.drafts.slice(0, i).reverse().find((y) => !y.parentKey);
        if (prev) x.parentKey = prev.key;
      }
      x.edited = true;
    });
  }

  async addDraftsToTasks(planId: string): Promise<CommandResult & { added?: number }> {
    const p = this.state.ideaPlans?.[planId];
    if (!p) return { ok: false, message: "方案不存在" };
    if (!p.drafts.some((x) => x.include)) return { ok: false, message: "没有选中的草稿" };
    let r = { added: 0, existing: 0, version: 0 };
    this.update((d) => {
      r = addDraftsIn(d, planId);
    });
    return {
      ok: true,
      added: r.added,
      message: `已加入 ${r.added} 项任务${r.existing ? `，${r.existing} 项已存在` : ""} · 来源 v${r.version} · 未启动 Agent`,
    };
  }

  async openLocalPlan(taskId: string, itemId: string) {
    let res = { id: localPlanId(taskId, itemId), created: false };
    this.update((d) => {
      res = openLocalPlanIn(d, taskId, itemId);
    });
    return res.id;
  }

  async resolveConflict(planId: string, turnId: string, choice: "submitted" | "declined"): Promise<CommandResult> {
    let ok = false;
    this.update((d) => {
      ok = resolveConflictIn(d, planId, turnId, choice, uid);
    });
    return { ok, message: choice === "submitted" ? "已作为待决定提交到上级方案，上级已确定条目未改" : "未采纳" };
  }

  async setWorkOwner(taskId: string, itemId: string, owner: Owner, agentId?: AgentId) {
    this.update((d) => {
      const w = d.orchestrations?.[taskId]?.items[itemId];
      if (!w || w.status === "running" || w.status === "queued") return;
      w.owner = owner;
      w.suggestedAgentId = owner === "agent" ? (agentId ?? w.suggestedAgentId ?? d.defaultAgent) : undefined;
    });
  }

  async setWorkStatus(taskId: string, itemId: string, status: "running" | "done" | "not_started") {
    this.update((d) => {
      const o = d.orchestrations?.[taskId];
      const w = o?.items[itemId];
      if (!o || !w) return;
      w.status = status;
      w.completedAt = status === "done" ? d.now : undefined;
      if (status === "done" && w.reviewNote?.startsWith("按 v")) w.reviewNote = `${w.reviewNote.split("；")[0]}完成；请按新版本复核`;
      refreshBlocked(o);
    });
  }

  async dispatchWork(taskId: string, itemId: string, agentId: AgentId): Promise<CommandResult> {
    const o = this.state.orchestrations?.[taskId];
    const w = o?.items[itemId];
    const agent = this.state.agents.find((a) => a.id === agentId);
    if (!o || !w || !agent) return { ok: false, message: "任务或 Agent 不存在" };
    if (agent.connection !== "healthy") return { ok: false, message: `${agent.name} 未连接，未发送` };
    if (w.status === "queued" || w.status === "running") return { ok: true, message: "正在执行，已忽略重复操作" };
    if (w.status === "blocked") return { ok: false, message: "前置任务未完成" };
    if (w.status === "done" || w.status === "cancelled") return { ok: false, message: "任务已结束" };
    const sid = uid("ses");
    const aid = uid("at");
    const exId = `ex-${agentId}`;
    this.update((d) => {
      const or = d.orchestrations![taskId];
      const item = or.items[itemId];
      or.executors[exId] ??= { id: exId, label: agent.name, agentId, parentExecutorId: null };
      const prev = item.attemptIds.length ? or.attempts[item.attemptIds[item.attemptIds.length - 1]] : null;
      d.sessions[sid] = {
        id: sid,
        agentId,
        title: item.title,
        origin: "dispatch",
        // 不进入主任务 sessionIds：单个子任务结束不会让整个事项自动完成
        taskId,
        dispatchId: uid("dsp"),
        dispatchPhase: "submitting",
        status: "pending",
        startedAt: null,
        lastActivity: d.now,
        step: null,
        tokens: null,
        rounds: [],
        subAgents: [],
      };
      or.attempts[aid] = {
        id: aid,
        workItemId: itemId,
        executorId: exId,
        sessionId: sid,
        parentSessionId: null,
        sourceLink: `${agentId}://session/${sid}`,
        kind: !prev ? "initial" : prev.executorId === exId ? "retry" : "reassign",
        status: "running",
        startedAt: d.now,
        tokens: null,
        rounds: [],
      };
      item.attemptIds.push(aid);
      item.owner = "agent";
      item.executorId = exId;
      item.suggestedAgentId = agentId;
      item.status = "queued";
    });
    this.later(1100, () =>
      this.update((d) => {
        const or = d.orchestrations?.[taskId];
        const s = d.sessions[sid];
        if (!or || !s) return;
        s.dispatchPhase = "acknowledged";
        s.status = "running";
        s.startedAt = d.now;
        s.step = { completed: 1, total: 3, label: "整理资料" };
        s.tokens = 4_000;
        const a = or.attempts[aid];
        a.startedAt = d.now;
        a.tokens = 4_000;
        a.step = { completed: 1, total: 3, label: "整理资料" };
        or.items[itemId].status = "running";
      }),
    );
    this.later(5200, () =>
      this.update((d) => {
        const or = d.orchestrations?.[taskId];
        const s = d.sessions[sid];
        if (!or || !s || s.status !== "running") return;
        const item = or.items[itemId];
        const reply = agentResult(item);
        const a = or.attempts[aid];
        a.status = "done";
        a.endedAt = d.now;
        a.tokens = 18_000;
        a.step = { completed: 3, total: 3, label: "完成" };
        a.rounds.push({ id: uid("r"), at: d.now, reply });
        s.status = "archived";
        s.endedAt = d.now;
        s.tokens = 18_000;
        s.step = { completed: 3, total: 3, label: "完成" };
        s.rounds.push({ id: uid("r"), at: d.now, reply });
        this.countSession(d, s);
        item.status = "done";
        item.completedAt = d.now;
        refreshBlocked(or);
      }),
    );
    return { ok: true, message: `已委派给 ${agent.name} · 提交中（演示）` };
  }

  async applyRevision(planId: string, supplement: string[]): Promise<CommandResult> {
    let r: ReturnType<typeof applyRevisionIn> = null;
    this.update((d) => {
      r = applyRevisionIn(d, planId, supplement, uid);
    });
    if (!r) return { ok: false, message: "没有需要应用的修订" };
    const x = r as NonNullable<ReturnType<typeof applyRevisionIn>>;
    return {
      ok: true,
      message: `已应用 v${x.version}：更新 ${x.updated} · 不再需要 ${x.obsolete} · 执行中保留 ${x.running} · 已完成保留 ${x.done}${x.created ? ` · 补充 ${x.created}` : ""}`,
    };
  }

  /** 旅行演示阶段：替换上一个演示事项后，按同一套逻辑同步重放到指定阶段 */
  private buildTravelStage(stage: TravelStage) {
    let out: { taskId: string; planId: string; itemId?: string } | null = null;
    const order: TravelStage[] = ["discuss", "drafts", "tree", "local", "revision", "note"];
    const at = (s: TravelStage) => order.indexOf(stage) >= order.indexOf(s);
    this.update((d) => {
      // 移除上一个演示旅行事项（只动演示数据）
      for (const p of Object.values(d.ideaPlans ?? {})) {
        if (p.demo !== "travel") continue;
        const tid = p.taskId;
        delete d.tasks[tid];
        d.journal.blocks = d.journal.blocks.filter((b) => !(b.kind === "task" && b.taskId === tid));
        delete d.orchestrations?.[tid];
        for (const q of Object.values(d.ideaPlans ?? {})) if (q.taskId === tid) delete d.ideaPlans![q.id];
        for (const s of Object.values(d.sessions)) if (s.taskId === tid) delete d.sessions[s.id];
      }
      const taskId = uid("task");
      const planId = createIdeaIn(d, "想安排一次轻松旅行，最后做成图文计划", { taskId, blockId: uid("b") }, (id, raw, now) => this.newTask(id, raw, now), "travel");
      aiStepIn(d, planId, "root", uid);
      pushUser(d, planId, "5 天，和伴侣，每天一两个点", "root", uid);
      aiStepIn(d, planId, "root", uid);
      // 用户直接改过的条目：后续轮次保留
      editLineIn(d, planId, "l-pace", { text: "每天 1–2 个主要活动，下午留白，不排早起" });
      pushUser(d, planId, "选高铁，不想开车累", "root", uid);
      aiStepIn(d, planId, "root", uid);
      out = { taskId, planId };
      if (!at("drafts")) return;
      pushUser(d, planId, "每天一张路线示意 + 3 张照片，先用参考图，回来换成自己的", "root", uid);
      aiStepIn(d, planId, "root", uid);
      generateDraftsIn(d, planId);
      if (!at("tree")) return;
      addDraftsIn(d, planId);
      const o = d.orchestrations![taskId];
      // 已完成的人工任务、已完成的 Agent 执行、进行中的人工任务
      o.items["w-dates"].status = "done";
      o.items["w-dates"].completedAt = d.now;
      const sid = uid("ses");
      const aid = uid("at");
      o.executors["ex-claude"] = { id: "ex-claude", label: "Claude Code", agentId: "claude", parentExecutorId: null };
      d.sessions[sid] = {
        id: sid, agentId: "claude", title: "比较交通", origin: "dispatch", taskId, dispatchId: uid("dsp"), dispatchPhase: "acknowledged",
        status: "archived", startedAt: d.now, endedAt: d.now, lastActivity: d.now, step: { completed: 3, total: 3, label: "完成" }, tokens: 18_000,
        rounds: [{ id: uid("r"), at: d.now, reply: agentResult(o.items["w-transport"]) }], subAgents: [], counted: true,
      };
      o.attempts[aid] = {
        id: aid, workItemId: "w-transport", executorId: "ex-claude", sessionId: sid, parentSessionId: null, sourceLink: `claude://session/${sid}`,
        kind: "initial", status: "done", startedAt: d.now, endedAt: d.now, tokens: 18_000, step: { completed: 3, total: 3, label: "完成" },
        rounds: [{ id: uid("r"), at: d.now, reply: agentResult(o.items["w-transport"]) }],
      };
      Object.assign(o.items["w-transport"], { attemptIds: [aid], executorId: "ex-claude", status: "done", completedAt: d.now });
      o.items["w-photos"].status = "running";
      refreshBlocked(o);
      if (!at("local")) return;
      const local = openLocalPlanIn(d, taskId, "w-daily").id;
      aiStepIn(d, local, "root", uid);
      pushUser(d, local, "B：先远后近", "root", uid);
      aiStepIn(d, local, "root", uid);
      pushUser(d, local, "片区之间按公交衔接", "root", uid);
      aiStepIn(d, local, "root", uid);
      generateDraftsIn(d, local);
      out = { taskId, planId: local, itemId: "w-daily" };
      if (!at("revision")) return;
      addDraftsIn(d, local);
      editLineIn(d, planId, "l-days", { text: "3 天" });
      out = { taskId, planId };
      if (!at("note")) return;
      applyRevisionIn(d, planId, ["w-transport"], uid);
    });
    return out;
  }

  // ---------- 示例控制 ----------

  private applyOrch(action: OrchDemoAction): CommandResult {
    if (!this.state.orchestrations?.[SEARCH_TASK_ID])
      return { ok: false, message: "没有全文搜索编排，可重置演示" };
    if (action !== "restore" && this.state.tasks[SEARCH_TASK_ID]?.completion)
      return { ok: false, message: "主任务已完成，先重新打开" };
    let result: CommandResult = { ok: true };
    this.update((d) => {
      const o = d.orchestrations![SEARCH_TASK_ID];
      const main = d.sessions[o.mainSessionId!];
      const now = d.now;
      const last = (id: string) => {
        const w = o.items[id];
        return o.attempts[w.attemptIds[w.attemptIds.length - 1]];
      };
      const finish = (id: string, reply?: string) => {
        const w = o.items[id];
        if (!w || w.status === "done") return;
        let a = last(id);
        if (!a) {
          // 计划中的子任务开始并完成：追加真实执行记录（由计划执行者完成）
          const aid = uid("at");
          a = o.attempts[aid] = {
            id: aid,
            workItemId: id,
            executorId: w.executorId ?? o.mainExecutorId ?? "",
            sessionId: o.mainSessionId!,
            parentSessionId: null,
            sourceLink: `claude-code://session/${o.mainSessionId}`,
            kind: "initial",
            status: "running",
            startedAt: now,
            tokens: 6_000,
            rounds: [],
          };
          w.attemptIds.push(aid);
        }
        a.status = "done";
        a.endedAt = now;
        if (a.step?.total) a.step = { ...a.step, completed: a.step.total };
        if (reply) a.rounds.push({ id: uid("r"), at: now, reply });
        w.status = "done";
        w.waiting = undefined;
        w.statusReason = undefined;
      };

      if (action === "fail_nested") {
        const w = o.items["w-edge"];
        if (!w || w.status !== "running") {
          result = { ok: false, message: "“验证分词边界用例”当前不在执行中" };
          return;
        }
        const a = last(w.id);
        a.status = "failed";
        a.endedAt = now;
        w.status = "failed";
        w.statusReason = "分词器在 emoji 边界用例上崩溃（演示）";
        result = { ok: true, message: "嵌套子任务失败，其他分支继续" };
      } else if (action === "retry") {
        const failed = o.itemOrder.map((id) => o.items[id]).filter((w) => w.status === "failed");
        if (!failed.length) {
          result = { ok: false, message: "没有失败的子任务" };
          return;
        }
        for (const w of failed) {
          const prev = last(w.id);
          const aid = uid("at");
          o.attempts[aid] = {
            ...prev,
            id: aid,
            kind: "retry",
            status: "running",
            startedAt: now,
            endedAt: undefined,
            tokens: 1_000,
            note: undefined,
            rounds: [],
          };
          w.attemptIds.push(aid);
          w.status = "running";
          w.statusReason = undefined;
        }
        result = { ok: true, message: `已重试 ${failed.length} 项（任务数不变）` };
      } else if (action === "permission") {
        const w = o.items["w-ui"];
        if (!w || w.status !== "running") {
          result = { ok: false, message: "“制作搜索界面”当前不在执行中" };
          return;
        }
        w.status = "waiting_permission";
        w.statusReason = "等待权限：安装分词依赖";
        w.waiting = {
          kind: "permission",
          question: "请求运行 pnpm add @node-rs/jieba（会修改 package.json 与锁文件）",
          impact: "只阻塞搜索界面；索引分支可继续。",
          since: now,
        };
        last(w.id).status = "waiting_permission";
        result = { ok: true, message: "界面分支等待权限" };
      } else if (action === "finish_parallel") {
        for (const id of ["w-seed", "w-edge"]) finish(id, id === "w-edge" ? "边界用例全部通过。" : undefined);
        finish("w-index", "全文索引已完成，2 万条笔记的中文分词基准通过。");
        finish("w-ui", "搜索界面已完成，结果高亮与空状态都已接好。");
        result = { ok: true, message: "并行分支已完成" };
      } else if (action === "finish_all") {
        for (const id of o.itemOrder)
          finish(
            id,
            id === "w-pinyin"
              ? "已按你的确认支持拼音首字母搜索。"
              : id === "w-integrate"
                ? "联调与测试通过。"
                : id === "w-handoff"
                  ? "交付说明已写入 docs/search.md。"
                  : undefined,
          );
        main.rounds.push({
          id: uid("r"),
          at: now,
          reply: "子任务已全部结束，联调测试通过。请验收；确认后再完成主任务。",
        });
        result = { ok: true, message: "子任务全部结束 → 待验收" };
      } else {
        d.orchestrations![SEARCH_TASK_ID] = createSearchOrchestration();
        const fresh = createSearchMainSession();
        d.sessions[o.mainSessionId!] = { ...main, rounds: fresh.rounds, status: "running", endedAt: undefined };
        result = { ok: true, message: "已恢复编排" };
      }
      const cur = d.orchestrations![SEARCH_TASK_ID];
      if (action !== "restore") cur.syncedAt = now;
      // 主会话的“含子代理总量”与唯一执行记录之和保持一致
      const recorded = Object.values(cur.attempts).reduce((s, a) => s + (a.tokens ?? 0), 0);
      d.sessions[cur.mainSessionId!].tokens = recorded + (cur.coordinationTokens ?? 0);
      d.sessions[cur.mainSessionId!].lastActivity = now;
    });
    return result;
  }

  private prepareMergeDemo() {
    const sessionId = uid("ses");
    let taskId = Object.values(this.state.tasks).find(
      (t) => t.title === MERGE_DEMO_TASK && !t.completion,
    )?.id;
    this.update((d) => {
      if (!taskId) {
        taskId = uid("task");
        d.tasks[taskId] = this.newTask(taskId, MERGE_DEMO_TASK, d.now);
        d.tasks[taskId].estimate = 10;
        d.journal.blocks.push({ id: uid("b"), kind: "task", taskId });
      }
      const n = Object.values(d.sessions).filter((s) => s.client === MERGE_DEMO_CLIENT).length + 1;
      const startedAt = fromMinutes(toMinutes(d.now) - 3);
      const parent = uid("sa");
      const s: Session = {
        id: sessionId,
        agentId: "codex",
        title: `演示会话 · 合并动效 #${n}`,
        origin: "observed",
        taskId: null,
        status: "running",
        startedAt,
        lastActivity: d.now,
        step: { completed: 1, total: 3, label: "整理演示记录" },
        tokens: 0,
        client: MERGE_DEMO_CLIENT,
        rounds: [
          {
            id: uid("r"),
            at: fromMinutes(toMinutes(d.now) - 1),
            reply: "这是演示会话的最终回复，用来展示关联到原 TODO 的过程。",
          },
        ],
        subAgents: [
          {
            id: parent,
            title: "演示子代理",
            status: "running",
            start: startedAt,
            tokens: 2_000,
            sessionRef: `${sessionId}-sub-1`,
          },
          {
            id: uid("sa"),
            parentId: parent,
            title: "演示子代理的下一层",
            status: "done",
            start: startedAt,
            end: d.now,
            tokens: 1_000,
            sessionRef: `${sessionId}-sub-1a`,
          },
        ],
      };
      d.sessions[sessionId] = s;
      this.addTokens(d, s, 6_000);
      this.countSession(d, s);
      // 放在演示 TODO 正上方，路径短且都在视野内
      const at = d.journal.blocks.findIndex((b) => b.kind === "task" && b.taskId === taskId);
      d.journal.blocks.splice(at < 0 ? d.journal.blocks.length : at, 0, {
        id: uid("b"),
        kind: "session",
        sessionId,
      });
    });
    return { sessionId, taskId: taskId! };
  }

  private addObservedSession() {
    this.externalCount += 1;
    const id = uid("ses");
    const parent = uid("sa");
    this.update((d) => {
      const startedAt = fromMinutes(toMinutes(d.now) - 6);
      const s: Session = {
        id,
        agentId: "codex",
        title:
          this.externalCount === 1 ? "核对发布清单里的版本号" : `外部会话 ${this.externalCount}`,
        origin: "observed",
        taskId: null,
        status: "running",
        startedAt,
        lastActivity: d.now,
        step: { completed: 2, total: 4, label: "比对版本号来源" },
        tokens: 0,
        client: "Codex 桌面客户端",
        rounds: [
          {
            id: uid("r"),
            at: fromMinutes(toMinutes(d.now) - 4),
            reply: "已读取 release-checklist.md，共 18 项，其中 4 项涉及版本号。",
          },
          {
            id: uid("r"),
            at: fromMinutes(toMinutes(d.now) - 1),
            reply: "package.json 与 CHANGELOG 的版本号一致，iOS 构建号仍是 2.3.9，需要更新。",
          },
        ],
        subAgents: [
          {
            id: parent,
            title: "比对各平台版本号",
            status: "running",
            start: fromMinutes(toMinutes(d.now) - 3),
            tokens: 9_000,
            sessionRef: `${id}-sub-1`,
          },
          {
            id: uid("sa"),
            parentId: parent,
            title: "读取 iOS Info.plist",
            status: "done",
            start: fromMinutes(toMinutes(d.now) - 3),
            end: fromMinutes(toMinutes(d.now) - 2),
            tokens: 3_000,
            sessionRef: `${id}-sub-1a`,
          },
        ],
      };
      d.sessions[id] = s;
      this.addTokens(d, s, 26_000);
      this.countSession(d, s);
      d.journal.blocks.push({ id: uid("b"), kind: "session", sessionId: id });
      d.activity.push({ agentId: "codex", start: startedAt, end: "now" });
    });
  }

  /** 演示动作：一轮结束、100%、子代理完成都只更新记录，不完成父任务 */
  private applyAction(taskId: string, action: DemoAction): CommandResult {
    const task = this.state.tasks[taskId];
    if (!task) return { ok: false, message: "任务不存在" };
    const target = task.sessionIds
      .map((id) => this.state.sessions[id])
      .find((s) => s && s.status !== "archived" && s.dispatchPhase !== "submitting");
    if (!target)
      return { ok: false, message: "该任务没有进行中的会话" };
    let message = "";
    this.update((d) => {
      const s = d.sessions[target.id];
      s.lastActivity = d.now;
      if (action === "end_round") {
        const n = s.rounds.length;
        // 演示轮次按自身顺序循环模板，便于看出逐轮保存
        const k = s.rounds.filter((r) => r.id.startsWith("rd-")).length;
        s.rounds.push({ id: uid("rd"), at: d.now, reply: REPLY_TEMPLATES[k % 3](task.title) });
        if (s.tokens != null) this.addTokens(d, s, 12_000);
        message = `第 ${n + 1} 轮回复已保存`;
      } else if (action === "steps_full") {
        const total = s.step?.total ?? 4;
        s.step = { completed: total, total, label: "全部步骤已完成" };
        message = `步骤 ${total}/${total}，任务仍未完成`;
      } else {
        const running = s.subAgents.filter((x) => x.status === "running");
        // 优先完成最深一层：没有正在运行的子级
        const leaf = running.find(
          (x) => !running.some((y) => y.parentId === x.id),
        );
        if (!leaf) {
          const pid = uid("sa");
          s.subAgents.push(
            {
              id: pid,
              title: "核对引用来源",
              status: "running",
              start: d.now,
              tokens: 6_000,
              sessionRef: `${s.id}-${pid}`,
            },
            {
              id: uid("sa"),
              parentId: pid,
              title: "抽查 3 条引用",
              status: "running",
              start: d.now,
              tokens: 2_000,
              sessionRef: `${s.id}-${pid}-a`,
            },
          );
          message = "已添加 2 个运行中的子代理（含 1 个嵌套）";
        } else {
          const sa = s.subAgents.find((x) => x.id === leaf.id)!;
          sa.status = "done";
          sa.end = d.now;
          message = `子代理“${sa.title}”已完成`;
        }
      }
    });
    return { ok: true, message };
  }

  private applyScenario(taskId: string, scenario: DemoScenario) {
    this.update((d) => {
      const task = d.tasks[taskId];
      if (!task) return;
      if (!task.sessionIds.length) {
        const id = uid("ses");
        d.sessions[id] = {
          id,
          agentId: d.defaultAgent,
          title: task.title,
          origin: "dispatch",
          taskId,
          dispatchId: uid("dsp"),
          dispatchPhase: "submitting",
          status: "pending",
          startedAt: null,
          lastActivity: d.now,
          step: null,
          tokens: null,
          rounds: [],
          subAgents: [],
        };
        task.sessionIds.push(id);
      }
      const s = d.sessions[task.sessionIds[0]];
      task.manualLock = false;
      task.completion = null;
      s.failure = undefined;
      s.waitingReason = undefined;
      s.waitingQuestion = undefined;
      s.waitingRisk = undefined;
      s.waitingOptions = undefined;
      s.endedAt = undefined;
      const started = s.startedAt ?? d.now;
      const step = s.step?.total ? s.step : { completed: 3, total: 6, label: "接上搜索框" };

      switch (scenario) {
        case "submitting":
          Object.assign(s, {
            dispatchPhase: "submitting",
            status: "pending",
            startedAt: null,
            step: null,
            tokens: null,
          });
          break;
        case "acknowledged":
          Object.assign(s, {
            dispatchPhase: "acknowledged",
            status: "queued",
            startedAt: null,
            step: null,
          });
          break;
        case "running":
          Object.assign(s, {
            dispatchPhase: "acknowledged",
            status: "running",
            startedAt: started,
            step: { ...step, completed: Math.min(step.completed ?? 1, (step.total ?? 6) - 2) },
          });
          s.tokens ??= 120_000;
          if (taskId === "task-a") {
            s.tokens = 388_000;
            s.step = { completed: 4, total: 6, label: "接上搜索框" };
            s.rounds = s.rounds.slice(0, 2);
            s.subAgents = [
              { ...s.subAgents[0], status: "done" },
              { ...s.subAgents[1], status: "running", end: undefined, tokens: 64_000 },
            ];
          }
          break;
        case "waiting_reply":
          Object.assign(s, {
            dispatchPhase: "acknowledged",
            status: "waiting_reply",
            startedAt: started,
          });
          if (!s.rounds.length)
            s.rounds.push({
              id: uid("r"),
              at: d.now,
              reply: "方案已整理好，涉及 3 个模块。请确认是否按这个范围继续？",
            });
          s.waitingReason = "本轮已结束，等你回复";
          s.waitingQuestion = s.rounds[s.rounds.length - 1].reply;
          s.waitingRisk = "源端未提供影响说明。";
          s.waitingOptions = ["按此范围继续", "调整范围后继续", "结束本会话"];
          break;
        case "waiting_permission":
          Object.assign(s, {
            dispatchPhase: "acknowledged",
            status: "waiting_permission",
            startedAt: started,
          });
          s.waitingReason = "请求运行 pnpm install";
          s.waitingQuestion =
            "需要运行 pnpm install 安装新增的分词依赖，会写入 node_modules 和 pnpm-lock.yaml。是否允许？";
          s.waitingRisk = "据源端权限请求：将写入 node_modules 与 pnpm-lock.yaml。";
          s.waitingOptions = ["允许本次", "拒绝并说明原因", "改为只读检查"];
          break;
        case "failed":
          Object.assign(s, { dispatchPhase: "acknowledged", status: "failed", startedAt: started });
          s.failure = "源端报告执行失败：测试进程退出码 1。已保留全部记录。";
          break;
        case "rejected":
          Object.assign(s, {
            dispatchPhase: "rejected",
            status: "failed",
            startedAt: null,
            step: null,
            tokens: null,
          });
          s.failure = `${this.agent(d, s.agentId).name} 拒绝受理：示例工作区未授权写入。原文已保留。`;
          break;
        case "unknown":
          Object.assign(s, {
            dispatchPhase: "unknown",
            status: "pending",
            startedAt: null,
            step: null,
            tokens: null,
          });
          s.failure = "请求已发出但未收到受理回执。先对账，不会自动重发或改投其他 Agent。";
          break;
        case "archived":
          for (const id of task.sessionIds) {
            const ses = d.sessions[id];
            ses.dispatchPhase =
              ses.dispatchPhase === "submitting" || ses.dispatchPhase === "unknown"
                ? "acknowledged"
                : ses.dispatchPhase;
            ses.status = "archived";
            ses.startedAt ??= started;
            ses.endedAt = d.now;
            ses.subAgents = ses.subAgents.map((sa) => ({
              ...sa,
              status: "done",
              end: sa.end ?? d.now,
            }));
          }
          if (taskId === "task-a") {
            const fresh = createSampleSnapshot().sessions["ses-claude-search"];
            Object.assign(s, { ...fresh });
          }
          break;
      }
      this.settle(d, taskId);
    });
  }
}

export const sampleDataSource = new SampleWorkdeckDataSource();
