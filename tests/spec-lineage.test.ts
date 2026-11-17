import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage, deriveLedger, deriveBlackboard, isCollaborationArtifactFresh, type CollaborationActor } from '../src/data/collaboration';
import { applyIntegration, inspectIntegration, listIntegrationSources, type IntegrationCommand } from '../src/data/resultIntegration';
import { currentProjectSpec, projectSpecArtifactStale, deriveSpecLineage } from '../src/data/specLineage';

let n=0;
const s=createEmptySnapshot({id:'spec-project',name:'规范继承'});
function domain(type:Parameters<typeof applyCollaboration>[1]['type'],payload:Record<string,unknown>,key?:string,actor:CollaborationActor={kind:'human'}) {
  return applyCollaboration(s,{projectId:s.project.id,idempotencyKey:`d-${++n}`,type,taskId:key,expectedVersion:key?s.collaboration?.tasks[key]?.version:undefined,payload},actor);
}
function create(title:string,owner='me') { const r=domain('create_task',{title,goal:title,criteria:['可核验'],owner});assert(r.ok,r.message);return r.resourceId!; }
function integrate(type:IntegrationCommand['type'],payload:IntegrationCommand['payload'],draftId?:string) {
 return applyIntegration(s,{projectId:s.project.id,idempotencyKey:`i-${++n}`,type,payload,draftId,expectedRevision:draftId?s.integration!.drafts[draftId].revision:undefined});
}
function accepted(key:string,body:string,actor:CollaborationActor={kind:'human'}) {
 const submit=domain('submit',{title:'设计与交互说明',body,sourceIds:[],unresolved:[],nextSteps:[]},key,actor);assert(submit.ok,submit.message);
 const review=domain('review',{submissionId:submit.resourceId,verdict:'accepted',checks:[true],note:'已核对'},key);assert(review.ok,review.message);
 return s.collaboration!.tasks[key].acceptedArtifactId!;
}
function publish(draftId:string) { const inspection=inspectIntegration(s,draftId);const r=integrate('publish',{reviewed:true,expectedBundleVersion:inspection.bundle.version},draftId);assert(r.ok,JSON.stringify(r));return r.versionId!; }
const candidateKey=create('候选规范');
const candidate=domain('submit',{title:'project-spec.md',body:'仅是文件名的候选说明'},candidateKey);assert(candidate.ok);
assert.equal(currentProjectSpec(s),undefined,'a spec-like title does not acquire authority');
const cid=s.collaboration!.submissions.find(x=>x.id===candidate.resourceId)!.artifactId;
assert.equal(integrate('create',{purpose:'project_spec',title:'项目规范',sourceIds:[cid]}).ok,false,'unaccepted candidate cannot become canonical spec');

const sourceKey=create('编写规范','agent');
const claim=domain('claim',{executor:'codex'},sourceKey,{kind:'service'});assert(claim.ok,claim.message);
const run=s.collaboration!.runs[claim.resourceId!];
const aid=accepted(sourceKey,'任务结果需包含正文与来源。',{kind:'runtime',runId:run.id,claimEpoch:run.claimEpoch});
const created=integrate('create',{purpose:'project_spec',title:'项目规范',sourceIds:[aid]});assert(created.ok,created.message);
assert.equal(currentProjectSpec(s),undefined,'a draft is not authoritative');
const v1=publish(created.draftId!);
assert.equal(currentProjectSpec(s)?.id,v1);
assert.equal(projectSpecArtifactStale(s,aid),false,'the producer remains valid after publishing its own work');
assert.equal(isCollaborationArtifactFresh(s,aid),true);
assert(listIntegrationSources(s).find(x=>x.artifactId===aid)?.eligible,'publication cannot invalidate its own evidence');
assert.equal(deriveBlackboard(s).projectSpec?.versionId,v1);
assert.equal(integrate('create',{purpose:'project_spec',title:'另一规范',sourceIds:[aid]}).code,'SPEC_EXISTS','one project has one canonical bundle');

