export type OutputAttachmentVerifier=(snapshot:Snapshot,input:SaveTaskOutputInput)=>Promise<import('./collaboration').VerifiedDeliveryFile[]>;
import { previewDeliveryChange, applyDeliveryChange as applyDeliveryChangeIn, type DeliveryChangeInput, type DeliveryChangeResult } from './deliveryChanges';
import { previewDeliveryPublication, publishDeliveryIn, type DeliveryPublicationPreview, type PublishDeliveryInput, type PublishDeliveryResult } from './deliveryPublication';
import type { DeliveryScope } from './deliveryPresentation';
import { maintainProjectSpec, resolveSpecMaintenanceIn, type ResolveSpecMaintenanceInput } from './specMaintenance';
import { retainsGoalPlanVersion } from "./retainedGoalPlan";
import { isGeneratedDiscussionSummary } from './discussionAuthority';
import { createTaskFromHandoffIn, type CreateTaskFromHandoffInput, type CreateTaskFromHandoffResult } from './taskHandoffTransfer';
import { seedTaskDirection, scopedBreakdownIssue } from "./scopedDiscussion";
import { ensureProjectDirection, readPlanOutline, readDeliverySlots, latestGoalPlan, type GoalAutomationInput } from "./goalDelivery";
import { materializeGoalPlan } from "./projectWorkflow";
import { canExecutePlanTaskDirectly, materializeDirectTaskPlan } from './directTaskPlan';
import { recordDiscussionFeedback as appendDiscussionFeedback } from "./discussionFeedback";
import type { DiscussionFeedbackInput, DiscussionFeedbackResult } from "./discussionVisual";
import { deletionBlocker } from './deletion';
import { approveDirection, planIsApproved, readPlanTasks } from './projectWorkflow';
import { ensureIntelligence, submitIntakeIn, retryIntakeIn, requestSummaryIn, resolveSuggestionIn, recoverIntelligenceJobs, type IntelligenceResult } from './intelligence';
import { applyIntegration, type IntegrationCommand, type IntegrationResult } from './resultIntegration';
import { getIntegrationReviewState, recoverIntegrationReviews } from './integrationReview';
import { buildTaskMemoryIndex, queryTaskMemory as queryMemory, readTaskEvidence as readEvidence, type TaskMemoryQuery, type TaskMemoryResponse } from './taskMemory';
import { applyCollaboration, advanceAuthorizedPlans, ensureCollaboration, reconcileCollaborationEdits, taskKey, type CollaborationCommand, type CollaborationResult } from './collaboration';
import { normalizeTaskIdentities } from "./taskIdentity";
import { exportRevisionFile, previewRevisionImport, applyRevisionImport as applyFileRevision, type RevisionPreview } from './projectionImport';
import { reconcileGrantedSources, readAndRecordGrantedArtifact } from './governance';
import { buildQualityCostReport, createUsageAccounting } from './usageAccounting';
import { readAndRecordContextEvidence, type ContextEvidenceRequest, type EvidenceReaderBinding } from './contextEvidence';
import { estimateTokens, hashText } from './collaboration';
import { createEmptySnapshot, readProjectLibrary, persistProjectLibrary, type ProjectInput, type ProjectLibrary } from "./projectStorage";
import { validateTaskAttachments } from "./taskAttachments";
import type { OutputAttachment, SaveTaskOutputInput } from "./types";
import { ensureTimeline, syncTimeline, reduceExecutionEvent, refreshTimelineStats, timeInZone, instant, type ExecutionEvent } from "./timeline";
import { validatePlanMove, type PlanMove } from './dailySchedule';
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
import { updateNowQueue } from './nowQueue';
import { deriveProjectActivity } from './projectActivity';
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
  previewDeliveryChange(projectId:string,input:DeliveryChangeInput):Promise<DeliveryChangeResult>;
  applyDeliveryChange(projectId:string,input:DeliveryChangeInput):Promise<DeliveryChangeResult>;
  previewDeliveryPublication(projectId:string,scope:DeliveryScope):Promise<DeliveryPublicationPreview>;
  publishDelivery(projectId:string,input:PublishDeliveryInput):Promise<PublishDeliveryResult>;
  resolveSpecMaintenance(projectId:string,input:ResolveSpecMaintenanceInput):Promise<CommandResult>;
  getQualityCostReport(projectId:string):Promise<ReturnType<typeof buildQualityCostReport>>;
  exportTaskRevisions(projectId:string):Promise<string>;
  previewTaskRevisions(projectId:string,raw:string):Promise<RevisionPreview>;
  importTaskRevisions(projectId:string,raw:string,digest:string):Promise<CommandResult>;
  integrate(command: IntegrationCommand): Promise<IntegrationResult>;
  reviewIntegration(draftId:string,projectId?:string):Promise<CommandResult & {jobId?:string}>;
  queryTaskMemory(query:TaskMemoryQuery):Promise<TaskMemoryResponse>;
  readTaskEvidence(projectId:string,taskKey:string,artifactId:string):Promise<import('./collaboration').CollaborationArtifact|undefined>;
  createTaskFromHandoff(projectId:string,input:CreateTaskFromHandoffInput):Promise<CreateTaskFromHandoffResult>;
  readonly mode: "local" | "sample" | "live";
  listProjects(): Promise<Snapshot[]>;
  submitIntake(text: string, projectId?: string): Promise<IntelligenceResult>;
  summarizeTaskTitle(taskId: string, projectId?: string): Promise<IntelligenceResult>;
  retryIntake(inputId: string, projectId?: string): Promise<IntelligenceResult>;
  resolveSuggestion(id: string, decision: 'accepted'|'rejected', projectId?: string): Promise<IntelligenceResult>;
  refreshProjectSummary(projectId?: string): Promise<IntelligenceResult>;
  collaborate(command: CollaborationCommand): Promise<CollaborationResult>;
  startReview(submissionId: string, agentId?: string): Promise<CommandResult & {sessionId?: string}>;
  createProject(input: ProjectInput): Promise<CommandResult & { projectId?: string }>;
  switchProject(id: string): Promise<CommandResult>;
  updateProject(id: string, patch: Partial<ProjectInput>): Promise<CommandResult>;
  deleteProject(id: string): Promise<CommandResult>;
  deleteTask(taskId: string, projectId: string, workItemId?: string): Promise<CommandResult>;
  saveTaskOutput(input: SaveTaskOutputInput): Promise<CommandResult & { outputId?: string }>;
  deleteTaskOutput(id: string): Promise<CommandResult>;
  addManualSubtask(taskId: string, parentId: string, title: string): Promise<CommandResult & { itemId?: string }>;
  setTaskOwner(taskId: string, owner: "me" | "agent"): Promise<void>;
  load(): Promise<Snapshot>;
  /** Idempotent adapter receipt. Does not infer completion from a turn ending. */
  applyExecutionEvent(event: ExecutionEvent): Promise<CommandResult>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;

  updateJournal(patch: { title?: string; summary?: string }): Promise<void>;
  addBlock(kind: "text" | "task", text: string): Promise<string>;
  updateText(blockId: string, text: string): Promise<void>;
  deleteBlock(blockId: string): Promise<void>;
  updateTaskTitle(taskId: string, title: string): Promise<void>;
  addTaskInput(projectId: string, taskId: string, text: string, inputId: string, attachments?: OutputAttachment[]): Promise<CommandResult>;
  createTaskWithAttachments(text: string, attachments: OutputAttachment[], projectId: string): Promise<CommandResult & { taskId?: string }>;
  setTaskAttachments(projectId: string, taskId: string, attachments: OutputAttachment[], workItemId?: string, expectedIds?: string[]): Promise<CommandResult>;
  convertTextToTask(blockId: string): Promise<string>;

  dispatch(taskId: string, agentId: AgentId): Promise<CommandResult>;
  /** 仅在源端受理前可撤回；受理后须回源会话处理 */
  cancelDispatch(sessionId: string): Promise<CommandResult>;
  reconcile(sessionId: string): Promise<CommandResult>;
  retryDispatch(sessionId: string): Promise<CommandResult>;
  /** Explicitly hand unfinished work to another configured Agent after stopping the old execution. */
  handoffSession(sessionId: string, targetAgentId: string): Promise<CommandResult & { sessionId?: string }>;
  completeTask(taskId: string): Promise<void>;
  reopenTask(taskId: string): Promise<void>;
  resumeAutoFollow(taskId: string): Promise<void>;
  linkSession(sessionId: string, taskId: string, options?: SessionLinkOptions): Promise<CommandResult>;
  createTaskFromSession(sessionId: string, blockId?: string): Promise<CommandResult & { taskId?: string }>;

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
  ensureProjectPlan(projectId?:string):Promise<string>;
  savePlanOutline(planId:string,sections:PlanSection[],expectedDraftVersion:number,projectId?:string):Promise<CommandResult>;
  configureGoalAutomation(planId:string,input:GoalAutomationInput,projectId?:string):Promise<CommandResult>;
  setDiscussionAgent(planId: string, agentId: AgentId): Promise<CommandResult>;
  recordDiscussionConclusion(planId: string, scope: string, input: DiscussionConclusionInput): Promise<CommandResult>;
  adoptDiscussionConclusion(planId: string, id: string): Promise<CommandResult>;
  recordDiscussionFeedback(input: DiscussionFeedbackInput): Promise<DiscussionFeedbackResult>;
  recordPlanConfirmation(planId: string, conclusionId: string | undefined, confirmed: string[], projectId?: string): Promise<CommandResult>;
  approvePlan(planId: string, conclusionId?: string, projectId?: string, expectedDraftVersion?: number): Promise<CommandResult & { added?: number; approvedDraftVersion?:number }>;
  editPlanLine(planId: string, lineId: string, patch: { text?: string; state?: LineState }): Promise<void>;
  generateDrafts(planId: string): Promise<void>;
  updateDraft(planId: string, key: string, patch: Partial<TaskDraft>): Promise<void>;
  removeDraft(planId: string, key: string): Promise<void>;
  mergeDraftUp(planId: string, key: string): Promise<CommandResult>;
  indentDraft(planId: string, key: string, dir: 1 | -1): Promise<void>;
  /** 加入任务：幂等，只创建任务、不启动 Agent */
  addDraftsToTasks(planId: string): Promise<CommandResult & { added?: number; approvedDraftVersion?:number }>;
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

  addPlan(plan: Omit<PlanItem, "id" | "actual">, projectId?: string): Promise<void>;
  removePlan(planId: string, projectId?: string): Promise<void>;
  setPlanTimer(planId: string, running: boolean, projectId?: string): Promise<void>;
  applyPlanMoves(moves: PlanMove[]): Promise<void>;
  manageNow(command: import('./nowQueue').NowQueueCommand): Promise<void>;

  /** 仅示例数据源提供：用于逐项检查状态 */
  readonly demo?: DemoControls;
}

