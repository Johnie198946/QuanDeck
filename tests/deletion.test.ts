import { submitAndReviewOutput } from './manual-acceptance.fixture';
import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { LOCAL_PROJECTS_KEY } from '../src/data/projectStorage';
import { pendingScheduleTasks } from '../src/data/dailySchedule';
import { searchSnapshot } from '../src/data/search';
import { taskKey } from '../src/data/collaboration';
import type { Session } from '../src/data/types';

const memory = new Map<string,string>(); let failSave = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key:string) => memory.get(key) ?? null,
  setItem: (key:string,value:string) => { if (failSave) throw Error('quota'); memory.set(key,value); },
  removeItem: (key:string) => memory.delete(key),
}});
(async () => {
  const source = new LocalWorkdeckDataSource();
  const a = (await source.createProject({name:'保留历史的项目'})).projectId!;
  const root = (await source.createTaskWithAttachments('计划旅行删除测试', [{id:'file-a',name:'资料.pdf',type:'application/pdf',size:10}], a)).taskId!;
  const child = (await source.addManualSubtask(root,root,'交通删除测试')).itemId!;
  const nested = (await source.addManualSubtask(root,child,'列车删除测试')).itemId!;
  const sibling = (await source.addManualSubtask(root,root,'住宿保留测试')).itemId!;
  const output = await submitAndReviewOutput(source,{projectId:a,taskId:root,workItemId:nested,title:'列车结果',body:'确认车次'}); assert(output.ok);
  let snap = await source.load(); const originalFacts = structuredClone(snap.collaboration!.artifacts);
  await source.addPlan({taskId:root,workItemId:child,title:'交通安排',date:snap.date,start:'13:00',minutes:30,kind:'flexible'},a);
  const before = await source.load(); failSave=true;
  await assert.rejects(source.deleteTask(root,a,child), /未保存/); failSave=false;
  assert.deepEqual(await source.load(),before,'failed save cannot partially archive/delete');
  assert((await source.deleteTask(root,a,child)).ok);
  snap=await source.load();
  assert(snap.tasks[root]); assert(snap.orchestrations![root].items[sibling]);
  assert.equal(snap.orchestrations![root].items[child],undefined); assert.equal(snap.orchestrations![root].items[nested],undefined);
  assert.equal(snap.deletedWorkItems![taskKey(root,nested)].item.title,'列车删除测试');
  assert(snap.collaboration!.tasks[taskKey(root,nested)].archived);
  assert.equal(JSON.stringify(snap.collaboration!.artifacts),JSON.stringify(originalFacts),'published source content remains exact');
  assert(snap.outputs![output.outputId!]); assert(snap.plans[0].cancelled);
  assert.equal(searchSnapshot(snap,{projectId:a,query:'列车删除测试'}).items.some(hit=>hit.target.itemId===nested),false);
  assert.equal((await source.deleteTask(root,a,child)).ok,false);

  const b=(await source.createProject({name:'另一个项目'})).projectId!;
  const other=(await source.createTaskWithAttachments('另一个项目待办',[],b)).taskId!;
  assert((await source.deleteTask(root,a)).ok,'delete is bound to the clicked project even after switching');
  assert.equal((await source.load()).project.id,b);
  snap=(await source.listProjects()).find(p=>p.project.id===a)!;
  assert.equal(snap.tasks[root],undefined); assert.equal(snap.deletedTasks![root].task.attachments![0].id,'file-a');
  assert.equal(snap.journal.blocks.some(block=>block.kind==='task'&&block.taskId===root),false);
  assert.equal(pendingScheduleTasks([snap],snap.date).length,0);
  assert.equal(searchSnapshot(snap,{projectId:a,query:'删除测试'}).total,0,'removed root and retained subtree are absent from main search');
  assert.equal((await source.load()).tasks[other].title,'另一个项目待办');
  assert.equal(JSON.stringify(snap.collaboration!.artifacts),JSON.stringify(originalFacts));
  const reloaded=new LocalWorkdeckDataSource();
  assert.equal((await reloaded.listProjects()).find(p=>p.project.id===a)!.tasks[root],undefined);
  assert((await reloaded.deleteProject(a)).ok); assert.equal((await reloaded.load()).project.id,b);
  assert.equal((await reloaded.listProjects()).length,1);
  assert.equal((await reloaded.switchProject(a)).ok,false);
  assert.equal((await reloaded.deleteTask(root,a)).ok,false);
  assert.throws(()=>reloaded.mutateRuntimeProject(a,d=>{d.project.name='resurrect';}),/已删除/);
  const retained=JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!).projects[a];
  assert(retained.project.deletedAt); assert.equal(JSON.stringify(retained.collaboration.artifacts),JSON.stringify(originalFacts));

  assert.equal((await reloaded.listArchivedProjects())[0].project.id,a);
  assert((await reloaded.restoreProject(a)).ok);assert.equal((await reloaded.load()).project.id,a);
  assert.equal(JSON.stringify((await reloaded.load()).collaboration!.artifacts),JSON.stringify(originalFacts));
  assert((await reloaded.archiveProject(a)).ok);assert.equal((await reloaded.load()).project.id,b);

  const planSnap=await reloaded.load();
  await reloaded.addPlan({taskId:other,title:'人工计时',date:planSnap.date,start:'15:00',minutes:30,kind:'fixed'},b);
  const planId=(await reloaded.load()).plans[0].id;
  await reloaded.setPlanTimer(planId,true,b);
  assert.equal((await reloaded.deleteTask(other,b)).ok,false); assert.equal((await reloaded.deleteProject(b)).ok,false);
  await reloaded.setPlanTimer(planId,false,b);
  reloaded.mutateRuntimeProject(b,d=>{d.sessions.running={id:'running',agentId:'codex',title:'执行中',origin:'dispatch',taskId:other,status:'running',startedAt:new Date().toISOString(),lastActivity:d.now,step:null,tokens:null,rounds:[],subAgents:[]};});
  assert.equal((await reloaded.deleteTask(other,b)).ok,false); assert.equal((await reloaded.deleteProject(b)).ok,false);
  reloaded.mutateRuntimeProject(b,d=>{d.sessions.running.status='paused';});
  assert.equal((await reloaded.deleteTask(other,b)).ok,false,'paused resumable source is not silently detached');
  reloaded.mutateRuntimeProject(b,d=>{d.sessions.running.status='archived';});
  failSave=true; await assert.rejects(reloaded.deleteProject(b),/未保存/); failSave=false;
  assert.equal((await reloaded.load()).project.id,b);
  assert((await reloaded.deleteProject(b)).ok); assert.deepEqual(await reloaded.listProjects(),[]);
  assert.equal((await reloaded.load()).project.id,''); assert.equal((await new LocalWorkdeckDataSource().load()).project.id,'');
  assert((await reloaded.createProject({name:'删除后重新开始'})).ok);
  const guarded=(await reloaded.createProject({name:'讨论与复核关联守卫'})).projectId!;
  const idea=await reloaded.createIdea('有独立讨论执行的原任务');
  const branch=(await reloaded.addManualSubtask(idea.taskId,idea.taskId,'讨论子分支')).itemId!;
  const siblingBranch=(await reloaded.addManualSubtask(idea.taskId,idea.taskId,'无关子分支')).itemId!;
  const localPlan=await reloaded.openLocalPlan(idea.taskId,branch);
  const planning=(await reloaded.createTaskWithAttachments('独立规划任务',[],guarded)).taskId!;
  const unrelated=(await reloaded.createTaskWithAttachments('无关任务允许删除',[],guarded)).taskId!;
  const makeSession=(id:string, owner:string, meta:Partial<NonNullable<Session['runtime']>>):Session=>({
    id,agentId:'codex',title:id,origin:'dispatch',taskId:owner,status:'running',startedAt:new Date().toISOString(),lastActivity:new Date().toISOString(),tokens:null,step:null,rounds:[],subAgents:[],
    runtime:{dispatchId:id,projectId:guarded,taskId:owner,purpose:'discussion',connection:{connectionId:'guard-fixture',tool:'codex',projectPath:'/fixture'},context:{taskTitle:id,prompt:'fixture',capturedAt:new Date().toISOString()},sequence:0,eventIds:[],...meta},
  });
  reloaded.mutateRuntimeProject(guarded,d=>{d.sessions.discussion=makeSession('discussion',planning,{planId:idea.planId});});
  assert.equal((await reloaded.deleteTask(idea.taskId,guarded)).ok,false,'root discussion is associated through planId, not planning task ID');
  assert((await reloaded.deleteTask(unrelated,guarded)).ok,'independent discussion does not block unrelated tasks');
  reloaded.mutateRuntimeProject(guarded,d=>{d.sessions.discussion.status='archived';d.sessions.childDiscussion=makeSession('childDiscussion',planning,{planId:localPlan});});
  assert.equal((await reloaded.deleteTask(idea.taskId,guarded,branch)).ok,false,'local method discussion protects its exact subtree');
  assert((await reloaded.deleteTask(idea.taskId,guarded,siblingBranch)).ok,'unrelated sibling is not blocked by local method discussion');
  reloaded.mutateRuntimeProject(guarded,d=>{
    d.sessions.childDiscussion.status='archived';
    const at=new Date().toISOString();
    d.collaboration!.runs['discussion-run']={id:'discussion-run',key:planning,executor:'codex',purpose:'discussion',status:'running',specRevision:1,claimEpoch:1,sessionId:'childDiscussion',startedAt:at,lastHeartbeatAt:at,leaseExpiresAt:at,reservedTokens:100,actualTokens:null};
  });
  assert.equal((await reloaded.deleteTask(idea.taskId,guarded,branch)).ok,false,'still-active managed run blocks deletion even if session record was archived');
  reloaded.mutateRuntimeProject(guarded,d=>{d.collaboration!.runs['discussion-run'].status='succeeded';});
  assert((await reloaded.deleteTask(idea.taskId,guarded,branch)).ok,'completed and archived discussion allows subtree deletion');
  assert((await reloaded.deleteTask(idea.taskId,guarded)).ok,'completed discussions allow root deletion');

  const reviewTarget=(await reloaded.createTaskWithAttachments('等待独立复核的原任务',[],guarded)).taskId!;
  const reviewedChild=(await reloaded.addManualSubtask(reviewTarget,reviewTarget,'待复核子任务')).itemId!;
  const unrelatedChild=(await reloaded.addManualSubtask(reviewTarget,reviewTarget,'未参与复核子任务')).itemId!;
  assert((await reloaded.saveTaskOutput({projectId:guarded,taskId:reviewTarget,workItemId:reviewedChild,title:'待复核成果',body:'候选内容'})).ok);
  const submission=(await reloaded.load()).collaboration!.submissions.find(value=>value.key===taskKey(reviewTarget,reviewedChild))!;
  const reviewer=(await reloaded.createTaskWithAttachments('独立复核任务',[],guarded)).taskId!;
  reloaded.mutateRuntimeProject(guarded,d=>{d.sessions.review=makeSession('review',reviewer,{purpose:'review',reviewSubmissionId:submission.id});});
  assert.equal((await reloaded.deleteTask(reviewTarget,guarded)).ok,false,'reviewSubmissionId links independent review to source root');
  assert.equal((await reloaded.deleteTask(reviewTarget,guarded,reviewedChild)).ok,false,'review protects the submitted subtree');
  assert((await reloaded.deleteTask(reviewTarget,guarded,unrelatedChild)).ok,'review does not block unrelated sibling');
  reloaded.mutateRuntimeProject(guarded,d=>{d.sessions.review.status='archived';});
  assert((await reloaded.deleteTask(reviewTarget,guarded,reviewedChild)).ok,'archived completed review allows deletion');
  assert((await reloaded.deleteTask(reviewTarget,guarded)).ok);
  const all=JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!);delete all.projects[a];memory.set(LOCAL_PROJECTS_KEY,JSON.stringify(all));
  const unaffected=await reloaded.getProjectSnapshot(guarded);reloaded.reloadAfterProjectErasure([a]);
  assert.equal((await reloaded.restoreProject(a)).ok,false,'erased archive cannot be restored');
  assert.throws(()=>reloaded.mutateRuntimeProject(a,d=>{d.project.name='late';}),/不存在|删除/);
  reloaded.mutateRuntimeProject(guarded,d=>{d.project.description='still writable after scoped reload';});
  assert.equal((await reloaded.getProjectSnapshot(guarded))!.project.description,'still writable after scoped reload');
  assert.equal((await reloaded.getProjectSnapshot(guarded))!.project.id,unaffected!.project.id);
  console.log('deletion: project/task/subtree removal, immutable history, attachments, direct/discussion/review run guards, schedule/search, explicit project routing, restart and persistence rollback passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Source acknowledgement is required before removal; sending stop cannot detach a running Agent.
(async () => {
  const { deletionIssues, closeDeletionSession } = await import('../src/data/deletion');
  const { createEmptySnapshot } = await import('../src/data/projectStorage');
  const projectId='closing-fixture', taskId='close-task';
  const snapshot=createEmptySnapshot({id:projectId,name:'收尾回执测试',description:'',color:'#A94435',createdAt:new Date().toISOString()});
  snapshot.sessions.closeMe={id:'closeMe',agentId:'codex',title:'等待回复的方向讨论',origin:'dispatch',taskId,status:'waiting_reply',startedAt:snapshot.now,lastActivity:snapshot.now,step:null,tokens:null,rounds:[],subAgents:[],runtime:{runId:'close-run',dispatchId:'close-dispatch',projectId,taskId,purpose:'discussion',connection:{connectionId:'fixture',tool:'codex',projectPath:'/fixture'},context:{taskTitle:'测试',prompt:'test',capturedAt:snapshot.now},sequence:0,eventIds:[]}};
  const issues=deletionIssues(snapshot); assert.equal(issues[0].canClose,true);assert.equal(issues[0].detail,'等待回复');
  const calls:string[]=[];
  const api={listProjects:async()=>[structuredClone(snapshot)],controlSession:async (_id:string,action:any)=>{calls.push(action);return {ok:true};}};
  assert.equal((await closeDeletionSession(api,projectId,'closeMe')).ok,false,'an unacknowledged archive cannot remove the guard');
  assert.deepEqual(calls,['archive']);
  snapshot.sessions.closeMe.status='running';calls.length=0;
  assert.equal((await closeDeletionSession(api,projectId,'closeMe')).ok,false);assert.deepEqual(calls,['stop']);
  const confirmed={...api,controlSession:async (_id:string,action:any)=>{calls.push(action);snapshot.sessions.closeMe.status=action==='stop'?'paused':'archived';return {ok:true};}};
  calls.length=0;assert((await closeDeletionSession(confirmed,projectId,'closeMe')).ok);assert.deepEqual(calls,['stop','archive']);
  assert.equal(deletionIssues(snapshot).length,0);
  snapshot.sessions.closeMe.runtime!.stoppedConfirmed=false;
  assert.equal(deletionIssues(snapshot)[0].detail,'源端停止尚未确认');
  assert.equal((await closeDeletionSession(confirmed,projectId,'closeMe')).ok,false,'terminal label cannot override explicit missing stop proof');
  snapshot.sessions.closeMe.runtime!.stoppedConfirmed=true;
  assert.equal(deletionIssues(snapshot).length,0);
})().catch(error=>{console.error(error);process.exitCode=1;});
