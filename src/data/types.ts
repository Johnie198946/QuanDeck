// QuanDeck 前端领域模型（对应 PRD V0.5 §4 / §13 的前端可见子集）。
// QuanDeck 不含 Runtime：会话、轮次、步骤、token 都来自外部 Runtime 的回执。
import type { SourceReference } from "../integration/contracts";

/** 内置 Agent：claude / codex / workbuddy / deepseek；自定义 Agent 使用 custom-* */
export type AgentId = string;

export type ConnectionHealth = "healthy" | "offline";

export interface Agent {
  runtimeConnection?: import('./runtimeContracts').RuntimeConnectionBinding;
  id: AgentId;
  name: string;
  short: string;
  /** 稳定的 Agent 身份色，日记、执行栏、螺旋、图例共用 */
  color: string;
  connection: ConnectionHealth;
  connectionNote: string;
  tracked: boolean;
  starred: boolean;
  pinned: boolean;
  /** null = 未覆盖（未连接／扫描失败，没有证据）；0 = 有覆盖证据且确无活动 */
  today: { minutes: number | null; tokens: number | null; sessions: number | null };
  /** 含今日的 14 个自然日协作分钟（会话累计）；null = 当日未覆盖 */
  daily14: (number | null)[];
  scan: { state: "idle" | "scanning" | "failed"; lastAt: string | null; note?: string };
  /** 用户自定义的 Agent：默认未连接 / 待配置，保存配置不会派发 */
  custom?: boolean;
  /** 用户配置已登记到业务身份表；不代表当前连接已验证。 */
  registered?: boolean;
  /** 自定义头像（已缩放的 data URL）；内置 Agent 使用本地官方标志 */
  logo?: string | null;
  /** 连接方式 / 会话地址（仅记录，不保存密钥） */
  endpoint?: string;
}

/** 派发子态：本地提交 → 源端受理／拒绝／受理未知 */
export type DispatchPhase = "submitting" | "acknowledged" | "rejected" | "unknown";

export type SessionStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_reply"
  | "waiting_permission"
  | "failed"
  | "paused"
  | "cancelled"
  | "archived";

export interface Step {
  /** 只有源端给出真实总步骤时才有 completed / total */
  completed?: number;
  total?: number;
  label: string;
}

export interface Round {
  id: string;
  at: string;
  /** 该轮最后一条可展示的 assistant 最终回复原文 */
  reply: string;
}

export interface SubAgentRecord {
  source?: SourceReference;
  id: string;
  /** 真实父级：缺省为会话本身；有值时挂在对应子代理下一层 */
  parentId?: string;
  title: string;
  status: "queued" | "running" | "paused" | "cancelled" | "done" | "failed";
  start: string;
  end?: string;
  tokens: number | null;
  sessionRef: string;
}

export interface Session {
  bindingHistory?: { fromTaskId: string | null; toTaskId: string; at: string }[];
  runtime?: import('./runtimeContracts').RuntimeExecutionMeta;
  /** Exact source receipt. A demo/business session id is not a tool session id. */
  source?: SourceReference;
  /** 示例中等同 runtime_session_id；真实实现需与 connection_id 组合定位 */
  id: string;
  agentId: AgentId;
  title: string;
  /** dispatch = 本工作台派发；observed = 外部客户端新开、自动记入日记 */
  origin: "dispatch" | "observed";
  taskId: string | null;
  dispatchId?: string;
  dispatchPhase?: DispatchPhase;
  status: SessionStatus;
  startedAt: string | null;
  endedAt?: string;
  lastActivity: string;
  step: Step | null;
  /** 仅当源端回执给出真实百分比时才有值；QuanDeck 不自行估算 */
  percent?: number | null;
  tokens: number | null;
  rounds: Round[];
  subAgents: SubAgentRecord[];
  /** 等待摘要，例如“3 个术语待确认”（源端提供） */
  waitingReason?: string;
  /** 源端原始问题全文；缺失时退回最新一轮回复 */
  waitingQuestion?: string;
  /** 影响说明，须注明依据；缺失时显示“未提供”，不做推断 */
  waitingRisk?: string;
  /** 推荐选项，仅作提示；实际选择须回源会话完成 */
  waitingOptions?: string[];
  failure?: string;
  mergedAt?: string;
  /** 以归档历史身份关联（不会重新执行，也不影响任务完成状态） */
  linkedAsHistory?: boolean;
  /** 来源客户端描述，例如“Codex 桌面客户端” */
  client?: string;
  /** 已计入今日统计（防止重试、对账、合并重复计数） */
  counted?: boolean;
}

