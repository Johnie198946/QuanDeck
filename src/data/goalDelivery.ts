import type { CollaborationArtifact, CollaborationState, CollaborationSubmission } from './collaboration';
import { isCollaborationArtifactFresh, activeExecutionAncestor } from './collaboration';
import type { IdeaPlan, PlanSection, Snapshot } from './types';

export interface DeliverySlotDraft { id: string; title: string; taskKey: string; description?: string; parentId?: string }
export interface GoalTaskBinding { key: string; taskId: string; workItemId?: string; draftKey: string; parentKey?: string; specRevision: number }
export interface DeliverySlot extends DeliverySlotDraft { planId: string; taskId: string; workItemId?: string }
export interface GoalPlanVersion { id: string; title: string; scope: 'project'|'task'; taskId: string; version: number; draftVersion: number; at: string; tasks: GoalTaskBinding[]; slots: DeliverySlot[]; retainedFromVersion?: number }
export interface GoalAutomation {
  planId: string; planVersion: number; draftVersion: number; enabled: boolean; agentId: string; version: number; at: string;
  attempts: Record<string,{state:'reserved'|'sent'|'failed'|'unknown'; at:string; sessionId?:string; error?:string}>;
  decomposition?:{state:'reserved'|'sent'|'failed'|'unknown';at:string;sessionId?:string;error?:string;closeState?:'pending'|'stopped'|'unknown'};
}
export type GoalAutomationInput = {enabled:boolean;agentId?:string;expectedDraftVersion:number;executionIntent?:{text:string;sourceSessionId:string}};
export interface DeliverySlotView extends DeliverySlot {
  state:'empty'|'running'|'blocked'|'candidate'|'accepted'|'changes_requested'|'stale';
  missingReason?:string; artifact?:CollaborationArtifact; submissionId?:string; sourceSessionId?:string;
}
export const projectDirectionId = (projectId:string) => `project-plan-${projectId}`;
export const latestGoalPlan = (snapshot:Snapshot,planId:string) => snapshot.collaboration?.goalPlans?.[planId]?.at(-1);
export function readPlanOutline(value:unknown):PlanSection[]|undefined {
  if(value===undefined)return;
  if(!Array.isArray(value)||value.length>40)throw Error('方向大纲格式无效');
  const ids=new Set<string>();
  return value.map((s:any)=>{
    if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||!['key','body'].includes(s.kind)||typeof s.title!=='string'||!Array.isArray(s.lines)||s.lines.length>100)throw Error('方向章节无效');
    ids.add(s.id);
    return {id:s.id,title:s.title.slice(0,200),kind:s.kind,lines:s.lines.map((l:any)=>{
      if(!l||typeof l.id!=='string'||!l.id||ids.has(l.id)||typeof l.text!=='string'||l.text.length>20000||!['fixed','tentative','open'].includes(l.state))throw Error('方向段落无效');
      ids.add(l.id);return {id:l.id,text:l.text,state:l.state};
    })};
  });
}
export function readDeliverySlots(value:unknown):DeliverySlotDraft[]|undefined {
  if(value===undefined)return;
  if(!Array.isArray(value)||value.length>100)throw Error('交付结构格式无效');
  const slots:DeliverySlotDraft[]=value.map((s:any)=>{
    if(!s||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(s.id)||typeof s.title!=='string'||!s.title.trim()||typeof s.taskKey!=='string'||!s.taskKey)throw Error('交付槽必须有标识、标题与任务键');
    return {id:s.id,title:s.title.slice(0,200),taskKey:s.taskKey,...(typeof s.description==='string'?{description:s.description.slice(0,2000)}:{}),...(typeof s.parentId==='string'?{parentId:s.parentId}:{})};
  });
  const keys=new Map(slots.map(s=>[s.id,s]));if(keys.size!==slots.length)throw Error('交付槽标识重复');
  for(const s of slots){const seen=new Set([s.id]);let parent=s.parentId;while(parent){if(seen.has(parent)||!keys.has(parent))throw Error('交付槽层级无效');seen.add(parent);parent=keys.get(parent)!.parentId;}}
  return slots;
}
export function ensureProjectDirection(snapshot:Snapshot):string {
  const id=projectDirectionId(snapshot.project.id);snapshot.ideaPlans??={};
  snapshot.ideaPlans[id]??={id,scope:'project',taskId:'',itemId:null,title:snapshot.project.name,script:'generic',step:0,round:0,draftVersion:1,adopted:null,turns:[],drafts:[],draft:{sections:[{id:'s-goal',title:'项目目标',kind:'key',lines:[{id:`${id}-goal`,text:snapshot.project.description||snapshot.project.name,state:'fixed',userEdited:true}]},{id:'s-outline',title:'方向与交付结构',kind:'body',lines:[]}]},discussion:{agentId:snapshot.defaultAgent,conclusions:[]}};
  return id;
}
function currentSubmission(c:CollaborationState,key:string){const task=c.tasks[key];return c.submissions.find(s=>s.id===task?.latestSubmissionId&&s.key===key&&s.specRevision===task.specRevision);}
/** Completion claims are separate from the existence of a saved candidate. Explicit [] means no slot delivered. */
export function goalDeliveryReadiness(snapshot:Snapshot,key:string,artifact?:CollaborationArtifact,submission?:CollaborationSubmission) {
  const c=snapshot.collaboration,task=c?.tasks[key];
  const plans=Object.values(c?.goalPlans??{}).flatMap(v=>v.at(-1)?[v.at(-1)!]:[]).filter(p=>p.tasks.some(t=>t.key===key&&t.specRevision===task?.specRevision));
  submission??=c?currentSubmission(c,key):undefined;
  artifact??=submission&&c?.artifacts.find(a=>a.id===submission!.artifactId&&a.key===key);
  const slots=[...new Map(plans.flatMap(p=>p.slots.filter(s=>s.taskKey===key)).map(s=>[s.id,s])).values()];
  const unresolved=submission?.unresolved??[];
  const missingSlots=slots.filter(slot=>!artifact||!(artifact.deliverySlotIds?.includes(slot.id)||(artifact.deliverySlotIds===undefined&&slots.length===1&&!unresolved.length)));
  const applicable=plans.length>0;
  const current=applicable&&plans.every(plan=>{
    const direction=snapshot.ideaPlans?.[plan.id],authorization=c?.goalAutomation?.[plan.id];
    return direction?.draftVersion===plan.draftVersion&&direction.adopted?.draftVersion===plan.draftVersion&&(!authorization||authorization.planVersion===plan.version&&authorization.draftVersion===plan.draftVersion);
  });
  const complete=!!artifact&&(!applicable||(!missingSlots.length&&!unresolved.length));
  const partial=applicable&&!!artifact&&!complete;
  const reason=partial?[unresolved.length?unresolved.join('；'):'',missingSlots.length?'尚未交付：'+missingSlots.map(s=>s.title).join('、'):''].filter(Boolean).join('；'):undefined;
  return {applicable,current,complete,partial,reason,missingSlots,unresolved,artifact,submission};
}
/** A candidate is usable only inside the exact version explicitly authorized by the user. */
export function goalDependencySource(snapshot:Snapshot,targetKey:string,sourceKey:string,requireEnabled=true):CollaborationArtifact|undefined {
  const c=snapshot.collaboration;if(!c)return;
  const authorized=Object.values(c.goalAutomation??{}).some(a=>{
    const plan=latestGoalPlan(snapshot,a.planId),direction=snapshot.ideaPlans?.[a.planId];
    return (!requireEnabled||a.enabled)&&plan?.version===a.planVersion&&direction?.draftVersion===a.draftVersion&&direction.adopted?.draftVersion===direction.draftVersion&&plan.tasks.some(t=>t.key===targetKey&&c.tasks[t.key]?.specRevision===t.specRevision)&&plan.tasks.some(t=>t.key===sourceKey&&c.tasks[t.key]?.specRevision===t.specRevision);
  });
  if(!authorized)return;
  const task=c.tasks[sourceKey],submission=currentSubmission(c,sourceKey);if(!submission||!['in_review','done'].includes(task.status)||task.requiresRevalidation||!goalDeliveryReadiness(snapshot,sourceKey).complete)return;
  const review=[...c.reviews].reverse().find(r=>r.submissionId===submission.id);if(review?.verdict==='needs_changes')return;
  const artifact=c.artifacts.find(a=>a.id===submission.artifactId&&a.key===sourceKey);
  return artifact&&isCollaborationArtifactFresh(snapshot,artifact.id)?artifact:undefined;
}
export function deriveDeliveryMap(snapshot:Snapshot,filter:{planId?:string;taskId?:string}={}) {
  const c=snapshot.collaboration;
  const plans=Object.values(c?.goalPlans??{}).flatMap(versions=>versions.length?[versions.at(-1)!]:[]).filter(p=>(!filter.planId||p.id===filter.planId)&&(!filter.taskId||p.taskId===filter.taskId||p.tasks.some(t=>t.taskId===filter.taskId))).map(p=>({...p,approved:snapshot.ideaPlans?.[p.id]?.adopted?.draftVersion===p.draftVersion&&snapshot.ideaPlans?.[p.id]?.draftVersion===p.draftVersion}));
  const slots:DeliverySlotView[]=plans.flatMap(plan=>plan.slots.filter(slot=>!filter.taskId||slot.taskId===filter.taskId).map(slot=>{
    const task=c?.tasks[slot.taskKey],binding=plan.tasks.find(t=>t.key===slot.taskKey),submission=c&&currentSubmission(c,slot.taskKey);
    const artifact=submission&&c?.artifacts.find(a=>a.id===submission.artifactId&&a.key===slot.taskKey);
    const review=submission&&[...(c?.reviews??[])].reverse().find(r=>r.submissionId===submission.id);
    const readiness=goalDeliveryReadiness(snapshot,slot.taskKey);
    const matching=!!artifact&&(artifact.deliverySlotIds?.includes(slot.id)||(artifact.deliverySlotIds===undefined&&plan.slots.filter(s=>s.taskKey===slot.taskKey).length===1&&!submission?.unresolved.length));
    const stale=!plan.approved||!task||task.archived||task.specRevision!==binding?.specRevision||!!task.requiresRevalidation||!!artifact&&!isCollaborationArtifactFresh(snapshot,artifact.id);
    let state:DeliverySlotView['state']=review?.verdict==='needs_changes'?'changes_requested':stale?'stale':matching&&readiness.unresolved.length?'blocked':matching?(task?.acceptedArtifactId===artifact?.id&&review?.verdict==='accepted'?'accepted':'candidate'):task?.status==='running'?'running':['blocked','paused','failed','waiting_input','waiting_permission'].includes(task?.status??'')?'blocked':'empty';
    const session=artifact?.runId?Object.values(snapshot.sessions).find(s=>s.runtime?.collaboration?.runId===artifact.runId&&s.runtime?.collaboration?.projectId===snapshot.project.id&&s.runtime?.collaboration?.taskId===slot.taskId&&(s.runtime?.collaboration?.workItemId??undefined)===(slot.workItemId??undefined)):undefined;
    const reason=readiness.partial?'部分进展已保存；'+readiness.reason:state==='empty'?matching?undefined:'尚未收到此交付槽的成果':state==='stale'?'方向、任务要求或引用已变化':state==='changes_requested'?'成果已退回，需要修改':state==='blocked'?task?.blockReason||'等待前置成果或用户处理':undefined;
    return {...slot,state,missingReason:reason,sourceSessionId:session?.id,...(matching?{artifact,submissionId:submission!.id}:{})};
  }));
  const filled=slots.filter(s=>['candidate','accepted'].includes(s.state)).length;
  return {plans,slots,total:slots.length,filled,accepted:slots.filter(s=>s.state==='accepted').length,assembly:(!filled?'empty':filled===slots.length?'assembled':'partial') as 'empty'|'partial'|'assembled'};
}
export function deriveGoalAutomation(snapshot:Snapshot,planId:string) {
  const a=snapshot.collaboration?.goalAutomation?.[planId],plan=latestGoalPlan(snapshot,planId),direction=snapshot.ideaPlans?.[planId],c=snapshot.collaboration;
  const bindings=plan?.tasks??[];
  const map=deriveDeliveryMap(snapshot,{planId});
  const completed=bindings.filter(b=>!!c&&!!currentSubmission(c,b.key)&&['in_review','done'].includes(c.tasks[b.key]?.status)&&goalDeliveryReadiness(snapshot,b.key).complete).length;
  let status:'off'|'ready'|'running'|'paused'|'blocked'|'assembled'|'outdated'='off',blockedReason:string|undefined;
  if(a?.enabled&&!plan){
    const session=a.decomposition?.sessionId?snapshot.sessions[a.decomposition.sessionId]:undefined;
    if(a.draftVersion!==direction?.draftVersion||direction.adopted?.draftVersion!==direction.draftVersion){status='outdated';blockedReason='方向已更新，请确认当前版本后重新开启';}
    else if(['failed','unknown'].includes(a.decomposition?.state??'')||session&&['failed','paused','waiting_permission','waiting_reply'].includes(session.status)){status='paused';blockedReason='任务拆解需要处理，请查看原讨论会话';}
    else if(session?.status==='archived'){status='blocked';blockedReason='Agent 尚未交付有效任务结构，请在原讨论中补充';}
    else status=a.decomposition?'running':'ready';
  }
  if(a?.enabled&&plan){
    if(a.planVersion!==plan.version||a.draftVersion!==direction?.draftVersion||direction.adopted?.draftVersion!==direction.draftVersion||plan.tasks.some(t=>c?.tasks[t.key]?.specRevision!==t.specRevision)){status='outdated';blockedReason='方向或任务要求已更新，请确认当前版本后重新开启';}
    else if(a.decomposition?.closeState==='unknown'){status='paused';blockedReason='任务结构已保存，但尚未确认拆解会话已停止，请核对原会话';}
    else if(bindings.some(b=>['failed','paused','waiting_input','waiting_permission'].includes(c?.tasks[b.key]?.status??'')||['failed','unknown'].includes(a.attempts[b.key]?.state))){status='paused';blockedReason='执行遇到失败、授权或待回复，请先处理原会话';}
    else if(map.assembly==='assembled'&&completed===bindings.length){status='assembled';}
    else if(bindings.some(b=>['running','claimed'].includes(c?.tasks[b.key]?.status??'')||a.attempts[b.key]?.state==='reserved'))status='running';
    else if(bindings.some(b=>!a.attempts[b.key]&&!activeExecutionAncestor(snapshot,b.key)&&['ready','blocked'].includes(c?.tasks[b.key]?.status??'')&&(c?.tasks[b.key]?.dependencies??[]).every(dep=>!!goalDependencySource(snapshot,b.key,dep))))status='ready';
    else if(bindings.some(b=>!!activeExecutionAncestor(snapshot,b.key))){status='blocked';blockedReason='上级任务仍有整项执行；请先处理原会话的授权或停止旧执行，避免与拆分任务重复工作';}
    else {status='blocked';blockedReason=completed===bindings.length?'任务已交付，但仍有交付槽缺少明确绑定':'等待前置成果或人工任务';}
  }
  return {enabled:!!a?.enabled,status,completed,total:bindings.length,blockedReason,nextAction:status==='outdated'?'确认新版本后开启':status==='paused'?'查看待处理会话':status==='assembled'?'查看候选成果，按需验收':status==='off'?'确认方向并开启自动执行':status==='blocked'?'查看缺失交付':'按依赖自动推进'};
}
