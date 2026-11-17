import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { readPlanTasks } from '../src/data/projectWorkflow';
import { applyCollaboration, hashText, buildContextPackage, type CollaborationActor } from '../src/data/collaboration';
import { currentDeliverySlots } from '../src/data/deliveryContract';
import { latestGoalPlan, deriveDeliveryMap } from '../src/data/goalDelivery';
import { prepareAssemblyForDispatch, refreshProjectAssemblyInputs, recoverInitialSpecAssemblyBaselines } from '../src/data/projectAssembly';
import { maintainProjectSpec } from '../src/data/specMaintenance';
import { acceptedBeforeInitialProjectSpec, currentProjectSpec, projectSpecArtifactStale } from '../src/data/specLineage';
import { applyIntegration } from '../src/data/resultIntegration';
import { previewDeliveryPublication, publishDeliveryIn } from '../src/data/deliveryPublication';
import { persistProjectLibrary } from '../src/data/projectStorage';
import type { Snapshot } from '../src/data/types';

const memory = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)}});
let serial=0;
function command(s:Snapshot,key:string|undefined,type:Parameters<typeof applyCollaboration>[1]['type'],payload:Record<string,unknown>,actor:CollaborationActor={kind:'human'}) {
  return applyCollaboration(s,{projectId:s.project.id,type,taskId:key?.split('::')[0],workItemId:key?.split('::')[1],expectedVersion:key?s.collaboration!.tasks[key].version:undefined,idempotencyKey:`baseline-${++serial}`,payload},actor);
}
function accepted(s:Snapshot,key:string,body:string) {
  prepareAssemblyForDispatch(s,key);
  const claim=command(s,key,'claim',{executor:'codex'},{kind:'service'});assert(claim.ok,claim.message);
  const run=s.collaboration!.runs[claim.resourceId!],slots=currentDeliverySlots(s,key);
  const files=slots.filter(slot=>slot.contract!.kind==='file').map(slot=>({attachmentId:`file-${slot.id}`,name:`${slot.title}.${slot.contract!.format}`,path:`${slot.id}.${slot.contract!.format}`,bytes:new TextEncoder().encode(body).length,sha256:hashText(body),verifiedAt:new Date().toISOString(),textBody:body}));
  const submit=command(s,key,'submit',{title:key,body,sourceIds:s.collaboration!.tasks[key].dependencies.map(dep=>s.collaboration!.tasks[dep].acceptedArtifactId),deliveryItems:slots.map(slot=>({slotId:slot.id,contractRevision:slot.contract!.revision,...(slot.contract!.kind==='file'?{path:`${slot.id}.${slot.contract!.format}`}:{body})}))},{kind:'runtime',runId:run.id,claimEpoch:run.claimEpoch,verifiedDeliveryFiles:files});assert(submit.ok,submit.message);
  const spec=s.collaboration!.specs.find(item=>item.key===key&&item.revision===s.collaboration!.tasks[key].specRevision)!;
  const review=command(s,key,'review',{submissionId:submit.resourceId,verdict:'accepted',checks:spec.criteria.map(()=>true),deliveryChecks:Object.fromEntries(slots.map(slot=>[slot.id,slot.contract!.criteria.map(()=>true)])),note:'逐件核对实际正文与来源'});assert(review.ok,review.message);
  return s.collaboration!.tasks[key].acceptedArtifactId!;
}
async function main(){
  const repo=new LocalWorkdeckDataSource(),projectId=(await repo.createProject({name:'A 到 B 及两份最终交付'})).projectId!;
  await repo.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
  const planId=await repo.ensureProjectPlan(projectId);
  const recorded=await repo.recordDiscussionConclusion(planId,'root',{summary:'A 规范和 B 手册分别整合，项目发布后再建立规范基线',confirmed:[],open:[],tasks:readPlanTasks([
    {key:'A',title:'A 规则设计',expected:'五条规则',deps:[],owner:'agent',phase:'制作'},
    {key:'child',parentKey:'A',title:'整理规则与例子',expected:'规则和例子',deps:[],owner:'agent',phase:'制作'},
    {key:'B',title:'B 手册页面',expected:'采用 A 的规则',deps:['A'],owner:'agent',phase:'制作'},
  ]),deliverables:[
    {id:'spec',title:'协作规范',taskKey:'A',contract:{revision:1,kind:'file',format:'md',required:true,criteria:['规则完整'],purpose:'project_spec'}},
    {id:'manual',title:'协作手册',taskKey:'B',contract:{revision:1,kind:'file',format:'html',required:true,criteria:['页面完整'],purpose:'deliverable'}},
  ]});assert(recorded.ok,recorded.message);
  let s=await repo.load();const approved=await repo.approvePlan(planId,s.ideaPlans![planId].discussion!.conclusions.at(-1)!.id,projectId,1);assert(approved.ok,approved.message);s=await repo.load();
  const plan=latestGoalPlan(s,planId)!,child=plan.tasks.find(b=>b.workItemId)!,a=plan.tasks.find(b=>s.collaboration!.tasks[b.key].title==='A 规则设计')!,b=plan.tasks.find(b=>s.collaboration!.tasks[b.key].title==='B 手册页面')!;
  accepted(s,child.key,'五条规则与例子');accepted(s,a.key,'# 协作规范\n规则来源与交接。');accepted(s,b.key,'<!doctype html><html><body>采用 A 的五条规则</body></html>');
  const finals=latestGoalPlan(s,planId)!.tasks.filter(binding=>binding.assembly),md=finals.find(binding=>binding.assembly!.sourceTaskKeys.includes(a.key))!,html=finals.find(binding=>binding.assembly!.sourceTaskKeys.includes(b.key))!;
  accepted(s,md.key,'# 协作规范\n规则来源与交接。');const htmlId=accepted(s,html.key,'<!doctype html><html><body>协作手册与交接</body></html>');
  assert.equal(deriveDeliveryMap(s).accepted,2);
  const preview=previewDeliveryPublication(s,{}),release=publishDeliveryIn(s,{scope:{},reviewed:true,expectedFingerprint:preview.fingerprint,idempotencyKey:'project-v1'});assert(release.ok,release.message);
  const publishedRelease=structuredClone(s.integration!.versions.find(v=>v.id===release.versionId)!);
  // These tasks exist before first publication but have no accepted evidence.
  const candidateKey=command(s,undefined,'create_task',{title:'未验收候选',goal:'候选',criteria:['有效'],owner:'agent'}).resourceId!;
  const candidateClaim=command(s,candidateKey,'claim',{executor:'codex'},{kind:'service'}),candidateRun=s.collaboration!.runs[candidateClaim.resourceId!];
  const candidate=command(s,candidateKey,'submit',{title:'候选',body:'尚未验收'},{kind:'runtime',runId:candidateRun.id,claimEpoch:candidateRun.claimEpoch});assert(candidate.ok,candidate.message);
  const runningKey=command(s,undefined,'create_task',{title:'仍在运行',goal:'运行',criteria:['有效'],owner:'agent'}).resourceId!;
  const runningClaim=command(s,runningKey,'claim',{executor:'codex'},{kind:'service'}),runningRun=s.collaboration!.runs[runningClaim.resourceId!];
  maintainProjectSpec(s);const maintenance=s.integration!.specMaintenance!,draft=s.integration!.drafts[maintenance.draftId!];
  const spec=applyIntegration(s,{projectId,type:'publish',idempotencyKey:'spec-v1',draftId:draft.id,expectedRevision:draft.revision,payload:{reviewed:true,expectedBundleVersion:0}});assert(spec.ok,spec.message);
  const version=latestGoalPlan(s,planId)!.version;
  assert(acceptedBeforeInitialProjectSpec(s,htmlId));assert.equal(projectSpecArtifactStale(s,htmlId),false);
  assert.equal(deriveDeliveryMap(s).accepted,2,'publishing the first Spec does not undo already verified releases');
  for(const final of finals)assert.equal(refreshProjectAssemblyInputs(s,planId,undefined,final.key),false);
  assert.equal(latestGoalPlan(s,planId)!.version,version,'first publication causes no spurious plan revision or re-execution');
  assert(previewDeliveryPublication(s,{}).publishedVersion?.current,'the exact project release remains current');
  assert.deepEqual(s.integration!.versions.find(v=>v.id===release.versionId),publishedRelease);
  assert.equal(command(s,candidateKey,'review',{submissionId:candidate.resourceId,verdict:'accepted',checks:[true],note:'不能越过新规范'}).code,'SOURCE_STALE');
  assert.equal(command(s,runningKey,'submit',{title:'旧上下文结果',body:'不能越过新规范'},{kind:'runtime',runId:runningRun.id,claimEpoch:runningRun.claimEpoch}).code,'PROJECT_SPEC_CHANGED');

  // Reproduce the cached v3 -> v4 invalidation left by the old installed build.
  const broken=structuredClone(s),c=broken.collaboration!,binding=latestGoalPlan(broken,planId)!.tasks.find(item=>item.key===html.key)!;
  c.tasks[html.key].requiresRevalidation=true;c.freshness[htmlId]='stale';
  const invalidation={id:'old-first-spec-invalidation',sequence:++c.sequence,type:'assembly_inputs_invalidated',taskKey:html.key,actor:'service',at:new Date().toISOString(),detail:JSON.stringify({reason:'等待有效任务交付：协作手册',inputArtifactIds:binding.assembly!.inputArtifactIds})};c.events.push(invalidation);
  const oldPlan=latestGoalPlan(broken,planId)!;c.goalPlans![planId].push({...structuredClone(oldPlan),version:oldPlan.version+1,at:invalidation.at});
  const before=structuredClone({artifacts:c.artifacts,reviews:c.reviews,contexts:c.contextPackages,plans:c.goalPlans,versions:broken.integration!.versions});
  const recovered=structuredClone(broken);assert(recoverInitialSpecAssemblyBaselines(recovered));assert.equal(deriveDeliveryMap(recovered).accepted,2);assert.equal(recoverInitialSpecAssemblyBaselines(recovered),false,'recovery is idempotent');
  assert.deepEqual({artifacts:recovered.collaboration!.artifacts,reviews:recovered.collaboration!.reviews,contexts:recovered.collaboration!.contextPackages,plans:recovered.collaboration!.goalPlans,versions:recovered.integration!.versions},before,'recovery only rebuilds cached flags and appends a reasoned event');
  assert(recovered.collaboration!.events.some(event=>event.type==='assembly_initial_spec_baseline_restored'&&event.detail.includes(invalidation.id)));
  // The installed app runs the same idempotent migration even with automation off.
  persistProjectLibrary({schema:1,activeProjectId:projectId,projects:{[projectId]:broken},agents:[],defaultAgent:''});
  const restarted=await new LocalWorkdeckDataSource().load();assert.equal(deriveDeliveryMap(restarted).accepted,2);
  const rejected=structuredClone(broken);command(rejected,html.key,'mark_stale',{artifactId:htmlId,reason:'负责人发现实际错误'});assert.equal(recoverInitialSpecAssemblyBaselines(rejected),false,'explicit invalidation is never reversed');
  const changed=structuredClone(broken);latestGoalPlan(changed,planId)!.slots.find(slot=>slot.taskKey===html.key)!.contract!.revision++;assert.equal(recoverInitialSpecAssemblyBaselines(changed),false,'contract changes cannot use old acceptance');
  const fake=structuredClone(s);fake.collaboration!.reviews=fake.collaboration!.reviews.filter(review=>review.submissionId!==fake.collaboration!.tasks[html.key].latestSubmissionId);assert.equal(acceptedBeforeInitialProjectSpec(fake,htmlId),false,'completed/accepted ID alone is not evidence');
  const late=structuredClone(s);late.collaboration!.reviews.find(review=>review.submissionId===late.collaboration!.tasks[html.key].latestSubmissionId)!.at=new Date(Date.parse(currentProjectSpec(s)!.at)+1).toISOString();assert.equal(acceptedBeforeInitialProjectSpec(late,htmlId),false,'only acceptance before first publication qualifies');
  const missing=structuredClone(s);delete missing.collaboration!.artifacts.find(artifact=>artifact.id===htmlId)!.deliveryReceipts;assert.equal(acceptedBeforeInitialProjectSpec(missing,htmlId),false,'actual current per-item receipts are required');

  const baseline=currentProjectSpec(s)!,v2draft=applyIntegration(s,{projectId,type:'create',idempotencyKey:'spec-v2-draft',payload:{purpose:'project_spec',bundleId:baseline.bundleId}});assert(v2draft.ok,v2draft.message);
  const d=s.integration!.drafts[v2draft.draftId!],revision=s.integration!.revisions.find(r=>r.id===d.revisionId)!;
  const saved=applyIntegration(s,{projectId,type:'save',idempotencyKey:'spec-v2-edit',draftId:d.id,expectedRevision:d.revision,payload:{title:revision.title,sourceIds:revision.sourcePins.map(pin=>pin.artifactId),sections:revision.sections.map(section=>({...section,body:section.body+'\n新增实际规则。'}))}});assert(saved.ok,saved.message);
  const v2=applyIntegration(s,{projectId,type:'publish',idempotencyKey:'spec-v2',draftId:d.id,expectedRevision:s.integration!.drafts[d.id].revision,payload:{reviewed:true,expectedBundleVersion:1}});assert(v2.ok,v2.message);
  assert.equal(projectSpecArtifactStale(s,htmlId),true,'a genuine second normative revision still invalidates old output');
  assert.equal(deriveDeliveryMap(s).accepted,1);assert(refreshProjectAssemblyInputs(s,planId,undefined,html.key));assert.equal(recoverInitialSpecAssemblyBaselines(s),false);
  assert.equal(buildContextPackage(s,runningKey).projectSpec?.version,2,'new fixed contexts use the new norm');
  console.log('Initial Spec baseline: A → B with child + two final files, durable project release, candidate/run fences, immutable cached-state recovery and v2 invalidation passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