export interface Task {
  /** User-authored context, delivered with the next dispatch and retained in task history. */
  inputs?: { id: string; text: string; at: string; attachments?: OutputAttachment[] }[];
  /** Full original wording retained when AI condenses the title. */
  originalTitle?: string;
  titleRevision?: number;
  attachments?: OutputAttachment[];
  due?: import('./intelligence').TaskDue;
  createdFrom?: {type:'input'|'suggestion';id:string;summaryId?:string};
  sessionHistory?: { sessionId: string; transferredToTaskId: string; at: string; title: string; status: SessionStatus; rounds: Round[]; source?: SourceReference }[];
  owner?: "me" | "agent";
  id: string;
  title: string;
  estimate?: number;
  sessionIds: string[];
  completion: null | { reason: "all_archived" | "manual"; at: string };
  /** 用户手动完成／重新打开后的覆盖锁，自动事件不改掉用户意图 */
  manualLock: boolean;
  createdAt: string;
}

export type JournalBlock =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "task"; taskId: string }
  | { id: string; kind: "session"; sessionId: string };

export interface PlanItem {
  id: string;
  date?: string;
  cancelled?: boolean;
  manualStartedAt?: string;
  manualActual?: [string, string][];
  title: string;
  kind: "fixed" | "flexible";
  start: string;
  minutes: number;
  actual: [string, string][];
  taskId?: string;
  /** Omit for the whole task; set for a subtask and its descendants. */
  workItemId?: string;
}

export interface AgentInterval {
  agentId: AgentId;
  start: string;
  end: string | "now";
}

export interface RecentSession {
  id: string;
  agentId: AgentId;
  title: string;
  date: string;
  time: string;
  status: "running" | "waiting" | "archived" | "failed";
}

export interface TodayStats {
  /** 协作分钟（会话累计，非用户工时） */
  collabMinutes: number | null;
  /** 墙钟覆盖（并集） */
  wallMinutes: number | null;
  tokens: number | null;
  sessions: number | null;
}

// ---------- 主任务编排：子任务（工作）／执行者（Agent）／执行记录（attempt）分开建模 ----------

/** 子任务状态。queued = 资源尚未分配；blocked = 等待前置（依赖未完成），两者不混用 */
export type WorkStatus =
  | "not_started"
  | "queued"
  | "running"
  | "paused"
  | "waiting_reply"
  | "waiting_permission"
  | "blocked"
  | "failed"
  | "review"
  | "done"
  | "cancelled";

/** 执行者：主 Agent 或子 Agent。parentExecutorId 表示执行者层级（parentAgentId） */
export interface Executor {
  id: string;
  label: string;
  /** 所属产品家族，决定颜色：同一主 Agent 家族同色 */
  agentId: AgentId;
  parentExecutorId: string | null;
}

/** 某次执行。重试／恢复／更换执行者都追加 attempt，不创建新子任务 */
export interface Attempt {
  source?: SourceReference;
  id: string;
  workItemId: string;
  executorId: string;
  sessionId: string;
  parentSessionId: string | null;
  /** 演示跳转目标；未连接时不声称已打开 */
  sourceLink: string;
  kind: "initial" | "retry" | "resume" | "reassign";
  status: "running" | "queued" | "paused" | "waiting_reply" | "waiting_permission" | "done" | "failed" | "interrupted" | "cancelled";
  startedAt: string;
  endedAt?: string;
  /** 本次执行自身的 token（不含下级子任务），null = 尚未同步 */
  tokens: number | null;
  /** 只有源端给出可核验步骤时才有 */
  step?: Step | null;
  rounds: Round[];
  note?: string;
}

/** 子任务：需要完成的工作单元，稳定 id；parentTaskId 表示任务层级，dependsOnTaskIds 表示执行依赖 */
export interface WorkItem {
  attachments?: OutputAttachment[];
  id: string;
  rootTaskId: string;
  /** 主任务 id 或另一子任务 id */
  parentTaskId: string;
  title: string;
  phase: string;
  dependsOnTaskIds: string[];
  /** 当前执行者（Agent 层级）；人工或未安排的任务没有执行者 */
  executorId?: string;
  /** 负责人：我 / Agent / 未安排。与“借助 AI 思考”无关 */
  owner?: Owner;
  /** Agent 负责但尚未委派时的建议 Agent */
  suggestedAgentId?: AgentId;
  /** 预期结果 */
  expected?: string;
  /** 来源方案版本与段落（正式任务记录来源，修订时据此判断影响） */
  source?: { planId: string; version: number; lineIds: string[] };
  /** 方案条件不再满足时不再需要，例如天数少于此值 */
  minDays?: number;
  /** 修订后需要复核的说明（不改动执行中的要求） */
  reviewNote?: string;
  completedAt?: string;
  /** 由草稿加入时的草稿键，保证重复加入幂等 */
  draftKey?: string;
  status: WorkStatus;
  statusReason?: string;
  attemptIds: string[];
  waiting?: {
    kind: "reply" | "permission";
    question: string;
    impact?: string;
    since: string;
  };
}

