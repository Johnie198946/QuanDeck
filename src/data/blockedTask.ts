import { taskKey } from './collaboration';
import { sourceOwner } from './taskSourceDirectory';
import { validateTaskAttachments } from './taskAttachments';
import type { OutputAttachment, Session, Snapshot, Task } from './types';

export interface BlockedTaskInput {
  inputId:string;
  text?:string;
  attachments?:OutputAttachment[];
  sourceDirectory?:string;
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
    previous.sourceDirectory === input.sourceDirectory &&
    JSON.stringify(previous.attachments ?? []) === JSON.stringify(validateTaskAttachments(input.attachments ?? []));
}

export function saveBlockedTaskInput(snapshot:Snapshot, session:Session, input:BlockedTaskInput) {
  if (!blockedTaskSession(snapshot,session)) throw Error('原任务或阻塞原因已经变化，请重新查看');
  const owner = sourceOwner(snapshot,session.runtime!.taskId,session.runtime!.workItemId);
  if (!owner) throw Error('原任务不存在');
  const text = input.text?.trim() ?? '';
  const attachments = validateTaskAttachments(input.attachments ?? []);
  if (!/^[\w-]{1,128}$/.test(input.inputId) || text.length > 10000 || !(text || attachments.length || input.sourceDirectory))
    throw Error('请填写补充说明、添加附件或选择源码文件夹');
  const previous = owner.inputs?.find(row => row.id === input.inputId);
  if (previous) {
    if (!sameBlockedInput(previous,session.id,input))
      throw Error('这条补充材料已变化，请作为新补充提交');
    return;
  }
  const saved = owner.attachments ?? [];
  if (attachments.some(file => saved.some(other => other.id === file.id && (other.name !== file.name ||
      other.size !== file.size || other.type !== file.type)))) throw Error('附件内容已变化，请重新选择');
  const merged = [...saved,...attachments.filter(file => !saved.some(other => other.id === file.id))];
  validateTaskAttachments(merged);
  owner.attachments = merged;
  (owner.inputs ??= []).push({id:input.inputId, at:new Date().toISOString(), text, blockedSessionId:session.id,
    ...(input.sourceDirectory && {sourceDirectory:input.sourceDirectory}), ...(attachments.length && {attachments})});
}
