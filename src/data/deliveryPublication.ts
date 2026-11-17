import type { Snapshot, CommandResult } from './types';
import { deliveryPresentation, type DeliveryScope } from './deliveryPresentation';
import { receiptForSlot } from './deliveryContract';
import { hashText, stableContent } from './contentHash';
import { applyIntegration, listIntegrationSources, type IntegrationSection } from './resultIntegration';

export interface DeliveryPublicationItem { slotId:string; title:string; state:string; required:boolean; artifactId?:string; format?:string }
export interface DeliveryPublicationPreview {
  fingerprint:string; title:string; items:DeliveryPublicationItem[]; blockers:string[]; canPublish:boolean;
  publishedVersion?:{id:string;version:number;at:string;current:boolean};
}
export interface PublishDeliveryInput { scope:DeliveryScope; expectedFingerprint:string; reviewed:true; idempotencyKey:string }
export type PublishDeliveryResult=CommandResult&{versionId?:string;code?:string;replayed?:boolean};
export const deliveryScopeKey=(scope:DeliveryScope)=>scope.workItemId?`task:${scope.taskId}:work:${scope.workItemId}`:scope.taskId?`task:${scope.taskId}`:'project';
function publicationMap(snapshot:Snapshot,scope:DeliveryScope) {
  const map=deliveryPresentation(snapshot,scope);
  if(!scope.taskId)map.slots=map.slots.filter(slot=>snapshot.collaboration?.goalPlans?.[slot.planId]?.at(-1)?.scope==='project');
  return map;
}
function scopeIssue(snapshot:Snapshot,scope:DeliveryScope) {
  if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).some(k=>!['taskId','workItemId'].includes(k)))return '成果范围无效';
  if(scope.workItemId&&!scope.taskId||scope.taskId&&!snapshot.tasks[scope.taskId]||scope.workItemId&&!snapshot.orchestrations?.[scope.taskId!]?.items[scope.workItemId])return '对应任务不存在';
}
export function previewDeliveryPublication(snapshot:Snapshot,scope:DeliveryScope={}):DeliveryPublicationPreview {
  const problem=scopeIssue(snapshot,scope);
  if(problem)return {fingerprint:'',title:'',items:[],blockers:[problem],canPublish:false};
  const map=publicationMap(snapshot,scope),sources=listIntegrationSources(snapshot),key=deliveryScopeKey(scope);
  const bundle=Object.values(snapshot.integration?.bundles??{}).find(b=>b.deliveryScopeKey===key);
  const published=snapshot.integration?.versions.find(v=>v.id===bundle?.publishedVersionId);
  const title=scope.workItemId?snapshot.orchestrations![scope.taskId!].items[scope.workItemId].title:scope.taskId?snapshot.tasks[scope.taskId].title:snapshot.project.name;
  const items=map.slots.map(slot=>({slotId:slot.id,title:slot.title,state:slot.state,required:slot.contract?.required!==false,artifactId:slot.artifact?.id,format:slot.contract?.format}));
  const blockers:string[]=[];
  if(!items.length)blockers.push('请先定义本范围的交付清单');
  for(const slot of map.slots){
    if(!slot.contract){blockers.push(`“${slot.title}”尚未定义逐件交付契约`);continue;}
    const receipt=receiptForSlot(slot.artifact,slot);
    if(!slot.contract.required&&!slot.artifact)continue;
    if(!receipt)blockers.push(`“${slot.title}”尚无当前版本的验证交付`);
    if(slot.state!=='accepted'||!sources.find(s=>s.artifactId===slot.artifact?.id)?.eligible)blockers.push(`“${slot.title}”需要有效验收`);
  }
  if(!map.slots.some(s=>receiptForSlot(s.artifact,s)))blockers.push('至少需要一件已验证成果');
  const contentFingerprint=hashText(stableContent({scope:key,slots:map.slots.map(slot=>({id:slot.id,contract:slot.contract,contributionIds:slot.contributionIds,artifactId:slot.artifact?.id,artifactHash:slot.artifact?.hash,receipt:receiptForSlot(slot.artifact,slot),state:slot.state,source:sources.find(s=>s.artifactId===slot.artifact?.id)}))}));
  return {fingerprint:hashText(stableContent({contentFingerprint,bundleVersion:bundle?.version??0})),title,items,blockers:[...new Set(blockers)],canPublish:!blockers.length,
    ...(published?{publishedVersion:{id:published.id,version:published.version,at:published.at,current:published.deliveryPublication?.contentFingerprint===contentFingerprint}}:{})};
}
/** Builds frozen publication sections from validated receipts, never generic repeated artifact bodies. */
export function publishDeliveryIn(snapshot:Snapshot,input:PublishDeliveryInput):PublishDeliveryResult {
  if(!input||input.reviewed!==true||typeof input.idempotencyKey!=='string'||!input.idempotencyKey||input.idempotencyKey.length>150)return {ok:false,code:'INVALID_PUBLICATION',message:'请明确核对本次成果后发布'};
  const operationHash=hashText(stableContent(input)),prior=snapshot.integration?.deliveryPublicationReceipts?.[input.idempotencyKey];
  if(prior)return prior.fingerprint===operationHash?{...prior.result,replayed:true}:{ok:false,code:'IDEMPOTENCY_CONFLICT',message:'请求标识已被其他发布使用'};
  const preview=previewDeliveryPublication(snapshot,input.scope);
  if(!preview.canPublish)return {ok:false,code:'PUBLICATION_BLOCKED',message:preview.blockers.join('；')};
  if(input.expectedFingerprint!==preview.fingerprint)return {ok:false,code:'PUBLICATION_CHANGED',message:'交付清单、来源或发布版本已变化，请重新核对'};
  if(preview.publishedVersion?.current)return {ok:true,versionId:preview.publishedVersion.id,message:'当前成果已经发布'};
  const copy=structuredClone(snapshot),scopeKey=deliveryScopeKey(input.scope),map=publicationMap(copy,input.scope);
  const bundle=Object.values(copy.integration?.bundles??{}).find(b=>b.deliveryScopeKey===scopeKey);
  const available=map.slots.filter(s=>receiptForSlot(s.artifact,s)),sourceIds=[...new Set(available.map(s=>s.artifact!.id))];
  const sections:IntegrationSection[]=available.map(slot=>{
    const receipt=receiptForSlot(slot.artifact,slot)!;
    return {id:slot.id,title:slot.title,body:receipt.body??receipt.textBody??`文件：${receipt.fileName}\n\n已保存不可变原件；请在此交付件详情中打开。`,sourceIds:[slot.artifact!.id],
      facts:[{key:`delivery:${slot.id}`,value:`v${receipt.contractRevision} ${receipt.format} ${receipt.contentHash}`} ]};
  });
  const omitted=map.slots.filter(s=>!s.contract?.required&&!receiptForSlot(s.artifact,s));
  if(omitted.length)sections.push({id:'optional-omissions',title:'本次未包含的可选交付',body:omitted.map(s=>`- ${s.title}：未交付`).join('\n'),sourceIds});
  const created=applyIntegration(copy,{projectId:copy.project.id,idempotencyKey:`delivery-create:${input.idempotencyKey}`,type:'create',payload:{title:preview.title,bundleId:bundle?.id,sourceIds,sections}});
  if(!created.ok)return created;
  copy.integration!.bundles[created.bundleId!].deliveryScopeKey=scopeKey;
  const result=applyIntegration(copy,{projectId:copy.project.id,idempotencyKey:`delivery-publish:${input.idempotencyKey}`,type:'publish',draftId:created.draftId,expectedRevision:created.revision,payload:{reviewed:true,expectedBundleVersion:bundle?.version??0,reviewNote:'用户核对逐件交付清单、验收和来源后正式发布'}});
  if(!result.ok)return result;
  const sources=listIntegrationSources(copy);
  const contentFingerprint=hashText(stableContent({scope:scopeKey,slots:map.slots.map(slot=>({id:slot.id,contract:slot.contract,contributionIds:slot.contributionIds,artifactId:slot.artifact?.id,artifactHash:slot.artifact?.hash,receipt:receiptForSlot(slot.artifact,slot),state:slot.state,source:sources.find(s=>s.artifactId===slot.artifact?.id)}))}));
  const version=copy.integration!.versions.find(v=>v.id===result.versionId)!;
  version.deliveryPublication={scopeKey,contentFingerprint,items:map.slots.map(s=>({slotId:s.id,title:s.title,contract:structuredClone(s.contract!),artifactId:s.artifact?.id,receipt:structuredClone(receiptForSlot(s.artifact,s))}))};
  version.hash=hashText(stableContent({title:version.title,sourcePins:version.sourcePins,sections:version.sections,deliveryPublication:version.deliveryPublication}));
  const response:PublishDeliveryResult={ok:true,versionId:result.versionId,message:`成果 v${version.version} 已正式发布`};
  (copy.integration!.deliveryPublicationReceipts??={})[input.idempotencyKey]={fingerprint:operationHash,result:response};
  snapshot.integration=copy.integration;
  return response;
}
