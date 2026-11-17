import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunWorkflow, locateRunWorkflow, isExecutionIntent } from './app/run-workflow.mjs';

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
test('console shows the canonical rejected reply issue without trusting transport state', async()=>{
  const f=fixture();
  f.run.submissionIssue={code:'transport-only',message:'not authoritative'};
  assert.equal((await f.host.read('run-original')).submissionIssue,undefined);
  const issue={code:'DISCUSSION_CONTEXT_STALE',message:'原回复已保留在会话历史，未写入当前方案。请先停止并归档原讨论，再从当前方向重新开始。'};
  f.session.runtime.submissionIssue=issue;
  assert.deepEqual((await f.host.read('run-original')).submissionIssue,issue);
  delete f.session.runtime.submissionIssue;
  assert.equal((await f.host.read('run-original')).submissionIssue,undefined);
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
test('explicit execution starts the existing task tree instead of only navigating',async()=>{
  const f=fixture();f.project.orchestrations.root={items:{child:{id:'child',status:'not_started'}}};
  assert((await f.host.control('run-original','execute_task')).ok);
  assert.equal(f.calls.filter(c=>c.automation).length,1);
  assert.equal(f.calls.some(c=>c.dispatch),false);
  assert.equal(f.calls.some(c=>c.action==='archive'),true);
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


test('real user execution words switch phase once and preserve scoped intent', async()=>{
  const f=fixture();f.plan.adopted={version:1,draftVersion:2};
  const receipt=await f.host.control('run-original','reply',{prompt:'支持。请执行',expectedVersion:2,conclusionId:'conclusion'});
  assert.equal(receipt.ok,true);
  assert.equal(f.calls.some(c=>c.action==='reply'),false);
  assert.equal(f.calls.some(c=>c.approve),false);
  assert.deepEqual(f.calls.find(c=>c.automation).automation[1].executionIntent,{text:'支持。请执行',sourceSessionId:'session-original'});
});
test('execution intent never guesses permission, ambiguous edits, negations or stale approval',async()=>{
  for(const text of ['请执行吗？','不要执行','确认，不执行','如果可行请执行','先修改酒店，然后执行','他说“请执行”','请执行\n我补充的附件：x.png','我授权你执行。'])assert.equal(isExecutionIntent(text),false,text);
  for(const text of ['支持。请执行','按方案执行','开始自动执行','我满意方案了，开始执行','Yes, please execute.'])assert.equal(isExecutionIntent(text),true,text);
  const f=fixture();assert.equal((await f.host.control('run-original','reply',{prompt:'开始执行',expectedVersion:1})).ok,false);assert.equal(f.calls.length,0);
  const permission=fixture('waiting_permission');
  assert.equal((await permission.host.control('run-original','reply',{prompt:'开始执行'})).ok,false);
  assert.equal(permission.calls.length,0);
  const execution=fixture();execution.run.purpose='execution';
  await execution.host.control('run-original','reply',{prompt:'开始执行'});
  assert.equal(execution.calls[0].action,'reply');
});


test('completed candidate console closes ordinary reply and navigates exact original task output', async()=>{
  const f=fixture();f.run.purpose='execution';delete f.session.runtime.planId;
  f.run.status='waiting_reply';f.run.controls={canReply:true,canResume:true};
  const delivery={projectId:'project-original',taskId:'root',workItemId:'leaf',submissionId:'submission-1',title:'真实候选',accepted:false};
  f.source.getSessionDelivery=async id=>id==='session-original'?delivery:undefined;
  const view=await f.host.read('run-original');
  assert.equal(view.status,'waiting_reply','read preserves the actual source lifecycle');
  assert.equal(view.controls.canReply,false);assert.equal(view.controls.canResume,false);
  assert.deepEqual(view.delivery,delivery);assert.equal(f.run.controls.canReply,true,'view must not mutate source controls');
  assert((await f.host.control('run-original','open_delivery')).ok);
  assert((await f.host.control('run-original','open_revision')).ok);
  assert.deepEqual(f.calls,[
    {navigate:{projectId:'project-original',taskId:'root',itemId:'leaf',view:'results'}},
    {navigate:{projectId:'project-original',taskId:'root',itemId:'leaf',view:'plan'}},
  ],'opening the revision editor does not reopen or resume the completed run');
  f.source.getSessionDelivery=async()=>undefined;
  assert.equal((await f.host.read('run-original')).controls.canReply,true,'partial work keeps the existing reply flow');
  assert.equal((await f.host.control('run-original','open_revision')).ok,false,'stale delivery navigation is rejected');
  assert.equal(f.calls.length,2);
});

test('stale context offers explicit new attempt and opens its original-project receipt',async()=>{
  const f=fixture('paused');f.run.purpose='execution';delete f.session.runtime.planId;
  f.run.controls={canReply:true,canResume:true};
  f.source.inspectContextRestart=async id=>id===f.session.id?{available:true,reason:'旧资料已失效'}:undefined;
  f.source.restartFreshContext=async id=>{f.calls.push({restart:id});f.project.sessions.successor={id:'successor',runtime:{runId:'run-new'}};return {ok:true,sessionId:'successor'};};
  const view=await f.host.read('run-original');assert.equal(view.contextRestart.available,true);assert.equal(view.controls.canReply,false);assert.equal(view.controls.canResume,false);assert.equal(f.run.controls.canReply,true);
  assert((await f.host.control('run-original','restart_fresh_context')).ok);
  assert.deepEqual(f.calls,[{restart:'session-original'},{open:'run-new'}]);
  f.source.restartFreshContext=async()=>({ok:false,message:'停止回执待核对'});
  assert.equal((await f.host.control('run-original','restart_fresh_context')).ok,false);assert.equal(f.calls.length,2,'failed preflight cannot open a nonexistent new run');
});
