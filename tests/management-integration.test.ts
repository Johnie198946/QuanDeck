import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { applyCollaboration, type CollaborationCommandType, type CollaborationResult } from '../src/data/collaboration';
import { issueArtifactReadToken } from '../src/data/governance';
import { LOCAL_PROJECTS_KEY } from '../src/data/projectStorage';
import type { Snapshot } from '../src/data/types';

const memory=new Map<string,string>();let failWrite=false,serial=0;
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{if(failWrite)throw Error('simulated disk full');memory.set(k,v);},removeItem:(k:string)=>memory.delete(k)}});
const base=new LocalWorkdeckDataSource();
const snapshot=async(id:string)=>(await base.listProjects()).find(s=>s.project.id===id)!;
async function cmd(projectId:string,type:CollaborationCommandType,payload:Record<string,unknown>,key?:string){
  const s=await snapshot(projectId);
  return base.collaborate({projectId,type,payload,taskId:key,expectedVersion:key?s.collaboration!.tasks[key].version:undefined,idempotencyKey:'management-'+ ++serial});
}
async function task(projectId:string,owner:'me'|'agent'='me') {const r=await cmd(projectId,'create_task',{title:'管理任务',goal:'生成可验收成果',criteria:['核对依据'],owner});assert(r.ok,r.message);return r.resourceId!;}
async function humanOutput(projectId:string,key:string){const submit=await cmd(projectId,'submit',{title:'来源成果',body:'经核对的来源正文。'.repeat(100),sourceIds:[]},key);assert(submit.ok,submit.message);await accept(projectId,key,submit.resourceId!);return (await snapshot(projectId)).collaboration!.tasks[key].acceptedArtifactId!;}
async function accept(projectId:string,key:string,submissionId:string){const r=await cmd(projectId,'review',{submissionId,verdict:'accepted',note:'已逐项核对',checks:[true]},key);assert(r.ok,r.message);return r;}
async function claim(projectId:string,key:string){let r!:CollaborationResult;base.mutateRuntimeProject(projectId,d=>{r=applyCollaboration(d,{projectId,type:'claim',taskId:key,idempotencyKey:'claim-'+ ++serial,payload:{executor:'fixture-agent'}},{kind:'service'});if(!r.ok)throw Error(r.message);});return r.resourceId!;}
async function grant(sourceId:string,targetId:string,artifactId:string,runId:string,expiresAt=new Date(Date.now()+3600000).toISOString()){
  const r=await cmd(sourceId,'grant_artifacts',{principalId:'local-user',targetProjectId:targetId,artifactIds:[artifactId],expiresAt});assert(r.ok,r.message);
  const source=await snapshot(sourceId);let token='';base.mutateRuntimeProject(targetId,d=>{token=issueArtifactReadToken(source,d,{runId,grantId:r.resourceId!}).token;});
  return {id:r.resourceId!,token,sourceProjectId:sourceId,artifactIds:[artifactId],expiresAt};
}
async function agentOutput(projectId:string,key:string,runId:string){let r!:CollaborationResult;base.mutateRuntimeProject(projectId,d=>{r=applyCollaboration(d,{projectId,type:'submit',taskId:key,idempotencyKey:'agent-'+ ++serial,payload:{title:'Agent 综合',body:'Agent 返回的候选成果',sourceIds:[]}},{kind:'runtime',runId,claimEpoch:d.collaboration!.runs[runId].claimEpoch});if(!r.ok)throw Error(r.message);});return r.resourceId!;}

