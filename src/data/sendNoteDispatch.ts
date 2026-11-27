import type { WorkdeckDataSource, NoteTaskOrigin } from './repository';
import type { RuntimeCommands } from './runtimeContracts';
import type { NoteDispatchSettings } from './noteDispatchLogic';
import type { OutputAttachment, Snapshot } from './types';
import { canRetryDispatch } from './dispatchRecovery';

type Source = Pick<WorkdeckDataSource, 'createTaskWithAttachments' | 'listProjects'> & Partial<Pick<RuntimeCommands, 'dispatchProjectTask' | 'setTaskSourceDirectory'> & Pick<WorkdeckDataSource,'retryDispatch'>>;
interface Input {
  retry?: boolean;
  attachments?: OutputAttachment[];
  sourceDirectory?: string;
  projectId: string;
  text: string;
  origin: NoteTaskOrigin & {dispatch: NoteDispatchSettings};
}

function latestExecution(project: Snapshot | undefined, taskId: string) {
  return project?.tasks[taskId]?.sessionIds.slice().reverse().map(id => project.sessions[id])
    .find(session => session?.runtime?.purpose === 'execution' && !session.runtime.workItemId);
}

/** Persist the source and claim before invoking the same project-scoped agent command used in 帮你管. */
export async function sendNoteDispatch(api: Source, {projectId, text, origin, retry, attachments = [], sourceDirectory}: Input) {
  const claimed = await api.createTaskWithAttachments(text, attachments, projectId, sourceDirectory ? {...origin,sourceDirectory} : origin);
  if (!claimed.ok || !claimed.taskId) return claimed;
  if (claimed.dispatchMode === 'joined' || claimed.dispatchMode === 'conflict') return claimed;
  if (!claimed.dispatchMode) return {...claimed, ok:false, message:'项目服务未返回分工信息，任务已保存。请打开任务核对后再分派。'};
  const {taskId} = claimed;
  try {
    const snapshot = (await api.listProjects()).find(s => s.project.id === projectId);
    if (!snapshot?.tasks[taskId]) return {...claimed, ok:false, message:'任务已保存，项目资料已变化，请在帮你管核对。'};
    const prior = latestExecution(snapshot, taskId);
    const mayRetry = async () => {
      const latest = (await api.listProjects()).find(project => project.project.id === projectId);
      if (!latest?.tasks[taskId]) return false;
      const session = latestExecution(latest, taskId);
      return !session || canRetryDispatch(session);
    };
    if (prior) {
      if (canRetryDispatch(prior)) {
        if (retry && api.retryDispatch) {
          const receipt = await api.retryDispatch(prior.id);
          return {...claimed, ...receipt, retryable: !receipt.ok && await mayRetry(),
            message: receipt.message || (receipt.ok ? '已重新派发原任务。' : '原任务重试未成功。')};
        }
        return {...claimed,ok:false,retryable:true,message:prior.failure || '原任务已保留，上次执行已停止，可以重试。'};
      }
      if (prior.status === 'paused' || prior.status === 'failed' || prior.status === 'cancelled') {
        return {...claimed,ok:false,message:prior.failure || '请在原任务核对执行状态后继续。'};
      }
      if (prior.dispatchPhase !== 'acknowledged') return {...claimed,ok:false,message:'已保留原任务，尚未确认受理。请在任务中查看派发状态。'};
      if (prior.status === 'waiting_permission') return {...claimed,ok:false,message:'原任务正在等待工具授权，可在任务中处理。'};
      return {...claimed,message:'已有执行记录，已关联原任务。'};
    }
    if (!api.dispatchProjectTask) return {...claimed,ok:false,message:'任务已保存。请在桌面版连接 Agent 后重试。'};
    const agentId = snapshot.tasks[taskId].noteWork?.agentId || origin.dispatch.agentId;
    if (sourceDirectory) {
      let binding;
      try {
        binding = await api.setTaskSourceDirectory?.(projectId,taskId,agentId,sourceDirectory);
      } catch (error) {
        return {...claimed,ok:false,retryable:true,message:'任务已保存，源码文件夹绑定失败。' + (error instanceof Error ? error.message : '请重试。')};
      }
      if (!binding?.ok) return {...claimed,ok:false,retryable:true,message:binding?.message || '任务已保存，源码文件夹尚未绑定，请重试。'};
    }
    const sent = await api.dispatchProjectTask(projectId, taskId, agentId);
    const message = [claimed.dispatchMode === 'split' ? claimed.message : '', sent.ok ? (sent.message || '已派发给 Agent。') : '任务已保存。' + (sent.message || '连接失败，可在任务中重试。')].filter(Boolean).join(' ');
    return {...claimed, ...sent, retryable: !sent.ok && await mayRetry(), message};
  } catch (error) {
    return {...claimed,ok:false,message:'任务已保存，请在任务中查看派发状态。' + (error instanceof Error ? error.message : '')};
  }
}
