import type { Snapshot, CommandResult } from './types';
import { currentDeliverySlots, receiptForSlot } from './deliveryContract';
import { applyIntegration, ensureIntegration, listIntegrationSources, type IntegrationSection } from './resultIntegration';
import { hashText, stableContent } from './contentHash';
import { currentProjectSpec, projectSpecBundle } from './specLineage';

export interface SpecMaintenanceConflict {id:string;sectionId:string;title:string;proposed?:IntegrationSection;reason:string}
export interface SpecMaintenance {
  fingerprint:string;draftId?:string;revisionId?:string;status:'ready'|'conflict'|'waiting';at:string;
  generatedHashes:Record<string,string>;conflicts:SpecMaintenanceConflict[];message:string;
  /** Explicit conflict choices are staged until every affected source can be saved atomically. */
  pendingSections?:IntegrationSection[];pendingGeneratedHashes?:Record<string,string>;
}
const sectionHash=(s:IntegrationSection)=>hashText(stableContent(s));
function desiredSpec(snapshot:Snapshot) {
  const sources=listIntegrationSources(snapshot),waiting:string[]=[];
  const slots=currentDeliverySlots(snapshot).filter(s=>s.contract?.purpose==='project_spec');
  const sections:IntegrationSection[]=[];
  for(const slot of slots){
    const artifact=snapshot.collaboration?.artifacts.find(a=>a.id===snapshot.collaboration?.tasks[slot.taskKey]?.acceptedArtifactId);
    const receipt=receiptForSlot(artifact,slot);
    if(!artifact||!receipt||!sources.find(s=>s.artifactId===artifact.id)?.eligible){waiting.push(`${slot.title}：等待当前版本验收`);continue;}
    const body=receipt.body??receipt.textBody;
    if(!body||body.length>100000){waiting.push(`${slot.title}：需要不超过 100000 字符的已验证文本正文`);continue;}
    sections.push({id:`spec-${slot.id}`,title:slot.title,body,sourceIds:[artifact.id]});
  }
  return {slots,sections,waiting};
}
/** Runs inside the same backend transaction after acceptance/changes. It never publishes. */
export function maintainProjectSpec(snapshot:Snapshot):void {
  if(!snapshot.integration?.specMaintenance&&!currentDeliverySlots(snapshot).some(s=>s.contract?.purpose==='project_spec'))return;
  const desired=desiredSpec(snapshot),previous=snapshot.integration?.specMaintenance;
  if(!desired.slots.length&&!previous)return;
  const bundle=projectSpecBundle(snapshot),published=currentProjectSpec(snapshot);
  const draft=Object.values(snapshot.integration?.drafts??{}).filter(d=>d.bundleId===bundle?.id&&d.status==='draft').at(-1);
  const revision=snapshot.integration?.revisions.find(r=>r.id===draft?.revisionId);
  const fingerprint=hashText(stableContent({sections:desired.sections,waiting:desired.waiting,slots:desired.slots.map(s=>({id:s.id,contract:s.contract})),published:published?.id}));
  if(previous?.fingerprint===fingerprint&&previous.revisionId===(revision?.id??published?.revisionId))return;
  const state=ensureIntegration(snapshot),at=new Date().toISOString();
  const base=revision?.sections??published?.sections??[];
  const generatedHashes={...previous?.generatedHashes},conflicts:SpecMaintenanceConflict[]=[];
  const sections=structuredClone(base);
  for(const proposed of desired.sections){
    const index=sections.findIndex(s=>s.id===proposed.id),old=index<0?undefined:sections[index];
    const known=generatedHashes[proposed.id];
    if(old&&sectionHash(old)!==sectionHash(proposed)&&known&&sectionHash(old)!==known&&sectionHash(proposed)!==known){
      conflicts.push({id:hashText(stableContent([proposed.id,proposed])),sectionId:proposed.id,title:proposed.title,proposed,reason:'人工正文与新验收规范同时变化，需选择合并结果'});continue;
    }
    // Preserve deliberate user edits until a different accepted source arrives.
    if(old&&known&&sectionHash(old)!==known&&sectionHash(proposed)===known)continue;
    if(index<0)sections.push(proposed);else sections[index]=proposed;
    generatedHashes[proposed.id]=sectionHash(proposed);
  }
  const activeIds=new Set(desired.slots.map(s=>`spec-${s.id}`));
  for(const section of sections)if(generatedHashes[section.id]&&!activeIds.has(section.id))conflicts.push({id:hashText(`retired:${section.id}:${fingerprint}`),sectionId:section.id,title:section.title,reason:'规范交付项已取消；已发布正文保留，需明确是否从新草案移除'});
  if(!sections.length){state.specMaintenance={fingerprint,status:'waiting',at,generatedHashes,conflicts,message:desired.waiting.join('；')||'等待已验收规范内容'};return;}
  if(!draft&&published&&stableContent(sections)===stableContent(published.sections)&&!conflicts.length){state.specMaintenance={fingerprint,status:desired.waiting.length?'waiting':'ready',at,revisionId:published.revisionId,generatedHashes,conflicts,message:desired.waiting.join('；')||'项目规范已包含当前验收内容'};return;}
  // A conflict never rewrites body, provenance, or pins. In particular an old accepted
  // source can be stale now: do not silently swap its ID just to make save validate.
  if(conflicts.length){
    let conflictDraft=draft,conflictRevision=revision;
    if(!conflictDraft&&published){
      const created=applyIntegration(snapshot,{projectId:snapshot.project.id,idempotencyKey:`spec-conflict-base:${fingerprint.slice(0,48)}:${published.id}`,type:'create',payload:{purpose:'project_spec',bundleId:bundle!.id,baseVersionId:published.id}},'system');
      if(!created.ok){ensureIntegration(snapshot).specMaintenance={fingerprint,status:'waiting',at,generatedHashes:previous?.generatedHashes??{},conflicts,message:`规范维护待处理：${created.message}`};return;}
      conflictDraft=snapshot.integration!.drafts[created.draftId!];conflictRevision=snapshot.integration!.revisions.find(r=>r.id===conflictDraft?.revisionId);
    }
    ensureIntegration(snapshot).specMaintenance={fingerprint,draftId:conflictDraft?.id,revisionId:conflictRevision?.id,status:'conflict',at,generatedHashes:previous?.generatedHashes??{},conflicts,pendingSections:sections,pendingGeneratedHashes:generatedHashes,message:'规范更新与人工修订有差异，请核对'};
    return;
  }
  const sourceIds=[...new Set(sections.flatMap(s=>s.sourceIds))];
  const oldPins=revision?.sourcePins??published?.sourcePins??[];
  const excludeReasons=Object.fromEntries(oldPins.filter(p=>!sourceIds.includes(p.artifactId)).map(p=>[p.artifactId,'由同一规范交付项的新验收版本替代']));
  let nextDraft=draft,nextRevision=revision;
  if(!draft||stableContent(sections)!==stableContent(revision?.sections)){
    const command=draft?{type:'save' as const,draftId:draft.id,expectedRevision:draft.revision,payload:{title:revision!.title,sourceIds,sections,excludeReasons}}:
      {type:'create' as const,payload:{purpose:'project_spec' as const,bundleId:bundle?.id,title:published?.title??`${snapshot.project.name} · 项目规范`,sourceIds,sections,excludeReasons}};
    const result=applyIntegration(snapshot,{projectId:snapshot.project.id,idempotencyKey:`spec-maintain:${fingerprint.slice(0,48)}:${revision?.id??'new'}`,...command},'system');
    if(!result.ok){ensureIntegration(snapshot).specMaintenance={fingerprint,revisionId:revision?.id,draftId:draft?.id,status:'waiting',at,generatedHashes:previous?.generatedHashes??{},conflicts,message:`规范维护待处理：${result.message}`};return;}
    nextDraft=snapshot.integration!.drafts[result.draftId!];nextRevision=snapshot.integration!.revisions.find(r=>r.id===nextDraft?.revisionId);
  }
  ensureIntegration(snapshot).specMaintenance={fingerprint,draftId:nextDraft?.id,revisionId:nextRevision?.id,status:conflicts.length?'conflict':desired.waiting.length?'waiting':'ready',at,generatedHashes,conflicts,message:conflicts.length?'规范更新与人工修订有差异，请核对':desired.waiting.join('；')||'已验收规范自动加入草案，核对发布后生效'};
}

