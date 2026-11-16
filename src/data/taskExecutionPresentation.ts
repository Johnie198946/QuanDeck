import { taskSessions } from './derive';
import { deriveProjectActivity, type ProjectActivityEntry } from './projectActivity';
import { executionProgress, sessionProgress, type ExecutionProgress } from './executionProgress';
import type { Session, Snapshot } from './types';

export interface TaskExecutionRow {
  id: string;
  title: string;
  agentId?: string;
  sessionId?: string;
  entry?: ProjectActivityEntry;
  progress: ExecutionProgress | null;
}
const newest = (a: Session, b: Session) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') || a.id.localeCompare(b.id);

/** One read-only scope for inline progress, source navigation and the reply excerpt.
 * Active child work uses the same projection as the execution rail. Root-only sessions
 * remain historical evidence rather than masquerading as the child's current state.
 */
export function taskExecutionPresentation(snapshot: Snapshot, taskId: string) {
  const task = snapshot.tasks[taskId];
  const roots = task ? taskSessions(snapshot, task) : [];
  const activity = deriveProjectActivity(snapshot).entries.filter(entry => entry.taskId === taskId);
  const hasChildActivity = activity.some(entry => !!entry.itemId || !!entry.subAgentId);
  const rows: TaskExecutionRow[] = hasChildActivity
    ? activity.map(entry => ({ id: entry.id, title: entry.title, agentId: entry.agentId, sessionId: entry.sessionId, entry, progress: executionProgress(entry.state, entry.step, entry.percent) }))
    : roots.filter(session => !session.linkedAsHistory && !['archived', 'cancelled'].includes(session.status)).sort(newest)
      .map(session => ({ id: session.id, title: session.title, agentId: session.agentId, sessionId: session.id, progress: sessionProgress(session) }));
  const candidates = rows.flatMap(row => row.sessionId && snapshot.sessions[row.sessionId] ? [{ row, session: snapshot.sessions[row.sessionId] }] : []);
  candidates.sort((a, b) => newest(a.session, b.session));
  const selected = candidates[0];
  // Do not substitute an old parent reply when a child has not replied or has no local session.
  const primarySession = selected?.session ?? (!hasChildActivity ? [...roots].sort(newest)[0] : undefined);
  const primaryTitle = selected?.row.title ?? primarySession?.title;
  return { hasChildActivity, rows, primarySession, primaryTitle };
}
