import type { WorkdeckDataSource, NoteTaskOrigin } from './repository';
import type { RuntimeCommands } from './runtimeContracts';
import type { NoteDispatchSettings } from './noteDispatchLogic';

type Source = Pick<WorkdeckDataSource, 'createTaskWithAttachments' | 'listProjects'> & Partial<Pick<RuntimeCommands, 'dispatchProjectTask'>>;
interface Input {
  projectId: string;
  text: string;
  origin: NoteTaskOrigin & {dispatch: NoteDispatchSettings};
}

/** Persist the source and claim before invoking the same project-scoped agent command used in 帮你管. */
export async function sendNoteDispatch(api: Source, {projectId, text, origin}: Input) {
  const claimed = await api.createTaskWithAttachments(text, [], projectId, origin);
  if (!claimed.ok || !claimed.taskId) return claimed;
  if (claimed.dispatchMode === 'joined' || claimed.dispatchMode === 'conflict') return claimed;
  if (!claimed.dispatchMode) return {...claimed, ok:false, message:'项目服务未返回分工信息，任务已保存。请打开任务核对后再分派。'};
  const {taskId} = claimed;
  try {
    const snapshot = (await api.listProjects()).find(s => s.project.id === projectId);
    if (!snapshot?.tasks[taskId]) return {...claimed, ok:false, message:'任务已保存，项目资料已变化，请在帮你管核对。'};
    const prior = [...snapshot.tasks[taskId].sessionIds].reverse().map(id=>snapshot.sessions[id])
      .find(session => session?.runtime?.purpose === 'execution' && !session.runtime.workItemId);
    if (prior) {
      if (prior.dispatchPhase === 'rejected' || ['failed','cancelled','paused'].includes(prior.status)) {
        return {...claimed,ok:false,message:'任务已保留，上次执行已停止。可在原任务查看原因并重试。'};
      }
      if (prior.dispatchPhase !== 'acknowledged') return {...claimed,ok:false,message:'已保留原任务，尚未确认受理。请在任务中查看派发状态。'};
      if (prior.status === 'waiting_permission') return {...claimed,ok:false,message:'原任务正在等待工具授权，可在任务中处理。'};
      return {...claimed,message:'已有执行记录，已关联原任务。'};
    }
    if (!api.dispatchProjectTask) return {...claimed,ok:false,message:'任务已保存。请在桌面版连接 Agent 后重试。'};
    const sent = await api.dispatchProjectTask(projectId, taskId, snapshot.tasks[taskId].noteWork?.agentId || origin.dispatch.agentId);
    const message = [claimed.dispatchMode === 'split' ? claimed.message : '', sent.ok ? (sent.message || '已派发给 Agent。') : '任务已保存。' + (sent.message || '连接失败，可在任务中重试。')].filter(Boolean).join(' ');
    return {...claimed,...sent,message};
  } catch (error) {
    return {...claimed,ok:false,message:'任务已保存，请在任务中查看派发状态。' + (error instanceof Error ? error.message : '')};
  }
}
