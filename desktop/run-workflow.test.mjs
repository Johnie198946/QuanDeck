import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunWorkflow, locateRunWorkflow } from './app/run-workflow.mjs';

function fixture(status='waiting_reply') {
  const plan={id:'plan-original',taskId:'root',draftVersion:2,adopted:null,discussion:{conclusions:[{id:'conclusion',scopeId:'root'}]}};
  const session={id:'session-original',agentId:'codex',status,dispatchPhase:'acknowledged',runtime:{runId:'run-original',planId:plan.id,scope:'root'}};
  const project={project:{id:'project-original'},sessions:{[session.id]:session},ideaPlans:{[plan.id]:plan},orchestrations:{}};
  const projects=[{project:{id:'current-other-project'},sessions:{}},project],calls=[];
  const source={
    listProjects:async()=>structuredClone(projects),
    controlSession:async(id,action,payload)=>{calls.push({id,action,payload});session.status=action==='stop'?'paused':'archived';return {ok:true};},
    approvePlan:async(...args)=>{calls.push({approve:args});plan.adopted={version:1,draftVersion:2};return {ok:true,added:0};},
    startDiscussion:async(...args)=>{calls.push({discuss:args});return {ok:true};},
    dispatchProjectTask:async(...args)=>{calls.push({dispatch:args});return {ok:true};},
  };
  const host=createRunWorkflow({source,readRun:id=>({runId:id,purpose:'discussion'}),openRun:async id=>calls.push({open:id}),showMain:async target=>calls.push({navigate:target})});
  return {host,source,project,plan,session,projects,calls};
}
test('console workflow reads persisted approval and original project',async()=>{
  const f=fixture();assert.equal((await f.host.read('run-original')).workflow.approved,false);
  assert((await f.host.control('run-original','approve_plan',{conclusionId:'conclusion',expectedVersion:2})).ok);
  assert.deepEqual(f.calls,[{approve:['plan-original','conclusion','project-original',2]}]);
  assert.equal((await f.host.read('run-original')).workflow.approved,true);
  assert.equal(locateRunWorkflow(f.projects,'missing'),null);
});
test('explicit direct execution closes discussion and dispatches exact project task',async()=>{
  const f=fixture('running');assert((await f.host.control('run-original','execute_task')).ok);
  assert.deepEqual(f.calls.map(c=>c.action||c.dispatch),['stop','archive',['project-original','root','codex',undefined]]);
});
test('unacknowledged stop cannot start a second process',async()=>{
  const f=fixture('running');f.source.controlSession=async()=>({ok:true});
  assert.equal((await f.host.control('run-original','execute_task')).ok,false);
  assert.equal(f.calls.some(c=>c.dispatch),false);
});
test('approved direction decomposition does not ask approval again or switch projects',async()=>{
  const f=fixture();assert.equal((await f.host.control('run-original','decompose_plan')).ok,false);
  f.plan.adopted={version:1,draftVersion:2};assert((await f.host.control('run-original','decompose_plan')).ok);
  assert.deepEqual(f.calls.map(c=>c.action||c.discuss),['archive',['plan-original','codex','root','project-original']]);
});
test('existing task tree opens instead of dispatching a monolithic task',async()=>{
  const f=fixture();f.project.orchestrations.root={items:{child:{id:'child',status:'not_started'}}};
  assert((await f.host.control('run-original','execute_task')).ok);
  assert.deepEqual(f.calls,[{navigate:{projectId:'project-original',taskId:'root',view:'tasks'}}]);
});
test('reply metadata reaches domain confirmation command without host inventing authority',async()=>{
  const f=fixture();const payload={prompt:'已确认酒店',confirmedInformation:['Hotel'],conclusionId:'conclusion'};
  await f.host.control('run-original','reply',payload);assert.deepEqual(f.calls,[{id:'session-original',action:'reply',payload}]);
});
