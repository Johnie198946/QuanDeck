import type { Snapshot, Step, SessionStatus } from './types';
import type { SourceReference } from '../integration/contracts';
import type { RuntimeSubmissionBinding } from './runtimeSubmission';

export interface RuntimeConnectionBinding {
  connectionId: string; tool: SourceReference['tool']; projectPath: string;
  capabilities?: Record<string, boolean>; model?: string; provider?: string; protocol?: string;
}
export interface RuntimeRunInput {
  dispatchId: string; projectId: string; taskId: string; workItemId?: string;
  agentId: string; connectionId: string; prompt: string;
  purpose: 'execution' | 'discussion' | 'review'; sourceSessionId?: string;
  collaboration?: RuntimeSubmissionBinding;
  budget?: { maxTokens: number; enforcement: 'soft' };
}
export interface RuntimeReceipt { runId: string; sessionId: string; connectionId: string; acceptedAt: string; protocol?: string; controls?: { canResume: boolean; canReply: boolean; reason?: string } }
export interface RuntimeEvent {
  id: string; sequence: number; at: string; runId: string; sessionId: string;
  status?: 'queued' | 'running' | 'waiting_reply' | 'waiting_permission' | 'paused' | 'done' | 'failed' | 'cancelled';
  reply?: { id: string; text: string }; step?: Step | null; tokens?: number | null;
  /** Adapter-only structured channel; the same validator applies to the CLI fallback. */
  submission?: unknown;
  reason?: string; error?: string; requestResolved?: string;
  request?: { id: string; kind: 'reply' | 'question' | 'permission'; prompt: string; options?: string[]; questions?: unknown; targetSessionId?: string };
  child?: { id: string; parentId?: string; title: string; status: 'queued' | 'running' | 'paused' | 'cancelled' | 'done' | 'failed'; start?: string; end?: string; tokens?: number | null; sessionId?: string; reply?: string };
}
export interface ObservedRuntimeSession {
  sessionId: string; connectionId: string; title: string; updatedAt: string; startedAt?: string;
  status?: SessionStatus; tokens?: number | null; replies?: { id: string; text: string; at: string }[];
}
export type RuntimeRunRecord = RuntimeReceipt & Partial<RuntimeRunInput> & { acceptance?: 'acknowledged' | 'unknown' | 'rejected'; status?: RuntimeEvent['status']; events?: RuntimeEvent[] };
export interface RuntimeAssistInput {
  requestId: string; projectId: string; connectionId: string; tool: SourceReference['tool'];
  kind: 'classify' | 'summary' | 'title'; prompt: string; outputSchema: Record<string, unknown>; maxTokens: number; timeoutMs: number;
}
export interface RuntimeAssistReceipt {
  requestId: string; projectId: string; connectionId: string; tool: SourceReference['tool']; sourceSessionId: string;
  output: unknown; actualTokens: number|null; startedAt: string; acceptedAt: string; finishedAt: string;
  budgetEnforcement: 'soft'; tokenLimit: number; budgetExceeded: boolean;
  contextPolicy: 'new-isolated-session'; toolPolicy: 'sdk-tools-disabled'|'read-only-isolated'|'isolated-no-tool-plugins';
}
export interface RuntimeDriver {
  prepareAttachments?(input: { projectId: string; taskId: string; workItemId?: string; connectionId: string; ids: string[] }): Promise<{ id: string; name: string; path: string }[]>;
  assist?(input: RuntimeAssistInput): Promise<RuntimeAssistReceipt>;
  run(input: RuntimeRunInput): Promise<RuntimeReceipt>;
  adopt?(input: RuntimeRunInput & { sourceSessionId: string }): Promise<RuntimeRunRecord>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  control(runId: string, action: RuntimeAction, payload?: Record<string, unknown>): Promise<unknown>;
  scan(connectionId: string): Promise<ObservedRuntimeSession[] | { sessions: ObservedRuntimeSession[]; coverage?: string }>;
  listRuns?(): Promise<RuntimeRunRecord[]> | RuntimeRunRecord[];
  recover?(input: RuntimeRunInput & Partial<RuntimeReceipt> & { sequence?: number; status?: RuntimeEvent['status']; tokens?: number | null }): Promise<unknown>;
}
export type RuntimeAction = 'stop' | 'resume' | 'cancel' | 'reply' | 'archive';
export interface RuntimeExecutionMeta {
  protocol?: string;
  dispatchId: string; runId?: string; acceptedAt?: string; projectId: string; taskId: string; workItemId?: string; attemptId?: string;
  connection: RuntimeConnectionBinding; purpose: 'execution' | 'discussion' | 'review'; planId?: string; scope?: string; reviewSubmissionId?: string;
  collaboration?: RuntimeSubmissionBinding;
  capabilities?: { context: 'new-source-session' | 'resumed-source-session' | 'unknown'; toolEnforcement: 'unverified'; budgetEnforcement: 'soft'; usage: 'provider-reported' | 'unknown' };
  submissionReceipts?: { messageId: string; at: string; ok: boolean; code?: string; message?: string; resourceId?: string; converter: string }[];
  context: { taskTitle: string; prompt: string; planVersion?: number; capturedAt: string };
  sequence: number; eventIds: string[]; request?: RuntimeEvent['request'];
  requests?: Record<string, NonNullable<RuntimeEvent['request']>>;
  controlPending?: RuntimeAction; disconnected?: boolean;
  usageSamples?: { at: string; tokens: number; delta: number | null }[];
}
export interface RuntimeCommands {
  bindRuntimeConnection(agentId: string, connection: RuntimeConnectionBinding): Promise<{ ok: boolean; message?: string }>;
  startDiscussion(planId: string, agentId?: string, scope?: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  startReview(submissionId: string, agentId?: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  controlSession(sessionId: string, action: RuntimeAction, payload?: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  syncRuntime(): Promise<{ ok: boolean; message?: string }>;
  prepareSourceSession(sessionId: string): Promise<{ ok: boolean; message?: string; runId?: string }>;
}
export type RuntimeProjectMutation = (snapshot: Snapshot) => void;