const downstream=create('依据规范执行','agent');
const ctx=buildContextPackage(s,downstream);assert.equal(ctx.projectSpec?.versionId,v1);assert(ctx.prompt.includes('任务结果需包含正文与来源。'));
const dc=domain('claim',{executor:'codex'},downstream,{kind:'service'});assert(dc.ok,dc.message);
const dr=s.collaboration!.runs[dc.resourceId!];
const completed=create('已按旧版执行','agent');
const cc=domain('claim',{executor:'codex'},completed,{kind:'service'});assert(cc.ok,cc.message);
const cr=s.collaboration!.runs[cc.resourceId!];const oldArtifact=accepted(completed,'旧版对应交付',{kind:'runtime',runId:cr.id,claimEpoch:cr.claimEpoch});
assert.equal(s.collaboration!.tasks[completed].activeRunId,undefined,'acceptance legitimately ends the active claim');
assert.equal(deriveSpecLineage(s,completed).pinnedProjectSpec?.versionId,v1,'accepted runtime result retains its own fixed normative version');
assert.equal(deriveSpecLineage(s,completed).projectSpecSource,'run-context');
const recordFallback=structuredClone(s);
delete recordFallback.collaboration!.runs[cr.id];
assert.equal(deriveSpecLineage(recordFallback,completed).pinnedProjectSpec?.versionId,v1,'an immutable handoff remains a fallback when the historical run is unavailable');
assert.equal(deriveSpecLineage(recordFallback,completed).projectSpecSource,'task-handoff');
const pendingKey=create('旧版待验收','agent');
const pendingClaim=domain('claim',{executor:'codex'},pendingKey,{kind:'service'});assert(pendingClaim.ok,pendingClaim.message);
const pendingRun=s.collaboration!.runs[pendingClaim.resourceId!];
const pendingSubmit=domain('submit',{title:'旧版候选',body:'按第一版规范完成的候选'},pendingKey,{kind:'runtime',runId:pendingRun.id,claimEpoch:pendingRun.claimEpoch});assert(pendingSubmit.ok,pendingSubmit.message);
const acceptedProjection=structuredClone(s);
const candidateLineage=deriveSpecLineage(acceptedProjection,pendingKey);
const acceptedProjectionReview=applyCollaboration(acceptedProjection,{projectId:s.project.id,type:'review',taskId:pendingKey,expectedVersion:acceptedProjection.collaboration!.tasks[pendingKey].version,idempotencyKey:'accepted-projection',payload:{submissionId:pendingSubmit.resourceId,verdict:'accepted',checks:[true],note:'校验验收前后同一来源'}},{kind:'human'});
assert(acceptedProjectionReview.ok,acceptedProjectionReview.message);
const acceptedLineage=deriveSpecLineage(acceptedProjection,pendingKey);
assert.deepEqual(acceptedLineage.pinnedProjectSpec,candidateLineage.pinnedProjectSpec,'UI acceptance must not erase the result spec label');
assert.equal(acceptedLineage.artifactId,candidateLineage.artifactId);
assert.equal(acceptedLineage.artifactAuthority,'accepted');
const humanComplete=create('人工按当前规范交付');
const humanArtifact=accepted(humanComplete,'人工核对当前项目规范后完成的交付');
assert.equal(deriveSpecLineage(s,humanComplete).projectSpecSource,'task-handoff');
assert.equal(deriveSpecLineage(s,humanComplete).pinnedProjectSpec?.versionId,v1);
const humanPending=create('人工旧版待验收');
const humanSubmission=domain('submit',{title:'人工旧版候选',body:'人工提交仍绑定当前规范'},humanPending);assert(humanSubmission.ok,humanSubmission.message);
const legacyUnknown=structuredClone(s);
delete legacyUnknown.collaboration!.handoffs;
assert.equal(deriveSpecLineage(legacyUnknown,humanComplete).projectSpecSource,'legacy-unknown','missing historical pins are visible, never invented');
const bundle=currentProjectSpec(s)!.bundleId;
const revision=integrate('create',{purpose:'project_spec',bundleId:bundle});assert(revision.ok,revision.message);
let inspection=inspectIntegration(s,revision.draftId!);
const save=integrate('save',{title:inspection.revision.title,sourceIds:[aid],sections:inspection.revision.sections.map(section=>({...section,body:section.body+' 每一章还需标明验收标准。'}))},revision.draftId);assert(save.ok,save.message);
const v2=publish(revision.draftId!);assert.notEqual(v2,v1);
assert.equal(deriveSpecLineage(s,completed).pinnedProjectSpec?.versionId,v1,'publishing a new norm cannot relabel an old accepted result');
assert.equal(deriveSpecLineage(s,completed).stale,true);
const restartedProjection=structuredClone(s);
const restartReopen=applyCollaboration(restartedProjection,{projectId:s.project.id,type:'reopen',taskId:completed,expectedVersion:restartedProjection.collaboration!.tasks[completed].version,idempotencyKey:'projection-reopen',payload:{reason:'按新版重新执行'}},{kind:'human'});assert(restartReopen.ok,restartReopen.message);
const restartClaim=applyCollaboration(restartedProjection,{projectId:s.project.id,type:'claim',taskId:completed,idempotencyKey:'projection-claim',payload:{executor:'codex'}},{kind:'service'});assert(restartClaim.ok,restartClaim.message);
const restartRun=restartedProjection.collaboration!.runs[restartClaim.resourceId!];
assert.equal(restartedProjection.collaboration!.contextPackages.find(p=>p.id===restartRun.contextPackageId)?.projectSpec?.versionId,v2);
assert.equal(deriveSpecLineage(restartedProjection,completed,oldArtifact).pinnedProjectSpec?.versionId,v1,'a newly active v2 run cannot relabel the selected v1 artifact');
const newSubmission=applyCollaboration(restartedProjection,{projectId:s.project.id,type:'submit',taskId:completed,idempotencyKey:'projection-new-result',payload:{title:'新版成果',body:'根据第二版规范重新完成'}},{kind:'runtime',runId:restartRun.id,claimEpoch:restartRun.claimEpoch});assert(newSubmission.ok,newSubmission.message);
assert.equal(deriveSpecLineage(restartedProjection,completed).pinnedProjectSpec?.versionId,v2,'the current new candidate uses its own context');
assert.equal(deriveSpecLineage(restartedProjection,completed,oldArtifact).pinnedProjectSpec?.versionId,v1,'explicit historical selection remains on the selected artifact');
assert.equal(deriveSpecLineage(restartedProjection,completed,aid).pinnedProjectSpec,undefined,'an artifact from another task cannot lend its lineage');
assert.equal(s.integration!.versions.find(v=>v.id===v1)?.sections[0].body,'任务结果需包含正文与来源。','older normative version remains immutable');
assert.equal(projectSpecArtifactStale(s,aid),false,'normative source cannot enter a rework loop');
assert.equal(projectSpecArtifactStale(s,oldArtifact),true,'downstream deliverables retain their old version and become stale');
assert.equal(projectSpecArtifactStale(s,humanArtifact),true,'a human submission cannot bypass normative version changes by having no provider run');
assert.equal(isCollaborationArtifactFresh(s,humanArtifact),false);
assert(deriveBlackboard(s).blocked.some(row=>row.key===humanComplete),'blackboard projects human-only normative drift');
assert.equal(domain('review',{submissionId:humanSubmission.resourceId,verdict:'accepted',checks:[true],note:'不能接受过时人工候选'},humanPending).code,'SOURCE_STALE');
assert.equal(deriveLedger(s).find(row=>row.key===completed)?.requiresRevalidation,true);
assert(deriveBlackboard(s).blocked.some(row=>row.key===completed),'blackboard projects the same revalidation fact');
const staleReview=domain('review',{submissionId:pendingSubmit.resourceId,verdict:'accepted',checks:[true],note:'不能忽略规范版本改变'},pendingKey);assert.equal(staleReview.code,'SOURCE_STALE','review cannot accept a result pinned to an obsolete project spec');
const stale=domain('submit',{title:'过时交付',body:'运行中规范改变后完成的旧版交付'},downstream,{kind:'runtime',runId:dr.id,claimEpoch:dr.claimEpoch});
assert.equal(stale.code,'PROJECT_SPEC_CHANGED');
const fresh=create('后续新任务','agent');assert.equal(buildContextPackage(s,fresh).projectSpec?.versionId,v2,'future work inherits the published version without asking again');
// Reopening a normative producer must allow repairing its source, not deadlock all future work.
const reopen=domain('reopen',{reason:'规范来源需要修订'},sourceKey);assert(reopen.ok,reopen.message);
const repairContext=buildContextPackage(s,sourceKey);assert.equal(repairContext.projectSpec?.versionId,v2);assert(repairContext.prompt.includes('来源已有后续变化'));
assert.equal(currentProjectSpec(s)?.id,v2,'a changed source does not silently change published authority');
const repairClaim=domain('claim',{executor:'codex'},sourceKey,{kind:'service'});assert(repairClaim.ok,repairClaim.message);
const repairRun=s.collaboration!.runs[repairClaim.resourceId!];
const replacement=accepted(sourceKey,'修订后的规范来源：正文、来源和验收标准。',{kind:'runtime',runId:repairRun.id,claimEpoch:repairRun.claimEpoch});
const replacePayload={purpose:'project_spec' as const,bundleId:bundle,sourceIds:[replacement],sections:[{id:'updated-source',title:'规范修订',body:'修订后的规范来源：正文、来源和验收标准。',sourceIds:[replacement]}]};
assert.equal(integrate('create',replacePayload).code,'EXCLUSION_REASON_REQUIRED','removing canonical evidence requires an audited reason');
const replacementDraft=integrate('create',{...replacePayload,excludeReasons:{[aid]:'由已验收的新版本替代'}});assert(replacementDraft.ok,replacementDraft.message);
const v3=publish(replacementDraft.draftId!);assert.notEqual(v3,v2);assert.equal(projectSpecArtifactStale(s,replacement),false,'the repaired producer also stays fresh');
assert(s.integration!.events.some(event=>event.detail.includes('由已验收的新版本替代')),'source replacement reason is retained in the existing ledger');
const unrelated=createEmptySnapshot({id:'another-project',name:'其他项目'});assert.equal(currentProjectSpec(unrelated),undefined,'no cross-project spec inheritance');
// A human-authored normative source remains valid when it becomes the new spec basis.
const humanNormKey=create('人工修订规范来源');
const humanNormArtifact=accepted(humanNormKey,'人工修订后的项目规范正文');
const humanNormDraft=integrate('create',{purpose:'project_spec',bundleId:bundle,sourceIds:[replacement,humanNormArtifact],sections:[...currentProjectSpec(s)!.sections,{id:'human-norm-source',title:'人工规范修订',body:'人工修订后的项目规范正文',sourceIds:[humanNormArtifact]}]});assert(humanNormDraft.ok,humanNormDraft.message);
publish(humanNormDraft.draftId!);
assert.equal(projectSpecArtifactStale(s,humanNormArtifact),false,'publishing a human normative source cannot invalidate its own evidence');
console.log('spec lineage: canonical role, candidate boundary, source preservation, immutable versions and stale downstream checks passed');
