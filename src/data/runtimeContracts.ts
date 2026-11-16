import type { Snapshot, Step, SessionStatus } from './types';
import type { SourceReference } from '../integration/contracts';

export interface RuntimeConnectionBinding {
  connectionId: string; tool: SourceReference['tool']; projectPath: string;
  capabilities?: Record<string, boolean>; model?: string; provider?: string;
}
export interface RuntimeRunInput {
  dispatchId: string; projectId: string; taskId: string; workItemId?: string;
  agentId: string; connectionId: string; prompt: string;
  purpose: 'execution' | 'discussion'; sourceSessionId?: string;
}
export interface RuntimeReceipt { runId: string; sessionId: string; connectionId: string; acceptedAt: string }
export interface RuntimeEvent {
  id: string; sequence: number; at: string; runId: string; sessionId: string;
  status?: 'queued' | 'running' | 'waiting_reply' | 'waiting_permission' | 'paused' | 'done' | 'failed' | 'cancelled';
  reply?: { id: string; text: string }; step?: Step | null; tokens?: number | null;
  reason?: string; error?: string; requestResolved?: string;
  request?: { id: string; kind: 'reply' | 'question' | 'permission'; prompt: string; options?: string[]; questions?: unknown; targetSessionId?: string };
  child?: { id: string; parentId?: string; title: string; status: 'queued' | 'running' | 'paused' | 'cancelled' | 'done' | 'failed'; start?: string; end?: string; tokens?: number | null; sessionId?: string; reply?: string };
}
export interface ObservedRuntimeSession {
  sessionId: string; connectionId: string; title: string; updatedAt: string; startedAt?: string;
  status?: SessionStatus; tokens?: number | null; replies?: { id: string; text: string; at: string }[];
}
export type RuntimeRunRecord = RuntimeReceipt & Partial<RuntimeRunInput> & { acceptance?: 'acknowledged' | 'unknown' | 'rejected'; status?: RuntimeEvent['status']; events?: RuntimeEvent[] };
export interface RuntimeDriver {
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
  dispatchId: string; runId?: string; acceptedAt?: string; projectId: string; taskId: string; workItemId?: string; attemptId?: string;
  connection: RuntimeConnectionBinding; purpose: 'execution' | 'discussion'; planId?: string; scope?: string;
  context: { taskTitle: string; prompt: string; planVersion?: number; capturedAt: string };
  sequence: number; eventIds: string[]; request?: RuntimeEvent['request'];
  requests?: Record<string, NonNullable<RuntimeEvent['request']>>;
  controlPending?: RuntimeAction; disconnected?: boolean;
  usageSamples?: { at: string; tokens: number; delta: number | null }[];
}
export interface RuntimeCommands {
  bindRuntimeConnection(agentId: string, connection: RuntimeConnectionBinding): Promise<{ ok: boolean; message?: string }>;
  startDiscussion(planId: string, agentId?: string, scope?: string): Promise<{ ok: boolean; message?: string; sessionId?: string }>;
  controlSession(sessionId: string, action: RuntimeAction, payload?: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  syncRuntime(): Promise<{ ok: boolean; message?: string }>;
  prepareSourceSession(sessionId: string): Promise<{ ok: boolean; message?: string; runId?: string }>;
}
export type RuntimeProjectMutation = (snapshot: Snapshot) => void;