export interface ResolveSpecMaintenanceInput {fingerprint:string;conflictId:string;choice:'accepted'|'manual';reason:string;expectedRevision:number}
export function resolveSpecMaintenanceIn(snapshot:Snapshot,input:ResolveSpecMaintenanceInput):CommandResult {
  const state=snapshot.integration,m=state?.specMaintenance,draft=m?.draftId?state?.drafts[m.draftId]:undefined,revision=state?.revisions.find(r=>r.id===draft?.revisionId),conflict=m?.conflicts.find(c=>c.id===input.conflictId);
  if(!m||!draft||!revision||!conflict||m.fingerprint!==input.fingerprint||draft.revision!==input.expectedRevision)return {ok:false,message:'规范草案已变化，请重新核对'};
  if(!['accepted','manual'].includes(input.choice)||!input.reason?.trim()||input.reason.length>2000)return {ok:false,message:'请选择处理方式并说明理由'};
  const sections=structuredClone(m.pendingSections??revision.sections),index=sections.findIndex(s=>s.id===conflict.sectionId);
  if(index<0)return {ok:false,message:'章节不存在'};
  if(input.choice==='accepted'){if(conflict.proposed)sections[index]=conflict.proposed;else sections.splice(index,1);}
  else if(conflict.proposed)sections[index].sourceIds=conflict.proposed.sourceIds;
  const conflicts=m.conflicts.filter(c=>c.id!==input.conflictId),generatedHashes={...(m.pendingGeneratedHashes??m.generatedHashes)};
  if(conflict.proposed)generatedHashes[conflict.sectionId]=sectionHash(conflict.proposed);else delete generatedHashes[conflict.sectionId];
  if(conflicts.length){
    // Other choices may still refer to stale sources. Record this explicit choice,
    // but keep the entire draft immutable until all conflicts have been resolved.
    m.conflicts=conflicts;m.pendingSections=sections;m.pendingGeneratedHashes=generatedHashes;
    m.message='已记录本项选择；全部差异处理后将一起写入规范草案';
    state!.events.push({id:`spec-resolution:${crypto.randomUUID()}`,sequence:++state!.sequence,at:new Date().toISOString(),type:'spec_maintenance_resolved',draftId:draft.id,bundleId:draft.bundleId,detail:JSON.stringify({conflictId:input.conflictId,choice:input.choice,reason:input.reason,staged:true})});
    return {ok:true,message:m.message};
  }
  const sourceIds=[...new Set(sections.flatMap(s=>s.sourceIds))];
  const result=applyIntegration(snapshot,{projectId:snapshot.project.id,idempotencyKey:`spec-resolve:${crypto.randomUUID()}`,type:'save',draftId:draft.id,expectedRevision:draft.revision,payload:{title:revision.title,sections,sourceIds,excludeReasons:Object.fromEntries(revision.sourcePins.filter(p=>!sourceIds.includes(p.artifactId)).map(p=>[p.artifactId,input.reason]))}});
  if(!result.ok)return result;
  const current=ensureIntegration(snapshot),next=current.specMaintenance!;
  next.conflicts=[];next.status='ready';next.revisionId=current.drafts[draft.id].revisionId;next.generatedHashes=generatedHashes;
  delete next.pendingSections;delete next.pendingGeneratedHashes;
  next.message='已记录合并选择，请核对草案并发布';
  current.events.push({id:`spec-resolution:${crypto.randomUUID()}`,sequence:++current.sequence,at:new Date().toISOString(),type:'spec_maintenance_resolved',draftId:draft.id,bundleId:draft.bundleId,detail:JSON.stringify({conflictId:input.conflictId,choice:input.choice,reason:input.reason})});
  return {ok:true,message:next.message};
}
