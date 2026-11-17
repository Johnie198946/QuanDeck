import type { Snapshot } from './types';
import { hashText, stableContent } from './contentHash';
import { contextSearchTerms, isCollaborationArtifactFresh } from './collaboration';

export interface ProjectMemoryNote {
  id: string;
  noteId: string;
  projectId: string;
  revision: number;
  at: string;
  author: string;
  status: 'candidate' | 'confirmed' | 'withdrawn';
  situation: string;
  action: string;
  outcome: string;
  limitation: string;
  source: { taskKey: string; artifactId: string; hash: string; reviewId: string };
  hash: string;
}

const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
const content = (value: unknown, name: string) => typeof value === 'string' && value.trim() && value.length <= 1000 ? value.trim() : fail('MEMORY_NOTE_INVALID', name + '需要 1–1000 字');

/** Human reflection is a business fact. It never changes a task, normative Spec or permission. */
export function recordProjectMemoryNote(snapshot: Snapshot, payload: Record<string, unknown>, author: string): ProjectMemoryNote {
  const c = snapshot.collaboration!;
  const previous = payload.noteId ? [...(c.memoryNotes ?? [])].reverse().find(item => item.noteId === payload.noteId) : undefined;
  if (payload.noteId && !previous) fail('NOT_FOUND', '经验记录不存在');
  if (previous && payload.expectedRevision !== previous.revision) fail('VERSION_CONFLICT', '经验记录已更新，请刷新后修改');
  if (!previous && payload.expectedRevision !== undefined) fail('VERSION_CONFLICT', '新经验不能携带历史版本');
  if (typeof payload.status !== 'string' || !['candidate', 'confirmed', 'withdrawn'].includes(payload.status)) fail('MEMORY_NOTE_INVALID', '经验状态无效');
  const status = payload.status as ProjectMemoryNote['status'];
  if (status === 'withdrawn' && !previous) fail('MEMORY_NOTE_INVALID', '只能撤回已有经验');
  const artifactId = status === 'withdrawn' ? previous!.source.artifactId : payload.artifactId;
  const artifact = c.artifacts.find(item => item.id === artifactId);
  const task = artifact ? c.tasks[artifact.key] : undefined;
  const submission = artifact ? c.submissions.find(item => item.artifactId === artifact.id) : undefined;
  const review = submission ? [...c.reviews].reverse().find(item => item.submissionId === submission.id) : undefined;
  if (status !== 'withdrawn' && (!artifact || !task || task.archived || task.acceptedArtifactId !== artifact.id || task.requiresRevalidation || !isCollaborationArtifactFresh(snapshot, artifact.id) || review?.verdict !== 'accepted')) fail('MEMORY_SOURCE_CHANGED', '请选择当前有效且已验收的成果作为经验依据');
  if (status !== 'withdrawn' && (payload.artifactHash !== artifact!.hash || hashText(artifact!.body) !== artifact!.hash)) fail('MEMORY_SOURCE_CHANGED', '经验来源版本已变化，请重新查看来源');
  const revision = (previous?.revision ?? 0) + 1;
  const noteId = previous?.noteId ?? 'memory-note:' + crypto.randomUUID();
  const note = { id: noteId + ':v' + revision, noteId, projectId: snapshot.project.id, revision,
    at: new Date().toISOString(), author, status,
    situation: status === 'withdrawn' ? previous!.situation : content(payload.situation, '适用情境'),
    action: status === 'withdrawn' ? previous!.action : content(payload.action, '做法'),
    outcome: status === 'withdrawn' ? previous!.outcome : content(payload.outcome, '结果'),
    limitation: status === 'withdrawn' ? previous!.limitation : content(payload.limitation, '限制与下次调整'),
    source: status === 'withdrawn' ? previous!.source : { taskKey: artifact!.key, artifactId: artifact!.id, hash: artifact!.hash, reviewId: review!.id } };
  const record = { ...note, hash: hashText(stableContent(note)) };
  (c.memoryNotes ??= []).push(record);
  return record;
}

export function projectMemoryNotes(snapshot: Snapshot) {
  const latest = new Map<string, ProjectMemoryNote>();
  for (const note of snapshot.collaboration?.memoryNotes ?? []) if (note.projectId === snapshot.project.id) latest.set(note.noteId, note);
  return [...latest.values()].map(note => {
    const { hash, ...body } = note;
    const c = snapshot.collaboration, artifact = c?.artifacts.find(item => item.id === note.source.artifactId);
    const task = c?.tasks[note.source.taskKey];
    const review = c?.reviews.find(item => item.id === note.source.reviewId);
    const submission = review && c?.submissions.find(item => item.id === review.submissionId);
    const stale = hashText(stableContent(body)) !== hash || !artifact || artifact.key !== note.source.taskKey || artifact.hash !== note.source.hash || hashText(artifact.body) !== note.source.hash || !task || task.archived || task.acceptedArtifactId !== artifact.id || task.requiresRevalidation || review?.verdict !== 'accepted' || submission?.artifactId !== artifact.id || !isCollaborationArtifactFresh(snapshot, artifact.id);
    return { ...note, stale: !!stale };
  });
}

/** Only explicitly confirmed, still valid, matching experience is optional reference. */
export function queryProjectLessons(snapshot: Snapshot, taskKey: string) {
  const task = snapshot.collaboration?.tasks[taskKey];
  if (!task) return [];
  const spec = snapshot.collaboration?.specs.find(item => item.key === taskKey && item.revision === task.specRevision);
  const query = (task.title + ' ' + (spec?.goal ?? '')).normalize('NFKC').toLocaleLowerCase();
  const terms = contextSearchTerms(query);
  return projectMemoryNotes(snapshot).filter(note => note.status === 'confirmed' && !note.stale &&
    (task.dependencies.includes(note.source.taskKey) || terms.some(term => (note.situation + ' ' + note.action).normalize('NFKC').toLocaleLowerCase().includes(term))))
    .sort((a,b) => a.noteId.localeCompare(b.noteId)).slice(0, 3);
}
