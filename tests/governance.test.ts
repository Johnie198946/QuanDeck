import assert from 'node:assert/strict';
import { applyCollaboration, ensureCollaboration, advanceAuthorizedPlans, type CollaborationActor, type CollaborationCommandType } from '../src/data/collaboration';
import { automationReadyQueue, issueArtifactReadToken, readGrantedArtifact, readAndRecordGrantedArtifact, reconcileGrantedSources } from '../src/data/governance';
import { createEmptySnapshot } from '../src/data/projectStorage';
import type { Snapshot } from '../src/data/types';

let serial = 0;
function cmd(s: Snapshot, type: CollaborationCommandType, payload: Record<string, unknown> = {}, taskId?: string, actor: CollaborationActor = {kind:'human'}) {
  return applyCollaboration(s, {projectId:s.project.id, idempotencyKey:'governance-'+ ++serial, type, taskId, expectedVersion:taskId?s.collaboration?.tasks[taskId]?.version:undefined, payload}, actor);
}
function make(id: string) { const s=createEmptySnapshot({id,name:id}); ensureCollaboration(s); return s; }
function task(s: Snapshot, owner: 'me'|'agent'='me') {
  const r=cmd(s,'create_task',{title:'必要任务',goal:'完成目标',criteria:['核对成果'],owner}); assert(r.ok,r.message); return r.resourceId!;
}
function done(s:Snapshot, key:string) {
  const submission=cmd(s,'submit',{title:'已核对成果',body:'有来源的研究正文。'.repeat(400),sourceIds:[]},key); assert(submission.ok,submission.message);
  const review=cmd(s,'review',{submissionId:submission.resourceId,verdict:'accepted',note:'已核对',checks:[true]},key); assert(review.ok,review.message);
  return s.collaboration!.tasks[key].acceptedArtifactId!;
}
function claim(s:Snapshot,key:string) { const r=cmd(s,'claim',{executor:'test-agent'},key,{kind:'service'}); assert(r.ok,r.message); return r.resourceId!; }
function expectCode(fn:()=>unknown, code:string) { assert.throws(fn,(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===code); }

const source=make('source'), target=make('target');
assert.equal(source.collaboration!.governance!.ownerId,'local-user');
const version=source.collaboration!.governance!.members['local-user'].version;
ensureCollaboration(source); assert.equal(source.collaboration!.governance!.members['local-user'].version,version,'migration is stable');
assert.equal(cmd(source,'create_task',{title:'x',goal:'x',criteria:['x'],owner:'me'},undefined,{kind:'human',principalId:'intruder'}).code,'FORBIDDEN');
assert.equal(cmd(source,'set_member',{principalId:'local-user',role:'reader',active:false}).code,'OWNER_REQUIRED');
assert(cmd(source,'set_member',{principalId:'viewer',role:'reader',active:true}).ok);
assert.equal(cmd(source,'set_policy',{maxParallel:1},undefined,{kind:'human',principalId:'viewer'}).code,'FORBIDDEN');
const key=task(source), artifact=done(source,key), secret=done(source,task(source));
const runId=claim(target,task(target,'agent'));
const grant=cmd(source,'grant_artifacts',{principalId:'local-user',targetProjectId:target.project.id,artifactIds:[artifact],expiresAt:new Date(Date.now()+3600000).toISOString()}); assert(grant.ok,grant.message);
const access=issueArtifactReadToken(source,target,{runId,grantId:grant.resourceId!});
assert(!JSON.stringify(target.collaboration!.governance!.readTokens).includes(access.token),'raw capabilities are not stored');
let page=readGrantedArtifact(source,target,{token:access.token,artifactId:artifact,limit:100});
assert.equal(page.body.length,100); assert.equal(page.nextOffset,100); assert(!('sessions' in page));
expectCode(()=>readGrantedArtifact(source,target,{token:access.token,artifactId:secret}),'GRANT_REVOKED');
expectCode(()=>readGrantedArtifact(source,make('wrong'),{token:access.token,artifactId:artifact}),'TOKEN_EXPIRED');
expectCode(()=>readGrantedArtifact(source,target,{token:access.token,artifactId:artifact,limit:99999}),'SCHEMA_INVALID');
assert(cmd(source,'revoke_grant',{grantId:grant.resourceId}).ok);
expectCode(()=>readGrantedArtifact(source,target,{token:access.token,artifactId:artifact}),'GRANT_REVOKED');
const nextGrant=cmd(source,'grant_artifacts',{principalId:'local-user',targetProjectId:'target',artifactIds:[artifact],expiresAt:new Date(Date.now()+3600000).toISOString()});
const nextAccess=issueArtifactReadToken(source,target,{runId,grantId:nextGrant.resourceId!});
target.collaboration!.tasks[target.collaboration!.runs[runId].key].claimEpoch++;
expectCode(()=>readGrantedArtifact(source,target,{token:nextAccess.token,artifactId:artifact}),'RUN_REVOKED');
const other=make('other'), otherRun=claim(other,task(other,'agent'));
assert(cmd(other,'set_member',{principalId:'editor',role:'editor',active:true}).ok);
assert(cmd(source,'set_member',{principalId:'editor',role:'reader',active:true}).ok);
const thirdGrant=cmd(source,'grant_artifacts',{principalId:'editor',targetProjectId:'other',artifactIds:[artifact],expiresAt:new Date(Date.now()+3600000).toISOString()});
const third=issueArtifactReadToken(source,other,{runId:otherRun,grantId:thirdGrant.resourceId!},'editor');
assert(cmd(source,'set_member',{principalId:'editor',role:'reader',active:false}).ok);
assert(cmd(source,'set_member',{principalId:'editor',role:'reader',active:true}).ok);
expectCode(()=>readGrantedArtifact(source,other,{token:third.token,artifactId:artifact}),'GRANT_REVOKED');

const linked=make('linked'), linkedKey=task(linked,'agent'), linkedRun=claim(linked,linkedKey);
const linkedGrant=cmd(source,'grant_artifacts',{principalId:'local-user',targetProjectId:'linked',artifactIds:[artifact],expiresAt:new Date(Date.now()+3600000).toISOString()});
const linkedAccess=issueArtifactReadToken(source,linked,{runId:linkedRun,grantId:linkedGrant.resourceId!});
const linkedFragment=readAndRecordGrantedArtifact(source,linked,{token:linkedAccess.token,artifactId:artifact,limit:200});
readAndRecordGrantedArtifact(source,linked,{token:linkedAccess.token,artifactId:artifact,limit:200});
assert.equal(linked.collaboration!.governance!.reads!.length,1,'repeated page request does not duplicate read provenance');
assert(linkedFragment.sourceRef.uri.includes(encodeURIComponent(artifact)));
const linkedReceipt=JSON.stringify(linked.collaboration!.governance!.reads);
const linkedSubmit=cmd(linked,'submit',{title:'跨项目综合',body:'基于授权成果综合',sourceIds:[],sourceRefs:[linkedFragment.sourceRef]},linkedKey,{kind:'runtime',runId:linkedRun,claimEpoch:linked.collaboration!.runs[linkedRun].claimEpoch});assert(linkedSubmit.ok,linkedSubmit.message);
const linkedReview=cmd(linked,'review',{submissionId:linkedSubmit.resourceId,verdict:'accepted',note:'已核对',checks:[true]},linkedKey);assert(linkedReview.ok,linkedReview.message);
assert.deepEqual(reconcileGrantedSources([source],linked),{invalidReadIds:[],staleArtifactIds:[]});
assert(cmd(source,'revoke_grant',{grantId:linkedGrant.resourceId}).ok);
const impact=reconcileGrantedSources([source],linked);
assert.equal(impact.invalidReadIds.length,1);assert.equal(impact.staleArtifactIds.length,1);
assert.equal(linked.collaboration!.tasks[linkedKey].requiresRevalidation,true);
assert.equal(JSON.stringify(linked.collaboration!.governance!.reads),linkedReceipt,'revocation never rewrites immutable read history');
assert.deepEqual(reconcileGrantedSources([source],linked),{invalidReadIds:[],staleArtifactIds:[]},'reconciliation is idempotent');

const pending=make('pending'), pendingKey=task(pending,'agent'), pendingRun=claim(pending,pendingKey);
const pendingGrant=cmd(source,'grant_artifacts',{principalId:'local-user',targetProjectId:'pending',artifactIds:[artifact],expiresAt:new Date(Date.now()+3600000).toISOString()});
const pendingAccess=issueArtifactReadToken(source,pending,{runId:pendingRun,grantId:pendingGrant.resourceId!});
readAndRecordGrantedArtifact(source,pending,{token:pendingAccess.token,artifactId:artifact});
cmd(source,'revoke_grant',{grantId:pendingGrant.resourceId});
reconcileGrantedSources([source],pending);
assert.equal(pending.collaboration!.runs[pendingRun].status,'cancelled');
assert.equal(pending.collaboration!.tasks[pendingKey].status,'blocked');
assert.equal(cmd(pending,'submit',{title:'迟到成果',body:'不能写回',sourceIds:[]},pendingKey,{kind:'runtime',runId:pendingRun,claimEpoch:pending.collaboration!.runs[pendingRun].claimEpoch}).code,'STALE_CLAIM');

const s=make('automation'), root=task(s), outside=task(s,'agent');
const proposed=[{key:'manual',title:'人工确认日期',goal:'确认日期',criteria:['日期确认'],owner:'me',dependsOn:[]},{key:'ai',title:'编排行程',goal:'综合计划',criteria:['计划完整'],owner:'agent',dependsOn:['manual']}];
assert(cmd(s,'propose_plan',{tasks:proposed},root).ok);
assert.deepEqual(automationReadyQueue(s),[],'automatic execution defaults off');
assert.equal(cmd(s,'set_policy',{autoAdopt:true}).code,'APPROVAL_REQUIRED');
assert.equal(cmd(s,'configure_automation',{enabled:true,autoStart:false,taskKeys:[],maxNewTasks:2}).code,'APPROVAL_REQUIRED');
assert(cmd(s,'configure_automation',{enabled:true,autoStart:false,taskKeys:[root],maxNewTasks:2}).ok);
assert.equal(cmd(s,'configure_automation',{enabled:true,autoStart:true,taskKeys:[root],maxNewTasks:2}).code,'MANAGER_ONLY','task manager can never enable automatic execution');
assert.equal(cmd(s,'advance_automation',{},undefined,{kind:'human'}).code,'FORBIDDEN');
assert.deepEqual(cmd(s,'advance_automation',{},undefined,{kind:'service'}).createdTaskIds,[],'planning alone does not mean the root is accepted');
done(s,root);
const advance=cmd(s,'advance_automation',{},undefined,{kind:'service'}); assert(advance.ok,advance.message); assert.equal(advance.createdTaskIds?.length,2);
assert.equal(s.collaboration!.events.filter(e=>e.type==='task_created'&&advance.createdTaskIds!.includes(e.taskKey!)).every(e=>e.actor==='automation-policy'),true,'auto-created tasks never claim human authorship');
assert.deepEqual(cmd(s,'advance_automation',{},undefined,{kind:'service'}).createdTaskIds,[],'adopted proposal is not repeated');
assert.deepEqual(automationReadyQueue(s),[],'manual dependency is a hard gate and unrelated ready tasks stay out of scope');
const [manual, ai]=advance.createdTaskIds!;
done(s,manual);
assert.deepEqual(automationReadyQueue(s).map(t=>t.key),[ai]);
assert(!automationReadyQueue(s).some(t=>t.key===outside));
const secondProposal=cmd(s,'propose_plan',{tasks:[{...proposed[0],key:'second',dependsOn:[]}]},root); assert(secondProposal.ok);
assert.deepEqual(cmd(s,'advance_automation',{},undefined,{kind:'service'}).createdTaskIds,[],'project cumulative expansion cap is enforced');
assert(cmd(s,'configure_automation',{enabled:false,autoStart:false,taskKeys:[root],maxNewTasks:2}).ok);
assert.deepEqual(automationReadyQueue(s),[]);
assert(cmd(s,'configure_automation',{enabled:true,autoStart:false,taskKeys:[root],maxNewTasks:2}).ok);
assert.equal(s.collaboration!.governance!.automation.createdTaskIds.length,2,'toggle does not reset cumulative cap');
s.collaboration!.policy.projectTokens=1;
assert.deepEqual(automationReadyQueue(s),[],'no budget means no automatic claim');
s.collaboration!.policy.projectTokens=200000;
assert(cmd(s,'mark_stale',{artifactId:s.collaboration!.tasks[manual].acceptedArtifactId,reason:'日期变更'}).ok);
assert.deepEqual(automationReadyQueue(s),[],'stale source blocks downstream dispatch');

const revised=make('revised'), revisionRoot=task(revised);
assert(cmd(revised,'propose_plan',{tasks:proposed},revisionRoot).ok);
assert(cmd(revised,'configure_automation',{enabled:true,autoStart:false,taskKeys:[revisionRoot],maxNewTasks:10}).ok);
assert(cmd(revised,'revise_task',{goal:'日期改为明年',criteria:['核对成果'],reason:'用户更改日期'},revisionRoot).ok);
done(revised,revisionRoot);
assert.deepEqual(cmd(revised,'advance_automation',{},undefined,{kind:'service'}).createdTaskIds,[],'changed requirements invalidate automatic adoption authorization');
assert(cmd(revised,'configure_automation',{enabled:true,autoStart:false,taskKeys:[revisionRoot],maxNewTasks:10}).ok);
assert.deepEqual(cmd(revised,'advance_automation',{},undefined,{kind:'service'}).createdTaskIds,[],'renewing scope does not make an old proposal match new requirements');
assert(cmd(revised,'propose_plan',{tasks:proposed},revisionRoot).ok);
const revisedAdvance=cmd(revised,'advance_automation',{},undefined,{kind:'service'});assert.equal(revisedAdvance.createdTaskIds?.length,2);
assert(cmd(revised,'propose_plan',{tasks:proposed},revisionRoot).ok);
assert.deepEqual(cmd(revised,'advance_automation',{},undefined,{kind:'service'}).createdTaskIds,[],'duplicate proposal content never creates more tasks even when task budget remains');
const autonomous=make('autonomous'), autoKey=task(autonomous,'agent');
assert(cmd(autonomous,'configure_automation',{enabled:true,autoStart:false,taskKeys:[autoKey],maxNewTasks:0}).ok);
assert.equal(automationReadyQueue(autonomous).length,1);
assert(cmd(autonomous,'revise_task',{goal:'修改执行范围',criteria:['核对成果'],reason:'修改'},autoKey).ok);
assert.deepEqual(automationReadyQueue(autonomous),[],'dispatch authorization is pinned to the approved requirement revision');
const managed=make('managed'), managedRoot=task(managed);
assert(cmd(managed,'configure_automation',{enabled:true,autoStart:false,taskKeys:[managedRoot],maxNewTasks:2}).ok);
assert(cmd(managed,'propose_plan',{tasks:proposed},managedRoot).ok);
const beforeNoop=JSON.stringify(managed);
assert.deepEqual(advanceAuthorizedPlans(managed).createdTaskIds,[]);
assert.equal(JSON.stringify(managed),beforeNoop,'manager no-op does not append receipts or emit a self-triggering change');
done(managed,managedRoot);
assert.equal(advanceAuthorizedPlans(managed).createdTaskIds?.length,2);
assert.equal(Object.keys(managed.collaboration!.runs).length,0,'registering Agent suggestions never executes any Agent');
assert.equal(Object.keys(managed.sessions).length,0);
assert.equal(managed.collaboration!.artifacts.length,1,'manager cannot fabricate child outputs');
console.log('governance: scoped grants, revocation, takeover, bounded automation and manual gates passed');
