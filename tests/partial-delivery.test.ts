import { completedSessionDelivery } from '../src/data/sessionDelivery';
import { taskExecutionPresentation } from '../src/data/taskExecutionPresentation';
import { deriveProjectActivity } from '../src/data/projectActivity';
import assert from 'node:assert/strict';
import { workItemPresentation } from '../src/data/workItemPresentation';
import { canReplyToTask } from '../src/data/taskInput';
import { overviewProject, flattenOverview } from '../src/data/overviewTree';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { deriveDeliveryMap, deriveGoalAutomation, goalDependencySource, latestGoalPlan, goalDeliveryReadiness } from '../src/data/goalDelivery';
import { applyCollaboration, taskKey } from '../src/data/collaboration';
import { readPlanTasks } from '../src/data/projectWorkflow';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeRunRecord } from '../src/data/runtimeContracts';
const memory=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
class Driver implements RuntimeDriver {
  calls:RuntimeRunInput[]=[];records:RuntimeRunRecord[]=[];controls:{runId:string;action:string;payload?:Record<string,unknown>}[]=[];
  listener=(_e:RuntimeEvent)=>{};clock=Date.now()+1000;
  subscribe(fn:(e:RuntimeEvent)=>void){this.listener=fn;return()=>{};}
  async run(input:RuntimeRunInput){this.calls.push(input);const record:RuntimeRunRecord={...input,runId:`run-${this.calls.length}`,sessionId:`source-${this.calls.length}`,acceptedAt:new Date(this.clock++).toISOString(),acceptance:'acknowledged',status:'queued',events:[]};this.records.push(record);return record;}
  emit(record:RuntimeRunRecord,fields:Partial<RuntimeEvent>){const event:RuntimeEvent={...fields,id:`e-${record.runId}-${record.events!.length}`,sequence:record.events!.length,at:new Date(this.clock+=1000).toISOString(),runId:record.runId,sessionId:record.sessionId};record.events!.push(event);if(fields.status)record.status=fields.status;this.listener(event);}
  async control(runId:string,action:string,payload?:Record<string,unknown>){this.controls.push({runId,action,payload});if(action==='reply')this.emit(this.records.find(r=>r.runId===runId)!,{status:'running',...(typeof payload?.requestId==='string'?{requestResolved:payload.requestId}:{})});}
  scan=async()=>[];listRuns=()=>this.records;
}
async function main(){
  const base=new LocalWorkdeckDataSource(),driver=new Driver(),runtime=createRuntimeDataSource(base,driver);
  const projectId=(await runtime.createProject({name:'部分交付回归'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
  await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'partial-test',projectPath:'/partial-test'});
  const taskId=(await runtime.createTaskWithAttachments('页面重构',[],projectId)).taskId!;
  const planId=await runtime.ensureTaskPlan(taskId);
  const draft=(key:string,deps:string[]=[])=>({key,deps,title:key,expected:`可核对的 ${key}`,owner:'agent',phase:'执行'});
  await runtime.recordDiscussionConclusion(planId,'root',{summary:'定位后设计再开发',confirmed:[],open:[],tasks:readPlanTasks([draft('audit'),draft('design',['audit']),draft('develop',['design'])]),deliverables:[{id:'audit',title:'页面问题与功能清单',taskKey:'audit'},{id:'design',title:'界面设计',taskKey:'design'},{id:'code',title:'可运行代码',taskKey:'develop'}]});
  let snapshot=await runtime.load();
  const approval=await runtime.approvePlan(planId,snapshot.ideaPlans![planId].discussion!.conclusions.at(-1)!.id,projectId,1);assert(approval.ok,approval.message);
  assert((await runtime.configureGoalAutomation(planId,{enabled:true,agentId:'codex',expectedDraftVersion:approval.approvedDraftVersion!},projectId)).ok);
  await runtime.flushRuntime();snapshot=await runtime.load();
  const plan=latestGoalPlan(snapshot,planId)!,audit=plan.tasks.find(t=>t.draftKey.endsWith('-audit'))!,design=plan.tasks.find(t=>t.draftKey.endsWith('-design'))!;
  const record=driver.records[0],session=Object.values(snapshot.sessions).find(s=>s.runtime?.runId===record.runId)!;
  const binding=session.runtime!.collaboration!;
  const result=(key:string,slots:string[],unresolved:string[])=>({schemaVersion:'quandeck.runtime.v1',idempotencyKey:key,binding,kind:'result',payload:{title:'页面分析候选',body:'已梳理截图。源码级定位尚未完成，本次不声明该槽完整交付。',deliverySlotIds:slots,sourceIds:[],unresolved,nextSteps:['补齐来源后继续定位']}});
  // Same shape as the live failure: explicit empty slot claims and a source/verification blocker.
  const partial=result('partial',[],['缺少源码，尚未定位实际组件','尚未进行交互和响应式验证']);
  driver.emit(record,{status:'waiting_reply',turnCompleted:true,submission:partial});await runtime.flushRuntime();snapshot=await runtime.load();
  assert.equal(driver.calls.length,1,'partial result must not start the dependent design task');
  assert.equal(snapshot.collaboration!.submissions.length,1,'partial progress is retained as a real immutable submission');
  assert.equal(snapshot.collaboration!.tasks[audit.key].status,'paused');
  assert.equal(completedSessionDelivery(snapshot,snapshot.sessions[session.id]),undefined);
  assert(deriveProjectActivity(snapshot).entries.some(e=>e.sessionId===session.id&&e.state==='waiting_reply'),'partial work still needs the user');
  assert.equal(deriveDeliveryMap(snapshot).filled,0,'explicit [] keeps a single-slot map empty');
  assert.equal(deriveDeliveryMap(snapshot).slots[0].sourceSessionId,session.id,'the empty slot still links to the progress source');
  assert.match(deriveDeliveryMap(snapshot).slots[0].missingReason!,/部分进展已保存/);
  assert.equal(deriveGoalAutomation(snapshot,planId).completed,0);
  assert.equal(goalDependencySource(snapshot,design.key,audit.key),undefined);
  const oldFacts=JSON.stringify(snapshot.collaboration!.submissions);
  const oldArtifact=JSON.stringify(snapshot.collaboration!.artifacts[0]);
  const oldClaim=snapshot.collaboration!.tasks[audit.key].claimEpoch;
  // Old 0.11.1 incorrectly marked this exact partial shape in_review; fix the projection without rewriting old facts.
  const legacy=structuredClone(snapshot);legacy.collaboration!.tasks[audit.key].status='in_review';
  assert.equal(deriveDeliveryMap(legacy).filled,0);assert.equal(goalDependencySource(legacy,design.key,audit.key),undefined);
  assert.equal(deriveGoalAutomation(legacy,planId).completed,0);
  const displayBefore=JSON.stringify(legacy),orch=legacy.orchestrations![taskId],item=orch.items[audit.workItemId!];
  const display=workItemPresentation(legacy,orch,item);
  assert.equal(display.label,'待补齐');assert.equal(display.awaitingCompletion,true);
  assert.match(display.detail!,/缺少源码/);assert.equal(display.progress?.label,'待补齐');
  assert.equal(canReplyToTask(legacy,legacy.sessions[session.id]),true,'historic partial candidate remains a legal task input target');
  const nodes=flattenOverview([overviewProject(legacy)]);
  assert.equal(nodes.find(n=>n.itemId===audit.workItemId)?.state,'待补齐');
  assert.match(nodes.find(n=>n.taskId===taskId&&n.kind==='task')!.state,/待补齐/);
  assert.equal(JSON.stringify(legacy),displayBefore,'display and reply eligibility do not rewrite the historical ledger');
  const idle=structuredClone(legacy);idle.sessions[session.id].status='paused';
  assert.equal(workItemPresentation(idle,idle.orchestrations![taskId],idle.orchestrations![taskId].items[audit.workItemId!]).label,'待补齐','restart source pause cannot restore the coarse awaiting-review label');
  assert.equal(workItemPresentation(idle,idle.orchestrations![taskId],idle.orchestrations![taskId].items[audit.workItemId!]).progress?.label,'待补齐','the idle progress bar matches the partial state');
  const permission=structuredClone(legacy);permission.sessions[session.id].status='waiting_permission';permission.sessions[session.id].runtime!.requests={read:{id:'read',kind:'permission',prompt:'允许读取源码？'}};
  const permissionDisplay=workItemPresentation(permission,permission.orchestrations![taskId],permission.orchestrations![taskId].items[audit.workItemId!]);
  assert.equal(permissionDisplay.label,'等待权限');assert.equal(permissionDisplay.awaitingCompletion,false);assert.equal(canReplyToTask(permission,permission.sessions[session.id]),false);
  const outdated=structuredClone(legacy);outdated.ideaPlans![planId].draftVersion++;
  assert.equal(canReplyToTask(outdated,outdated.sessions[session.id]),false,'stale direction never enables a task input target');

  const legacyTask=legacy.collaboration!.tasks[audit.key];
  const accept=applyCollaboration(legacy,{projectId,taskId,workItemId:audit.workItemId,type:'review',expectedVersion:legacyTask.version,idempotencyKey:'cannot-accept-partial',payload:{submissionId:legacyTask.latestSubmissionId,verdict:'accepted',checks:[true],note:'不能跳过实际交付'}},{kind:'human'});
  assert.equal(accept.code,'INCOMPLETE_DELIVERY');
  const oldCopy=structuredClone(legacy);delete oldCopy.collaboration!.artifacts[0].deliverySlotIds;
  assert.equal(deriveDeliveryMap(oldCopy).filled,0,'legacy omission with unresolved blockers cannot invent delivery');
  oldCopy.collaboration!.submissions[0].unresolved=[];
  assert.equal(deriveDeliveryMap(oldCopy).filled,1,'legacy single-slot omission without blockers remains readable');
  base.mutateRuntimeProject(projectId,d=>{d.collaboration!.tasks[audit.key].status='in_review';d.collaboration!.runs[binding.runId].leaseExpiresAt=new Date(Date.now()-1000).toISOString();});
  // A real source permission request wins over ordinary text, even for a partial candidate.
  driver.emit(record,{status:'waiting_permission',request:{id:'read-source',kind:'permission',prompt:'读取源码需要授权'}});await runtime.flushRuntime();
  const controlsBefore=driver.controls.length;
  assert.equal((await runtime.controlSession(session.id,'reply',{prompt:'同意，请继续'})).ok,false);
  assert.equal(driver.controls.length,controlsBefore,'a text message never authorizes the pending permission');
  assert((await runtime.controlSession(session.id,'reply',{requestId:'read-source',decision:'allowed-once'})).ok,'the actual current permission card remains actionable for a historic partial candidate');
  await runtime.flushRuntime();
  driver.emit(record,{status:'waiting_reply'});await runtime.flushRuntime();
  base.mutateRuntimeProject(projectId,d=>{d.collaboration!.runs[binding.runId].leaseExpiresAt=new Date(Date.now()-1000).toISOString();});
  const continued=await runtime.controlSession(session.id,'reply',{prompt:'源码已补齐，请在原任务范围继续定位。'});assert(continued.ok,continued.message);await runtime.flushRuntime();
  snapshot=await runtime.load();
  assert.equal(JSON.stringify(snapshot.collaboration!.submissions),oldFacts,'continuation preserves the earlier submission');
  assert.equal(JSON.stringify(snapshot.collaboration!.artifacts[0]),oldArtifact,'continuation preserves the earlier artifact');
  assert.equal(snapshot.collaboration!.tasks[audit.key].claimEpoch,oldClaim,'an active same-scope claim is not replaced or revived');
  assert(snapshot.collaboration!.events.some(e=>e.type==='partial_submission_continued'&&JSON.parse(e.detail!).leaseRenewed===true),'explicit human continuation renews an unchanged waiting lease after the user takes time to reply');
  assert.equal(snapshot.collaboration!.tasks[audit.key].status,'running');
  // A result that claims the slot but still has unresolved prerequisites is not usable downstream.
  const slot=plan.slots.find(s=>s.taskKey===audit.key)!.id;
  driver.emit(record,{status:'waiting_reply',submission:result('still-partial',[slot],['还缺运行验证'])});await runtime.flushRuntime();snapshot=await runtime.load();
  assert.equal(driver.calls.length,1);assert.equal(deriveDeliveryMap(snapshot).filled,0);assert.equal(snapshot.collaboration!.tasks[audit.key].status,'paused');
  assert((await runtime.controlSession(session.id,'reply',{prompt:'继续补齐运行验证。'})).ok);await runtime.flushRuntime();
  driver.emit(record,{status:'waiting_reply',submission:result('complete',[slot],[])});await runtime.flushRuntime();snapshot=await runtime.load();
  assert.equal(driver.calls.length,2,'a complete candidate releases exactly the dependent task');
  assert.equal(snapshot.collaboration!.tasks[audit.key].status,'in_review');
  assert.equal(deriveDeliveryMap(snapshot).filled,1);assert.equal(deriveDeliveryMap(snapshot).accepted,0);
  assert(goalDependencySource(snapshot,design.key,audit.key));
  assert.equal(snapshot.collaboration!.reviews.length,0,'automatic reuse is never human acceptance');
  const beforeDeliveryView=JSON.stringify(snapshot);
  const delivery=completedSessionDelivery(snapshot,snapshot.sessions[session.id]);
  assert.equal(delivery?.submissionId,snapshot.collaboration!.tasks[audit.key].latestSubmissionId);
  assert.equal((await runtime.getSessionDelivery(session.id))?.submissionId,delivery?.submissionId);
  assert.equal(delivery?.accepted,false);
  assert.equal(snapshot.sessions[session.id].status,'waiting_reply','the source lifecycle is preserved');
  assert(!deriveProjectActivity(snapshot).entries.some(e=>e.sessionId===session.id),'complete candidate does not ask the user to send another reply');
  assert.equal(JSON.stringify(snapshot),beforeDeliveryView,'delivery and activity projections are read-only');
  for (const status of ['waiting_reply', 'paused', 'archived', 'cancelled'] as const) {
    const stopped = structuredClone(snapshot);
    stopped.sessions[session.id].status = status;
    const stoppedOrchestration = stopped.orchestrations![taskId], stoppedItem = stoppedOrchestration.items[audit.workItemId!];
    stoppedOrchestration.attempts[stoppedItem.attemptIds.at(-1)!].step = {label:'/bin/zsh -c python3 /tmp/old-tool.py'};
    const before = JSON.stringify(stopped);
    const presentation = workItemPresentation(stopped, stopped.orchestrations![taskId], stopped.orchestrations![taskId].items[audit.workItemId!]);
    assert.equal(presentation.label, '待验收', `complete candidate remains awaiting review after source ${status}`);
    assert.equal(presentation.progress, null);
    assert.equal(presentation.delivery?.submissionId, delivery?.submissionId);
    assert.equal(presentation.activity, '完整候选成果已保存，等待验收。', 'a completed leaf never calls its last shell command the current stage');
    const node = flattenOverview([overviewProject(stopped)]).find(node => node.itemId === audit.workItemId)!;
    assert.equal(node.state, '待验收'); assert.equal(node.execution, null); assert.equal(node.awaitingReview, true);
    assert(!taskExecutionPresentation(stopped,taskId).rows.some(row=>row.sessionId===session.id), 'idle submitted source has no live execution row');
    assert(!deriveProjectActivity(stopped).entries.some(e=>e.sessionId===session.id));
    assert.equal(JSON.stringify(stopped), before);
  }
  const requestSnapshot=structuredClone(snapshot);
  requestSnapshot.sessions[session.id].status='paused';
  requestSnapshot.sessions[session.id].runtime!.request={id:'still-permission',kind:'permission',prompt:'真实权限不可隐藏'};
  requestSnapshot.sessions[session.id].runtime!.requests={'still-permission':requestSnapshot.sessions[session.id].runtime!.request!};
  assert.equal(deriveProjectActivity(requestSnapshot).entries.find(e=>e.sessionId===session.id)?.state,'waiting_permission');
  assert.equal(workItemPresentation(requestSnapshot,requestSnapshot.orchestrations![taskId],requestSnapshot.orchestrations![taskId].items[audit.workItemId!]).label,'等待权限','a paused complete candidate cannot conceal an actual pending permission');
  assert.equal(workItemPresentation(requestSnapshot,requestSnapshot.orchestrations![taskId],requestSnapshot.orchestrations![taskId].items[audit.workItemId!]).activity,'真实权限不可隐藏');
  requestSnapshot.sessions[session.id].runtime!.request={id:'question',kind:'question',prompt:'真实问题不可隐藏'};
  requestSnapshot.sessions[session.id].runtime!.requests={question:requestSnapshot.sessions[session.id].runtime!.request!};
  assert.equal(deriveProjectActivity(requestSnapshot).entries.find(e=>e.sessionId===session.id)?.state,'waiting_reply');
  delete requestSnapshot.sessions[session.id].runtime!.request;requestSnapshot.sessions[session.id].runtime!.requests={};
  requestSnapshot.sessions[session.id].runtime!.submissionIssue={messageId:'rejected',at:new Date().toISOString(),code:'SOURCE_STALE',message:'来源已变化'};
  assert.equal(deriveProjectActivity(requestSnapshot).entries.find(e=>e.sessionId===session.id)?.state,'failed');
  assert.equal(workItemPresentation(requestSnapshot,requestSnapshot.orchestrations![taskId],requestSnapshot.orchestrations![taskId].items[audit.workItemId!]).state,'failed');
  const incidentSnapshot = structuredClone(snapshot);
  incidentSnapshot.sessions[session.id].status='paused';
  incidentSnapshot.sessions[session.id].runtime!.incident={id:'open-failure',status:'open',kind:'failure',code:'network',title:'连接失败',message:'实际源连接失败',detectedAt:new Date().toISOString()};
  assert.equal(deriveProjectActivity(incidentSnapshot).entries.find(e=>e.sessionId===session.id)?.state,'failed');
  const incidentDisplay=workItemPresentation(incidentSnapshot,incidentSnapshot.orchestrations![taskId],incidentSnapshot.orchestrations![taskId].items[audit.workItemId!]);
  assert.equal(incidentDisplay.label,'失败');assert.equal(incidentDisplay.activity,'实际源连接失败');
  const accepted=structuredClone(snapshot);accepted.collaboration!.tasks[audit.key].status='done';accepted.collaboration!.tasks[audit.key].acceptedArtifactId=goalDeliveryReadiness(snapshot,audit.key).artifact!.id;
  assert.equal(completedSessionDelivery(accepted,accepted.sessions[session.id])?.accepted,true);
  const otherRun=structuredClone(snapshot);otherRun.sessions[session.id].runtime!.collaboration!.runId='older-run';
  assert.equal(completedSessionDelivery(otherRun,otherRun.sessions[session.id]),undefined,'another run cannot inherit a completed candidate');
  assert(deriveProjectActivity(otherRun).entries.some(e=>e.sessionId===session.id),'only the exact submitting source is quiet');
  assert.equal(canReplyToTask(snapshot,snapshot.sessions[session.id]),false,'complete candidate is not a task reply target');
  assert.equal((await runtime.controlSession(session.id,'reply',{prompt:'完整候选后普通续谈不能绕过复核'})).ok,false);
  driver.emit(record,{status:'running'});await runtime.flushRuntime();snapshot=await runtime.load();assert.equal(snapshot.collaboration!.tasks[audit.key].status,'in_review','late provider status cannot reopen a completed candidate');
  // Strict fences remain for historical partial results: claim, spec, plan, terminal run and expectedVersion.
  for(const mutate of [
    (s:typeof snapshot)=>{s.collaboration!.tasks[audit.key].claimEpoch++;},
    (s:typeof snapshot)=>{s.collaboration!.tasks[audit.key].specRevision++;},
    (s:typeof snapshot)=>{s.ideaPlans![planId].draftVersion++;},
    (s:typeof snapshot)=>{s.collaboration!.runs[binding.runId].status='succeeded';},
    (s:typeof snapshot)=>{s.collaboration!.runs[binding.runId].status='running';s.collaboration!.runs[binding.runId].leaseExpiresAt=new Date(Date.now()-1000).toISOString();},
    (s:typeof snapshot)=>{s.collaboration!.runs[binding.runId].status='lost';},
  ]){
    const fenced=structuredClone(legacy);mutate(fenced);
    const task=fenced.collaboration!.tasks[audit.key];
    const receipt=applyCollaboration(fenced,{projectId,taskId,workItemId:audit.workItemId,type:'continue_partial',expectedVersion:task.version,idempotencyKey:'fenced-'+Math.random(),payload:{submissionId:task.latestSubmissionId,runId:binding.runId}},{kind:'human'});
    assert.equal(receipt.ok,false,'an old partial claim cannot bypass a changed fence');
  }
  const multi=structuredClone(snapshot),multiPlan=latestGoalPlan(multi,planId)!;
  multiPlan.slots.push({...multiPlan.slots[0],id:'additional-required-slot',title:'补充证据'});
  assert.equal(goalDependencySource(multi,design.key,audit.key),undefined,'one declared slot cannot satisfy all required slots');
  // Retain an already-admitted downstream run from the buggy release, but never continue from its incomplete input.
  base.mutateRuntimeProject(projectId,d=>{d.collaboration!.tasks[audit.key].latestSubmissionId=legacy.collaboration!.tasks[audit.key].latestSubmissionId;d.collaboration!.tasks[audit.key].status='in_review';});
  const downstream=driver.records[1];driver.emit(downstream,{status:'waiting_reply'});await runtime.flushRuntime();
  const historical=await runtime.load(),designSession=Object.values(historical.sessions).find(s=>s.runtime?.runId===downstream.runId)!;
  const denied=await runtime.controlSession(designSession.id,'reply',{prompt:'继续开发'});assert.equal(denied.ok,false);assert.match(denied.message!,/前置交付/);
  driver.emit(downstream,{status:'waiting_reply',submission:{schemaVersion:'quandeck.runtime.v1',idempotencyKey:'invalid-dependent',binding:designSession.runtime!.collaboration!,kind:'result',payload:{title:'不能传播不完整来源',body:'历史运行需保留，但当前输入不足',deliverySlotIds:[plan.slots.find(s=>s.taskKey===design.key)!.id],sourceIds:[],unresolved:[],nextSteps:[]}}});
  await runtime.flushRuntime();const rejected=await runtime.load();
  assert.equal(rejected.sessions[designSession.id].runtime!.submissionIssue!.code,'SOURCE_STALE','a historic downstream result cannot silently consume incomplete provenance');
  assert.equal(driver.calls.length,2,'no later dependent starts');
  assert.equal(goalDeliveryReadiness(snapshot,audit.key).complete,true);
  runtime.dispose();
  console.log('partial delivery: real failure shape retained; no phantom slot or dependency; explicit scoped continuation; permission, version, claim and terminal guards passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
