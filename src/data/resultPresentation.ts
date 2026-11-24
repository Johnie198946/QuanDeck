import { completedResults, executionDrafts, type ResultRecord } from './results';
import { listIntegrationSources } from './resultIntegration';
import type { Snapshot } from './types';

export interface PresentedResult {
  record: ResultRecord;
  status: '待核对' | '已确认' | '已提交' | '执行回报' | '需重新核对';
  sessionId?: string;
  runId?: string;
  inlineAttachments?: ResultRecord['attachments'];
}

/** Published is a storage state, not evidence of acceptance. Source runs come only from saved bindings. */
export function presentResult(snapshot: Snapshot, taskId: string, record: ResultRecord, pending = false): PresentedResult {
  const artifact = record.outputId ? [...(snapshot.collaboration?.artifacts ?? [])].reverse().find(item =>
    item.outputId === record.outputId && item.body === record.text && snapshot.collaboration?.tasks[item.key]?.taskId === taskId,
  ) : undefined;
  const source = artifact ? listIntegrationSources(snapshot).find(item => item.artifactId === artifact.id) : undefined;
  const sessionId = source?.sessionId ?? record.sessionId;
  const session = sessionId ? snapshot.sessions[sessionId] : undefined;
  const runtime = session?.runtime;
  const bound = runtime?.projectId === snapshot.project.id && runtime.taskId === taskId && session?.taskId === taskId;
  const runId = source?.runtimeRunId ?? (bound ? runtime?.runId : undefined);
  const state = artifact && snapshot.collaboration?.tasks[artifact.key];
  const status = source?.eligible ? '已确认' : state?.acceptedArtifactId === artifact?.id && artifact ? '需重新核对' :
    pending || artifact && !artifact.legacy ? '待核对' : record.outputId ? '已提交' : '执行回报';
  return { record, status, sessionId, runId };
}

/** A submitted artifact and its transport reply are one delivery, not two. */
export function taskResultEntries(snapshot: Snapshot, taskId: string, itemId: string | null): PresentedResult[] {
  const saved = completedResults(snapshot, taskId, itemId).map(record => presentResult(snapshot, taskId, record));
  const drafts = executionDrafts(snapshot, taskId, itemId).filter(record => !saved.some(entry =>
    entry.sessionId === record.sessionId && entry.record.text === record.text,
  )).map(record => presentResult(snapshot, taskId, record, true));
  return [...saved, ...drafts].sort((a, b) => b.record.at.localeCompare(a.record.at));
}

export { resultExcerpt } from './resultExcerpt';
