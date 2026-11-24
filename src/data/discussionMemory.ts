import { hashText, stableContent } from './contentHash';
import type { CollaborationArtifact } from './collaboration';
import { projectMemoryNotes, type ProjectMemoryNote } from './projectMemoryNotes';
import type { Snapshot } from './types';

export interface ProvidedLesson {
  note: ProjectMemoryNote;
  source?: CollaborationArtifact;
  followUpAt?: string;
}

/** A historical read of what the transport acknowledged. Never run today's recommender here. */
export function discussionMemory(snapshot: Snapshot, sessionId: string | undefined, planId: string, scope: string, through?: string): ProvidedLesson[] {
  const rt = sessionId ? snapshot.sessions[sessionId]?.runtime : undefined;
  if (rt?.purpose !== 'discussion' || rt.planId !== planId || (rt.scope ?? 'root') !== scope) return [];
  return providedSessionMemory(snapshot, sessionId, through);
}

export function providedSessionMemory(snapshot: Snapshot, sessionId?: string, through?: string): ProvidedLesson[] {
  const session = sessionId && snapshot.sessions[sessionId];
  if (!session || session.dispatchPhase !== 'acknowledged' || !session.source?.sessionId) return [];
  const rt = session.runtime, ledger = snapshot.collaboration;
  if (!ledger || !rt || rt.projectId !== snapshot.project.id) return [];

  const binding = rt.collaboration;
  if (!binding || binding.projectId !== snapshot.project.id || binding.taskId !== session.taskId ||
      binding.taskId !== rt.taskId || binding.workItemId !== rt.workItemId) return [];
  const key = binding.workItemId ? binding.taskId + '::' + binding.workItemId : binding.taskId;
  if (rt.purpose === 'discussion' && key !== `planning:${rt.planId}:${rt.scope ?? 'root'}:${rt.context.planVersion}`) return [];
  const run = ledger.runs[binding.runId];
  const pack = ledger.contextPackages.find(candidate => candidate.id === binding.contextPackageId);
  if (!pack || pack.key !== key || pack.runId !== binding.runId || run?.sessionId !== session.id || run.contextPackageId !== pack.id) return [];

  // The start of a send is not a delivery receipt. Older follow-ups without an
  // acknowledgement time can be shown at session level, but never dated to a reply.
  const cutoff = through === undefined ? undefined : Date.parse(through);
  const wasReceived = (at: string | undefined) => cutoff === undefined || (!!at && Date.parse(at) <= cutoff);
  if (!wasReceived(rt.acceptedAt)) return [];
  const batches = [
    { pins: pack.memoryLessons, followUpAt: undefined },
    ...Object.values(rt.controlDeliveries ?? {})
      .filter(receipt => receipt.status === 'sent' && receipt.memoryLessons?.length && wasReceived(receipt.sentAt))
      .map(receipt => ({ pins: receipt.memoryLessons, followUpAt: receipt.sentAt ?? receipt.at }))
      .sort((a, b) => a.followUpAt.localeCompare(b.followUpAt)),
  ];
  const rows = new Map<string, ProvidedLesson>();
  for (const batch of batches) {
    for (const pin of batch.pins ?? []) {
      if (rows.has(pin.id)) continue;
      const note = ledger.memoryNotes?.find(n => n.id === pin.id && n.projectId === snapshot.project.id && n.revision === pin.revision && n.hash === pin.hash);
      if (!note || note.status !== 'confirmed' || (pin.sourceArtifactId && pin.sourceArtifactId !== note.source.artifactId)) continue;
      const { hash, ...content } = note;
      if (hashText(stableContent(content)) !== hash) continue;
      const source = ledger.artifacts.find(a => a.id === note.source.artifactId && a.hash === note.source.hash && a.key === note.source.taskKey);
      rows.set(pin.id, { note, source, followUpAt: batch.followUpAt });
    }
  }
  return [...rows.values()];
}

/** An open provider conversation still contains its previous turns after their evidence changes. */
export function obsoleteSessionLessonNotice(snapshot: Snapshot, sessionId: string): string {
  const received = providedSessionMemory(snapshot, sessionId);
  if (!received.length) return '';
  const effectiveHashes = new Set(projectMemoryNotes(snapshot)
    .filter(note => note.status === 'confirmed' && !note.stale)
    .map(note => note.hash));
  const obsolete = received.filter(({ note }) => !effectiveHashes.has(note.hash));
  if (!obsolete.length) return '';
  if (obsolete.length > 5)
    return `\n\n先前提供的项目经验中有 ${obsolete.length} 个版本已失效。请仅使用本轮重新提供且来源可核对的项目经验。`;
  const ids = obsolete.map(({ note }) => note.id).join('、');
  return `\n\n先前提供的项目经验版本 ${ids} 已失效。请停止依据这些版本执行或引用，重新核对当前来源。`;
}
