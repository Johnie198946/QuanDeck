import type { RuntimeRequest } from '../integration/desktop';
import type { Snapshot, Step, SessionStatus } from './types';
import type { SourceReference, AgentIncident } from '../integration/contracts';
import type { RuntimeSubmissionBinding } from './runtimeSubmission';
import type { CollaborationContext, CollaborationResult } from './collaboration';

export interface RuntimeConnectionBinding {
  connectionId: string; tool: SourceReference['tool']; projectPath: string;
  /** Transport cache revision; user configuration is application-wide. */
  profileRevision?: string;
  capabilities?: Record<string, boolean>; model?: string; provider?: string; protocol?: string;
}
export interface RuntimeRunInput {
  dispatchId: string; projectId: string; taskId: string; workItemId?: string;
  agentId: string; connectionId: string; prompt: string; title?: string;
  purpose: 'execution' | 'discussion' | 'review'; sourceSessionId?: string;
  /** Transport hint for note-origin work; execution permissions and delivery use the project contract. */
  noteSourceTask?: boolean;
  /** IDs only. Image bytes are transient and never recorded in run snapshots. */
  noteImageIds?: string[];
  /** Only connections bound to this business project may be selected by a backup policy. */
  allowedFallbackConnectionIds?: string[];
  collaboration?: RuntimeSubmissionBinding;
  /** Historical dispatch metadata. The Agent owns enforcement. */
  budget?: { maxTokens: number; enforcement: 'soft' };
}
export interface RuntimeFallbackReceipt {
  fromConnectionId: string; toConnectionId: string; reason: string; acceptanceNotSent: true;
}
export interface TaskWorkspaceReceipt {
  role:'code'|'release'; source:string; directory:string; branch:string; baseSha:string;
}
export interface RuntimeReceipt {
  taskWorkspace?:TaskWorkspaceReceipt;
  runId: string; sessionId: string; connectionId: string; acceptedAt: string;
  tool?: SourceReference['tool']; fallback?: RuntimeFallbackReceipt;
  stoppedConfirmed?: boolean;
  protocol?: string; controls?: { canResume: boolean; canReply: boolean; reason?: string };
}
export interface RuntimeEvent {
  id: string; sequence: number; at: string; runId: string; sessionId: string;
  status?: 'queued' | 'running' | 'waiting_reply' | 'waiting_permission' | 'paused' | 'done' | 'failed' | 'cancelled';
  reply?: { id: string; text: string }; step?: Step | null; tokens?: number | null;
  /** Adapter-only structured channel; the same validator applies to the CLI fallback. */
  submission?: unknown;
  /** Source protocol confirmed a successful model turn; waiting_reply alone is not completion. */
  turnCompleted?: boolean;
  /** Driver acknowledgement only; terminal display status is not stop evidence. */
  stoppedConfirmed?: boolean;
  reason?: string; error?: string; requestResolved?: string;
  incident?: AgentIncident; fallback?: RuntimeFallbackReceipt;
  message?: { id: string; text: string; role?: string };
  request?: RuntimeRequest & { kind: 'reply' | 'question' | 'permission'; options?: string[] };
  child?: { id: string; parentId?: string; title: string; status: 'queued' | 'running' | 'paused' | 'cancelled' | 'done' | 'failed'; start?: string; end?: string; tokens?: number | null; sessionId?: string; reply?: string };
}
export interface ObservedRuntimeSession {
  sessionId: string; connectionId: string; title: string; updatedAt: string; startedAt?: string;
  status?: SessionStatus; tokens?: number | null; replies?: { id: string; text: string; at: string }[];
}
export type RuntimeRunRecord = RuntimeReceipt & Partial<RuntimeRunInput> & { acceptance?: 'acknowledged' | 'unknown' | 'rejected'; status?: RuntimeEvent['status']; events?: RuntimeEvent[]; stoppedConfirmed?: boolean };
export interface RuntimeAssistInput {
  requestId: string; projectId: string; connectionId: string; tool: SourceReference['tool'];
  kind: 'classify' | 'summary' | 'title' | 'integration'; prompt: string; outputSchema: Record<string, unknown>; maxTokens?: number; timeoutMs: number;
}
export interface RuntimeAssistReceipt {
  requestId: string; projectId: string; connectionId: string; tool: SourceReference['tool']; sourceSessionId: string;
  output: unknown; actualTokens: number|null; startedAt: string; acceptedAt: string; finishedAt: string;
  budgetEnforcement: 'soft' | 'source'; tokenLimit?: number | null; budgetExceeded: boolean;
  contextPolicy: 'new-isolated-session'; toolPolicy: 'sdk-tools-disabled'|'read-only-isolated'|'isolated-no-tool-plugins';
}
export interface RuntimeDriver {
  verifyTaskWorkspace?(runId:string):Promise<void>;
  /** Native adapter reads and freezes actual file bytes. Never exposed as a renderer command. */
  verifyDeliveryFiles?(input: { runId: string; projectId: string; taskId: string; workItemId?: string; items: unknown[] }): Promise<import('./collaboration').VerifiedDeliveryFile[]>;
  contextAccess?(binding: RuntimeSubmissionBinding, grants?: {sourceProjectId:string;token:string;artifactIds:string[]}[]): string;
  prepareAttachments?(input: { projectId: string; taskId: string; workItemId?: string; connectionId: string; ids: string[]; imageIds?: string[] }): Promise<{ id: string; name: string; path: string; sha256?: string; imageUrl?: string }[]>;
  prepareReceiptFiles?(input: { projectId: string; taskId: string; workItemId?: string; connectionId: string; ids: string[] }): Promise<{ id: string; name: string; path: string; sha256?: string }[]>;
  prepareSourceAttachments?(input: { projectId: string; taskId: string; workItemId?: string; connectionId: string; reviewSubmissionId?: string; reworkReviewId?: string; sources: {id:string;hash:string}[] }): Promise<{ id: string; name: string; path: string; sha256: string }[]>;
  assist?(input: RuntimeAssistInput): Promise<RuntimeAssistReceipt>;
  run(input: RuntimeRunInput, images?: {id:string;url:string}[]): Promise<RuntimeReceipt>;
  adopt?(input: RuntimeRunInput & { sourceSessionId: string }): Promise<RuntimeRunRecord>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  control(runId: string, action: RuntimeAction, payload?: Record<string, unknown>): Promise<unknown>;
  scan(connectionId: string): Promise<ObservedRuntimeSession[] | { sessions: ObservedRuntimeSession[]; coverage?: string }>;
  listRuns?(): Promise<RuntimeRunRecord[]> | RuntimeRunRecord[];
  resolveIncident?(runId: string, resolution: { reason: 'handed_off'; successorRunId: string }): Promise<unknown> | unknown;
  recover?(input: RuntimeRunInput & Partial<RuntimeReceipt> & { sequence?: number; status?: RuntimeEvent['status']; tokens?: number | null }): Promise<unknown>;
}
export type RuntimeAction = 'stop' | 'resume' | 'cancel' | 'reply' | 'archive';
export interface DirectionMessage {
  projectId: string; planId: string; scope: string; agentId: string;
  draftVersion: number; conclusionId?: string; messageId: string; text: string;
}
export interface RuntimeExecutionMeta {
  resultRevision?: import('./resultReply').ResultRevision;
  taskWorkspace?:TaskWorkspaceReceipt;
  preparedInputs?:{id:string;path:string;sha256:string}[];
  initialDirectionMessage?: { id: string; hash: string; length?: number; conclusionId?: string };
  protocol?: string;
  dispatchId: string; runId?: string; acceptedAt?: string; projectId: string; taskId: string; workItemId?: string; attemptId?: string;
  connection: RuntimeConnectionBinding; purpose: 'execution' | 'discussion' | 'review'; planId?: string; scope?: string; reviewSubmissionId?: string;
  collaboration?: RuntimeSubmissionBinding;
  capabilities?: { context: 'new-source-session' | 'resumed-source-session' | 'unknown'; toolEnforcement: 'unverified'; budgetEnforcement: 'soft' | 'source'; usage: 'provider-reported' | 'unknown' };
  submissionReceipts?: { messageId: string; at: string; ok: boolean; kind?: 'result' | 'checkpoint' | 'plan_proposal' | 'blocker'; code?: string; message?: string; resourceId?: string; converter: string; replayed?:boolean }[];
  /** Successful original requests only, committed with their domain mutation. Replays never reread mutable paths. */
  submissionCommands?:Record<string,{fingerprint:string;result:CollaborationResult}>;
  submissionIssue?: { messageId: string; at: string; code: string; message: string; requiresStructuredResult?: boolean };
  /** One durable formatting repair per owned run; an unknown send is never replayed. */
  /** One durable stop reservation after an authorized assembly candidate, never a business acceptance. */
  completionStop?: {state:'reserved'|'unknown'|'stopped';at:string;error?:string};
  submissionRepair?: { messageId: string; at: string; state: 'reserved' | 'sent' | 'failed' | 'unknown'; planId: string; authorizationVersion: number; planVersion: number; draftVersion: number; error?: string };
  context: { taskTitle: string; prompt: string; planVersion?: number; capturedAt: string };
  finalReplyId?: string | null;
  sequence: number; eventIds: string[]; request?: RuntimeEvent['request'];
  requests?: Record<string, NonNullable<RuntimeEvent['request']>>;
  controlDeliveries?: Record<string,{ fingerprint:string; resultRoundId?:string; status:'sending'|'sent'|'failed'|'unknown'; at:string; sentAt?:string; error?:string; memoryLessons?: CollaborationContext['memoryLessons']; taskAnnotationPins?: CollaborationContext['taskAnnotationPins'] }>;
  controlPending?: RuntimeAction; disconnected?: boolean;
  /** True only after the driver has verified this owned execution stopped. */
  stoppedConfirmed?: boolean;
  /** A new execution carries a frozen handoff brief; it never reuses the predecessor's source ID. */
  predecessorSessionId?: string; handedOffTo?: string;
  fallback?: RuntimeFallbackReceipt & { fromAgentId: string; toAgentId: string };
  incident?: AgentIncident;
  usageSamples?: { at: string; tokens: number; delta: number | null }[];
}
export interface RuntimeCommands {
  setTaskSourceDirectory(projectId:string,taskId:string,agentId:string,directory:string,workItemId?:string):Promise<{ok:boolean;message?:string}>;
  restartBlockedTask(sessionId:string,input:import('./blockedTask').BlockedTaskInput):Promise<{ok:boolean;message?:string;sessionId?:string;materialsSaved?:boolean}>;
  replyToResult(input: import('./resultReply').ResultReplyInput): Promise<{ok:boolean;message?:string;sessionId?:string}>;
  resolveProjectAgentConnection(projectId:string,agentId:string):Promise<{ok:boolean;message?:string;binding?:RuntimeConnectionBinding}>;
  bindRuntimeConnection(agentId: string, connection: RuntimeConnectionBinding, guard?: { projectId: string; expectedConnectionId: string }): Promise<{ ok: boolean; message?: string }>;
  dispatchProjectTask(projectId: string, taskId: string, agentId: string, itemId?: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  sendDirectionMessage(input: DirectionMessage): Promise<{ ok: boolean; message?: string; sessionId?: string; recovery?: 'retry' | 'reconcile' }>;
  startDiscussion(planId: string, agentId?: string, scope?: string, projectId?: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  startReview(submissionId: string, agentId?: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  controlSession(sessionId: string, action: RuntimeAction, payload?: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  inspectContextRestart(sessionId: string): Promise<import('./runtimeContextRestart').ContextRestart | undefined>;
  restartFreshContext(sessionId: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  handoffSession(sessionId: string, targetAgentId: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  syncRuntime(): Promise<{ ok: boolean; message?: string }>;
  prepareSourceSession(sessionId: string): Promise<{ ok: boolean; message?: string; runId?: string }>;
}
export type RuntimeProjectMutation = (snapshot: Snapshot) => void;
