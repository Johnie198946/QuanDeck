import { completedResults, executionDrafts, type ResultRecord } from './results';
import { listIntegrationSources } from './resultIntegration';
import type { Snapshot } from './types';
import { taskKey } from './collaboration';

export interface PresentedResult {
  record: ResultRecord;
  artifactId?: string;
  status: '待核对' | '已确认' | '已提交' | '执行回报' | '需重新核对';
  sessionId?: string;
  runId?: string;
  inlineAttachments?: ResultRecord['attachments'];
}

/** Published is a storage state, not evidence of acceptance. Source runs come only from saved bindings. */
export function presentResult(snapshot: Snapshot, taskId: string, record: ResultRecord, pending = false): PresentedResult {
  const key = taskKey(taskId, record.itemId);
  const artifact = record.artifactId
    ? snapshot.collaboration?.artifacts.find(item => item.id === record.artifactId && item.key === key)
    : record.outputId ? [...(snapshot.collaboration?.artifacts ?? [])].reverse().find(item =>
      item.key === key && item.outputId === record.outputId && item.body === record.text,
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
  return { record, artifactId: artifact?.id, status, sessionId, runId };
}

/** A submitted artifact and its transport reply are one delivery, not two. */
export function taskResultEntries(snapshot: Snapshot, taskId: string, itemId: string | null): PresentedResult[] {
  const candidates = executionDrafts(snapshot, taskId, itemId);
  const saved = completedResults(snapshot, taskId, itemId).map(record => {
    const archived = candidates.find(candidate => candidate.replyRoundId && candidate.sessionId === record.sessionId
      && candidate.at === record.at && candidate.text === record.text);
    // An execution that just closed is still the same reply already read in a note.
    return presentResult(snapshot, taskId, archived ? { ...record, id: archived.id, replyRoundId: archived.replyRoundId } : record);
  });
  const drafts = candidates.filter(record => !saved.some(entry =>
    (record.artifactId && entry.artifactId === record.artifactId) ||
    (entry.sessionId === record.sessionId && entry.record.text === record.text && (!record.replyRoundId || entry.record.at === record.at)),
  )).map(record => presentResult(snapshot, taskId, record, true));
  return [...saved, ...drafts].sort((a, b) => b.record.at.localeCompare(a.record.at));
}

export { resultExcerpt } from './resultExcerpt';