export interface SessionLinkOptions { replace?: boolean; expectedTaskId?: string | null }

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
const uid = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(seq++).toString(36)}`}`;

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
  /** Trusted desktop business layer only; never exposed as a renderer IPC command. */
  mutateRuntime(mutator: (snapshot: Snapshot) => void) { this.update(mutator, true); }
  /** In-memory mirror after the library has atomically persisted schedule-only changes. */
  refreshPlans(plans: PlanItem[], version: number) { this.state.plans=structuredClone(plans); this.state.version=version; }
  readonly mode: "local" | "sample";
  private state: Snapshot;
  private taskMemoryCache?: {state:Snapshot;version:number;index:ReturnType<typeof buildTaskMemoryIndex>};
  private onPersist?: (snapshot: Snapshot) => void;
  private verifyOutputAttachments?:OutputAttachmentVerifier;
  private listeners = new Set<(s: Snapshot) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private loadedAt = Date.now();
  private clockBase: string;
  private clockDate: string;
  private nextOutcome: DispatchOutcome = "accept";
  private externalCount = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private resumed = false;
  private linking = new Set<string>();

  constructor(options?: { snapshot: Snapshot; onPersist: (snapshot: Snapshot) => void; verifyOutputAttachments?:OutputAttachmentVerifier }) {
    this.mode = options ? "local" : "sample";
    this.state = options ? structuredClone(options.snapshot) : createSampleSnapshot();
    if (options) for (const plan of this.state.plans) plan.date ??= this.state.date;
    this.onPersist = options?.onPersist;
    this.verifyOutputAttachments = options?.verifyOutputAttachments;
    this.clockBase = this.state.now;
    this.clockDate = this.state.date;
    if (options) this.demo = undefined;
    const saved = options ? null : readPersisted();
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
    const discussionChanged = normalizeDiscussionState(this.state);
    if (normalizeTaskIdentities(this.state) || discussionChanged) this.persist();
    ensureTimeline(this.state);
    refreshTimelineStats(this.state);
  }

  readonly demo: DemoControls | undefined = {
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

  refreshAgentConfiguration(agents: Agent[], defaultAgent: string) {
    this.state = { ...this.state, agents: structuredClone(agents).map(agent => this.state.runtimeConnections?.[agent.id] ? { ...agent, connection: 'healthy' as const, connectionNote: '本地连接已验证' } : agent), defaultAgent };
  }
  peek() { return structuredClone(this.state); }
  refreshPersistedSnapshot(snapshot:Snapshot) {this.state=structuredClone(snapshot);this.taskMemoryCache=undefined;}
  async listProjects() { return [this.peek()]; }
  async getQualityCostReport(projectId:string) {if(projectId!==this.state.project.id)throw Error('项目不存在');return buildQualityCostReport(this.peek(),this.state.usageAccounting??createUsageAccounting());}
  async exportTaskRevisions(projectId:string) {if(projectId!==this.state.project.id)throw Error('项目不存在');return exportRevisionFile(this.peek());}
  async previewTaskRevisions(projectId:string,raw:string) {if(projectId!==this.state.project.id)throw Error('项目不存在');return previewRevisionImport(this.peek(),raw);}
  async importTaskRevisions(projectId:string,raw:string,digest:string):Promise<CommandResult> {
    if(projectId!==this.state.project.id)return {ok:false,message:'项目不存在'};
    try {let count=0;this.update(d=>{count=applyFileRevision(d,raw,digest).changes.length;});return {ok:true,message:`已采用 ${count} 项修订`};}
    catch(error){return {ok:false,message:error instanceof Error?error.message:'修订失败'};}
  }
  private intelligenceMutation(action:(snapshot:Snapshot)=>IntelligenceResult):IntelligenceResult {
    let result:IntelligenceResult={ok:false};
    try { this.update(d=>{result=action(d);if(!result.ok)throw Object.assign(new Error(result.message),{intelligenceResult:result});});return result; }
    catch(error){if(error&&typeof error==='object'&&'intelligenceResult'in error)return error.intelligenceResult as IntelligenceResult;throw error;}
  }
  async summarizeTaskTitle(_taskId:string):Promise<IntelligenceResult>{return {ok:false,message:'请在桌面版连接 Agent 后使用 AI 精简标题，原文已保留'};}
  async submitIntake(text:string):Promise<IntelligenceResult>{return this.intelligenceMutation(d=>submitIntakeIn(d,text));}
  async retryIntake(inputId:string):Promise<IntelligenceResult>{return this.intelligenceMutation(d=>retryIntakeIn(d,inputId));}
  async resolveSuggestion(id:string,decision:'accepted'|'rejected'):Promise<IntelligenceResult>{return this.intelligenceMutation(d=>resolveSuggestionIn(d,id,decision));}
  async refreshProjectSummary():Promise<IntelligenceResult>{return this.intelligenceMutation(d=>requestSummaryIn(d));}
  async startReview(_submissionId: string, _agentId?: string): Promise<CommandResult & {sessionId?: string}> { return {ok:false,message:'请配置可用 Agent 后发起独立复核'}; }
  async collaborate(command: CollaborationCommand): Promise<CollaborationResult> {
    let result: CollaborationResult = {ok:false};
    try {
      this.update(d => {
        result = applyCollaboration(d,command,{kind:'human'});
        if(!result.ok) throw Object.assign(new Error(result.message),{collaborationResult:result});
        advanceAuthorizedPlans(d);
      });
      return result;
    } catch(error) {
      if(error && typeof error==='object' && 'collaborationResult' in error) return error.collaborationResult as CollaborationResult;
      throw error;
    }
  }

  async previewDeliveryChange(projectId:string,input:DeliveryChangeInput) {
    if(projectId!==this.state.project.id)throw Error('项目不存在');
    return previewDeliveryChange(this.peek(),input);
  }
  async applyDeliveryChange(projectId:string,input:DeliveryChangeInput) {
    if(projectId!==this.state.project.id)throw Error('项目不存在');
    let result:DeliveryChangeResult;
    try {this.update(d=>{result=applyDeliveryChangeIn(d,input);if(!result.ok)throw Object.assign(Error(result.message),{deliveryResult:result});});return result!;}
    catch(error){if(error&&typeof error==='object'&&'deliveryResult' in error)return error.deliveryResult as DeliveryChangeResult;throw error;}
  }
  async previewDeliveryPublication(projectId:string,scope:DeliveryScope) {
    if(projectId!==this.state.project.id)throw Error('项目不存在');
    return previewDeliveryPublication(this.peek(),scope);
  }
  async publishDelivery(projectId:string,input:PublishDeliveryInput):Promise<PublishDeliveryResult> {
    if(projectId!==this.state.project.id)return {ok:false,message:'项目不存在'};
    let result:PublishDeliveryResult={ok:false};
    try {this.update(d=>{result=publishDeliveryIn(d,input);if(!result.ok)throw Object.assign(Error(result.message),{deliveryResult:result});});return result;}
    catch(error){if(error&&typeof error==='object'&&'deliveryResult' in error)return error.deliveryResult as PublishDeliveryResult;throw error;}
  }
  async resolveSpecMaintenance(projectId:string,input:ResolveSpecMaintenanceInput):Promise<CommandResult> {
    if(projectId!==this.state.project.id)return {ok:false,message:'项目不存在'};
    let result:CommandResult={ok:false};
    try {this.update(d=>{result=resolveSpecMaintenanceIn(d,input);if(!result.ok)throw Object.assign(Error(result.message),{deliveryResult:result});});return result;}
    catch(error){if(error&&typeof error==='object'&&'deliveryResult' in error)return error.deliveryResult as CommandResult;throw error;}
  }
  async integrate(command:IntegrationCommand):Promise<IntegrationResult> {
    let result:IntegrationResult={ok:false};
    try {
      this.update(d=>{
        if(command.type==='publish'&&command.draftId) {
          const review=getIntegrationReviewState(d,command.draftId);
          if(review.status==='running')throw Error('复核正在进行，请等待结果或保存新草案后人工核对');
          if(review.status==='ready'&&review.review?.findings.some(f=>f.severity==='conflict')&&!command.payload.reviewNote?.trim())throw Error('请记录对复核冲突的处理说明');
        }
        result=applyIntegration(d,command);
        if(!result.ok)throw Object.assign(Error(result.message),{integrationResult:result});
      });
      return result;
    } catch(error) {
      if(error&&typeof error==='object'&&'integrationResult'in error)return error.integrationResult as IntegrationResult;
      throw error;
    }
  }
  async reviewIntegration(_draftId:string,_projectId?:string):Promise<CommandResult> {return {ok:false,message:'请连接用户列表首项 Agent 后复核'};}
  async queryTaskMemory(query:TaskMemoryQuery) {
    if(query.projectId!==this.state.project.id)return {items:[],total:0,sourceSequence:0,scope:'project' as const,query:query.query??''};
    if(!this.taskMemoryCache||this.taskMemoryCache.state!==this.state||this.taskMemoryCache.version!==this.state.version||this.taskMemoryCache.index.validUntil<=Date.now())
      this.taskMemoryCache={state:this.state,version:this.state.version,index:buildTaskMemoryIndex(this.state)};
    return queryMemory(this.state,query,this.taskMemoryCache.index);
  }
  async readTaskEvidence(projectId:string,key:string,artifactId:string) {return this.state.project.id===projectId?readEvidence(this.peek(),key,artifactId):undefined;}
  async createTaskFromHandoff(projectId:string,input:CreateTaskFromHandoffInput):Promise<CreateTaskFromHandoffResult> {
    let result:CreateTaskFromHandoffResult={ok:false};
    try {
      this.update(d=>{
        result=createTaskFromHandoffIn(d,projectId,input);
        if(!result.ok)throw Object.assign(Error(result.message),{handoffResult:result});
      });
      return result;
    } catch(error) {
      if(error&&typeof error==='object'&&'handoffResult'in error)return error.handoffResult as CreateTaskFromHandoffResult;
      throw error;
    }
  }
  async deleteProject(_id: string): Promise<CommandResult> { return { ok: false, message: "请使用本地项目工作区" }; }
  async createProject(_input: ProjectInput): Promise<CommandResult & {projectId?: string}> { return { ok: false, message: "请使用本地项目工作区" }; }
  async switchProject(_id: string): Promise<CommandResult> { return { ok: false, message: "请使用本地项目工作区" }; }
  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<CommandResult> {
    if (id !== this.state.project.id || (patch.name !== undefined && !patch.name.trim())) return { ok: false, message: "项目名称不能为空" };
    this.update(d => { d.project = { ...d.project, ...patch, name: patch.name?.trim() ?? d.project.name }; });
    return { ok: true };
  }
  async load() {
    if (this.mode === "local") {
      const today = createEmptySnapshot(this.state.project);
      this.state = { ...this.state, now: today.now, date: today.date, dateLabel: today.dateLabel };
      refreshTimelineStats(this.state);
      return this.peek();
    }
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
    if (this.mode === "local") return timeInZone(Date.now(), this.state.project.timeZone ?? "Asia/Shanghai");
    return fromMinutes(toMinutes(this.clockBase) + Math.floor((Date.now() - this.loadedAt) / 60000));
  }

  private eventTime() {
    if (this.mode === "local") return new Date().toISOString();
    return new Date(Date.parse(instant(this.clockBase, this.clockDate, this.state.project.timeZone ?? "Asia/Shanghai")) + Date.now() - this.loadedAt).toISOString();
  }

  private update(mutator: (draft: Snapshot) => void, fromRuntime = false) {
    const previous = this.state;
    const draft = structuredClone(this.state);
    if (this.mode === "local") {
      const today = createEmptySnapshot(draft.project);
      draft.date = today.date; draft.dateLabel = today.dateLabel;
    }
    draft.now = this.now();
    if(this.mode === "local") ensureCollaboration(draft);
    mutator(draft);
    if(this.mode === "local") reconcileCollaborationEdits(previous,draft,fromRuntime);
    for (const p of draft.plans) if (p.manualStartedAt && p.taskId && (draft.tasks[p.taskId]?.completion || p.workItemId && draft.orchestrations?.[p.taskId]?.items[p.workItemId]?.status === "done")) {
      (p.manualActual ??= []).push([p.manualStartedAt, new Date().toISOString()]); delete p.manualStartedAt;
    }
    maintainProjectSpec(draft);
    normalizeDiscussionState(draft);
    normalizeTaskIdentities(draft);
    draft.version += 1;
    draft.now = this.now();
    draft.lastSync = draft.now;
    if (fromRuntime) refreshTimelineStats(draft);
    else syncTimeline(draft, this.state, this.eventTime());
    this.state = draft;
    try { this.emit(); } catch (error) { this.state = previous; throw error; }
  }

  private emit() {
    this.persist();
    this.listeners.forEach((l) => l(this.state));
  }

  private persist() {
    normalizeTaskIdentities(this.state);
    if (this.mode === "local") { this.onPersist?.(this.peek()); return; }
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
    if (this.mode === "local") return;
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
    if (!task || task.manualLock || draft.collaboration?.tasks[taskId]) return;
    const sessions = task.sessionIds.map((id) => draft.sessions[id]).filter(s => s && !s.linkedAsHistory);
    const children = Object.values(draft.orchestrations?.[taskId]?.items ?? {});
    if (sessions.length && sessions.every((s) => s.status === "archived") && children.every(item => item.status === 'done' || item.status === 'cancelled')) {
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
    if (event.taskId && (this.state.deletedTasks?.[event.taskId] || event.workItemId && this.state.deletedWorkItems?.[taskKey(event.taskId,event.workItemId)])) return { ok: false, message: "任务已删除，不再接收执行更新" };
    const d = structuredClone(this.state);
    if (this.mode === "local") {
      const today = createEmptySnapshot(d.project); d.date = today.date; d.dateLabel = today.dateLabel; d.now = today.now;
    }
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
    const previous = this.state;
    this.state=d;
    try { this.emit(); } catch (error) { this.state = previous; throw error; }
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
      d.journal.blocks.unshift({ id: blockId, kind: "task", taskId });
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
      owner: "me",
      completion: null,
      manualLock: false,
      createdAt: this.mode === "local" ? new Date().toISOString() : now,
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

  async deleteTask(taskId: string, projectId: string, workItemId?: string): Promise<CommandResult> {
    if (projectId !== this.state.project.id) return { ok: false, message: '项目已切换，未删除任务' };
    if (!this.state.tasks[taskId]) return { ok: false, message: '任务不存在或已删除' };
    const orchestration = this.state.orchestrations?.[taskId];
    if (workItemId && !orchestration?.items[workItemId]) return { ok: false, message: '子任务不存在或已删除' };
    const removedIds = new Set<string>();
    if (workItemId) {
      const visit = (id: string) => { if (removedIds.has(id)) return; removedIds.add(id); for (const item of Object.values(orchestration!.items)) if (item.parentTaskId === id) visit(item.id); };
      visit(workItemId);
    }
    const blocked = deletionBlocker(this.state, taskId, workItemId ? removedIds : undefined);
    if (blocked) return { ok: false, message: blocked };
    const original = structuredClone(this.state.tasks[taskId]);
    const removedItems = Object.values(orchestration?.items ?? {}).filter(item => removedIds.has(item.id)).map(item => structuredClone(item));
    this.update(d => {
      const keys = Object.values(ensureCollaboration(d).tasks).filter(unit => unit.taskId === taskId && !unit.archived && (!workItemId || !!unit.workItemId && removedIds.has(unit.workItemId))).map(unit => unit.key);
      for (const key of keys) {
        const unit = d.collaboration!.tasks[key];
        const result = applyCollaboration(d, { projectId, idempotencyKey: uid('delete-task'), type: 'archive_task', taskId,
          workItemId: unit.workItemId, expectedVersion: unit.version, payload: { reason: '用户删除任务；本地历史与附件保留' } }, { kind: 'human' });
        if (!result.ok) throw new Error(result.message);
      }
      const deletedAt = new Date().toISOString();
      if (workItemId) {
        const o = d.orchestrations![taskId];
        for (const item of removedItems) { (d.deletedWorkItems ??= {})[taskKey(taskId,item.id)] = { item, deletedAt }; delete o.items[item.id]; }
        o.itemOrder = o.itemOrder.filter(id => !removedIds.has(id));
      } else {
        (d.deletedTasks ??= {})[taskId] = { task: original, deletedAt };
        delete d.tasks[taskId];
        d.journal.blocks = d.journal.blocks.filter(block => block.kind === 'task' ? block.taskId !== taskId : block.kind === 'session' ? d.sessions[block.sessionId]?.taskId !== taskId : true);
      }
      for (const plan of d.plans) if (plan.taskId === taskId && (!workItemId || !!plan.workItemId && removedIds.has(plan.workItemId))) plan.cancelled = true;
    });
    return { ok: true, message: '任务已删除，本地历史与附件保留' };
  }

  async updateTaskTitle(taskId: string, title: string) {
    title = title.trim();
    if (!title) throw new Error("请填写任务标题");
    this.update((d) => {
      if (d.tasks[taskId]) { d.tasks[taskId].originalTitle ??= d.tasks[taskId].title; d.tasks[taskId].title = title; d.tasks[taskId].titleRevision = (d.tasks[taskId].titleRevision ?? 0) + 1; const current = ensureCollaboration(d).tasks[taskId]; current.title = title; current.version++; }
    });
  }

  async createTaskWithAttachments(text: string, attachments: OutputAttachment[], projectId: string): Promise<CommandResult & { taskId?: string }> {
    if (projectId !== this.state.project.id || !text.trim()) return { ok: false, message: '项目或任务内容无效' };
    const validated = validateTaskAttachments(attachments), taskId = uid('task');
    this.update(d => { d.tasks[taskId] = { ...this.newTask(taskId, text, d.now), attachments: validated }; d.journal.blocks.unshift({ id: uid('block'), kind: 'task', taskId }); });
    return { ok: true, taskId };
  }
  async addTaskInput(projectId: string, taskId: string, text: string, inputId: string, attachments: OutputAttachment[] = []): Promise<CommandResult> {
    if (projectId !== this.state.project.id || !this.state.tasks[taskId]) return { ok: false, message: '任务不存在，请返回当前项目确认' };
    let files: OutputAttachment[], merged: OutputAttachment[];
    try {
      files = validateTaskAttachments(attachments);
      const existing = this.state.tasks[taskId].attachments ?? [];
      if (files.some(file => existing.some(old => old.id === file.id && JSON.stringify(old) !== JSON.stringify(file)))) return { ok: false, message: '附件记录已变化，请重新添加' };
      merged = validateTaskAttachments([...existing, ...files.filter(file => !existing.some(old => old.id === file.id))]);
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
    if (typeof text !== 'string' || !text.trim() && !files.length || typeof inputId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(inputId)) return { ok: false, message: '请输入内容或添加附件' };
    const content = text.trim(), previous = this.state.tasks[taskId].inputs?.find(input => input.id === inputId);
    if (previous) {
      const same = previous.text === content && JSON.stringify(previous.attachments ?? []) === JSON.stringify(files);
      return { ok: same, message: same ? '已保存到任务' : '这条输入已变化，请重新保存' };
    }
    this.update(d => { d.tasks[taskId].attachments = merged; (d.tasks[taskId].inputs ??= []).push({ id: inputId, text: content, at: new Date().toISOString(), ...(files.length ? {attachments:files} : {}) }); });
    return { ok: true, message: '已保存到任务，下次派发时交给 Agent' };
  }

  async setTaskAttachments(projectId: string, taskId: string, attachments: OutputAttachment[], workItemId?: string, expectedIds?: string[]): Promise<CommandResult> {
    if (projectId !== this.state.project.id) return { ok: false, message: '项目不存在' };
    const target = workItemId ? this.state.orchestrations?.[taskId]?.items[workItemId] : this.state.tasks[taskId];
    if (!target || !this.state.tasks[taskId]) return { ok: false, message: '任务不存在' };
    if (expectedIds && JSON.stringify((target.attachments ?? []).map(file => file.id)) !== JSON.stringify(expectedIds)) return { ok: false, message: '附件列表已变化，请重试' };
    const validated = validateTaskAttachments(attachments);
    this.update(d => { const item = workItemId ? d.orchestrations![taskId].items[workItemId] : d.tasks[taskId]; item.attachments = validated; });
    return { ok: true };
  }

  async convertTextToTask(blockId: string) {
    const taskId = uid("task");
    this.update((d) => {
      const index = d.journal.blocks.findIndex((b) => b.id === blockId);
      const block = d.journal.blocks[index];
      if (!block || block.kind !== "text") return;
      d.tasks[taskId] = this.newTask(taskId, block.text, d.now);
      // 新生成的待办前置，保留原 block 身份供搜索与定位使用。
      d.journal.blocks.splice(index, 1);
      d.journal.blocks.unshift({ id: block.id, kind: "task", taskId });
    });
    return taskId;
  }

  async setTaskOwner(taskId: string, owner: "me" | "agent") {
    if (!this.state.tasks[taskId]) throw new Error("任务不存在");
    this.update(d => { d.tasks[taskId].owner = owner; });
  }

  async addManualSubtask(taskId: string, parentId: string, title: string): Promise<CommandResult & { itemId?: string }> {
    if (!this.state.tasks[taskId] || !title.trim()) return { ok: false, message: "请填写子任务名称" };
    if (parentId !== taskId && !this.state.orchestrations?.[taskId]?.items[parentId]) return { ok: false, message: "上级任务不存在" };
    const itemId = uid("work");
    this.update(d => {
      d.orchestrations ??= {};
      const o = d.orchestrations[taskId] ??= { taskId, label: d.tasks[taskId].title, startedAt: d.now, syncedAt: d.now,
        coordinationTokens: null, phases: ["任务"], executors: {}, items: {}, itemOrder: [], attempts: {},
        capabilities: { subAgents: false, steps: false, tokens: false, permissionEvents: false } };
      o.items[itemId] = { id: itemId, rootTaskId: taskId, parentTaskId: parentId, title: title.trim(), phase: "任务", dependsOnTaskIds: [], owner: "me", status: "not_started", attemptIds: [] };
      if (!o.phases.includes("任务")) o.phases.push("任务");
      o.itemOrder.push(itemId);
      // New work reopens completed ancestors; a finished parent cannot contain newly unfinished work.
      const seen = new Set<string>();
      let ancestor = o.items[parentId];
      while (ancestor && !seen.has(ancestor.id)) {
        seen.add(ancestor.id);
        if (ancestor.status === "done") { ancestor.status = "not_started"; delete ancestor.completedAt; }
        ancestor = o.items[ancestor.parentTaskId];
      }
      d.tasks[taskId].completion = null;
      if(this.mode==='local') {
        const c=ensureCollaboration(d);
        for(const key of [taskId,...[...seen].map(item=>taskKey(taskId,item))]) {
          const task=d.collaboration!.tasks[key];
          if(task&&['done','in_review'].includes(task.status)) {
            const reopened=applyCollaboration(d,{projectId:d.project.id,idempotencyKey:uid('scope-change'),type:'reopen',taskId,workItemId:task.workItemId,expectedVersion:task.version,payload:{reason:'新增子任务，重新核对交付范围'}},{kind:'human'});
            if(!reopened.ok)throw new Error(reopened.message);
          }
        }
      }
    });
    return { ok: true, itemId };
  }

  async saveTaskOutput(input: SaveTaskOutputInput): Promise<CommandResult & { outputId?: string }> {
    if (input.projectId !== undefined && input.projectId !== this.state.project.id) return { ok: false, message: "项目已切换，请回到原项目保存" };
    const task = this.state.tasks[input.taskId];
    const item = input.workItemId ? this.state.orchestrations?.[input.taskId]?.items[input.workItemId] : undefined;
    if (!task || (input.workItemId && !item)) return { ok: false, message: "成果对应的任务不存在" };
    const existing = input.id ? this.state.outputs?.[input.id] : undefined;
    if (input.id && (!existing || existing.taskId !== input.taskId || (existing.workItemId ?? null) !== (input.workItemId ?? null))) return { ok: false, message: "成果记录不属于当前任务" };
    if (existing && existing.origin !== "human") return { ok: false, message: "Agent 原始回报不能改为人工成果" };
    if (!input.title.trim()) return { ok: false, message: "请填写成果标题" };
    const links = input.links ?? [];
    for (const link of links) {
      try { const u = new URL(link.url); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new Error(); }
      catch { return { ok: false, message: "成果链接需要使用 HTTP 或 HTTPS 地址" }; }
    }
    if (!input.body.trim() && !links.length && !input.attachments?.length && !input.deliveryItems?.length) return { ok: false, message: "请添加成果内容、链接或附件" };
    if (input.status && !["draft", "published"].includes(input.status)) return { ok: false, message: "成果状态无效" };
    if (input.complete && input.status === "draft") return { ok: false, message: "请先发布成果，再完成任务" };
    let verifiedDeliveryFiles:import('./collaboration').VerifiedDeliveryFile[]=[];
    if(input.status!=='draft'&&input.deliveryItems?.some(item=>item.attachmentId||item.path)) {
      if(!this.verifyOutputAttachments)return {ok:false,message:'请在桌面客户端验证交付附件；正文与草稿仍可保存'};
      try {verifiedDeliveryFiles=await this.verifyOutputAttachments(this.peek(),input);}catch(error){return {ok:false,message:error instanceof Error?error.message:'附件验证失败'};}
    }
    const outputId = input.id ?? uid("output");
    const now = new Date().toISOString();
    this.update(d => {
      d.outputs ??= {};
      d.outputs[outputId] = { id: outputId, taskId: input.taskId, workItemId: input.workItemId ?? null, title: input.title.trim(), body: input.body.trim(),
        links: structuredClone(links), attachments: structuredClone(input.attachments ?? []), ...(input.deliveryItems?{deliveryItems:structuredClone(input.deliveryItems)}:{}), origin: "human", status: input.status ?? "published", createdAt: existing?.createdAt ?? now, updatedAt: now };
      if (this.mode === 'local' && (input.status ?? 'published') === 'published') {
        const state = ensureCollaboration(d), key = taskKey(input.taskId,input.workItemId), current = state.tasks[key];
        if (current.status === 'done') {
          const reopened=applyCollaboration(d,{projectId:d.project.id,idempotencyKey:uid('reopen-output'),type:'reopen',taskId:input.taskId,workItemId:input.workItemId??undefined,expectedVersion:current.version,payload:{reason:'人工修订成果'}},{kind:'human'});
          if(!reopened.ok) throw new Error(reopened.message);
        }
        const submitted=applyCollaboration(d,{projectId:d.project.id,idempotencyKey:uid('submit-output'),type:'submit',taskId:input.taskId,workItemId:input.workItemId??undefined,expectedVersion:d.collaboration!.tasks[key].version,payload:{title:input.title,body:input.body.trim()||[...links.map(x=>x.label+': '+x.url),...(input.attachments??[]).map(x=>'附件：'+x.name)].join('\n')||input.title,outputId,deliveryItems:input.deliveryItems}},{kind:'human',verifiedDeliveryFiles});
        if(!submitted.ok) throw new Error(submitted.message);
        if(input.complete) {
          const task=d.collaboration!.tasks[key],spec=d.collaboration!.specs.find(x=>x.key===key&&x.revision===task.specRevision)!;
          const reviewed=applyCollaboration(d,{projectId:d.project.id,idempotencyKey:uid('review-output'),type:'review',taskId:input.taskId,workItemId:input.workItemId??undefined,expectedVersion:task.version,payload:{submissionId:submitted.resourceId,verdict:'accepted',note:'用户保存成果并明确确认完成（人工自验收）',checks:spec.criteria.map(()=>true),deliveryChecks:input.deliveryChecks}},{kind:'human'});
          if(!reviewed.ok) throw new Error(reviewed.message);
        }
      } else if (input.complete) {
        if (input.workItemId) {
          const o=d.orchestrations![input.taskId],w=o.items[input.workItemId];w.status='done';w.completedAt=now;refreshBlocked(o);this.settle(d,input.taskId);
        } else {d.tasks[input.taskId].completion={reason:'manual',at:now};d.tasks[input.taskId].manualLock=true;}
      }
    });
    return { ok: true, outputId, message: input.status === "draft" ? "草稿已保存" : "成果已归入项目" };
  }

  async deleteTaskOutput(id: string): Promise<CommandResult> {
    const output = this.state.outputs?.[id];
    if (!output || output.origin !== "human") return { ok: false, message: "人工成果不存在" };
    this.update(d => { delete d.outputs![id]; });
    return { ok: true };
  }

  // ---------- 派发与生命周期 ----------

  async dispatch(taskId: string, agentId: AgentId): Promise<CommandResult> {
    if (this.mode === "local") return { ok: false, message: "请在已配置的 Agent 中执行；本地工作区不会模拟受理或执行进度。" };
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
    if (this.mode === "local") return { ok: false, message: "请在已配置的 Agent 中执行；本地工作区不会模拟受理或执行进度。" };
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
    if (this.mode === "local") return { ok: false, message: "请在已配置的 Agent 中执行；本地工作区不会模拟受理或执行进度。" };
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

  async handoffSession(_sessionId: string, _targetAgentId: string): Promise<CommandResult> {
    return { ok: false, message: '请在桌面版连接真实 Agent 后交接任务' };
  }

  async completeTask(taskId: string) {
    this.update(d => {
      if(this.mode !== 'local') {d.tasks[taskId].completion={reason:'manual',at:d.now};d.tasks[taskId].manualLock=true;return;}
      const state=ensureCollaboration(d),task=state.tasks[taskId],spec=state.specs.find(x=>x.key===taskId&&x.revision===task?.specRevision);
      if(!task?.latestSubmissionId||!spec) throw new Error('请先提交成果，再逐项验收；结束会话不会自动完成任务');
      const result=applyCollaboration(d,{projectId:d.project.id,idempotencyKey:uid('review'),type:'review',taskId,expectedVersion:task.version,payload:{submissionId:task.latestSubmissionId,verdict:'accepted',checks:spec.criteria.map(()=>true),note:'用户明确确认任务完成（人工验收）'}},{kind:'human'});
      if(!result.ok)throw new Error(result.message);
    });
  }

  async reopenTask(taskId: string) {
    this.update(d => {
      if(this.mode !== 'local'){d.tasks[taskId].completion=null;d.tasks[taskId].manualLock=true;return;}
      const task=ensureCollaboration(d).tasks[taskId];
      const result=applyCollaboration(d,{projectId:d.project.id,idempotencyKey:uid('reopen'),type:'reopen',taskId,expectedVersion:task?.version},{kind:'human'});
      if(!result.ok)throw new Error(result.message);
    });
  }

  async resumeAutoFollow(taskId: string) {
    if(this.mode==='local') throw new Error('协作任务以成果验收为准，源会话归档不自动确认完成');
    this.update((d) => {
      d.tasks[taskId].manualLock = false;
      d.tasks[taskId].completion = null;
      this.settle(d, taskId);
    });
  }

  async linkSession(sessionId: string, taskId: string, options?: SessionLinkOptions): Promise<CommandResult> {
    const s = this.state.sessions[sessionId];
    const task = this.state.tasks[taskId];
    if (!s || !task) return { ok: false, message: "会话或待办不存在" };
    const bindingIssue = this.sessionBindingIssue(s, taskId);
    if (bindingIssue) return { ok: false, message: bindingIssue };
    if (s.taskId === taskId) return { ok: true, message: "已在此待办下" };
    if (s.runtime?.purpose === 'discussion' || s.runtime?.workItemId) return { ok: false, message: '讨论和子任务执行保留原范围，请关联主会话' };
    if (s.taskId && (!options?.replace || options.expectedTaskId !== s.taskId)) return { ok: false, requiresRebind: true, fromTaskId: s.taskId, message: '这条会话已关联其他任务，确认后保留旧任务历史并改绑' };
    if (task.completion) return { ok: false, message: "任务已完成，先重新打开" };
    // 关联请求进行中：重复拖放／重复点击直接忽略，不会重复关联
    if (this.linking.has(sessionId)) return { ok: false, message: "正在关联，已忽略重复操作" };
    this.linking.add(sessionId);
    try {
      await Promise.resolve();
      const latest = this.state.sessions[sessionId];
      if (latest.taskId !== s.taskId) return { ok: false, message: '关联目标已变化，请重新选择' };
      const latestIssue = this.sessionBindingIssue(latest, taskId);
      if (latestIssue) return { ok: false, message: latestIssue };
      this.update(d => this.attachSession(d, sessionId, taskId));
    } finally {
      this.linking.delete(sessionId);
    }
    return { ok: true, message: s.taskId ? '已改绑，原任务保留当时的会话历史' : s.status === 'archived' ? '已关联为历史' : '已合并到待办' };
  }

  private sessionBindingIssue(session: Session, taskId: string): string | undefined {
    const runtime = session.runtime;
    if (!runtime) return;
    if (runtime.collaboration && runtime.collaboration.taskId !== taskId) return '受管运行已绑定固定任务和上下文，不能重绑；请为新任务创建新会话';
    if (session.status !== 'archived' && runtime.taskId !== taskId) {
      return '源会话已绑定固定任务和上下文，不能关联到其他任务；请为新任务创建新会话，或归档后仅关联为历史';
    }
  }

  private attachSession(d: Snapshot, sessionId: string, taskId: string) {
    const ses = d.sessions[sessionId], oldTaskId = ses.taskId, at = new Date().toISOString();
    if (oldTaskId === taskId) return;
    if (oldTaskId && d.tasks[oldTaskId]) {
      const old = d.tasks[oldTaskId];
      (old.sessionHistory ??= []).push({ sessionId, transferredToTaskId: taskId, at, title: ses.title, status: ses.status, rounds: structuredClone(ses.rounds), source: ses.source ? structuredClone(ses.source) : undefined });
      old.sessionIds = old.sessionIds.filter(id => id !== sessionId);
      const previous = d.orchestrations?.[oldTaskId];
      const childKeys = previous && ses.runtime?.runId ? Object.keys(previous.items).filter(id => id.startsWith(`child:${ses.runtime!.runId}:`)) : [];
      if (previous && childKeys.length) {
        const next = (d.orchestrations ??= {})[taskId] ??= { taskId, label: d.tasks[taskId].title, startedAt: at, syncedAt: at, coordinationTokens: null, phases: [], executors: {}, items: {}, itemOrder: [], attempts: {}, capabilities: { ...previous.capabilities } };
        for (const id of childKeys) {
          const item = previous.items[id]; next.items[id] = { ...item, rootTaskId: taskId, parentTaskId: item.parentTaskId === oldTaskId ? taskId : item.parentTaskId }; if (!next.itemOrder.includes(id)) next.itemOrder.push(id);
          if (item.executorId && previous.executors[item.executorId]) next.executors[item.executorId] = previous.executors[item.executorId];
          for (const attemptId of item.attemptIds) { if (previous.attempts[attemptId]) { next.attempts[attemptId] = previous.attempts[attemptId]; delete previous.attempts[attemptId]; } }
          delete previous.items[id];
        }
        previous.itemOrder = previous.itemOrder.filter(id => !childKeys.includes(id));
        if (previous.mainSessionId === sessionId) {
          if (previous.mainExecutorId && previous.executors[previous.mainExecutorId]) { next.mainExecutorId ??= previous.mainExecutorId; next.executors[previous.mainExecutorId] = previous.executors[previous.mainExecutorId]; }
          previous.mainSessionId = undefined; previous.mainAgentId = undefined; previous.mainExecutorId = undefined;
        }
        next.mainSessionId ??= sessionId; next.mainAgentId ??= ses.agentId;
      }
      this.settle(d, oldTaskId);
    }
    (ses.bindingHistory ??= []).push({ fromTaskId: oldTaskId, toTaskId: taskId, at });
    // Keep past actual time on the former task. The next real event opens the new association.
    for (const interval of d.timeline?.intervals ?? []) if ((interval.sessionId === sessionId || ses.runtime?.runId && interval.workItemId?.startsWith(`child:${ses.runtime.runId}:`)) && interval.end === null) interval.end = interval.observedThrough ?? d.timeline!.asOf;
    ses.taskId = taskId; ses.mergedAt = at; ses.linkedAsHistory = ses.status === 'archived';
    if (!d.tasks[taskId].sessionIds.includes(sessionId)) d.tasks[taskId].sessionIds.push(sessionId);
    d.journal.blocks = d.journal.blocks.filter(b => !(b.kind === 'session' && b.sessionId === sessionId));
    if (!ses.linkedAsHistory) this.settle(d, taskId);
  }

  async createTaskFromSession(sessionId: string, blockId?: string): Promise<CommandResult & { taskId?: string }> {
    const session = this.state.sessions[sessionId], block = blockId ? this.state.journal.blocks.find(b => b.id === blockId) : undefined;
    if (!session) return { ok: false, message: '会话不存在' };
    if (session.taskId) return { ok: true, taskId: session.taskId, message: '这条会话已经关联任务，未重复新建' };
    if (blockId && block?.kind !== 'text') return { ok: false, message: '原文字行已变化，请重试' };
    const taskId = uid('task');
    const bindingIssue = this.sessionBindingIssue(session, taskId);
    if (bindingIssue) return { ok: false, message: bindingIssue };
    this.update(d => {
      const title = block?.kind === 'text' && block.text.trim() ? block.text : session.title;
      d.tasks[taskId] = this.newTask(taskId, title, d.now);
      if (block) d.journal.blocks = d.journal.blocks.map(b => b.id === block.id ? { id: b.id, kind: 'task', taskId } : b);
      else d.journal.blocks.unshift({ id: uid('block'), kind: 'task', taskId });
      this.attachSession(d, sessionId, taskId);
    });
    return { ok: true, taskId, message: '已新建关联任务，会话未重新执行' };
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
    if (this.mode === "local") return { ok: false, message: "请在已配置的 Agent 中执行；本地工作区不会模拟受理或执行进度。" };
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

  async manageNow(command: import('./nowQueue').NowQueueCommand) {
    this.update(d => { d.nowQueue=updateNowQueue(deriveProjectActivity(d).entries,d.nowQueue,command); });
  }

  async addPlan(plan: Omit<PlanItem, "id" | "actual">) {
    if (!plan.title.trim()) throw new Error("请填写日程名称");
    const date = plan.date ?? this.state.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("请选择有效的日期");
    if (this.mode === "local" && !plan.taskId) throw new Error("请先选择任务");
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
      const existing = plan.taskId && d.plans.find(p => p.taskId === plan.taskId && p.workItemId === plan.workItemId && (p.date ?? d.date) === date);
      const input = { title: plan.title.trim(), taskId: plan.taskId, workItemId: plan.workItemId, start: plan.start, minutes: plan.minutes, kind: plan.kind, date, cancelled: false };
      if (existing) Object.assign(existing, input);
      else d.plans.push({ ...input, id: uid("p"), actual: [] });
      d.plans.sort((a, b) => (a.date ?? d.date).localeCompare(b.date ?? d.date) || toMinutes(a.start) - toMinutes(b.start));
    });
  }

  async applyPlanMoves(moves: PlanMove[]) {
    this.update(d=>{const targets=moves.map(move=>[validatePlanMove(d,move),move] as const);for(const [plan,move] of targets)plan.start=move.to;});
  }

  async removePlan(planId: string) {
    const plan = this.state.plans.find(p => p.id === planId);
    if (!plan) throw new Error("日程不存在");
    this.update(d => {
      const p = d.plans.find(value => value.id === planId)!;
      if (p.manualStartedAt) { (p.manualActual ??= []).push([p.manualStartedAt, new Date().toISOString()]); delete p.manualStartedAt; }
      p.cancelled = true;
    });
  }

  async setPlanTimer(planId: string, running: boolean) {
    const plan = this.state.plans.find(p => p.id === planId);
    if (!plan || plan.cancelled) throw new Error("日程不存在或已取消");
    if (running && plan.taskId && this.state.tasks[plan.taskId]?.completion) throw new Error("任务已完成，请先重新打开");
    this.update(d => {
      const p = d.plans.find(value => value.id === planId)!;
      const now = new Date().toISOString();
      if (running) p.manualStartedAt ??= now;
      else if (p.manualStartedAt) { (p.manualActual ??= []).push([p.manualStartedAt, now]); delete p.manualStartedAt; }
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

  async ensureProjectPlan():Promise<string> {
    let id='';this.update(d=>{id=ensureProjectDirection(d);});return id;
  }
  async savePlanOutline(planId:string,sections:PlanSection[],expectedDraftVersion:number):Promise<CommandResult> {
    const p=this.state.ideaPlans?.[planId];if(!p||p.draftVersion!==expectedDraftVersion)return {ok:false,message:'方向版本已变化，请刷新后编辑'};
    let clean:PlanSection[];try{clean=readPlanOutline(sections)!;}catch(error){return {ok:false,message:String(error)};}
    if(JSON.stringify(p.draft.sections)===JSON.stringify(clean))return {ok:true};
    this.update(d=>{const plan=d.ideaPlans![planId];plan.draft={sections:clean.map(s=>({...s,lines:s.lines.map(l=>({...l,userEdited:true}))}))};plan.draftVersion++;});
    return {ok:true,message:'已保存方向大纲，请确认此版本后执行'};
  }
  async configureGoalAutomation(planId:string,input:GoalAutomationInput):Promise<CommandResult> {
    let p=this.state.ideaPlans?.[planId],program=latestGoalPlan(this.state,planId);
    if(p&&planIsApproved(p)&&!program&&input.enabled&&p.draftVersion===input.expectedDraftVersion){this.update(d=>{const plan=d.ideaPlans![planId];materializeGoalPlan(d,plan);if(!latestGoalPlan(d,planId))materializeDirectTaskPlan(d,plan);});p=this.state.ideaPlans?.[planId];program=latestGoalPlan(this.state,planId);}
    if(!p||p.draftVersion!==input.expectedDraftVersion)return {ok:false,message:'方向版本已变化，请刷新'};
    if(input.enabled&&(!planIsApproved(p)||program&&program.draftVersion!==p.draftVersion))return {ok:false,message:'请先确认方向并生成任务'};
    const agentId=input.agentId??p.discussion?.agentId??this.state.defaultAgent;
    if(input.enabled&&!this.state.runtimeConnections?.[agentId])return {ok:false,message:'请先连接本项目的 Agent'};
    const intent=input.executionIntent;
    if(intent&&(typeof intent.text!=='string'||!intent.text.trim()||intent.text.length>4000||this.state.sessions[intent.sourceSessionId]?.runtime?.planId!==planId))return {ok:false,message:'执行指令与当前讨论来源不一致'};
    this.update(d=>{const c=ensureCollaboration(d),prior=c.goalAutomation?.[planId];
      const sameRevision=prior?.draftVersion===p.draftVersion;
      const retainedGraph=!!prior&&!!program&&retainsGoalPlanVersion(d,planId,prior.planVersion,program.version);
      const priorProgram=c.goalPlans?.[planId]?.find(version=>version.version===prior?.planVersion);
      // A new requirement may re-run completed work, but cannot erase an uncertain dispatch.
      const attempts=sameRevision?prior!.attempts:retainedGraph?Object.fromEntries(Object.entries(prior!.attempts).filter(([key,attempt])=>['unknown','reserved'].includes(attempt.state)||priorProgram?.tasks.find(task=>task.key===key)?.specRevision===program?.tasks.find(task=>task.key===key)?.specRevision)):{};
      (c.goalAutomation??={})[planId]={planId,planVersion:program?.version??0,draftVersion:p.draftVersion,enabled:input.enabled,agentId,version:(prior?.version??0)+1,at:new Date().toISOString(),attempts,...((sameRevision||retainedGraph)&&prior!.decomposition?{decomposition:prior!.decomposition}:{})};
      c.events.push({id:uid('goal-authorization'),sequence:++c.sequence,type:'goal_automation_authorized',actor:'human',at:new Date().toISOString(),detail:JSON.stringify({planId,enabled:input.enabled,draftVersion:p.draftVersion,agentId,...(intent?{executionIntent:{text:intent.text,sourceSessionId:intent.sourceSessionId}}:{})})});
    });return {ok:true,message:input.enabled?'已开启自动执行；等待授权或回复的分支暂停，其他独立任务继续':'已暂停后续自动派发；已运行任务可在原会话停止'};
  }

  async ensureTaskPlan(taskId: string): Promise<string> {
    const task = this.state.tasks[taskId];
    if (!task) throw new Error("任务已不存在");
    const id = rootPlanId(taskId);
    if (this.state.ideaPlans?.[id]) {
      this.update(d => { seedTaskDirection(d, d.ideaPlans![id]); });
      return id;
    }
    this.update(d => {
      d.ideaPlans ??= {};
      d.ideaPlans[id] = {
        id, taskId, itemId: null, title: task.title, script: "generic", step: 0, round: 0,
        draftVersion: 1, adopted: null, turns: [], drafts: [],
        draft: { sections: [
          { id: "s-goal", title: "目标", kind: "key", lines: [] },
          { id: "s-fixed", title: "已确定", kind: "key", lines: [] },
          { id: "s-open", title: "待决定", kind: "key", lines: [] },
        ] },
        discussion: { agentId: d.defaultAgent, conclusions: [] },
      };
      seedTaskDirection(d, d.ideaPlans[id]);
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
    let tasks: TaskDraft[] | undefined;
    let outline:PlanSection[]|undefined,deliverables:import("./goalDelivery").DeliverySlotDraft[]|undefined;
    try { tasks = readPlanTasks(input.tasks); outline=readPlanOutline(input.outline);deliverables=readDeliverySlots(input.deliverables); } catch (error) { return { ok: false, message: String(error) }; }
    const scopeIssue = scopedBreakdownIssue(this.state, plan, scope, tasks);
    if (scopeIssue) return { ok: false, message: scopeIssue };
    const confirmed = clean(input.confirmed);
    const open = clean(input.open);
    const normalize = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ");
    const confirmedKeys = new Set(confirmed.map(normalize));
    if (open.some((text) => confirmedKeys.has(normalize(text)))) return { ok: false, message: "同一条内容不能同时标为已确定和待定，请先核对结论" };
    const agentId = input.agentId ?? plan.discussion?.agentId ?? this.state.defaultAgent;
    if (!this.state.agents.some(agent => agent.id === agentId)) return { ok: false, message: "结论来源 Agent 尚未登记，请先保存配置" };
    const conclusions = plan.discussion?.conclusions ?? [];
    const last = conclusions[conclusions.length - 1];
    if (last?.source === "manual" && last.agentId === agentId && last.scopeId === scope && last.summary === summary && last.sourceUrl === (sourceUrl ?? undefined) && JSON.stringify(last.confirmed) === JSON.stringify(confirmed) && JSON.stringify(last.open) === JSON.stringify(open) && JSON.stringify(last.tasks) === JSON.stringify(tasks)) {
      return { ok: true, message: "相同结论已记录，未重复添加" };
    }
    this.update((d) => {
      const p = d.ideaPlans![planId];
      p.discussion ??= { agentId, conclusions: [] };
      p.discussion.conclusions.push({ id: uid("conclusion"), agentId, scopeId: scope, recordedAt: d.now, summary, confirmed, open, ...(tasks ? { tasks } : {}), ...(outline?{outline}:{}),...(deliverables?{deliverables}:{}), source: "manual", sourceUrl: sourceUrl ?? undefined });
      if (scope === 'root' && tasks?.length === 0) p.drafts = [];
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

  async recordDiscussionFeedback(input: DiscussionFeedbackInput): Promise<DiscussionFeedbackResult> {
    let result: DiscussionFeedbackResult = { ok: false };
    this.update(d => { result = appendDiscussionFeedback(d, input); if (!result.ok) throw Object.assign(new Error(result.message), { feedbackResult: result }); });
    return result;
  }

  async recordPlanConfirmation(planId: string, conclusionId: string | undefined, confirmed: string[], projectId?: string): Promise<CommandResult> {
    const plan = this.state.ideaPlans?.[planId];
    if (!plan || conclusionId && !plan.discussion?.conclusions.some(c => c.id === conclusionId)) return { ok: false, message: '讨论结论不存在' };
    if (!Array.isArray(confirmed) || confirmed.length > 100 || confirmed.some(text => typeof text !== 'string' || !text.trim() || text.length > 10000)) return { ok: false, message: '确认信息格式无效' };
    this.update(d => {
      const p = d.ideaPlans![planId];
      const wasApproved = planIsApproved(p);
      let section = p.draft.sections.find(s => s.id === 's-confirmed-input');
      if (!section) p.draft.sections.push(section = { id: 's-confirmed-input', title: '你已确认的信息', kind: 'key', lines: [] });
      const existing = new Set(p.draft.sections.flatMap(s => s.lines).filter(l => l.state === 'fixed' && !isGeneratedDiscussionSummary(p, l.id, l.text)).map(l => l.text.trim()));
      let added = false;
      for (const text of confirmed.map(text => text.trim())) if (!existing.has(text)) { section.lines.push({ id: uid('confirmed-input'), text, state: 'fixed', userEdited: true }); existing.add(text); added = true; }
      if (added) {
        p.draftVersion++;
        if (wasApproved) p.adopted = { ...p.adopted!, version: p.adopted!.version + 1, doc: structuredClone(p.draft), draftVersion: p.draftVersion, at: d.now };
      }
    });
    return { ok: true, message: '确认信息已保存到项目台帐' };
  }

  async approvePlan(planId: string, conclusionId?: string, projectId?: string, expectedDraftVersion?: number): Promise<CommandResult & { added?: number; approvedDraftVersion?:number }> {
    const plan = this.state.ideaPlans?.[planId];
    if (!plan) return { ok: false, message: "方案不存在" };
    const conclusion = conclusionId ? plan.discussion?.conclusions.find(c => c.id === conclusionId) : undefined;
    const latest = [...(plan.discussion?.conclusions ?? [])].reverse().find(c => c.scopeId === 'root');
    if (conclusion && latest?.id !== conclusion.id && !conclusion.adopted) return { ok: false, message: "已有更新的方案，请确认最新版本" };
    if (conclusionId && !conclusion) return { ok: false, message: "方案结论已变化，请刷新后确认" };
    if (conclusion && conclusion.scopeId !== "root") return { ok: false, message: "请从完整方案确认方向，局部结论可先采用到方案" };
    if (planIsApproved(plan) && (!conclusion || conclusion.adopted)) return { ok: true, added: 0, approvedDraftVersion:plan.draftVersion, message: "此方案已确认，未重复创建任务" };
    if (expectedDraftVersion !== undefined && plan.draftVersion !== expectedDraftVersion) return { ok: false, message: "方案版本已变化，请刷新后确认" };
    const previousProgram=latestGoalPlan(this.state,planId);
    if(previousProgram&&Object.values(this.state.sessions).some(s=>s.runtime&&previousProgram.tasks.some(b=>b.key===taskKey(s.runtime!.taskId,s.runtime!.workItemId))&&(s.dispatchPhase==='unknown'||s.runtime?.stoppedConfirmed!==true&&!['archived','failed','cancelled'].includes(s.status)||s.runtime.stoppedConfirmed===false)))return {ok:false,message:'上一版本仍有未确认停止的执行，请先在原会话停止并核对后再采用新方向'};
    let added = 0,approvedDraftVersion=plan.draftVersion;
    this.update(d => {
      const current = d.ideaPlans![planId];
      const selected = conclusionId ? current.discussion?.conclusions.find(c => c.id === conclusionId) : undefined;
      if (!approveDirection(d, current, selected)) return;
      generateDraftsIn(d, planId);
      added = materializeGoalPlan(d, current);
      approvedDraftVersion=current.draftVersion;
    });
    const retained=latestGoalPlan(this.state,planId);
    return { ok: true, added, approvedDraftVersion, message: added ? `方向已确认，已生成 ${added} 项任务与子任务，可分别执行` : canExecutePlanTaskDirectly(this.state,this.state.ideaPlans![planId]) ? '方向已确认，可直接开启当前任务的自动执行' : retained?.retainedFromVersion ? `方向已确认，沿用已生成的 ${retained.tasks.length} 项任务；可开启当前版本的自动执行` : "方向已确认；下一步拆分执行任务，不再重复确认方向" };
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

  async addDraftsToTasks(planId: string): Promise<CommandResult & { added?: number; approvedDraftVersion?:number }> {
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
      if(this.mode === 'local') {
        const c=ensureCollaboration(d),key=taskKey(taskId,itemId),task=c.tasks[key];
        const spec=c.specs.find(x=>x.key===key&&x.revision===task.specRevision)!;
        const result=applyCollaboration(d,{projectId:d.project.id,idempotencyKey:uid('human-state'),type:status==='done'?'review':status==='not_started'&&['done','cancelled'].includes(task.status)?'reopen':'set_task_state',taskId,workItemId:itemId,expectedVersion:task.version,payload:status==='done'?{submissionId:task.latestSubmissionId,verdict:'accepted',checks:spec.criteria.map(()=>true),note:'用户明确确认子任务完成（人工验收）'}:status==='not_started'&&['done','cancelled'].includes(task.status)?{}:{status:status==='not_started'?'ready':'running'}},{kind:'human'});
        if(!result.ok)throw new Error(result.message);
        return;
      }
      w.status = status;
      w.completedAt = status === "done" ? d.now : undefined;
      if (status === "done" && w.reviewNote?.startsWith("按 v")) w.reviewNote = `${w.reviewNote.split("；")[0]}完成；请按新版本复核`;
      refreshBlocked(o);
      this.settle(d, taskId);
    });
  }

  async dispatchWork(taskId: string, itemId: string, agentId: AgentId): Promise<CommandResult> {
    if (this.mode === "local") return { ok: false, message: "请在已配置的 Agent 中执行；本地工作区不会模拟受理或执行进度。" };
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

let sampleInstance: SampleWorkdeckDataSource | undefined;
/** Legacy explicit sample entry; importing the module never loads or mutates demo storage. */
export const sampleDataSource: WorkdeckDataSource = new Proxy({} as WorkdeckDataSource, {
  get(_target, key) { const source = sampleInstance ??= new SampleWorkdeckDataSource(); const value = Reflect.get(source, key); return typeof value === "function" ? value.bind(source) : value; },
});

const CONFIG_COMMANDS = new Set(['registerAgent', 'addCustomAgent', 'updateCustomAgent', 'removeCustomAgent', 'setDefaultAgent', 'setTracked', 'toggleStar', 'togglePin']);

/** Each project has its own command engine. A pending command can never mutate the project selected later. */
export interface LocalWorkdeckDataSource extends WorkdeckDataSource {}
export class LocalWorkdeckDataSource {
  async addTaskInput(projectId: string, taskId: string, text: string, inputId: string, attachments: OutputAttachment[] = []): Promise<CommandResult> {
    if (this.readError) throw this.readError;
    if (!this.library.projects[projectId]) return { ok: false, message: '项目不存在' };
    return this.engine(projectId).addTaskInput(projectId, taskId, text, inputId, attachments);
  }
  async getQualityCostReport(projectId:string) {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).getQualityCostReport(projectId);}
  async exportTaskRevisions(projectId:string) {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).exportTaskRevisions(projectId);}
  async previewTaskRevisions(projectId:string,raw:string) {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).previewTaskRevisions(projectId,raw);}
  async importTaskRevisions(projectId:string,raw:string,digest:string):Promise<CommandResult> {if(this.readError)throw this.readError;if(!this.library.projects[projectId])return {ok:false,message:'项目不存在'};return this.engine(projectId).importTaskRevisions(projectId,raw,digest);}
  async summarizeTaskTitle(taskId:string,projectId=this.library.activeProjectId??''):Promise<IntelligenceResult>{if(!this.library.projects[projectId])return {ok:false,message:'项目不存在'};return this.engine(projectId).summarizeTaskTitle(taskId);}
  async previewDeliveryChange(projectId:string,input:DeliveryChangeInput):Promise<DeliveryChangeResult> {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).previewDeliveryChange(projectId,input);}
  async applyDeliveryChange(projectId:string,input:DeliveryChangeInput):Promise<DeliveryChangeResult> {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).applyDeliveryChange(projectId,input);}
  async previewDeliveryPublication(projectId:string,input:DeliveryScope):Promise<DeliveryPublicationPreview> {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).previewDeliveryPublication(projectId,input);}
  async publishDelivery(projectId:string,input:PublishDeliveryInput):Promise<PublishDeliveryResult> {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).publishDelivery(projectId,input);}
  async resolveSpecMaintenance(projectId:string,input:ResolveSpecMaintenanceInput):Promise<CommandResult> {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).resolveSpecMaintenance(projectId,input);}
  async integrate(command:IntegrationCommand):Promise<IntegrationResult> {
    if(this.readError)throw this.readError;
    if(!this.library.projects[command.projectId])return {ok:false,message:'项目不存在',code:'NOT_FOUND'};
    return this.engine(command.projectId).integrate(command);
  }
  async queryTaskMemory(query:TaskMemoryQuery):Promise<TaskMemoryResponse> {
    if(this.readError)throw this.readError;
    const snapshot=this.library.projects[query.projectId];
    if(!snapshot)return {items:[],total:0,sourceSequence:0,scope:'project',query:query.query??''};
    return this.engine(query.projectId).queryTaskMemory(query);
  }
  async readTaskEvidence(projectId:string,key:string,artifactId:string) {
    if(this.readError)throw this.readError;
    return this.library.projects[projectId]?readEvidence(this.engine(projectId).peek(),key,artifactId):undefined;
  }
  async createTaskFromHandoff(projectId:string,input:CreateTaskFromHandoffInput):Promise<CreateTaskFromHandoffResult> {
    if(this.readError)throw this.readError;
    if(!this.library.projects[projectId])return {ok:false,code:'NOT_FOUND',message:'项目不存在'};
    this.reconcileProjectSources();
    return this.engine(projectId).createTaskFromHandoff(projectId,input);
  }
  async submitIntake(text:string,projectId=this.library.activeProjectId??''):Promise<IntelligenceResult>{if(!this.library.projects[projectId])return {ok:false,message:'请先新建项目'};return this.engine(projectId).submitIntake(text);}
  async retryIntake(inputId:string,projectId=this.library.activeProjectId??''):Promise<IntelligenceResult>{if(!this.library.projects[projectId])return {ok:false,message:'项目不存在'};return this.engine(projectId).retryIntake(inputId);}
  async resolveSuggestion(id:string,decision:'accepted'|'rejected',projectId=this.library.activeProjectId??''):Promise<IntelligenceResult>{if(!this.library.projects[projectId])return {ok:false,message:'项目不存在'};return this.engine(projectId).resolveSuggestion(id,decision);}
  async refreshProjectSummary(projectId=this.library.activeProjectId??''):Promise<IntelligenceResult>{if(!this.library.projects[projectId])return {ok:false,message:'项目不存在'};return this.engine(projectId).refreshProjectSummary();}

  async createTaskWithAttachments(text: string, attachments: OutputAttachment[], projectId: string) {
    if (this.readError) throw this.readError;
    if (!this.library.projects[projectId]) return { ok: false, message: '项目不存在' };
    return this.engine(projectId).createTaskWithAttachments(text, attachments, projectId);
  }
  async setTaskAttachments(projectId: string, taskId: string, attachments: OutputAttachment[], workItemId?: string, expectedIds?: string[]) {
    if (this.readError) throw this.readError;
    if (!this.library.projects[projectId]) return { ok: false, message: '项目不存在' };
    return this.engine(projectId).setTaskAttachments(projectId, taskId, attachments, workItemId, expectedIds);
  }
  async recordDiscussionFeedback(input: DiscussionFeedbackInput): Promise<DiscussionFeedbackResult> {
    if (this.readError) throw this.readError;
    if (!this.library.projects[input?.binding?.projectId]) return { ok: false, message: '项目不存在' };
    try { return await this.engine(input.binding.projectId).recordDiscussionFeedback(input); }
    catch (error) { if ((error as {feedbackResult?: DiscussionFeedbackResult}).feedbackResult) return (error as {feedbackResult: DiscussionFeedbackResult}).feedbackResult; throw error; }
  }
  async ensureProjectPlan(projectId=this.library.activeProjectId??'') {if(this.readError)throw this.readError;if(!this.library.projects[projectId])throw Error('项目不存在');return this.engine(projectId).ensureProjectPlan();}
  async savePlanOutline(planId:string,sections:PlanSection[],expectedDraftVersion:number,projectId=this.library.activeProjectId??'') {if(this.readError)throw this.readError;if(!this.library.projects[projectId])return {ok:false,message:'项目不存在'};return this.engine(projectId).savePlanOutline(planId,sections,expectedDraftVersion);}
  async configureGoalAutomation(planId:string,input:GoalAutomationInput,projectId=this.library.activeProjectId??'') {if(this.readError)throw this.readError;if(!this.library.projects[projectId])return {ok:false,message:'项目不存在'};return this.engine(projectId).configureGoalAutomation(planId,input);}
  async recordPlanConfirmation(planId: string, conclusionId: string | undefined, confirmed: string[], projectId = this.library.activeProjectId ?? '') {
    if (this.readError) throw this.readError;
    if (!this.library.projects[projectId]) return { ok: false, message: '项目不存在' };
    return this.engine(projectId).recordPlanConfirmation(planId, conclusionId, confirmed, projectId);
  }
  async approvePlan(planId: string, conclusionId?: string, projectId = this.library.activeProjectId ?? '', expectedDraftVersion?: number) {
    if (this.readError) throw this.readError;
    if (!this.library.projects[projectId]) return { ok: false, message: '项目不存在' };
    return this.engine(projectId).approvePlan(planId, conclusionId, projectId, expectedDraftVersion);
  }
  async collaborate(command: CollaborationCommand): Promise<CollaborationResult> {
    if(this.readError)throw this.readError;
    this.reconcileProjectSources();
    if(!this.library.projects[command.projectId])return {ok:false,code:'NOT_FOUND',message:'项目不存在'};
    return this.engine(command.projectId).collaborate(command);
  }
  /** Project-bound atomic mutation used by verified local Runtime adapters. */
  mutateRuntimeProject(projectId: string, mutator: (snapshot: Snapshot) => void) {
    this.reconcileProjectSources();
    if (!this.library.projects[projectId]) throw new Error('项目不存在');
    this.engine(projectId).mutateRuntime(mutator);
  }
  mutateRuntimeAgents(mutator: (snapshot: Snapshot) => void) {
    const engine = this.engine();
    engine.mutateRuntime(mutator);
    this.syncAgentConfiguration(engine.peek());
  }
  readonly mode = 'local' as const;
  readonly demo = undefined;
  private library: ProjectLibrary;
  private engines = new Map<string, SampleWorkdeckDataSource>();
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private readError: Error | null = null;

  constructor(private readonly trusted?:{verifyOutputAttachments?:OutputAttachmentVerifier}) {
    try {
      this.library = readProjectLibrary();
      let migrated = false;
      for (const project of Object.values(this.library.projects)) {
        if (project.project.deletedAt) continue;
        migrated = normalizeTaskIdentities(project) || migrated;
        if(!project.collaboration?.governance){ensureCollaboration(project);migrated=true;}
        if(!project.intelligence){ensureIntelligence(project);migrated=true;}
        if(recoverIntegrationReviews(project))migrated=true;
        if(Object.values(project.intelligence!.jobs).some(job=>job.status==='queued'||job.status==='running')){recoverIntelligenceJobs(project);migrated=true;}
      }
      if (migrated) persistProjectLibrary(this.library);
    }
    catch (error) { this.readError = error as Error; this.library = { schema: 1, activeProjectId: null, projects: {}, agents: [], defaultAgent: '' }; }
    return new Proxy(this, {
      get: (target, key, receiver) => {
        if (Reflect.has(target, key)) { const value = Reflect.get(target, key, receiver); return typeof value === 'function' ? value.bind(target) : value; }
        if (key === 'then' || typeof key !== 'string') return undefined;
        return async (...args: unknown[]) => {
          if (target.readError) throw target.readError;
          if (!target.library.activeProjectId && !CONFIG_COMMANDS.has(key)) throw new Error('请先新建项目');
          if (key === 'removeCustomAgent') {
            const id = args[0];
            if (Object.values(target.library.projects).some(project => Object.values(project.sessions).some(session => session.agentId === id))) return { ok: false, message: '该 Agent 在项目中仍有关联记录，不能移除' };
          }
          const engine = target.engine();
          const method = Reflect.get(engine, key);
          if (typeof method !== 'function') throw new Error('不支持的项目操作');
          const result = await method.apply(engine, args);
          if (CONFIG_COMMANDS.has(key) && !(result && result.ok === false)) target.syncAgentConfiguration(engine.peek());
          return result;
        };
      },
    });
  }

  private commit(next: ProjectLibrary) {
    next=structuredClone(next);
    const changed=new Set<string>();
    for(let pass=0;pass<Object.keys(next.projects).length;pass++) {
      let dirty=false;
      for(const [id,snapshot] of Object.entries(next.projects)) {
        const before=snapshot.collaboration?.sequence;
        reconcileGrantedSources(Object.values(next.projects),snapshot);
        if(snapshot.collaboration?.sequence!==before){snapshot.version++;changed.add(id);dirty=true;}
      }
      if(!dirty)break;
    }
    persistProjectLibrary(next);
    this.library = next;
    for(const [id,engine] of this.engines)if(next.projects[id])engine.refreshPersistedSnapshot(next.projects[id]);
  }
  /** Trusted capability gateway only; absent from BUSINESS_COMMANDS. */
  async readGrantedEvidence(sourceProjectId:string,targetProjectId:string,input:Parameters<typeof readAndRecordGrantedArtifact>[2]) {
    if(this.readError)throw this.readError;
    this.reconcileProjectSources();
    const source=this.library.projects[sourceProjectId];if(!source||!this.library.projects[targetProjectId])throw Error('来源项目不可用');
    let result!:ReturnType<typeof readAndRecordGrantedArtifact>;
    this.mutateRuntimeProject(targetProjectId,d=>{result=readAndRecordGrantedArtifact(source,d,input);});
    return result;
  }
  /** Agent capability service only. Human IPC cannot select or forge an execution binding. */
  async readEvidenceForAgent(request:ContextEvidenceRequest & {grants?:{sourceProjectId:string;token:string;artifactIds:string[]}[]},binding:EvidenceReaderBinding) {
    this.reconcileProjectSources();
    let page:unknown;
    this.mutateRuntimeProject(request.projectId,d=>{
      const grant=request.grants?.find(value=>value.artifactIds.includes(request.artifactId));
      if(!grant){page=readAndRecordContextEvidence(d,request,binding);return;}
      const source=this.library.projects[grant.sourceProjectId];if(!source)throw Error('来源项目不可用');
      const fragment=readAndRecordGrantedArtifact(source,d,{token:grant.token,artifactId:request.artifactId,offset:request.offset,limit:request.limit});
      if(fragment.hash!==request.hash)throw Error('资料版本不匹配');
      const boundRun=d.collaboration!.runs[binding.runId];
      const context=d.collaboration!.contextPackages.find(pack=>pack.id===request.contextPackageId&&pack.runId===binding.runId&&pack.claimEpoch===binding.claimEpoch);
      if(fragment.runId!==binding.runId||!boundRun||boundRun.claimEpoch!==binding.claimEpoch||!context||context.id!==boundRun.contextPackageId)throw Error('上下文绑定无效');
      const size=estimateTokens(JSON.stringify(fragment));
      (d.contextEvidenceReads??=[]).push({id:uid('evidence-read'),projectId:d.project.id,runId:binding.runId,contextPackageId:context.id,artifactId:fragment.artifactId,hash:fragment.hash,offset:fragment.offset,length:fragment.body.length,fragmentHash:hashText(fragment.body),at:new Date().toISOString(),estimatedTokens:size});
      page=fragment;
    });
    return page;
  }
  reconcileProjectSources() {
    const next=structuredClone(this.library);
    const before=Object.values(next.projects).map(p=>p.collaboration?.sequence);
    for(const snapshot of Object.values(next.projects))reconcileGrantedSources(Object.values(next.projects),snapshot);
    if(Object.values(next.projects).some((p,i)=>p.collaboration?.sequence!==before[i])){
      for(const snapshot of Object.values(next.projects))snapshot.version++;
      this.commit(next);this.emit();
    }
  }
  private engine(id = this.library.activeProjectId ?? '') {
    if (id && this.library.projects[id]?.project.deletedAt) throw new Error('项目已删除');
    let engine = this.engines.get(id);
    if (!engine) {
      const snapshot = structuredClone(this.library.projects[id] ?? createEmptySnapshot());
      snapshot.agents = this.library.agents.map(agent => {
        const existing = snapshot.agents.find(a => a.id === agent.id);
        return { ...structuredClone(agent), ...(snapshot.runtimeConnections?.[agent.id] ? { connection: 'healthy' as const, connectionNote: '本地连接已验证' } : {}), today: existing?.today ?? { minutes: null, tokens: null, sessions: null }, daily14: existing?.daily14 ?? [], scan: existing?.scan ?? agent.scan };
      });
      snapshot.defaultAgent = this.library.defaultAgent;
      engine = new SampleWorkdeckDataSource({ snapshot, verifyOutputAttachments:this.trusted?.verifyOutputAttachments, onPersist: state => {
        const next = structuredClone(this.library);
        if (id && this.library.projects[id]?.project.deletedAt) throw new Error('项目已删除，拒绝迟到写入');
        if (id) next.projects[id] = state;
        else { next.agents = state.agents; next.defaultAgent = state.defaultAgent; }
        this.commit(next);
        if (id === (this.library.activeProjectId ?? '')) this.listeners.forEach(listener => listener(structuredClone(this.library.projects[id]??state)));
        else this.emit();
      } });
      this.engines.set(id, engine);
    }
    return engine;
  }
  private syncAgentConfiguration(snapshot: Snapshot) {
    const next = structuredClone(this.library);
    next.agents = snapshot.agents;
    next.defaultAgent = snapshot.defaultAgent;
    for (const project of Object.values(next.projects)) {
      project.agents = snapshot.agents.map(agent => {
        const prior = project.agents.find(a => a.id === agent.id);
        return { ...agent, ...(project.runtimeConnections?.[agent.id] ? { connection: 'healthy' as const, connectionNote: '本地连接已验证' } : { connection: 'offline' as const, connectionNote: '请为此项目配置连接' }), today: prior?.today ?? { minutes: null, tokens: null, sessions: null }, daily14: prior?.daily14 ?? [] };
      });
      project.defaultAgent = snapshot.defaultAgent;
    }
    this.commit(next);
    // All persisted snapshots are now current; cached engines are safe to refresh without changing their project identity.
    for (const [id, engine] of this.engines) engine.refreshAgentConfiguration(next.projects[id]?.agents ?? next.agents, next.defaultAgent);
    this.emit();
  }
  private emit() { const snapshot = this.engine().peek(); this.listeners.forEach(listener => listener(structuredClone(snapshot))); }
  async load() {
    if (this.readError) throw this.readError;
    return this.engine().load();
  }
  subscribe(listener: (snapshot: Snapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async listProjects() {
    if (this.readError) throw this.readError;
    return Object.keys(this.library.projects).filter(id => !this.library.projects[id].project.deletedAt).map(id => this.engine(id).peek());
  }
  async deleteTask(taskId: string, projectId: string, workItemId?: string): Promise<CommandResult> {
    if (this.readError) throw this.readError;
    if (!this.library.projects[projectId] || this.library.projects[projectId].project.deletedAt) return { ok: false, message: '项目不存在或已删除' };
    return this.engine(projectId).deleteTask(taskId, projectId, workItemId);
  }
  async deleteProject(id: string): Promise<CommandResult> {
    if (this.readError) throw this.readError;
    const project = this.library.projects[id];
    if (!project || project.project.deletedAt) return { ok: false, message: '项目不存在或已删除' };
    const blocked = deletionBlocker(this.engine(id).peek());
    if (blocked) return { ok: false, message: blocked };
    const next = structuredClone(this.library);
    next.projects[id].project.deletedAt = new Date().toISOString();
    next.projects[id].version++;
    if (next.activeProjectId === id) next.activeProjectId = Object.keys(next.projects).find(key => !next.projects[key].project.deletedAt) ?? null;
    this.commit(next);
    this.engines.delete(id);
    this.emit();
    return { ok: true, message: '项目已删除，本地历史与附件保留' };
  }
  async createProject(input: ProjectInput): Promise<CommandResult & { projectId?: string }> {
    if (this.readError) throw this.readError;
    const name = input.name.trim();
    if (!name || name.length > 80) return { ok: false, message: '项目名称请填写 1–80 个字' };
    if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color)) return { ok: false, message: '项目颜色无效' };
    const projectId = uid('project');
    const snapshot = createEmptySnapshot({ id: projectId, name, description: input.description?.trim() ?? '', color: input.color ?? '#A94435', createdAt: new Date().toISOString() });
    snapshot.agents = this.library.agents.map(agent => ({
      ...structuredClone(agent),
      today: { minutes: null, tokens: null, sessions: null },
      daily14: [],
      scan: { state: "idle", lastAt: null },
    }));
    snapshot.defaultAgent = this.library.defaultAgent;
    ensureCollaboration(snapshot);
    ensureIntelligence(snapshot);
    snapshot.collaboration!.events.push({id:uid('event'),sequence:++snapshot.collaboration!.sequence,type:'project_created',actor:'local-user',at:new Date().toISOString(),detail:'项目建立；所有者 local-user'});
    this.commit({ ...this.library, projects: { ...this.library.projects, [projectId]: snapshot }, activeProjectId: projectId });
    this.emit();
    return { ok: true, projectId };
  }
  async addPlan(plan: Omit<PlanItem, "id" | "actual">, projectId = this.library.activeProjectId ?? '') {
    if (!this.library.projects[projectId]) throw new Error("项目不存在");
    return this.engine(projectId).addPlan(plan);
  }
  async removePlan(planId: string, projectId = this.library.activeProjectId ?? '') {
    if (!this.library.projects[projectId]) throw new Error("项目不存在");
    return this.engine(projectId).removePlan(planId);
  }
  async setPlanTimer(planId: string, running: boolean, projectId = this.library.activeProjectId ?? '') {
    if (!this.library.projects[projectId]) throw new Error("项目不存在");
    return this.engine(projectId).setPlanTimer(planId, running);
  }
  async applyPlanMoves(moves: PlanMove[]) {
    if(this.readError)throw this.readError;
    if(!moves.length)return;
    if(moves.length>500||new Set(moves.map(m=>`${m.projectId}:${m.planId}`)).size!==moves.length)throw new Error('重排列表无效');
    const next=structuredClone(this.library),changed=new Set<string>();
    for(const move of moves) {
      if(!next.projects[move.projectId])throw new Error('项目不存在');
      if(!changed.has(move.projectId))next.projects[move.projectId]=structuredClone(this.engine(move.projectId).peek());
      const project=next.projects[move.projectId];validatePlanMove(project,move).start=move.to;changed.add(move.projectId);
    }
    for(const id of changed)next.projects[id].version++;
    this.commit(next);
    for(const id of changed)this.engine(id).refreshPlans(next.projects[id].plans,next.projects[id].version);
    this.emit();
  }
  async applyExecutionEvent(event: ExecutionEvent): Promise<CommandResult> {
    if (!this.library.projects[event.projectId] || this.library.projects[event.projectId].project.deletedAt) return { ok: false, message: '事件所属项目不存在或已删除' };
    return this.engine(event.projectId).applyExecutionEvent(event);
  }
  async switchProject(id: string): Promise<CommandResult> {
    if (!this.library.projects[id] || this.library.projects[id].project.deletedAt) return { ok: false, message: '项目不存在或已删除' };
    this.commit({ ...this.library, activeProjectId: id });
    await this.engine().load();
    this.emit();
    return { ok: true };
  }
  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<CommandResult> {
    if (!this.library.projects[id] || this.library.projects[id].project.deletedAt) return { ok: false, message: '项目不存在或已删除' };
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.trim().length > 80)) return { ok: false, message: '项目名称请填写 1–80 个字' };
    if (patch.color !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.color)) return { ok: false, message: '项目颜色无效' };
    const result = await this.engine(id).updateProject(id, patch);
    if (id !== this.library.activeProjectId) this.emit();
    return result;
  }
}
export const localDataSource = new LocalWorkdeckDataSource();
