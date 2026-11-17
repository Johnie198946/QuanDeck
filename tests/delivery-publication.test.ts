import assert from 'node:assert/strict';
import { applyCollaboration } from '../src/data/collaboration';
import { applyDeliveryChange } from '../src/data/deliveryChanges';
import { previewDeliveryPublication, publishDeliveryIn } from '../src/data/deliveryPublication';
import { maintainProjectSpec, resolveSpecMaintenanceIn } from '../src/data/specMaintenance';
import { applyIntegration } from '../src/data/resultIntegration';
import { createEmptySnapshot } from '../src/data/projectStorage';
import type { Snapshot } from '../src/data/types';
let serial=0;
const invoke=(s:Snapshot,type:Parameters<typeof applyCollaboration>[1]['type'],taskId:string|undefined,payload:Record<string,unknown>)=>{
  const r=applyCollaboration(s,{projectId:s.project.id,idempotencyKey:`test-${++serial}`,type,taskId,expectedVersion:taskId?s.collaboration?.tasks[taskId]?.version:undefined,payload},{kind:'human'});assert(r.ok,r.message);return r;
};
function setup(purpose:'deliverable'|'project_spec'='deliverable',allSpec=false){
  const s=createEmptySnapshot({id:`p-${++serial}`,name:'成果清单验证'});
  const taskId=invoke(s,'create_task',undefined,{title:'说明与清单',goal:'交付两件成果',criteria:['来源已核对'],owner:'me'}).resourceId!;
  const change=applyDeliveryChange(s,{planId:`delivery:${taskId}`,taskId,expectedVersion:0,idempotencyKey:`define-${++serial}`,reason:'定义逐件交付',operations:['说明','清单'].map((title,i)=>({type:'add' as const,slot:{id:`item${i}`,title,taskKey:taskId,contract:{revision:1,kind:'text' as const,format:'markdown',required:true,criteria:['内容完整'],purpose:i===0||allSpec?purpose:'deliverable'}}}))});assert(change.ok,change.message);
  return {s,taskId,slots:change.slots};
}
function submit(s:Snapshot,taskId:string,bodies=['独立说明正文','独立清单正文']){
  const slots=s.collaboration!.goalPlans![`delivery:${taskId}`].at(-1)!.slots;
  const r=invoke(s,'submit',taskId,{title:'两件交付',body:'总摘要不应重复填入每件',deliveryItems:slots.map((slot,i)=>({slotId:slot.id,contractRevision:slot.contract!.revision,body:bodies[i]}))});
  invoke(s,'review',taskId,{submissionId:r.resourceId,verdict:'accepted',checks:[true],deliveryChecks:Object.fromEntries(slots.map(slot=>[slot.id,[true]])),note:'逐件核对通过'});
}
{
  const {s,taskId}=setup();let p=previewDeliveryPublication(s,{taskId});assert(!p.canPublish);submit(s,taskId);p=previewDeliveryPublication(s,{taskId});assert(p.canPublish,p.blockers.join(';'));
  assert(!previewDeliveryPublication(s,{}).canPublish,'project map cannot publish task intermediates');
  const request={scope:{taskId},expectedFingerprint:p.fingerprint,reviewed:true as const,idempotencyKey:'publish-first'};
  const result=publishDeliveryIn(s,request);assert(result.ok,result.message);assert(result.versionId);
  const version=s.integration!.versions.find(v=>v.id===result.versionId)!;assert.deepEqual(version.sections.map(x=>x.body),['独立说明正文','独立清单正文']);assert.equal(version.deliveryPublication!.items.length,2);
  assert.equal(publishDeliveryIn(s,request).versionId,result.versionId);assert.equal(s.integration!.versions.length,1);
  assert(previewDeliveryPublication(s,{taskId}).publishedVersion?.current);
  const noopRequest={...request,expectedFingerprint:previewDeliveryPublication(s,{taskId}).fingerprint,idempotencyKey:'already-published'};
  const noop=publishDeliveryIn(s,noopRequest);assert(noop.ok,noop.message);assert.equal(noop.versionId,result.versionId);assert.equal(s.integration!.versions.length,1);
  assert(s.integration!.deliveryPublicationReceipts?.[noopRequest.idempotencyKey],'no-op success must record the same durable idempotency receipt');
  assert(!publishDeliveryIn(s,{...request,idempotencyKey:'stale',expectedFingerprint:'changed'}).ok);
  invoke(s,'reopen',taskId,{reason:'修改来源'});assert(!previewDeliveryPublication(s,{taskId}).canPublish);assert.equal(s.integration!.versions.length,1);
  assert.deepEqual(publishDeliveryIn(s,noopRequest),{...noop,replayed:true},'retry must return prior no-op success even after the source becomes unavailable');
  assert.equal(publishDeliveryIn(s,{...noopRequest,expectedFingerprint:'different-request'}).code,'IDEMPOTENCY_CONFLICT');
}
{
  const {s,taskId}=setup('project_spec');submit(s,taskId);maintainProjectSpec(s);
  const m=s.integration!.specMaintenance!;assert.equal(m.status,'ready',m.message);assert(m.draftId);assert.equal(s.integration!.versions.length,0,'auto maintenance must not publish');
  const draft=s.integration!.drafts[m.draftId!],revision=s.integration!.revisions.find(r=>r.id===draft.revisionId)!;
  assert.equal(revision.sections.length,1,'only explicit spec output enters normative draft');assert.equal(revision.sections[0].body,'独立说明正文');
  maintainProjectSpec(s);assert.equal(s.integration!.revisions.length,1,'idempotent maintenance');
  const edited=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'manual-edit',type:'save',draftId:draft.id,expectedRevision:draft.revision,payload:{title:revision.title,sourceIds:revision.sourcePins.map(p=>p.artifactId),sections:[{...revision.sections[0],body:'人工补充的规范正文'}]}});assert(edited.ok,edited.message);maintainProjectSpec(s);
  const manualRevision=structuredClone(s.integration!.revisions.find(r=>r.id===s.integration!.drafts[draft.id].revisionId)!);
  const revisionCount=s.integration!.revisions.length;
  invoke(s,'reopen',taskId,{reason:'新的规范事实'});submit(s,taskId,['新的验收规范正文','独立清单正文']);maintainProjectSpec(s);
  const next=s.integration!.specMaintenance!;assert.equal(next.status,'conflict',next.message);assert.equal(next.conflicts.length,1);
  const current=s.integration!.drafts[next.draftId!];
  assert.equal(s.integration!.revisions.length,revisionCount,'conflict does not create a silently rebound revision');
  assert.deepEqual(s.integration!.revisions.find(r=>r.id===current.revisionId),manualRevision,'manual body and original source pins stay paired until an explicit choice');
  maintainProjectSpec(s);assert.equal(s.integration!.drafts[current.id].revisionId,manualRevision.id,'unrelated maintenance cannot rewrite a pending conflict');
  const blocked=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'blocked-publish',type:'publish',draftId:current.id,expectedRevision:current.revision,payload:{reviewed:true,expectedBundleVersion:0}});assert(!blocked.ok);assert.equal(blocked.code,'SPEC_MAINTENANCE_CONFLICT');
  const resolved=resolveSpecMaintenanceIn(s,{fingerprint:next.fingerprint,conflictId:next.conflicts[0].id,choice:'accepted',reason:'以新的验收规范为准',expectedRevision:current.revision});assert(resolved.ok,resolved.message);maintainProjectSpec(s);assert.equal(s.integration!.specMaintenance!.conflicts.length,0);
  const d=s.integration!.drafts[next.draftId!];const published=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'spec-publish',type:'publish',draftId:d.id,expectedRevision:d.revision,payload:{reviewed:true,expectedBundleVersion:0}});assert(published.ok,published.message);assert.equal(s.integration!.versions[0].sections[0].body,'新的验收规范正文');
}
{
  // Two simultaneous source conflicts are staged, not saved one at a time with a
  // remaining stale source (which would either fail or silently reattribute it).
  const {s,taskId}=setup('project_spec',true);submit(s,taskId);maintainProjectSpec(s);
  const m=s.integration!.specMaintenance!,draft=s.integration!.drafts[m.draftId!],revision=s.integration!.revisions.find(r=>r.id===draft.revisionId)!;
  const edited=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'multi-manual-edit',type:'save',draftId:draft.id,expectedRevision:draft.revision,payload:{title:revision.title,sourceIds:revision.sourcePins.map(p=>p.artifactId),sections:revision.sections.map((section,i)=>({...section,body:`人工规范 ${i}`}))}});assert(edited.ok,edited.message);maintainProjectSpec(s);
  const original=structuredClone(s.integration!.revisions.find(r=>r.id===s.integration!.drafts[draft.id].revisionId)!);
  invoke(s,'reopen',taskId,{reason:'两件规范来源一起变化'});submit(s,taskId,['新规范一','新规范二']);maintainProjectSpec(s);
  let next=s.integration!.specMaintenance!;assert.equal(next.conflicts.length,2);const count=s.integration!.revisions.length;
  let resolved=resolveSpecMaintenanceIn(s,{fingerprint:next.fingerprint,conflictId:next.conflicts[0].id,choice:'manual',reason:'保留已人工核对的正文',expectedRevision:s.integration!.drafts[draft.id].revision});assert(resolved.ok,resolved.message);
  maintainProjectSpec(s);next=s.integration!.specMaintenance!;assert.equal(next.conflicts.length,1);assert.equal(next.status,'conflict');assert.equal(s.integration!.revisions.length,count);assert.deepEqual(s.integration!.revisions.find(r=>r.id===s.integration!.drafts[draft.id].revisionId),original);
  resolved=resolveSpecMaintenanceIn(s,{fingerprint:next.fingerprint,conflictId:next.conflicts[0].id,choice:'accepted',reason:'采用第二件新规范',expectedRevision:s.integration!.drafts[draft.id].revision});assert(resolved.ok,resolved.message);maintainProjectSpec(s);
  const merged=s.integration!.revisions.find(r=>r.id===s.integration!.drafts[draft.id].revisionId)!;
  assert.equal(s.integration!.revisions.length,count+1,'all explicit choices commit as one draft revision');assert.deepEqual(merged.sections.map(section=>section.body),['人工规范 0','新规范二']);
  assert(merged.sections.every(section=>section.sourceIds[0]===s.collaboration!.tasks[taskId].acceptedArtifactId));assert.equal(s.integration!.specMaintenance!.status,'ready');assert.equal(s.integration!.specMaintenance!.pendingSections,undefined);
}
{
  // A published, manually edited Spec needs a faithful draft baseline before the
  // conflict is exposed, even if its accepted source has since become stale.
  const {s,taskId}=setup('project_spec');submit(s,taskId);maintainProjectSpec(s);
  const m=s.integration!.specMaintenance!,draft=s.integration!.drafts[m.draftId!],revision=s.integration!.revisions.find(r=>r.id===draft.revisionId)!;
  const edited=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'published-manual-edit',type:'save',draftId:draft.id,expectedRevision:draft.revision,payload:{title:revision.title,sourceIds:revision.sourcePins.map(p=>p.artifactId),sections:[{...revision.sections[0],body:'已发布的人工规范'}]}});assert(edited.ok,edited.message);maintainProjectSpec(s);
  const published=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'published-base',type:'publish',draftId:draft.id,expectedRevision:s.integration!.drafts[draft.id].revision,payload:{reviewed:true,expectedBundleVersion:0}});assert(published.ok,published.message);maintainProjectSpec(s);
  const version=structuredClone(s.integration!.versions.find(v=>v.id===published.versionId)!);
  invoke(s,'reopen',taskId,{reason:'发布后出现新规范来源'});submit(s,taskId,['发布后新规范','独立清单正文']);maintainProjectSpec(s);
  const next=s.integration!.specMaintenance!;assert.equal(next.status,'conflict',next.message);assert(next.draftId);assert.notEqual(next.draftId,draft.id);
  const nextDraft=s.integration!.drafts[next.draftId!],baseline=s.integration!.revisions.find(r=>r.id===nextDraft.revisionId)!;
  assert.deepEqual(baseline.sections,version.sections);assert.deepEqual(baseline.sourcePins,version.sourcePins);assert.deepEqual(s.integration!.versions.find(v=>v.id===version.id),version);
  const resolved=resolveSpecMaintenanceIn(s,{fingerprint:next.fingerprint,conflictId:next.conflicts[0].id,choice:'accepted',reason:'采纳发布后新规范',expectedRevision:nextDraft.revision});assert(resolved.ok,resolved.message);
  assert.equal(s.integration!.revisions.find(r=>r.id===s.integration!.drafts[nextDraft.id].revisionId)!.sections[0].body,'发布后新规范');assert.deepEqual(s.integration!.versions.find(v=>v.id===version.id),version);
}
console.log('delivery publication and specification maintenance invariants passed');
