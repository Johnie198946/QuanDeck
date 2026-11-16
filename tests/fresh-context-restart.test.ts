import assert from 'node:assert/strict';
import { inspectContextRestart } from '../src/data/runtimeContextRestart';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { latestGoalPlan, goalDeliveryReadiness } from '../src/data/goalDelivery';
import { readPlanTasks } from '../src/data/projectWorkflow';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeRunRecord } from '../src/data/runtimeContracts';
const memory=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
class Driver implements RuntimeDriver {
  calls:RuntimeRunInput[]=[];records:RuntimeRunRecord[]=[];controls:{runId:string;action:string;payload?:Record<string,unknown>}[]=[];
  listener=(_e:RuntimeEvent)=>{};clock=Date.now()+1000;
  subscribe(fn:(e:RuntimeEvent)=>void){this.listener=fn;return()=>{};}
  async run(input:RuntimeRunInput){this.calls.push(input);if(this.reject)throw Object.assign(new Error('new admission rejected'),{rejected:true});if(this.unknown)throw new Error('new admission unknown');const record:RuntimeRunRecord={...input,runId:`run-${this.calls.length}`,sessionId:`source-${this.calls.length}`,acceptedAt:new Date(this.clock++).toISOString(),acceptance:'acknowledged',status:'queued',events:[]};this.records.push(record);return record;}
  emit(record:RuntimeRunRecord,fields:Partial<RuntimeEvent>){const event:RuntimeEvent={...fields,id:`e-${record.runId}-${record.events!.length}`,sequence:record.events!.length,at:new Date(this.clock+=1000).toISOString(),runId:record.runId,sessionId:record.sessionId};record.events!.push(event);if(fields.status)record.status=fields.status;if(fields.stoppedConfirmed!==undefined)record.stoppedConfirmed=fields.stoppedConfirmed;this.listener(event);}
  async control(runId:string,action:string,payload?:Record<string,unknown>){this.controls.push({runId,action,payload});if(action==='reply')this.emit(this.records.find(r=>r.runId===runId)!,{status:'running',...(typeof payload?.requestId==='string'?{requestResolved:payload.requestId}:{})});}
  prepareAttachments?:RuntimeDriver['prepareAttachments'];
  onList?:()=>void;reject=false;unknown=false;
  scan=async()=>[];listRuns=()=>{this.onList?.();return this.records;};
}
async function fixture(){
  memory.clear();
  const base=new LocalWorkdeckDataSource(),driver=new Driver(),runtime=createRuntimeDataSource(base,driver);
  const projectId=(await runtime.createProject({name:'失效上下文重新执行'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
  await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'restart-test',projectPath:'/restart-test'});
  const taskId=(await runtime.createTaskWithAttachments('页面重构',[],projectId)).taskId!;
  const planId=await runtime.ensureTaskPlan(taskId);
  const draft=(key:string,deps:string[]=[])=>({key,deps,title:key,expected:`可核对的 ${key}`,owner:'agent',phase:'执行'});
  await runtime.recordDiscussionConclusion(planId,'root',{summary:'定位后设计',confirmed:[],open:[],tasks:readPlanTasks([draft('audit'),draft('design',['audit'])]),deliverables:[{id:'audit',title:'问题清单',taskKey:'audit'},{id:'design',title:'界面设计',taskKey:'design'}]});
  let snapshot=await runtime.load();
  const approval=await runtime.approvePlan(planId,snapshot.ideaPlans![planId].discussion!.conclusions.at(-1)!.id,projectId,1);assert(approval.ok,approval.message);
  assert((await runtime.configureGoalAutomation(planId,{enabled:true,agentId:'codex',expectedDraftVersion:approval.approvedDraftVersion!},projectId)).ok);
  await runtime.flushRuntime();snapshot=await runtime.load();
  const plan=latestGoalPlan(snapshot,planId)!,audit=plan.tasks.find(t=>t.draftKey.endsWith('-audit'))!,design=plan.tasks.find(t=>t.draftKey.endsWith('-design'))!;
  const auditRecord=driver.records[0],auditSession=Object.values(snapshot.sessions).find(s=>s.runtime?.runId===auditRecord.runId)!;
  const binding=auditSession.runtime!.collaboration!;
  const result=(id:string,slots:string[],unresolved:string[])=>({schemaVersion:'quandeck.runtime.v1',idempotencyKey:id,binding,kind:'result',payload:{title:'实际分析',body:id,deliverySlotIds:slots,sourceIds:[],unresolved,nextSteps:[]}});
  driver.emit(auditRecord,{status:'waiting_reply',submission:result('old-partial',[],['缺少源码'])});await runtime.flushRuntime();
  assert((await runtime.controlSession(auditSession.id,'reply',{prompt:'已补充源码，请继续定位'})).ok);
  driver.emit(auditRecord,{status:'waiting_reply',submission:result('complete-audit',[plan.slots.find(s=>s.taskKey===audit.key)!.id],[])});await runtime.flushRuntime();
  await runtime.stopGoalAutomation();snapshot=await runtime.load();
  const designRecord=driver.records[1],session=Object.values(snapshot.sessions).find(s=>s.runtime?.runId===designRecord.runId)!;
  assert.equal(await runtime.inspectContextRestart(session.id),undefined,'a current fixed source does not offer duplicate execution');
  // Reproduce the real old release: the design's immutable input pinned the earlier partial artifact.
  base.mutateRuntimeProject(projectId,d=>{
    const context=d.collaboration!.contextPackages.find(v=>v.id===session.runtime!.collaboration!.contextPackageId)!;
    const old=d.collaboration!.artifacts.find(a=>a.body==='old-partial')!;
    context.sources=[{id:old.id,title:old.title,excerpt:old.body,hash:old.hash,freshness:'candidate',taskKey:audit.key,required:true}];
  });
  driver.emit(designRecord,{status:'paused',stoppedConfirmed:true});await runtime.flushRuntime();
  snapshot=await runtime.load();
  return {base,driver,runtime,projectId,taskId,planId,plan,audit,design,session:snapshot.sessions[session.id],snapshot,designRecord};
}
async function main(){
  const f=await fixture(),{base,driver,runtime,projectId,session,design,audit,planId}=f;
  const before=await runtime.load(),frozen=JSON.stringify(before.collaboration!.contextPackages.find(c=>c.id===session.runtime!.collaboration!.contextPackageId)),facts=JSON.stringify(before.collaboration!.artifacts);
  const currentAudit=goalDeliveryReadiness(before,audit.key).artifact!.id;
  assert.equal((await runtime.inspectContextRestart(session.id))?.available,true);
  const controls=driver.controls.length;
  assert.equal((await runtime.controlSession(session.id,'resume')).ok,false);
  assert.equal((await runtime.controlSession(session.id,'reply',{prompt:'继续旧会话'})).ok,false);
  assert.equal(driver.controls.length,controls,'stale ordinary continuation is never sent');
  for(const change of [
    (s:typeof before)=>{s.sessions[session.id].runtime!.stoppedConfirmed=false;},
    (s:typeof before)=>{s.sessions[session.id].runtime!.requests={p:{id:'p',kind:'permission',prompt:'真实授权'}};},
    (s:typeof before)=>{s.collaboration!.tasks[design.key].claimEpoch++;},
    (s:typeof before)=>{s.collaboration!.tasks[design.key].specRevision++;},
    (s:typeof before)=>{s.collaboration!.tasks[design.key].status='in_review';},
    (s:typeof before)=>{s.collaboration!.runs[session.runtime!.collaboration!.runId].status='lost';},
    (s:typeof before)=>{s.ideaPlans![planId].draftVersion++;},
    (s:typeof before)=>{s.collaboration!.freshness[currentAudit]='stale';},
    (s:typeof before)=>{s.runtimeConnections!.codex.connectionId='other';},
    (s:typeof before)=>{s.collaboration!.externalActions.x={id:'x',key:design.key,operation:'publish',parameters:'external',status:'unknown',createdAt:new Date().toISOString()} as any;},
  ]){
    const copy=structuredClone(before);change(copy);
    assert.equal(inspectContextRestart(copy,copy.sessions[session.id])?.available,false,'changed safety guard cannot offer restart');
  }
  // Source stop must be independently confirmed, not inferred from the stored display label.
  f.designRecord.stoppedConfirmed=false;
  assert.equal((await runtime.restartFreshContext(session.id)).ok,false);assert.equal(driver.calls.length,2);
  f.designRecord.stoppedConfirmed=true;
  driver.onList=()=>{driver.onList=undefined;base.mutateRuntimeProject(projectId,d=>{d.collaboration!.tasks[design.key].version++;});};
  assert.equal((await runtime.restartFreshContext(session.id)).ok,false,'a task change during source preflight requires another explicit click');
  assert.equal(driver.calls.length,2);
  // An actual request cannot be replaced by a restart; its exact source reply remains actionable.
  driver.emit(f.designRecord,{status:'waiting_permission',request:{id:'current-permission',kind:'permission',prompt:'读取最新资料需要授权'}});await runtime.flushRuntime();
  assert.equal((await runtime.restartFreshContext(session.id)).ok,false);
  assert.equal((await runtime.controlSession(session.id,'reply',{requestId:'current-permission',decision:'denied'})).ok,true);
  driver.emit(f.designRecord,{status:'paused',requestResolved:'current-permission',stoppedConfirmed:true});await runtime.flushRuntime();
  // A slow attachment preparation must not reopen/fence the old run if the task changes.
  base.mutateRuntimeProject(projectId,d=>{d.tasks[f.taskId].attachments=[{id:'source-file',name:'source.txt',type:'text/plain',size:1}];});
  driver.prepareAttachments=async()=>{base.mutateRuntimeProject(projectId,d=>{d.collaboration!.tasks[design.key].version++;});return [{id:'source-file',name:'source.txt',path:'/restart-test/source.txt'}];};
  assert.equal((await runtime.restartFreshContext(session.id)).ok,false);assert.equal(driver.calls.length,2);
  assert.equal((await runtime.load()).collaboration!.tasks[design.key].activeRunId,session.runtime!.collaboration!.runId);
  driver.prepareAttachments=async()=>[{id:'source-file',name:'source.txt',path:'/restart-test/source.txt'}];
  const other=(await runtime.createProject({name:'切换后的项目'})).projectId!;
  const results=await Promise.all([runtime.restartFreshContext(session.id),runtime.restartFreshContext(session.id)]);
  assert(results.every(r=>r.ok),JSON.stringify(results));assert.equal(results[0].sessionId,results[1].sessionId);assert.equal(driver.calls.length,3,'double click creates one new run');
  assert.equal((await runtime.load()).project.id,other,'recovery stays in the original project without changing navigation');
  const after=(await runtime.listProjects()).find(p=>p.project.id===projectId)!,next=after.sessions[results[0].sessionId!],nextBinding=next.runtime!.collaboration!;
  const nextContext=after.collaboration!.contextPackages.find(c=>c.id===nextBinding.contextPackageId)!;
  assert.notEqual(next.runtime!.runId,session.runtime!.runId);assert.notEqual(nextBinding.runId,session.runtime!.collaboration!.runId);
  assert(nextBinding.claimEpoch>session.runtime!.collaboration!.claimEpoch);
  assert.deepEqual(nextContext.sources.map(s=>s.id),[currentAudit],'new run fixes the latest complete source, not old partial');
  assert.equal(JSON.stringify(after.collaboration!.contextPackages.find(c=>c.id===session.runtime!.collaboration!.contextPackageId)),frozen);
  assert.equal(JSON.stringify(after.collaboration!.artifacts),facts,'restart preserves all prior results');
  assert(after.collaboration!.events.some(e=>e.type==='task_context_restarted'));
  assert.equal(after.collaboration!.runs[session.runtime!.collaboration!.runId].status,'cancelled');
  assert.equal(after.sessions[session.id].runtime!.handedOffTo,next.id);
  assert.equal(next.runtime!.predecessorSessionId,session.id);
  assert.equal((await runtime.restartFreshContext(session.id)).sessionId,next.id);assert.equal(driver.calls.length,3,'persisted successor dedupes after the operation has completed');
  const oldResult={schemaVersion:'quandeck.runtime.v1',idempotencyKey:'late-old-result',binding:session.runtime!.collaboration!,kind:'result',payload:{title:'旧结果',body:'旧运行不得提交',sourceIds:[]}};
  driver.emit(f.designRecord,{status:'waiting_reply',submission:oldResult});await runtime.flushRuntime();
  const late=(await runtime.listProjects()).find(p=>p.project.id===projectId)!;
  assert.equal(late.collaboration!.tasks[design.key].activeRunId,nextBinding.runId,'late old-source events cannot steal the new claim');
  assert.equal(late.collaboration!.artifacts.length,before.collaboration!.artifacts.length,'late old result remains rejected');
  runtime.dispose();
  for(const unknown of [true,false]){
    const g=await fixture();g.driver.unknown=unknown;g.driver.reject=!unknown;
    const first=await g.runtime.restartFreshContext(g.session.id);assert.equal(first.ok,false);assert(first.sessionId);
    const count=g.driver.calls.length,again=await g.runtime.restartFreshContext(g.session.id);
    assert.equal(again.ok,false);assert.equal(again.sessionId,first.sessionId);assert.equal(g.driver.calls.length,count,'unknown/rejected admission retains its new identity and does not replay the original restart');
    g.runtime.dispose();
  }
  console.log('fresh context restart: immutable history, exact source refresh, stop/claim/permission/direction fences, cross-project routing, dedupe, late events and admission uncertainty passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
