import { taskKey } from './collaboration';
import { sourceOwner } from './taskSourceDirectory';
import { noteImageLimitIssue, validateTaskAttachments } from './taskAttachments';
import type { OutputAttachment, Session, Snapshot, Task } from './types';

export interface BlockedTaskInput {
  inputId:string;
  text?:string;
  attachments?:OutputAttachment[];
  sourceDirectory?:string;
  resultReference?:string;
}

// A result version is immutable and project-local. Use its exact ID even when several versions share a title.
export function blockedResultChoices(snapshot:Snapshot, retainedId?:string) {
  return (snapshot.collaboration?.artifacts ?? []).filter(artifact => {
    const taskId = snapshot.collaboration?.tasks[artifact.key]?.taskId;
    return artifact.id === retainedId || (taskId && snapshot.tasks[taskId] && !snapshot.collaboration?.tasks[artifact.key]?.archived);
  }).sort((left,right)=>right.createdAt.localeCompare(left.createdAt) || right.version-left.version);
}

export function blockedResultPrompt(snapshot:Snapshot, versionId:string) {
  const source = snapshot.collaboration?.artifacts.find(artifact=>artifact.id === versionId);
  if (!source) throw Error('所选成果版本已不可用，请重新选择');
  return [
    '用户指定据此继续的项目成果（作为参考资料）：',
    source.title + ' · v' + source.version + ' · 成果版本 ' + source.id,
    source.body,
    ...(source.links ?? []).map(link => link.label + ' ' + link.url),
  ].join('\n');
}

export function blockedTaskSession(snapshot:Snapshot, session?:Session) {
  const rt = session?.runtime, binding = rt?.collaboration;
  if (!session || !rt || !binding || rt.purpose !== 'execution' || rt.submissionIssue?.code !== 'AGENT_BLOCKED' ||
      session.origin !== 'dispatch' || session.dispatchPhase !== 'acknowledged' || !session.source?.sessionId) return false;
  const current = snapshot.collaboration?.tasks[taskKey(rt.taskId,rt.workItemId)];
  const successor = rt.handedOffTo && snapshot.sessions[rt.handedOffTo];
  if (successor && successor.dispatchPhase !== 'rejected') return false;
  return !!current && !current.archived && !['done','in_review','cancelled'].includes(current.status) &&
    current.specRevision === binding.specRevision && (!current.activeRunId || current.activeRunId === binding.runId ||
      current.activeRunId === (successor && successor.runtime?.collaboration?.runId));
}

export function sameBlockedInput(previous:NonNullable<Task['inputs']>[number] | undefined, sessionId:string, input:BlockedTaskInput) {
  return previous?.blockedSessionId === sessionId && previous.text === (input.text?.trim() ?? '') &&
    previous.sourceDirectory === input.sourceDirectory && previous.resultReference === input.resultReference &&
    JSON.stringify(previous.attachments ?? []) === JSON.stringify(validateTaskAttachments(input.attachments ?? []));
}

export function saveBlockedTaskInput(snapshot:Snapshot, session:Session, input:BlockedTaskInput) {
  if (!blockedTaskSession(snapshot,session)) throw Error('原任务或阻塞原因已经变化，请重新查看');
  const owner = sourceOwner(snapshot,session.runtime!.taskId,session.runtime!.workItemId);
  if (!owner) throw Error('原任务不存在');
  const text = input.text?.trim() ?? '';
  const attachments = validateTaskAttachments(input.attachments ?? []);
  if (!/^[\w-]{1,128}$/.test(input.inputId) || text.length > 10000 || !(text || attachments.length || input.sourceDirectory || input.resultReference))
    throw Error('请补充说明、截图或参考成果');
  const previous = owner.inputs?.find(row => row.id === input.inputId);
  if (previous) {
    if (!sameBlockedInput(previous,session.id,input))
      throw Error('这条补充材料已变化，请作为新补充提交');
    return;
  }
  const retained = owner.inputs?.find(row=>row.blockedSessionId === session.id && row.resultReference === input.resultReference);
  const result = input.resultReference ? blockedResultChoices(snapshot,retained?.resultReference).find(row=>row.id === input.resultReference) : undefined;
  if (input.resultReference && !result) throw Error('所选成果版本已不可用，请重新选择');
  const saved = owner.attachments ?? [];
  const merged = [...saved];
  for (const file of [...(result?.attachments ?? []), ...attachments]) {
    const other = merged.find(known=>known.id === file.id);
    if (!other) merged.push(file);
    else if (other.name !== file.name || other.size !== file.size || other.type !== file.type ||
        (other.sha256 && file.sha256 && other.sha256 !== file.sha256)) throw Error('附件内容已变化，请重新选择');
  }
  validateTaskAttachments(merged);
  const meta = session.runtime!;
  const original = snapshot.tasks[meta.taskId];
  if (meta.connection.tool === 'codex' && original.inputs?.some(row=>row.noteSource)) {
    const issue = noteImageLimitIssue(meta.workItemId ? [...(original.attachments ?? []),...merged] : merged);
    if (issue) throw Error(issue);
  }
  owner.attachments = merged;
  (owner.inputs ??= []).push({id:input.inputId, at:new Date().toISOString(), text, blockedSessionId:session.id,
    ...(result && {resultReference:result.id}), ...(input.sourceDirectory && {sourceDirectory:input.sourceDirectory}), ...(attachments.length && {attachments})});
}