async function main(){
  // Insertion order intentionally opposes dependency order: C -> B -> A in the library.
  const c=(await base.createProject({name:'C'})).projectId!, b=(await base.createProject({name:'B'})).projectId!, a=(await base.createProject({name:'A'})).projectId!;
  const aKey=await task(a), aArtifact=await humanOutput(a,aKey);
  const bKey=await task(b,'agent'), bRun=await claim(b,bKey), ab=await grant(a,b,aArtifact,bRun,new Date(Date.now()+60000).toISOString());
  await base.readGrantedEvidence(a,b,{token:ab.token,artifactId:aArtifact,limit:100});
  await accept(b,bKey,await agentOutput(b,bKey,bRun));
  const bArtifact=(await snapshot(b)).collaboration!.tasks[bKey].acceptedArtifactId!;
  const cKey=await task(c,'agent'), cRun=await claim(c,cKey), bc=await grant(b,c,bArtifact,cRun);
  await base.readGrantedEvidence(b,c,{token:bc.token,artifactId:bArtifact,limit:100});
  await accept(c,cKey,await agentOutput(c,cKey,cRun));
  const before=await base.listProjects(), disk=memory.get(LOCAL_PROJECTS_KEY);
  failWrite=true;await assert.rejects(()=>cmd(a,'revoke_grant',{grantId:ab.id}));failWrite=false;
  assert.deepEqual(await base.listProjects(),before,'failed transitive reconciliation leaves every project and cached engine unchanged');
  assert.equal(memory.get(LOCAL_PROJECTS_KEY),disk);
  const chainNow=Date.now;Date.now=()=>Date.parse(ab.expiresAt)+1;
  try {base.reconcileProjectSources();} finally {Date.now=chainNow;}
  assert((await cmd(a,'revoke_grant',{grantId:ab.id})).ok);
  assert.equal((await snapshot(b)).collaboration!.tasks[bKey].requiresRevalidation,true);
  assert.equal((await snapshot(c)).collaboration!.tasks[cKey].requiresRevalidation,true,'reverse-order cross-project chains reach a fixed point in one commit');
  await task(c);
  assert.equal((await snapshot(c)).collaboration!.tasks[cKey].requiresRevalidation,true,'next cached-engine mutation cannot resurrect the stale version');

  const d=(await base.createProject({name:'D'})).projectId!, dKey=await task(d,'agent'), dRun=await claim(d,dKey);
  const expiresAt=new Date(Date.now()+60000).toISOString(), ad=await grant(a,d,aArtifact,dRun,expiresAt);
  const dSnapshot=await snapshot(d), dContext=dSnapshot.collaboration!.contextPackages.find(p=>p.runId===dRun)!, hash=(await snapshot(a)).collaboration!.artifacts.find(v=>v.id===aArtifact)!.hash;
  const request={projectId:d,contextPackageId:dContext.id,artifactId:aArtifact,hash,offset:0,limit:40,grants:[ad]};
  const binding={runId:dRun,claimEpoch:dSnapshot.collaboration!.runs[dRun].claimEpoch};
  const beforeRead=await snapshot(d);
  await assert.rejects(()=>base.readEvidenceForAgent({...request,hash:'wrong'},binding));
  assert.deepEqual(await snapshot(d),beforeRead,'hash validation rejects before committing read provenance');
  failWrite=true;await assert.rejects(()=>base.readEvidenceForAgent(request,binding));failWrite=false;
  assert.deepEqual(await snapshot(d),beforeRead,'read capabilities return no page when evidence receipt cannot persist');
  await base.readEvidenceForAgent(request,binding);
  assert.equal((await snapshot(d)).contextEvidenceReads!.length,1);
  assert.equal((await snapshot(d)).collaboration!.governance!.reads!.length,1);
  const dSubmission=await agentOutput(d,dKey,dRun);
  const originalNow=Date.now;Date.now=()=>Date.parse(expiresAt)+1;
  try {
    const reviewed=await cmd(d,'review',{submissionId:dSubmission,verdict:'accepted',note:'不能采用过期依据',checks:[true]},dKey);
    assert.equal(reviewed.ok,false,'expiry reconciliation precedes review, not only commit');
    assert.equal((await snapshot(d)).collaboration!.tasks[dKey].status,'in_review');
  } finally {Date.now=originalNow;}

  // Simultaneous runs must not borrow another run's capability or context budget.
  const e=(await base.createProject({name:'E'})).projectId!, eKey=await task(e,'agent'), eRun=await claim(e,eKey), eSecond=await claim(e,await task(e,'agent'));
  const ae=await grant(a,e,aArtifact,eRun), eSnapshot=await snapshot(e), secondContext=eSnapshot.collaboration!.contextPackages.find(p=>p.runId===eSecond)!;
  const beforeMismatch=await snapshot(e);
  await assert.rejects(()=>base.readEvidenceForAgent({projectId:e,contextPackageId:secondContext.id,artifactId:aArtifact,hash,limit:40,grants:[ae]},{runId:eSecond,claimEpoch:eSnapshot.collaboration!.runs[eSecond].claimEpoch}), 'a capability issued to run one must not be accounted as run two');
  assert.deepEqual(await snapshot(e),beforeMismatch);

  const limited=(await base.createProject({name:'Limited'})).projectId!;
  assert((await cmd(limited,'set_policy',{contextTokens:1024})).ok);
  const limitedKey=await task(limited,'agent'),limitedRun=await claim(limited,limitedKey),limitedGrant=await grant(a,limited,aArtifact,limitedRun);
  const limitedSnapshot=await snapshot(limited),limitedContext=limitedSnapshot.collaboration!.contextPackages.find(p=>p.runId===limitedRun)!;
  await assert.rejects(()=>base.readEvidenceForAgent({projectId:limited,contextPackageId:limitedContext.id,artifactId:aArtifact,hash,limit:4000,grants:[limitedGrant]},{runId:limitedRun,claimEpoch:limitedSnapshot.collaboration!.runs[limitedRun].claimEpoch}),(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code==='CONTEXT_READ_BUDGET');
  assert.deepEqual(await snapshot(limited),limitedSnapshot,'budget rejection rolls back both immutable cross-project and context read receipts');

  // Suggestions become ordinary tasks only; no Agent process or output is created by management.
  const manager=(await base.createProject({name:'Manager'})).projectId!, root=await task(manager);
  assert((await cmd(manager,'configure_automation',{enabled:true,autoStart:false,taskKeys:[root],maxNewTasks:2})).ok);
  assert((await cmd(manager,'propose_plan',{tasks:[{key:'next',title:'Agent 下一步',goal:'处理下一步',criteria:['核对结果'],owner:'agent',dependsOn:[]}]},root)).ok);
  assert.equal(Object.keys((await snapshot(manager)).tasks).length,1);
  await humanOutput(manager,root);
  const final=await snapshot(manager);
  assert.equal(Object.keys(final.tasks).length,2);
  assert.equal(Object.keys(final.collaboration!.runs).length,0);
  assert.equal(Object.keys(final.sessions).length,0);
  assert.equal(final.collaboration!.artifacts.length,1);
  console.log('management integration: atomic revoke/read rollback, fixed-point caches, expiry-before-review, run scopes and manager-only continuation passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