export interface Orchestration {
  taskId: string;
  /** 面包屑中的短名，例如“全文搜索” */
  label: string;
  /** 主 Agent 协调时才有；人工方案生成的任务树没有主 Agent */
  mainAgentId?: AgentId;
  mainSessionId?: string;
  mainExecutorId?: string;
  startedAt: string;
  /** 数据源最近一次同步编排状态的时刻；经过时间按此计算，不外推 */
  syncedAt: string;
  /** 主 Agent 自身协调消耗（不含子任务记录），null = 尚未同步 */
  coordinationTokens: number | null;
  phases: string[];
  executors: Record<string, Executor>;
  items: Record<string, WorkItem>;
  /** 展示顺序（全部层级） */
  itemOrder: string[];
  attempts: Record<string, Attempt>;
  /** 数据源实际提供的能力；缺失的显示“尚未接入” */
  capabilities: { subAgents: boolean; steps: boolean; tokens: boolean; permissionEvents: boolean };
}

export type Owner = "me" | "agent" | "unassigned";

// ---------- 事项方案（思路）：方案与对话记录分开保存 ----------

export type LineState = "fixed" | "tentative" | "open";

export interface PlanLine {
  id: string;
  text: string;
  state: LineState;
  /** 用户直接编辑过：后续 AI 更新不覆盖 */
  userEdited?: boolean;
  /** 最近一次被修改的轮次 */
  round?: number;
}

export interface PlanSection {
  id: string;
  title: string;
  /** 要点区（目标/交付物/已确定/暂定/待决定）或正文结构段落 */
  kind: "key" | "body";
  lines: PlanLine[];
}

export interface PlanDoc {
  sections: PlanSection[];
}

export interface ChatTurn {
  id: string;
  role: "user" | "ai";
  /** 讨论范围：root 或正文段落 id */
  scope: string;
  at: string;
  text: string;
  options?: { label: string; action?: "drafts" }[];
  compare?: { cols: [string, string]; rows: [string, string, string][]; note?: string };
  /** 本轮修改范围（段落 → 增改删计数） */
  changes?: { section: string; added: number; changed: number; removed: number }[];
  /** 因用户已编辑而保留未改的条目 */
  kept?: string[];
  /** 与上级方案冲突的建议，须用户决定 */
  conflict?: { text: string; parentLine: string; resolved?: "submitted" | "declined" };
}

export interface TaskDraft {
  key: string;
  title: string;
  expected: string;
  deps: string[];
  owner: Owner;
  agentId?: AgentId;
  lineIds: string[];
  phase: string;
  parentKey?: string;
  include: boolean;
  /** 来源段落仍有待定项，默认不加入 */
  notReady?: string;
  minDays?: number;
  /** 用户编辑过：再次生成时保留 */
  edited?: boolean;
}

/** 讨论发生在外部 Agent；这里只保存带来源的结论，不保存本地聊天输入状态。 */
export interface DiscussionConclusion {
  outline?: PlanSection[];
  deliverables?: import("./goalDelivery").DeliverySlotDraft[];
  visualBlocks?: import("./discussionVisual").DiscussionVisualBlock[];
  id: string;
  agentId: AgentId;
  scopeId: string;
  recordedAt: string;
  summary: string;
  confirmed: string[];
  open: string[];
  /** Unaccepted Agent suggestions, separate from unknown questions. */
  proposed?: string[];
  /** Validated candidate graph; creates no work until explicit approval. */
  tasks?: TaskDraft[];
  source: "manual" | "sample" | "agent";
  sourceRef?: SourceReference;
  sourceMessageId?: string;
  sourceUrl?: string;
  adopted?: boolean;
  adoptedAt?: string;
  adoptedDraftVersion?: number;
}

export interface DiscussionConclusionInput {
  outline?: PlanSection[];
  deliverables?: import("./goalDelivery").DeliverySlotDraft[];
  tasks?: TaskDraft[];
  /** 明确记录来源身份，避免目标切换后归给另一个 Agent。 */
  agentId?: AgentId;
  summary: string;
  confirmed: string[];
  open: string[];
  sourceUrl?: string;
}

