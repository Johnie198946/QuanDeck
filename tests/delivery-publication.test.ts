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
function setup(purpose:'deliverable'|'project_spec'='deliverable'){
  const s=createEmptySnapshot({id:`p-${++serial}`,name:'成果清单验证'});
  const taskId=invoke(s,'create_task',undefined,{title:'说明与清单',goal:'交付两件成果',criteria:['来源已核对'],owner:'me'}).resourceId!;
  const change=applyDeliveryChange(s,{planId:`delivery:${taskId}`,taskId,expectedVersion:0,idempotencyKey:`define-${++serial}`,reason:'定义逐件交付',operations:['说明','清单'].map((title,i)=>({type:'add' as const,slot:{id:`item${i}`,title,taskKey:taskId,contract:{revision:1,kind:'text' as const,format:'markdown',required:true,criteria:['内容完整'],purpose:i===0?purpose:'deliverable'}}}))});assert(change.ok,change.message);
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
  assert(!publishDeliveryIn(s,{...request,idempotencyKey:'stale',expectedFingerprint:'changed'}).ok);
  invoke(s,'reopen',taskId,{reason:'修改来源'});assert(!previewDeliveryPublication(s,{taskId}).canPublish);assert.equal(s.integration!.versions.length,1);
}
{
  const {s,taskId}=setup('project_spec');submit(s,taskId);maintainProjectSpec(s);
  const m=s.integration!.specMaintenance!;assert.equal(m.status,'ready',m.message);assert(m.draftId);assert.equal(s.integration!.versions.length,0,'auto maintenance must not publish');
  const draft=s.integration!.drafts[m.draftId!],revision=s.integration!.revisions.find(r=>r.id===draft.revisionId)!;
  assert.equal(revision.sections.length,1,'only explicit spec output enters normative draft');assert.equal(revision.sections[0].body,'独立说明正文');
  maintainProjectSpec(s);assert.equal(s.integration!.revisions.length,1,'idempotent maintenance');
  const edited=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'manual-edit',type:'save',draftId:draft.id,expectedRevision:draft.revision,payload:{title:revision.title,sourceIds:revision.sourcePins.map(p=>p.artifactId),sections:[{...revision.sections[0],body:'人工补充的规范正文'}]}});assert(edited.ok,edited.message);maintainProjectSpec(s);
  invoke(s,'reopen',taskId,{reason:'新的规范事实'});submit(s,taskId,['新的验收规范正文','独立清单正文']);maintainProjectSpec(s);
  const next=s.integration!.specMaintenance!;assert.equal(next.status,'conflict',next.message);assert.equal(next.conflicts.length,1);
  const current=s.integration!.drafts[next.draftId!];
  const blocked=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'blocked-publish',type:'publish',draftId:current.id,expectedRevision:current.revision,payload:{reviewed:true,expectedBundleVersion:0}});assert(!blocked.ok);assert.equal(blocked.code,'SPEC_MAINTENANCE_CONFLICT');
  const resolved=resolveSpecMaintenanceIn(s,{fingerprint:next.fingerprint,conflictId:next.conflicts[0].id,choice:'accepted',reason:'以新的验收规范为准',expectedRevision:current.revision});assert(resolved.ok,resolved.message);maintainProjectSpec(s);assert.equal(s.integration!.specMaintenance!.conflicts.length,0);
  const d=s.integration!.drafts[next.draftId!];const published=applyIntegration(s,{projectId:s.project.id,idempotencyKey:'spec-publish',type:'publish',draftId:d.id,expectedRevision:d.revision,payload:{reviewed:true,expectedBundleVersion:0}});assert(published.ok,published.message);assert.equal(s.integration!.versions[0].sections[0].body,'新的验收规范正文');
}
console.log('delivery publication and specification maintenance invariants passed');
