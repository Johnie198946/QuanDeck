import { taskConnection } from './taskSourceDirectory';
import { sharedDecisionPins, sharedDecisionPinsCurrent } from './sharedDecisions';
import type { Session, Snapshot } from './types';
import { isCollaborationArtifactFresh, taskDependencyReady, taskKey } from './collaboration';
import { goalDeliveryReadiness, goalDependencySource } from './goalDelivery';

export interface ContextRestart { available: boolean; reason: string }
/** Fixed input is immutable. This projection offers a new attempt, never rewrites an old run. */
export function inspectContextRestart(snapshot: Snapshot, session: Session): ContextRestart | undefined {
  const rt=session.runtime,b=rt?.collaboration,c=snapshot.collaboration;
  if(!rt||rt.purpose!=='execution'||!b||!c)return;
  const context=c.contextPackages.find(v=>v.id===b.contextPackageId);
  if(!context || sharedDecisionPinsCurrent(snapshot,context.key,context.sharedDecisionPins) && !context.sources.some(source=>{
    const artifact=c.artifacts.find(v=>v.id===source.id);
    return !artifact||artifact.hash!==source.hash||!isCollaborationArtifactFresh(snapshot,source.id)||
      !(c.tasks[artifact.key]?.acceptedArtifactId===artifact.id&&!c.tasks[artifact.key]?.requiresRevalidation)&&
      !(source.freshness==='candidate'&&goalDependencySource(snapshot,context.key,artifact.key,false)?.id===source.id);
  }))return;
  const unavailable=(reason:string):ContextRestart=>({available:false,reason});
  if(rt.handedOffTo)return unavailable('已有新的执行记录，请打开接手后的会话；受理未知时先核对，不能重复派发。');
  if(session.origin!=='dispatch'||session.dispatchPhase!=='acknowledged'||rt.controlPending)return unavailable('原执行受理或控制回执尚未确认，请先核对源会话。');
  if(Object.keys(rt.requests??{}).length||rt.request)return unavailable('请先处理原会话的权限或问题，再停止原执行。');
  if(rt.stoppedConfirmed!==true||!['paused','failed','cancelled'].includes(session.status))return unavailable('固定资料已更新，请先停止原执行并等待确认，再使用最新资料重新执行。');
  const key=taskKey(b.taskId,b.workItemId),task=c.tasks[key],run=c.runs[b.runId];
  if(!task||!run||task.archived||task.owner!=='agent'||task.activeRunId!==b.runId||task.claimEpoch!==b.claimEpoch||task.specRevision!==b.specRevision||['done','cancelled','in_review'].includes(task.status)||['succeeded','failed','cancelled','lost'].includes(run.status))return unavailable('任务要求、验收或执行权已变化，请从当前任务创建新的受管执行。');
  const delivery=goalDeliveryReadiness(snapshot,key);
  if(delivery.applicable&&!delivery.current)return unavailable('方向或执行计划已变化，请先确认当前方向。');
  if(task.dependencies.some(dep=>!taskDependencyReady(snapshot,key,dep)))return unavailable('前置成果尚未补齐或未获准引用，请先处理前置任务。');
  if(Object.values(c.externalActions).some(action=>action.key===key&&['dispatched','unknown'].includes(action.status)))return unavailable('上次外部操作的结果尚未确认，请先核对，避免重复执行。');
  const connection=taskConnection(snapshot,rt.taskId,session.agentId,rt.workItemId);
  if(!connection||connection.connectionId!==rt.connection.connectionId||connection.projectPath!==rt.connection.projectPath||connection.tool!==rt.connection.tool||connection.capabilities?.dispatch===false)return unavailable('原 Agent 连接已变化，请先恢复并检测连接。');
  return {available:true,reason:'前置资料已更新。将保留原执行和成果，使用当前要求与最新有效资料创建新执行；原权限不会转移。'};
}
/** Used across asynchronous preflight; source, direction, task and connection changes require a fresh click. */
export function contextRestartFingerprint(snapshot:Snapshot,session:Session):string {
  const rt=session.runtime!,b=rt.collaboration!,c=snapshot.collaboration!,key=taskKey(b.taskId,b.workItemId);
  const context=c.contextPackages.find(v=>v.id===b.contextPackageId),task=c.tasks[key];
  const sourceKeys=new Set([...task.dependencies,...(context?.sources.map(s=>c.artifacts.find(a=>a.id===s.id)?.key).filter((k):k is string=>!!k)??[])]);
  const plans=Object.values(c.goalPlans??{}).flatMap(versions=>versions.at(-1)?[versions.at(-1)!]:[]).filter(p=>p.tasks.some(t=>t.key===key));
  return JSON.stringify({binding:b,task,sharedDecisions:sharedDecisionPins(snapshot,key),connection:taskConnection(snapshot,rt.taskId,session.agentId,rt.workItemId),context,
    upstream:[...sourceKeys].map(k=>{const t=c.tasks[k];return [k,t?.status,t?.latestSubmissionId,t?.acceptedArtifactId,t?.requiresRevalidation];}),
    sources:c.artifacts.filter(a=>sourceKeys.has(a.key)).map(a=>[a.id,a.hash,c.freshness[a.id]]),plans,
    authorization:plans.map(p=>{const a=c.goalAutomation?.[p.id];return [p.id,a?.enabled,a?.version,a?.draftVersion,a?.planVersion];}),
    directions:plans.map(p=>[p.id,snapshot.ideaPlans?.[p.id]?.draftVersion,snapshot.ideaPlans?.[p.id]?.adopted?.draftVersion])});
}