export interface IdeaPlan {
  scope?: "project" | "task";
  id: string;
  /** 事项（日记中的同一条任务） */
  taskId: string;
  /** 局部方案：针对某个子任务；null 为事项根方案 */
  itemId: string | null;
  title: string;
  script: string;
  step: number;
  round: number;
  thinking?: boolean;
  draft: PlanDoc;
  draftVersion: number;
  /** 已采用版本：正式任务记录来源；草稿与已采用分开 */
  adopted: { version: number; doc: PlanDoc; at: string; draftVersion?: number; conclusionIds?: string[] } | null;
  turns: ChatTurn[];
  drafts: TaskDraft[];
  /** 演示数据标记，便于跳转演示阶段时只替换演示事项 */
  demo?: string;
  /** 局部方案带入的上级条目 id（只读，随上级已采用版本变化） */
  inherit?: string[];
  /** 用户删除过的草稿键：再次生成时不再加回 */
  dismissed?: string[];
  /** 讨论目标与结论独立于业务执行会话；切换目标不改旧结论的来源。 */
  discussion?: { agentId: AgentId; conclusions: DiscussionConclusion[]; sessionId?: string; syncStatus?: 'pending' | 'synced' | 'failed'; syncedAt?: string };
}

export interface OutputAttachment { id: string; name: string; type: string; size: number }
export interface TaskOutput {
  id: string; taskId: string; workItemId?: string | null;
  title: string; body: string; links: { label: string; url: string }[];
  attachments?: OutputAttachment[];
  createdAt: string; updatedAt: string;
  origin: "human" | "agent";
  status: "draft" | "published";
}
export interface SaveTaskOutputInput {
  id?: string; projectId?: string; taskId: string; workItemId?: string | null;
  title: string; body: string; links?: TaskOutput["links"]; attachments?: TaskOutput["attachments"];
  status?: "draft" | "published"; complete?: boolean;
}
export interface Snapshot {
  /** Append-only evidence page delivery receipts; written before returning a page. */
  contextEvidenceReads?: import("./contextEvidence").ContextEvidenceRead[];
  /** Immutable, adapter-reported usage receipts; absent prices remain unknown. */
  usageAccounting?: import("./usageAccounting").UsageAccountingState;
  /** Removed from active work; retained locally with source history and attachments. */
  deletedTasks?: Record<string, { task: Task; deletedAt: string }>;
  deletedWorkItems?: Record<string, { item: WorkItem; deletedAt: string }>;
  /** Versioned multi-task deliverables; source artifacts remain immutable. */
  integration?: import('./resultIntegration').IntegrationState;
  /** Automated intake and advisory summaries; tasks stay in the existing task map. */
  intelligence?: import('./intelligence').IntelligenceState;
  /** Collaboration facts and projections, persisted with this same project snapshot. */
  collaboration?: import('./collaboration').CollaborationState;
  /** Persistent project-wide task shapes and root-task family colors. */
  taskIdentities?: import('./taskIdentity').TaskIdentityRegistry;
  /** Viewing order and visibility only; never affects source execution lifecycle. */
  nowQueue?: import('./nowQueue').NowQueueState;
  /** Each project's verified connections keep their own working directories. */
  runtimeConnections?: Record<string, import('./runtimeContracts').RuntimeConnectionBinding>;
  version: number;
  date: string;
  dateLabel: string;
  now: string;
  project: { id: string; name: string; deletedAt?: string; timeZone?: string; description?: string; color?: string; createdAt?: string };
  outputs?: Record<string, TaskOutput>;
  /** ISO execution segments and adapter event cursors; absent in older persisted snapshots. */
  timeline?: import("./timeline").TimelineState;
  journal: { title: string; summary: string; blocks: JournalBlock[] };
  tasks: Record<string, Task>;
  sessions: Record<string, Session>;
  agents: Agent[];
  defaultAgent: AgentId;
  autoJournal: boolean;
  plans: PlanItem[];
  activity: AgentInterval[];
  recent: RecentSession[];
  stats: TodayStats;
  lastSync: string;
  /** 主任务编排（按主任务 id）；旧数据可能没有 */
  orchestrations?: Record<string, Orchestration>;
  /** 事项方案（按方案 id） */
  ideaPlans?: Record<string, IdeaPlan>;
}

export type DispatchOutcome = "accept" | "reject" | "unknown";

export type DemoScenario =
  | "submitting"
  | "acknowledged"
  | "running"
  | "waiting_reply"
  | "waiting_permission"
  | "failed"
  | "rejected"
  | "unknown"
  | "archived";

export type DemoAction = "end_round" | "steps_full" | "subagent_done";

export interface CommandResult {
  ok: boolean;
  message?: string;
  requiresRebind?: boolean;
  fromTaskId?: string;
}
