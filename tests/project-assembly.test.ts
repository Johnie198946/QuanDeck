import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { deriveDeliveryMap, latestGoalPlan } from '../src/data/goalDelivery';
import { currentDeliverySlots } from '../src/data/deliveryContract';
import { assemblySubmissionInputs, reconcileProjectAssembly, refreshProjectAssemblyInputs } from '../src/data/projectAssembly';
import { readPlanTasks, materializeGoalPlan } from '../src/data/projectWorkflow';
import { taskKey } from '../src/data/collaboration';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeRunRecord } from '../src/data/runtimeContracts';
import type { Snapshot } from '../src/data/types';

const memory = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
class Driver implements RuntimeDriver {
  prepareSourceAttachments?:RuntimeDriver['prepareSourceAttachments'];
  verifyDeliveryFiles?:RuntimeDriver['verifyDeliveryFiles']; stopAcknowledged=true;
  calls:RuntimeRunInput[]=[]; records:RuntimeRunRecord[]=[]; controls:string[]=[]; listener=(_event:RuntimeEvent)=>{}; clock=Date.now()+1000;
  subscribe(fn:(event:RuntimeEvent)=>void){this.listener=fn;return()=>{};}
  async run(input:RuntimeRunInput){this.calls.push(input);const record:RuntimeRunRecord={...input,runId:`assembly-run-${globalThis.crypto.randomUUID()}`,sessionId:`source-${globalThis.crypto.randomUUID()}`,acceptedAt:new Date(this.clock++).toISOString(),acceptance:'acknowledged',status:'queued',events:[]};this.records.push(record);return record;}
  emit(record:RuntimeRunRecord,fields:Partial<RuntimeEvent>){const event:RuntimeEvent={...fields,id:`event-${record.runId}-${record.events!.length}`,sequence:record.events!.length,at:new Date(this.clock+=1000).toISOString(),runId:record.runId,sessionId:record.sessionId};record.events!.push(event);if(fields.status)record.status=fields.status;this.listener(event);}
  async control(_id:string,action:string,payload?:Record<string,unknown>){this.controls.push(action);if(action==='reply')assert.match(String(payload?.prompt),/仅自动尝试一次/);return {stoppedConfirmed:action==='stop'?this.stopAcknowledged:true};}
  scan=async()=>[];listRuns=()=>this.records;
}
const draft=(key:string)=>({key,title:key,expected:`产出可核对的 ${key} 内容`,deps:[],owner:'agent',phase:'制作'});
const payload=(s:Snapshot,key:string,label:string)=>({title:label,body:`概览：${label}`,sourceIds:[],unresolved:[],nextSteps:[],deliveryItems:currentDeliverySlots(s,key).map(slot=>({slotId:slot.id,contractRevision:slot.contract!.revision,body:`${label} 的独立完整正文，用于 ${slot.title}`}))});
async function main(){
  const base=new LocalWorkdeckDataSource(),driver=new Driver(),runtime=createRuntimeDataSource(base,driver);
  const projectId=(await runtime.createProject({name:'后端强制多输出整合验收'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
  await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'assembly-test',projectPath:'/assembly-test'});
  const planId=await runtime.ensureProjectPlan(projectId);
  await base.recordDiscussionConclusion(planId,'root',{summary:'独立制作正文和清单；系统负责每件最终输出',confirmed:[],open:[],tasks:readPlanTasks([draft('body'),draft('checklist')]),deliverables:[{id:'guide',title:'完整指南',taskKey:'body'},{id:'list',title:'检查清单',taskKey:'checklist'}]});
  let s=await base.load();const approval=await base.approvePlan(planId,s.ideaPlans![planId].discussion!.conclusions.at(-1)!.id,projectId,1);assert(approval.ok,approval.message);
  s=await base.load();let plan=latestGoalPlan(s,planId)!;
  assert.equal(plan.contractSchema,1);assert.equal(plan.tasks.filter(t=>t.assembly).length,2,'missing Agent assembly drafts are completed by backend responsibilities');
  assert.equal(plan.tasks.length,4);assert.equal(deriveDeliveryMap(s,{planId}).total,2,'project map contains final outputs only');
  const sources=plan.tasks.filter(t=>!t.assembly),assemblies=plan.tasks.filter(t=>t.assembly);
  for(const source of sources)assert.equal(deriveDeliveryMap(s,{taskId:source.taskId}).total,1,'each task exposes its own contribution output map');
  for(const assembly of assemblies){assert.equal(s.collaboration!.tasks[assembly.key].dependencies.length,1);assert(!s.collaboration!.tasks[assembly.key].dependencies.includes(assembly.key));}
  const clone=structuredClone(s),before=JSON.stringify(clone);assert.equal(reconcileProjectAssembly(clone,planId),false);assert.equal(JSON.stringify(clone),before,'reconciliation is idempotent');
  const missing=structuredClone(s),missingPlan=latestGoalPlan(missing,planId)!,missingKey=assemblies[0].key;
  missingPlan.tasks=missingPlan.tasks.filter(b=>b.key!==missingKey);delete missing.tasks[missingKey];
  assert(reconcileProjectAssembly(missing,planId));assert(missing.tasks[missingKey]);assert(latestGoalPlan(missing,planId)!.tasks.some(b=>b.key===missingKey&&b.assembly));assert.equal(reconcileProjectAssembly(missing,planId),false,'missing responsibility is repaired once');
  const retired=structuredClone(s),retiredPlan=latestGoalPlan(retired,planId)!;retiredPlan.slots[1].retired={reason:'用户移除输出',at:new Date().toISOString(),replacementIds:[]};
  assert(reconcileProjectAssembly(retired,planId));assert(retired.collaboration!.tasks[assemblies[1].key].archived);assert(!latestGoalPlan(retired,planId)!.tasks.some(b=>b.key===assemblies[1].key));
  const direction=retired.ideaPlans![planId];direction.draftVersion++;direction.adopted!.draftVersion=direction.draftVersion;materializeGoalPlan(retired,direction);
  assert(latestGoalPlan(retired,planId)!.slots.find(slot=>slot.id===retiredPlan.slots[1].id)?.retired,'old discussion deliverables cannot revive a canonically removed output');
  const invalid=structuredClone(s);latestGoalPlan(invalid,planId)!.slots[0].contributionIds=['unknown-slot'];assert.throws(()=>reconcileProjectAssembly(invalid,planId),/不存在/,'unknown contribution cannot be inferred from prose');
  const originalPlan=JSON.stringify(plan);
  assert((await runtime.configureGoalAutomation(planId,{enabled:true,agentId:'codex',expectedDraftVersion:approval.approvedDraftVersion!},projectId)).ok);await runtime.flushRuntime();
  assert.equal(driver.calls.length,2,'only contribution tasks execute before inputs exist');
  const first=driver.records.find(r=>r.taskId===sources[0].taskId)!;
  s=await base.load();let session=Object.values(s.sessions).find(x=>x.runtime?.runId===first.runId)!;
  driver.emit(first,{status:'waiting_reply',turnCompleted:true,submission:{schemaVersion:'quandeck.runtime.v1',idempotencyKey:'partial',binding:session.runtime!.collaboration!,kind:'result',payload:{...payload(s,sources[0].key,'部分正文'),deliveryItems:[]}}});await runtime.flushRuntime();
  s=await base.load();assert.equal(driver.calls.length,2,'partial evidence cannot unlock final assembly');assert.equal(driver.controls.filter(c=>c==='reply').length,1,'missing structured items receive one bounded correction');
  driver.emit(first,{status:'waiting_reply',turnCompleted:true,reply:{id:'still-missing',text:'尚未整理好逐件正文'}});await runtime.flushRuntime();assert.equal(driver.controls.filter(c=>c==='reply').length,1,'format correction is not a retry loop');
  async function deliver(record:RuntimeRunRecord,label:string,turnCompleted=false){const snapshot=await base.load(),session=Object.values(snapshot.sessions).find(x=>x.runtime?.runId===record.runId)!;const key=taskKey(session.runtime!.taskId,session.runtime!.workItemId);driver.emit(record,{status:turnCompleted?'waiting_reply':'done',turnCompleted,stoppedConfirmed:!turnCompleted,submission:{schemaVersion:'quandeck.runtime.v1',idempotencyKey:label,binding:session.runtime!.collaboration!,kind:'result',payload:payload(snapshot,key,label)}});await runtime.flushRuntime();const fresh=await base.load();assert.equal(fresh.sessions[session.id].runtime!.submissionReceipts!.at(-1)!.ok,true,JSON.stringify(fresh.sessions[session.id].runtime!.submissionReceipts!.at(-1)));}
  await deliver(first,'corrected-source');
  s=await base.load();assert.equal(driver.calls.length,3,'one ready output assembles without waiting for the unrelated branch');
  const firstAssembly=driver.records.find(r=>assemblies.some(a=>a.taskId===r.taskId))!;
  const firstAssemblyBinding=latestGoalPlan(s,planId)!.tasks.find(t=>t.taskId===firstAssembly.taskId)!;
  assert.match(firstAssembly.prompt,/corrected-source 的独立完整正文/,'assembly receives full item content, not the overview alone');
  assert(firstAssemblyBinding.assembly!.inputFingerprint);assert.equal(firstAssemblyBinding.assembly!.inputArtifactIds!.length,1);
  assert.equal(assemblySubmissionInputs(s,firstAssemblyBinding.key).issue,undefined);
  await deliver(firstAssembly,'first-final',true);
  s=await base.load();const closed=Object.values(s.sessions).find(x=>x.runtime?.runId===firstAssembly.runId)!;assert.equal(closed.runtime!.completionStop?.state,'stopped');assert.equal(driver.controls.filter(c=>c==='stop').length,1,'finished strict assembly stops its source once without accepting the business result');
  const other=driver.records.find(r=>r.taskId===sources[1].taskId)!;await deliver(other,'second-source');
  const secondAssembly=driver.records.find(r=>assemblies.some(a=>a.taskId===r.taskId)&&r.runId!==firstAssembly.runId)!;await deliver(secondAssembly,'second-final');
  s=await base.load();plan=latestGoalPlan(s,planId)!;
  assert.equal(deriveDeliveryMap(s,{planId}).filled,2);assert.equal(deriveDeliveryMap(s,{planId}).accepted,0,'automatic content merge cannot publish or accept a release');
  assert.equal(driver.calls.length,4,'exactly one conversation per contribution/assembly task');
  assert.equal(s.collaboration!.reviews.length,0);assert.equal(JSON.stringify(s.collaboration!.goalPlans![planId][0]),originalPlan,'input pinning appends immutable program revisions');
  const pinned=plan.tasks.find(t=>t.key===firstAssemblyBinding.key)!;
  const artifact=s.collaboration!.artifacts.find(a=>a.key===pinned.key)!;assert.deepEqual(artifact.sourceIds,pinned.assembly!.inputArtifactIds,'backend records fixed inputs even when Agent sourceIds is empty');
  const unrelated=plan.tasks.find(t=>t.taskId===secondAssembly.taskId)!,unrelatedRevision=unrelated.specRevision;
  const sourceTask=s.collaboration!.tasks[sources[0].key];
  const newer=await runtime.collaborate({projectId,taskId:sourceTask.taskId,type:'submit',expectedVersion:sourceTask.version,idempotencyKey:'new-source-version',payload:payload(s,sourceTask.key,'新的来源正文')});assert(newer.ok,newer.message);await runtime.flushRuntime();
  s=await base.load();plan=latestGoalPlan(s,planId)!;
  assert.equal(driver.calls.length,5,'changed valid source automatically re-runs only the affected assembly');
  assert.equal(plan.tasks.find(t=>t.key===unrelated.key)!.specRevision,unrelatedRevision);
  assert.equal(plan.tasks.find(t=>t.key===pinned.key)!.specRevision,pinned.specRevision+1);
  assert.equal(s.collaboration!.freshness[artifact.id],'stale','old final result remains history and is no longer a current candidate');
  // A source update while assembly admission or process stop is uncertain never duplicates execution.
  const pendingClone=structuredClone(s),pendingPlan=latestGoalPlan(pendingClone,planId)!;
  const activeBinding=pendingPlan.tasks.find(t=>t.key===pinned.key)!;pendingClone.collaboration!.goalAutomation![planId].attempts[pinned.key].state='unknown';
  activeBinding.assembly!.inputFingerprint='prior-input';
  assert.equal(refreshProjectAssemblyInputs(pendingClone,planId),true);
  assert.equal(pendingClone.collaboration!.goalAutomation![planId].attempts[pinned.key].state,'unknown');
  assert.equal(pendingClone.collaboration!.tasks[pinned.key].specRevision,s.collaboration!.tasks[pinned.key].specRevision,'unknown admission is fenced instead of re-arming');
  const unsafe=structuredClone(s);latestGoalPlan(unsafe,planId)!.tasks.find(t=>t.key===pinned.key)!.assembly!.inputFingerprint='prior-input';refreshProjectAssemblyInputs(unsafe,planId);assert.equal(unsafe.collaboration!.tasks[pinned.key].specRevision,s.collaboration!.tasks[pinned.key].specRevision,'live source process requires a real stop receipt');
  await deliver(driver.records.at(-1)!,'refreshed-final');
  // A contribution contract revision must re-open the contributor, not only its final assembly.
  s=await base.load();
  const reviewedTask=s.collaboration!.tasks[sources[0].key],reviewedSpec=s.collaboration!.specs.find(x=>x.key===reviewedTask.key&&x.revision===reviewedTask.specRevision)!;
  const acceptedSource=await runtime.collaborate({projectId,taskId:reviewedTask.taskId,type:'review',expectedVersion:reviewedTask.version,idempotencyKey:'accept-source-before-change',payload:{submissionId:reviewedTask.latestSubmissionId,verdict:'accepted',checks:reviewedSpec.criteria.map(()=>true),deliveryChecks:Object.fromEntries(currentDeliverySlots(s,reviewedTask.key).map(slot=>[slot.id,slot.contract!.criteria.map(()=>true)])),note:'已逐件核对'}});
  assert(acceptedSource.ok,acceptedSource.message);await runtime.flushRuntime();s=await base.load();
  assert(s.tasks[sources[0].taskId].completion,'accepted contribution is completed before its contract changes');
  const contribution=currentDeliverySlots(s,sources[0].key)[0],contributionPlan=latestGoalPlan(s,contribution.planId)!;
  const beforeContractSpec=s.collaboration!.tasks[sources[0].key].specRevision,callCount=driver.calls.length;
  const unchangedFinal=latestGoalPlan(s,planId)!.tasks.find(t=>t.key===unrelated.key)!.specRevision;
  const change={planId:contributionPlan.id,expectedVersion:contributionPlan.version,idempotencyKey:'revise-contribution',reason:'补充核对标准和独立说明',operations:[
    {type:'update' as const,slotId:contribution.id,patch:{contract:{...contribution.contract!,criteria:['新的正文核对标准']}}},
    {type:'add' as const,slot:{id:'source-extra',title:'补充说明',taskKey:sources[0].key,contract:{...contribution.contract!,criteria:['单独说明新增信息']}}},
  ]};
  const changed=await runtime.applyDeliveryChange(projectId,change);assert(changed.ok,changed.message);await runtime.flushRuntime();
  s=await base.load();assert.equal(s.collaboration!.goalAutomation![planId].enabled,false);assert.equal(driver.calls.length,callCount,'contract edits do not execute without a renewed authorization');
  assert(latestGoalPlan(s,contributionPlan.id)!.pendingTaskRevisions?.some(x=>x.key===sources[0].key));
  for(const state of ['unknown','reserved'] as const){const unknown=structuredClone(s);unknown.collaboration!.goalAutomation![planId].enabled=true;unknown.collaboration!.goalAutomation![planId].attempts[sources[0].key].state=state;
    refreshProjectAssemblyInputs(unknown,planId);assert.equal(unknown.collaboration!.tasks[sources[0].key].specRevision,beforeContractSpec,'uncertain admission preserves the previous execution revision');}
  const notStopped=structuredClone(s);notStopped.collaboration!.goalAutomation![planId].enabled=true;
  const oldSource=Object.values(notStopped.sessions).find(x=>x.runtime?.runId===first.runId)!;oldSource.runtime!.stoppedConfirmed=false;
  refreshProjectAssemblyInputs(notStopped,planId);assert.equal(notStopped.collaboration!.tasks[sources[0].key].specRevision,beforeContractSpec,'a local terminal label cannot replace a provider stop receipt');
  assert((await runtime.configureGoalAutomation(planId,{enabled:true,agentId:'codex',expectedDraftVersion:s.ideaPlans![planId].draftVersion},projectId)).ok);await runtime.flushRuntime();
  s=await base.load();assert.equal(driver.calls.length,callCount+1,'renewed authorization executes the changed contributor once');
  const revisedSource=driver.records.at(-1)!;assert.equal(revisedSource.taskId,sources[0].taskId);assert.equal(revisedSource.purpose,'execution');
  assert.equal(s.collaboration!.tasks[sources[0].key].specRevision,beforeContractSpec+1);
  assert.equal(s.tasks[sources[0].taskId].completion,null,'the actual task projection reopens with its ledger revision');
  assert.equal(latestGoalPlan(s,contributionPlan.id)!.pendingTaskRevisions,undefined);
  assert.equal(currentDeliverySlots(s,sources[0].key).length,2,'the reopened execution receives every new required item');
  assert.equal(latestGoalPlan(s,planId)!.tasks.find(t=>t.key===unrelated.key)!.specRevision,unchangedFinal);
  const revisedSession=Object.values(s.sessions).find(x=>x.runtime?.runId===revisedSource.runId)!,partialPayload=payload(s,sources[0].key,'仅旧部分');
  partialPayload.deliveryItems=partialPayload.deliveryItems.slice(0,1);
  driver.emit(revisedSource,{status:'waiting_reply',turnCompleted:true,submission:{schemaVersion:'quandeck.runtime.v1',idempotencyKey:'partial-new-contract',binding:revisedSession.runtime!.collaboration!,kind:'result',payload:partialPayload}});await runtime.flushRuntime();
  assert.equal(driver.calls.length,callCount+1,'omitting the added required item cannot unlock assembly');
  await deliver(revisedSource,'changed-contract-source');
  assert.equal(driver.calls.length,callCount+2,'only the dependent assembly re-runs after fresh complete contribution');
  assert.equal(driver.records.at(-1)!.taskId,pinned.taskId);
  await deliver(driver.records.at(-1)!,'changed-contract-final');
  await runtime.flushRuntime();assert.equal(driver.calls.length,callCount+2,'the persisted revision is not rearmed again');
  runtime.dispose();
  const restartedBase=new LocalWorkdeckDataSource(),restartDriver=new Driver(),restarted=createRuntimeDataSource(restartedBase,restartDriver);await restarted.flushRuntime();assert.equal(restartDriver.calls.length,0,'persisted sent receipts are not replayed on application restart');
  const restored=await restartedBase.load();assert.equal(deriveDeliveryMap(restored,{planId}).filled,2);
  const legacy=structuredClone(restored);delete latestGoalPlan(legacy,planId)!.contractSchema;const legacyBefore=JSON.stringify(legacy);assert.equal(reconcileProjectAssembly(legacy,planId),false);assert.equal(refreshProjectAssemblyInputs(legacy,planId),false);assert.equal(JSON.stringify(legacy),legacyBefore,'legacy projects are never automatically migrated or bulk-executed');
  restarted.dispose();
  await fileAndChildContract();
  console.log('project assembly contract tests passed');
}
async function fileAndChildContract(){
  memory.clear();const base=new LocalWorkdeckDataSource(),driver=new Driver(),runtime=createRuntimeDataSource(base,driver);
  const projectId=(await runtime.createProject({name:'文件与子任务严格验收'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'file-test',projectPath:'/file-test'});
  const planId=await runtime.ensureProjectPlan(projectId);
  await base.recordDiscussionConclusion(planId,'root',{summary:'先完成子任务再整合文档',confirmed:[],open:[],tasks:readPlanTasks([draft('root'),{...draft('child'),parentKey:'root'}]),deliverables:[{id:'file',title:'完整说明文件',taskKey:'root',contract:{revision:1,kind:'file',format:'md',required:true,criteria:['完整文档']}}]});
  let s=await base.load();const approval=await base.approvePlan(planId,s.ideaPlans![planId].discussion!.conclusions.at(-1)!.id,projectId,1);assert(approval.ok,approval.message);
  s=await base.load();const plan=latestGoalPlan(s,planId)!,leaf=plan.tasks.find(b=>b.workItemId)!,root=plan.tasks.find(b=>!b.workItemId&&!b.assembly)!;
  assert.equal(currentDeliverySlots(s,leaf.key).length,1,'intermediate leaf gets a task output contract even without an explicit final slot');
  assert((await runtime.configureGoalAutomation(planId,{enabled:true,agentId:'codex',expectedDraftVersion:approval.approvedDraftVersion!},projectId)).ok);await runtime.flushRuntime();assert.equal(driver.calls.length,1);assert.equal(driver.calls[0].workItemId,leaf.workItemId);
  const emit=async(record:RuntimeRunRecord,value:Record<string,unknown>,key:string,waiting=false)=>{s=await base.load();const session=Object.values(s.sessions).find(x=>x.runtime?.runId===record.runId)!;driver.emit(record,{status:waiting?'waiting_reply':'done',turnCompleted:waiting,stoppedConfirmed:!waiting,submission:{schemaVersion:'quandeck.runtime.v1',idempotencyKey:key,binding:session.runtime!.collaboration!,kind:'result',payload:value}});await runtime.flushRuntime();s=await base.load();return s.sessions[session.id];};
  await emit(driver.records[0],payload(await base.load(),leaf.key,'子任务实际交付'),'leaf');assert.equal(driver.calls.length,2);
  const rootRun=driver.records.find(r=>r.taskId===root.taskId&&!r.workItemId)!;
  s=await base.load();const items=currentDeliverySlots(s,root.key).map(slot=>({slotId:slot.id,contractRevision:slot.contract!.revision,path:'output.md'}));
  const filePayload={title:'说明文档',body:'文件交付说明',sourceIds:[],unresolved:[],nextSteps:[],deliveryItems:items};
  const rejected=await emit(rootRun,filePayload,'unverified-file',true);
  assert.equal(rejected.runtime!.submissionIssue!.code,'DELIVERY_FILE_UNVERIFIED');assert.equal(s.collaboration!.tasks[root.key].latestSubmissionId,undefined,'plain file paths do not prove file existence');assert.equal(driver.calls.length,2);
  let checks=0;driver.verifyDeliveryFiles=async input=>{checks++;assert.equal(input.taskId,root.taskId);return [{attachmentId:'verified-output',name:'output.md',bytes:12,sha256:'a'.repeat(64),verifiedAt:new Date().toISOString(),path:'output.md'}];};
  driver.prepareSourceAttachments=async input=>{assert(input.sources.length>0);return [{id:'verified-output',name:'output.md',path:'/file-test/.quandeck/attachments/frozen/output.md',sha256:'a'.repeat(64)}];};
  const accepted=await emit(rootRun,filePayload,'verified-file');assert.equal(accepted.runtime!.submissionReceipts!.at(-1)!.ok,true,accepted.runtime!.submissionReceipts!.at(-1)!.message);assert.equal(checks,1);assert.equal(driver.calls.length,3);
  const assembly=latestGoalPlan(s,planId)!.tasks.find(b=>b.assembly)!,assemblyRun=driver.records.find(r=>r.taskId===assembly.taskId)!;
  assert.match(assemblyRun.prompt,/前置成果的固定文件副本/);assert.match(assemblyRun.prompt,/frozen\/output.md/);
  driver.stopAcknowledged=false;
  const finalItems=currentDeliverySlots(s,assembly.key).map(slot=>({slotId:slot.id,contractRevision:slot.contract!.revision,path:'output.md'}));
  driver.verifyDeliveryFiles=async()=>[{attachmentId:'verified-final',name:'output.md',bytes:12,sha256:'b'.repeat(64),verifiedAt:new Date().toISOString(),path:'output.md'}];
  const pending=await emit(assemblyRun,{...filePayload,deliveryItems:finalItems},'final-file',true);assert.equal(pending.runtime!.completionStop?.state,'unknown');assert.equal(driver.controls.filter(a=>a==='stop').length,1);
  driver.emit(assemblyRun,{status:'waiting_reply',turnCompleted:true,reply:{id:'extra-prose',text:'文档已保留'}});await runtime.flushRuntime();assert.equal(driver.controls.filter(a=>a==='stop').length,1,'unknown stop receipt is not resent');
  runtime.dispose();const restoredDriver=new Driver(),restored=createRuntimeDataSource(new LocalWorkdeckDataSource(),restoredDriver);await restored.flushRuntime();assert.equal(restoredDriver.calls.length,0);assert.equal(restoredDriver.controls.length,0,'restart never repeats an uncertain stop or run');restored.dispose();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
