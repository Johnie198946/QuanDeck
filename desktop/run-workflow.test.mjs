import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunWorkflow, locateRunWorkflow } from './app/run-workflow.mjs';

function fixture(status='waiting_reply') {
  const plan={id:'plan-original',taskId:'root',draftVersion:2,adopted:null,discussion:{conclusions:[{id:'conclusion',scopeId:'root'}]}};
  const session={id:'session-original',agentId:'codex',status,dispatchPhase:'acknowledged',runtime:{runId:'run-original',planId:plan.id,scope:'root'}};
  const project={project:{id:'project-original'},sessions:{[session.id]:session},ideaPlans:{[plan.id]:plan},orchestrations:{}};
  const run={runId:'run-original',purpose:'discussion',stoppedConfirmed:true};
  const projects=[{project:{id:'current-other-project'},sessions:{}},project],calls=[];
  const source={
    listProjects:async()=>structuredClone(projects),
    controlSession:async(id,action,payload)=>{calls.push({id,action,payload});session.status=action==='stop'?'paused':'archived';return {ok:true};},
    approvePlan:async(...args)=>{calls.push({approve:args});plan.adopted={version:1,draftVersion:2};return {ok:true,added:0};},
    configureGoalAutomation:async(...args)=>{calls.push({automation:args});return {ok:true};},
    startDiscussion:async(...args)=>{calls.push({discuss:args});return {ok:true};},
    dispatchProjectTask:async(...args)=>{calls.push({dispatch:args});return {ok:true};},
  };
  const host=createRunWorkflow({source,readRun:()=>run,openRun:async id=>calls.push({open:id}),showMain:async target=>calls.push({navigate:target})});
  return {host,source,project,plan,session,projects,calls,run};
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

test('recovered unconfirmed source cannot be followed by another execution',async()=>{
  const f=fixture('paused');f.run.stoppedConfirmed=false;
  assert.equal((await f.host.control('run-original','execute_task')).ok,false);
  assert.equal(f.calls.some(c=>c.dispatch),false);
  f.plan.adopted={version:1,draftVersion:2};
  assert.equal((await f.host.control('run-original','decompose_plan')).ok,false);
  assert.equal(f.calls.some(c=>c.discuss),false);
});
test('old console cannot approve unseen conclusions from a newer session',async()=>{
  const f=fixture();f.plan.discussion.conclusions=[{id:'conclusion:session-original:reply-old',scopeId:'root'},{id:'conclusion:session-new:reply-new',scopeId:'root'}];
  f.project.sessions['session-new']={...f.session,id:'session-new',runtime:{...f.session.runtime,runId:'run-new'}};
  const old=await f.host.read('run-original');assert.equal(old.workflow.conclusionId,'conclusion:session-original:reply-old');
  assert.equal((await f.host.control('run-original','approve_plan')).ok,false);
  assert.equal(f.calls.some(c=>c.approve),false);
  assert.equal((await f.host.control('run-new','approve_plan')).ok,true);
});

test('visual feedback uses original session and persisted conclusion projection', async()=>{
  const f=fixture();f.plan.discussion.conclusions[0].id='conclusion:session-original:m1';f.plan.discussion.conclusions[0].sourceMessageId='m1';
  f.plan.discussion.conclusions[0].visualBlocks=[{id:'block',hash:'hash',kind:'fact',title:'测试',facts:[],sources:[]}];
  f.project.collaboration={discussionFeedback:[{feedbackId:'f',binding:{conclusionId:'conclusion:session-original:m1'}}]};
  f.source.sendDiscussionFeedback=async(id,input)=>{f.calls.push({id,input});return {ok:true};};
  const input={feedbackId:'f'};assert((await f.host.control('run-original','discussion_feedback',input)).ok);
  assert.deepEqual(f.calls,[{id:'session-original',input}]);
  const view=await f.host.read('run-original');assert.equal(view.workflow.conclusions[0].visualBlocks[0].id,'block');assert.equal(view.workflow.conclusions[0].feedback[0].feedbackId,'f');
});


test('one approval starts scoped automatic execution after discussion closure', async()=>{
  const f=fixture();f.plan.scope='project';f.plan.taskId='';
  assert((await f.host.control('run-original','approve_and_execute',{conclusionId:'conclusion',expectedVersion:2})).ok);
  assert.deepEqual(f.calls,[{approve:['plan-original','conclusion','project-original',2]}, {id:'session-original',action:'archive',payload:undefined}, {automation:['plan-original',{enabled:true,agentId:'codex',expectedDraftVersion:2},'project-original']}, {navigate:{projectId:'project-original',taskId:'',planId:'plan-original',view:'plan'}}]);
});
test('existing approval is reused and stale version cannot enable automation',async()=>{
  const f=fixture();f.plan.adopted={version:1,draftVersion:2};
  assert.equal((await f.host.control('run-original','enable_automation',{expectedVersion:1})).ok,false);
  assert.equal(f.calls.length,0);
  assert((await f.host.control('run-original','enable_automation',{expectedVersion:2})).ok);
  assert.equal(f.calls.some(c=>c.approve),false);
  assert.equal(f.calls.filter(c=>c.automation).length,1);
});
test('project goal cannot use monolithic direct execution and unknown stop blocks automation',async()=>{
  const f=fixture();f.plan.scope='project';f.plan.taskId='';
  assert.equal((await f.host.control('run-original','execute_task')).ok,false);
  f.plan.adopted={version:1,draftVersion:2};f.run.stoppedConfirmed=false;
  assert.equal((await f.host.control('run-original','enable_automation',{expectedVersion:2})).ok,false);
  assert.equal(f.calls.some(c=>c.automation),false);
});

test('automation binds the atomic approval receipt when adopting changes advances the version',async()=>{
  const f=fixture();f.source.approvePlan=async()=>{f.plan.draftVersion=3;f.plan.adopted={version:1,draftVersion:3};return {ok:true,approvedDraftVersion:3};};
  assert((await f.host.control('run-original','approve_and_execute',{expectedVersion:2})).ok);
  assert.equal(f.calls.find(call=>call.automation).automation[1].expectedDraftVersion,3);
});
