import assert from 'node:assert/strict';
import { decomposePlan, directionApproved, type PlanDecompositionSource } from '../src/data/planActions';
import { createEmptySnapshot } from '../src/data/projectStorage';
import type { IdeaPlan, Session } from '../src/data/types';
import type { DesktopHost } from '../src/integration/desktop';

async function main() {
  const snap = createEmptySnapshot();
  snap.project.id = 'original-project';
  const plan: IdeaPlan = { id:'plan-one', taskId:'task-one', itemId:null, title:'方向', script:'generic', step:0, round:1, draft:{sections:[]}, draftVersion:3, adopted:{version:1,draftVersion:3,doc:{sections:[]},at:'2026-11-17T00:00:00Z',conclusionIds:['approved-conclusion']},turns:[],drafts:[],discussion:{agentId:'codex',conclusions:[{id:'new-decomposition-conclusion',agentId:'codex',scopeId:'root',recordedAt:'2026-11-17T00:01:00Z',summary:'已生成任务',confirmed:[],open:[],source:'agent'}]}};
  assert.equal(directionApproved(plan),true,'a new decomposition reply never revokes approved direction');
  assert.equal(directionApproved({...plan,draftVersion:4}),false,'revised direction requires new approval');
  assert.equal(directionApproved({...plan,adopted:null}),false);
  const starts:unknown[][]=[], controls:unknown[][]=[], opened:string[]=[];
  const source:PlanDecompositionSource={startDiscussion:async(...args)=>{starts.push(args);return{ok:true,sessionId:'new-session'}},listProjects:async()=>[createEmptySnapshot(),{...snap,sessions:{'new-session':{runtime:{runId:'new-original-run'}} as Session}}]};
  const host={controlRun:async(...args:unknown[])=>{controls.push(args);return{ok:true}},openRun:async(runId:string)=>{opened.push(runId)}} as unknown as DesktopHost;
  await decomposePlan(source,host,snap,plan);
  assert.deepEqual(starts[0],['plan-one','codex','root','original-project']);
  assert.deepEqual(opened,['new-original-run'],'receipt opens from original project even if active project changed');
  snap.sessions.existing={id:'existing',agentId:'codex',title:'讨论',taskId:null,origin:'dispatch',status:'waiting_reply',startedAt:'2026-11-17T00:00:00Z',lastActivity:'2026-11-17T00:01:00Z',step:null,tokens:null,rounds:[],subAgents:[],runtime:{runId:'existing-run',projectId:'original-project',planId:'plan-one',purpose:'discussion'} as Session['runtime']};
  await decomposePlan(source,host,snap,plan);
  assert.deepEqual(controls,[['existing-run','decompose_plan']]);
  assert.equal(starts.length,1,'existing run must pass through host stop/archive handling before creating a successor');
  const unavailable=await decomposePlan(source,undefined,snap,plan);
  assert.equal(unavailable.ok,false);assert.equal(starts.length,1,'no duplicate active discussion without host');
  const unapproved=await decomposePlan(source,host,snap,{...plan,adopted:null});assert.equal(unapproved.ok,false);
  console.log('Plan actions: revision-based approval, host-routed transitions and explicit project-bound start passed');
}
void main();
