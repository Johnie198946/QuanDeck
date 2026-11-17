import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { IntelligenceRuntime, systemConnection } from '../src/data/intelligenceRuntime';
import { intelligenceSourceSeq, type IntelligenceJob, type SummaryInput } from '../src/data/intelligence';
import { createAIProvider, summaryOutputSchema } from '../src/data/aiProvider';
import { applyCollaboration } from '../src/data/collaboration';
import type { RuntimeDriver, RuntimeAssistInput, RuntimeAssistReceipt } from '../src/data/runtimeContracts';
const memory=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)}});
const until=async(check:()=>boolean|Promise<boolean>)=>{for(let i=0;i<300;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
class Provider implements RuntimeDriver {
  calls:RuntimeAssistInput[]=[];businessCalls=0;holdClassify=false;holdSummary=false;holdTitle=false;invalidSummaryLink=false;releases:(()=>void)[]=[];
  subscribe=()=>()=>{};scan=async()=>[];control=async()=>{};
  async run():Promise<never>{this.businessCalls++;throw Error('system AI must not dispatch business work');}
  async assist(input:RuntimeAssistInput):Promise<RuntimeAssistReceipt>{
    this.calls.push(input);
    const schema=input.outputSchema as any,binding=Object.fromEntries(Object.entries(schema.properties.binding.properties).map(([key,value])=>[key,(value as any).const]));
    const data=JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\n')+1));
    if(input.kind==='classify'&&data.intake.text==='ERROR')throw Object.assign(Error('provider unavailable'),{actualTokens:17,sourceSessionId:'failed-source',requestId:input.requestId,acceptance:'acknowledged',modelProgressed:true,lastModelProgressAt:'2026-11-17T00:00:00.000Z',privateDiagnostic:'never-persist-source-content'});
    const result=input.kind==='title'?{title:'精简后的调研任务'}:input.kind==='classify'?(data.intake.text.startsWith('todo:')?{source:'user_input',intent:'task',decision:'auto_create',reason:'Explicit request',task:{title:data.intake.text.slice(5)}}:{source:'user_input',intent:'note',decision:'keep_note',reason:'A plain note'}):{overview:'Only supplied project facts',completed:[],current:data.ledger.slice(0,1).map((item:any)=>({text:item.title,taskKey:item.key,factRefs:[item.key]})),issues:[],nextActions:data.ledger.length?[{actionId:'verify-evidence',title:'Verify pending evidence',goal:'Check candidate evidence',criteria:['User can inspect the evidence'],reason:'Explicit next step proposal',factRefs:[data.ledger[0].key]}]:[]};
    if(input.kind==='summary'&&this.invalidSummaryLink)(result as any).nextActions[0].existingTaskId='foreign-task::forged-child';
    if (input.tool === 'codex') {
      const checkSchema = (shape: any) => {
        if (shape.anyOf) { shape.anyOf.forEach(checkSchema); return; }
        assert.equal(typeof shape.type, 'string', 'Codex rejects schema nodes without an explicit type');
        if (shape.type === 'object') {
          assert.deepEqual([...shape.required].sort(), Object.keys(shape.properties).sort());
          Object.values(shape.properties).forEach(checkSchema);
        }
        if (shape.items) checkSchema(shape.items);
      };
      checkSchema(schema);
      if (input.kind === 'classify') {
        const classification = result as Record<string, unknown>;
        classification.existingTaskId = null;
        if (classification.task) Object.assign(classification.task, { goal: null, criteria: null, due: null });
        else classification.task = null;
      }
    }
    if(input.kind==='classify'&&data.intake.text==='BAD_BINDING')binding.projectId='foreign';
    const receipt:RuntimeAssistReceipt={requestId:input.requestId,projectId:input.projectId,connectionId:input.connectionId,tool:input.tool,sourceSessionId:`system-source-${this.calls.length}`,output:{schemaVersion:schema.properties.schemaVersion.const,binding,result},actualTokens:50,startedAt:new Date().toISOString(),acceptedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),budgetEnforcement:'soft',tokenLimit:input.maxTokens,budgetExceeded:false,contextPolicy:'new-isolated-session',toolPolicy:input.tool==='dsh'?'isolated-no-tool-plugins':'read-only-isolated'};
    if(input.kind==='title'&&this.holdTitle||input.kind==='classify'&&this.holdClassify||input.kind==='summary'&&this.holdSummary){this.holdClassify=false;this.holdSummary=false;this.holdTitle=false;await new Promise<void>(resolve=>this.releases.push(resolve));}
    return receipt;
  }
}
async function main(){
 const scopeInput:SummaryInput={projectId:'scope-project',projectName:'Scope contract',sourceSeq:7,sourceEventIds:[],ledger:['task-root','task-root::audit','planning:direction:root:1'].map(key=>({key,title:key,owner:'me',status:'ready',version:1,specRevision:1,goal:'核对资料',criteria:['保留事实']})),existingTaskIds:['task-root'],factRefs:['task-root','task-root::audit','planning:direction:root:1','fact-source'],facts:[],blackboard:{running:[],review:[],blocked:[],ready:[]},rejectedActions:[],referenceDate:'2026-11-17',timeZone:'Asia/Shanghai'};
 const scopedSchema=summaryOutputSchema(scopeInput);
 assert.deepEqual(scopedSchema.properties.nextActions.items.properties.existingTaskId?.enum,['task-root']);
 assert.deepEqual(scopedSchema.properties.current.items.properties.taskKey?.enum,scopeInput.ledger.map(row=>row.key));
 const refItems=scopedSchema.properties.issues.items.properties.factRefs.items;assert('enum' in refItems);assert.deepEqual(refItems.enum,scopeInput.factRefs);
 assert.deepEqual(summaryOutputSchema({...scopeInput,existingTaskIds:undefined}).properties.nextActions.items.properties.existingTaskId?.enum,['task-root'],'legacy inputs exclude planning rows and child scopes');
 const emptySchema=summaryOutputSchema({...scopeInput,ledger:[],existingTaskIds:[],factRefs:[]});
 assert.equal(emptySchema.properties.completed.maxItems,0);
 assert.equal(emptySchema.properties.current.items.properties.factRefs.maxItems,0);
 assert.equal(emptySchema.properties.current.items.properties.taskKey,undefined);
 assert.equal(emptySchema.properties.nextActions.items.properties.existingTaskId,undefined);
 const providerDriver=new Provider(),provider=createAIProvider(providerDriver);
 for(const input of [scopeInput,{...scopeInput,ledger:[],existingTaskIds:[],factRefs:[]}]){
   const job:IntelligenceJob={id:'scope-job-'+input.ledger.length,kind:'summary',status:'running',input,createdAt:new Date().toISOString()};
   const frozen=JSON.stringify(input);await provider.generateSummary(job,{agentId:'codex',connectionId:'scope-connection',tool:'codex'});
   assert.equal(JSON.stringify(input),frozen,'schema preparation cannot mutate the fixed input');
 }
 const scopedCall=providerDriver.calls[0],strict=(scopedCall.outputSchema as any).properties.result;
 assert.deepEqual(strict.properties.nextActions.items.properties.existingTaskId.anyOf[0].enum,['task-root']);
 assert(scopedCall.prompt.includes('existingTaskId与taskKey不同')&&scopedCall.prompt.includes('不能填带::的子任务key'));
 assert.equal(providerDriver.calls.length,2,'provider makes one request per input and never retries a schema choice');
 const base=new LocalWorkdeckDataSource();const projectA=(await base.createProject({name:'Project A'})).projectId!;
 await base.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#123456'});await base.registerAgent({id:'claude',name:'Claude',short:'Claude',color:'#654321',makeDefault:true});
 await base.registerAgent({id:'custom-company',name:'Company Codex',short:'Company',color:'#123456'});
 memory.set('quandeck.configured-agents.v1',JSON.stringify([{tool:'codex',agentId:'custom-company',connectionId:'company-provider'}]));
 assert.deepEqual(systemConnection(await base.load()),{agentId:'custom-company',connectionId:'company-provider',tool:'codex'},'named profile keeps its identity instead of selecting the tool catalog entry');
 memory.set('quandeck.configured-agents.v1',JSON.stringify([{tool:'codex',agentId:'custom-missing',connectionId:'missing-provider'}]));
 const missingProfileSnapshot=await base.load();assert.throws(()=>systemConnection(missingProfileSnapshot),/SYSTEM_CONNECTION_MISSING/);
 memory.set('quandeck.configured-agents.v1',JSON.stringify([{tool:'codex',connectionId:'first-provider',projectPath:'/old-workspace'},{tool:'claude',connectionId:'second-provider',projectPath:'/second'}]));
 const driver=new Provider(),service=new IntelligenceRuntime(base,driver,25);
 driver.holdClassify=true;const intake=await service.submitIntake('todo:Prepare brief',projectA);assert(intake.ok&&intake.inputId);
 await until(()=>driver.releases.length>0);
 assert((await base.load()).intelligence!.intakes.some(input=>input.id===intake.inputId&&input.text==='todo:Prepare brief'));
 await base.addBlock('task','Manual work during classification');assert.equal(Object.keys((await base.load()).tasks).length,1,'manual entry remains independent while AI is pending');
 driver.releases.shift()!();await service.flush();
 assert.equal((await base.load()).intelligence!.intakeStates[intake.inputId!].status,'classified');assert.equal(Object.keys((await base.load()).tasks).length,2);
 assert.equal(driver.calls[0].connectionId,'first-provider','configured first agent wins over default/catalog order');assert.equal(driver.businessCalls,0);assert.equal(Object.keys((await base.load()).sessions).length,0);assert.equal(Object.keys((await base.load()).collaboration!.runs).length,0);
 await until(async()=>Boolean((await base.load()).intelligence?.latestSummaryId));await service.flush();
 let snapshot=await base.load();assert.equal(snapshot.intelligence!.summaryState.status,'ready');
 assert(snapshot.usageAccounting?.receipts.some(receipt=>receipt.runId===`system:${intake.jobId}`&&receipt.purpose==='classify'&&receipt.totalTokens===50));
 assert(snapshot.usageAccounting?.receipts.some(receipt=>receipt.purpose==='summary'&&receipt.totalTokens===50));
 assert(snapshot.usageAccounting!.receipts.every(receipt=>receipt.billedMicros===undefined),'unreported actual monetary cost is never invented');
 const suggestion=Object.values(snapshot.intelligence!.suggestions).find(value=>value.status==='pending')!;assert(suggestion);const count=Object.keys(snapshot.tasks).length;
 assert.equal(Object.keys((await base.load()).tasks).length,count,'summary actions do not auto-create tasks');
 assert((await service.resolveSuggestion(suggestion.id,'accepted',projectA)).ok);assert.equal(Object.keys((await base.load()).tasks).length,count+1);assert((await service.resolveSuggestion(suggestion.id,'accepted',projectA)).ok);assert.equal(Object.keys((await base.load()).tasks).length,count+1);
 await until(async()=>{const s=await base.load();return s.intelligence!.summaryState.status==='ready'&&s.intelligence!.summaryState.sourceSeq===intelligenceSourceSeq(s);});
 const callsBefore=driver.calls.length;await base.updateJournal({summary:'ordinary user note'});await new Promise(resolve=>setTimeout(resolve,80));assert.equal(driver.calls.length,callsBefore,'non-ledger edits cannot trigger summary loops');
 driver.holdSummary=true;await base.addBlock('task','First changed task');await until(()=>driver.releases.length>0);const summaryCalls=driver.calls.filter(call=>call.kind==='summary').length;
 await base.addBlock('task','Second changed task while summary runs');await new Promise(resolve=>setTimeout(resolve,60));assert.equal(driver.calls.filter(call=>call.kind==='summary').length,summaryCalls,'one summary per project at a time');
 driver.releases.shift()!();await service.flush();await until(async()=>{const s=await base.load();return s.intelligence!.summaryState.status==='ready'&&s.intelligence!.summaryState.sourceSeq===intelligenceSourceSeq(s);});
 snapshot=await base.load();assert(snapshot.intelligence!.summaryVersions.some(version=>version.sourceSeq<(snapshot.intelligence!.summaryVersions.find(v=>v.id===snapshot.intelligence!.latestSummaryId)!.sourceSeq)),'obsolete result is retained as history');
 const failed=await service.submitIntake('ERROR',projectA);await service.flush();snapshot=await base.load();assert.equal(snapshot.intelligence!.intakeStates[failed.inputId!].status,'failed');assert(snapshot.intelligence!.intakes.some(value=>value.id===failed.inputId&&value.text==='ERROR'));assert.equal(snapshot.intelligence!.jobs[failed.jobId!].actualTokens,17);
 assert.equal(snapshot.intelligence!.jobs[failed.jobId!].meta?.modelProgressed,true);assert.equal(snapshot.intelligence!.jobs[failed.jobId!].meta?.lastModelProgressAt,'2026-11-17T00:00:00.000Z');assert.equal(snapshot.intelligence!.jobs[failed.jobId!].meta?.privateDiagnostic,undefined,'only safe activity metadata may be persisted');
 const invalid=await service.submitIntake('BAD_BINDING',projectA);await service.flush();assert.equal((await base.load()).intelligence!.intakeStates[invalid.inputId!].status,'failed');
 assert.equal((await base.load()).usageAccounting!.receipts.find(receipt=>receipt.runId===`system:${invalid.jobId}`)!.totalTokens,50,'invalid model content retains independently verified provider usage');
 const projectB=(await base.createProject({name:'New project without business binding'})).projectId!;assert.deepEqual((await base.load()).runtimeConnections??{},{});
 const newProject=await service.submitIntake('Just a note',projectB);await service.flush();assert.equal((await base.load()).intelligence!.intakeStates[newProject.inputId!].status,'classified');assert.equal(driver.calls.at(-1)!.connectionId,'first-provider');assert.equal(driver.calls.at(-1)!.projectId,projectB);
 await base.switchProject(projectA);const pinned=service.submitIntake('Pinned at click');await base.switchProject(projectB);const saved=await pinned;await service.flush();assert((await base.listProjects()).find(value=>value.project.id===projectA)!.intelligence!.intakes.some(value=>value.id===saved.inputId),'async initialization cannot reassign a click to the next selected project');
 const longTitle='整理访谈与竞品信息形成完整调研报告，保留需求细节和已知约束，并在提交前检查引用材料是否齐全';
 await base.switchProject(projectB);driver.holdTitle=true;const block=await base.addBlock('task',longTitle);let titleSnapshot=await base.load();const titleTask=(titleSnapshot.journal.blocks.find(row=>row.id===block) as {taskId:string}).taskId;
 const titleRequest=await service.summarizeTaskTitle(titleTask,projectB);assert(titleRequest.ok);await until(()=>driver.releases.length>0);
 await base.updateTaskTitle(titleTask,'用户指定名称');driver.releases.shift()!();await service.flush();
 assert.equal((await base.load()).tasks[titleTask].title,'用户指定名称','late AI title cannot override manual rename');
 await base.updateTaskTitle(titleTask,longTitle);
 base.mutateRuntimeProject(projectB,d=>{d.tasks[titleTask].owner='agent';const claim=applyCollaboration(d,{projectId:projectB,taskId:titleTask,type:'claim',idempotencyKey:'title-scope-claim',payload:{runId:'title-scope-run',sessionId:'title-scope-session',executor:'codex'}},{kind:'service',name:'runtime-test'});assert(claim.ok,claim.message);});
 const beforeTitle=(await base.load()).collaboration!,scopeBefore=structuredClone(beforeTitle.tasks[titleTask]),specsBefore=structuredClone(beforeTitle.specs);
 const retryTitle=await service.summarizeTaskTitle(titleTask,projectB);await service.flush();titleSnapshot=await base.load();
 assert.equal(titleSnapshot.tasks[titleTask].title,'精简后的调研任务');assert.equal(titleSnapshot.tasks[titleTask].originalTitle,longTitle);
 assert.equal(titleSnapshot.intelligence!.jobs[retryTitle.jobId!].status,'succeeded');
 assert.equal(titleSnapshot.collaboration!.tasks[titleTask].specRevision,scopeBefore.specRevision,'AI display title does not revise the original requirements');
 assert.equal(titleSnapshot.collaboration!.tasks[titleTask].activeRunId,scopeBefore.activeRunId,'AI display title cannot fence the active task execution');
 assert.equal(titleSnapshot.collaboration!.tasks[titleTask].claimEpoch,scopeBefore.claimEpoch);
 assert.deepEqual(titleSnapshot.collaboration!.specs,specsBefore,'complete task goal remains immutable');
 const titleCall=driver.calls.find(call=>call.kind==='title')!;assert.equal(titleCall.connectionId,'first-provider');assert.equal((titleCall.outputSchema as any).properties.result.properties.title.maxLength,40);
 assert.equal(driver.businessCalls,0);assert.equal(Object.keys(titleSnapshot.sessions).length,0);
 await base.registerAgent({id:'dsh',name:'DeepSeek Harness',short:'DSH',color:'#445566'});
 memory.set('quandeck.configured-agents.v1',JSON.stringify([{tool:'dsh',connectionId:'dsh-source-config'}]));
 const dshIntake=await service.submitIntake('DSH isolated classification',projectB);await service.flush();
 assert.equal((await base.load()).intelligence!.jobs[dshIntake.jobId!].status,'succeeded','DSH no-tool-plugin receipts pass the same fixed binding checks');
 const dshTitle=await service.summarizeTaskTitle(titleTask,projectB);await service.flush();
 assert.equal((await base.load()).intelligence!.jobs[dshTitle.jobId!].status,'succeeded','DSH title summaries accept their explicit isolation policy');
 assert(driver.calls.some(call=>call.requestId===dshTitle.jobId&&call.tool==='dsh'&&call.connectionId==='dsh-source-config'));
 memory.set('quandeck.configured-agents.v1',JSON.stringify([{tool:'missing' ,connectionId:'unavailable'},{tool:'codex',connectionId:'first-provider'}]));const beforeMissing=driver.calls.length;const missing=await service.submitIntake('todo:Retain raw',projectB);await service.flush();assert.equal(driver.calls.length,beforeMissing,'first agent failure never falls back');assert.equal((await base.load()).intelligence!.intakeStates[missing.inputId!].status,'failed');
 service.dispose();
 // Existing real-world long requirements are picked up after upgrade, without
 // importing demo data, requiring a click, or overriding a manual edit.
 memory.set('quandeck.configured-agents.v1',JSON.stringify([{tool:'codex',connectionId:'first-provider'}]));
 const legacy=await base.createTaskWithAttachments(longTitle+'（旧数据）',[],projectB);
 const preserved=await base.createTaskWithAttachments(longTitle+'（手工名称）',[],projectB);
 await base.updateTaskTitle(preserved.taskId!,longTitle+'（用户明确命名）');
 const backfillDriver=new Provider(),backfill=new IntelligenceRuntime(base,backfillDriver,60000);
 await backfill.flush();
 assert.equal((await base.load()).tasks[legacy.taskId!].title,'精简后的调研任务');
 assert.equal((await base.load()).tasks[legacy.taskId!].originalTitle,longTitle+'（旧数据）');
 assert.equal((await base.load()).tasks[preserved.taskId!].title,longTitle+'（用户明确命名）');
 assert.equal(backfillDriver.calls.filter(call=>call.kind==='title').length,1);
 assert.equal(backfillDriver.businessCalls,0);
 backfill.dispose();
 await base.addBlock('task','Verify invalid summary references');
 const invalidDriver=new Provider();invalidDriver.invalidSummaryLink=true;
 const invalidRuntime=new IntelligenceRuntime(base,invalidDriver,25);
 await invalidRuntime.flush();
 const invalidSummary=await invalidRuntime.refreshProjectSummary(projectB);await invalidRuntime.flush();
 const rejectedSummary=(await base.load()).intelligence!.jobs[invalidSummary.jobId!];
 assert.equal(rejectedSummary.status,'failed','a provider violating the enum is still rejected by the domain');
 assert(rejectedSummary.error?.includes('主任务 ID'));assert.equal(rejectedSummary.actualTokens,50,'failed validation preserves reported source usage');
 const failedCalls=()=>invalidDriver.calls.filter(call=>call.kind==='summary'&&call.projectId===projectB).length;
 const callCount=failedCalls();await new Promise(resolve=>setTimeout(resolve,100));await invalidRuntime.flush();
 assert.equal(failedCalls(),callCount,'invalid summary does not silently issue another large model request');
 const rejectedSeq=(rejectedSummary.input as SummaryInput).sourceSeq;
 await base.addBlock('task','New facts after failed summary');
 await until(()=>failedCalls()===callCount+1);await invalidRuntime.flush();
 const newSummaryJobs=Object.values((await base.load()).intelligence!.jobs).filter(job=>job.kind==='summary'&&(job.input as SummaryInput).sourceSeq>rejectedSeq);
 assert(newSummaryJobs.some(job=>job.status==='failed'),'new ledger version still schedules its own request');
 await new Promise(resolve=>setTimeout(resolve,100));await invalidRuntime.flush();
 assert.equal(failedCalls(),callCount+1,'the new failed input version is not automatically retried either');
 assert.equal(invalidDriver.businessCalls,0);invalidRuntime.dispose();
 const originalList=base.listProjects.bind(base),originalUpdates=base.readProjectUpdates.bind(base);
 const deltaBatches:string[][]=[];
 base.listProjects=async()=>{throw Error('background summary must not clone every project');};
 base.readProjectUpdates=async known=>{const update=await originalUpdates(known);deltaBatches.push(update.snapshots.map(p=>p.project.id));return update;};
 const deltaRuntime=new IntelligenceRuntime(base,new Provider(),60000);await deltaRuntime.flush();deltaBatches.length=0;
 await base.addBlock('task','Delta-only project memory check');await deltaRuntime.flush();
 assert(deltaBatches.some(ids=>ids.includes(projectB)),'changed project remains eligible for summary');
 assert(deltaBatches.every(ids=>ids.every(id=>id===projectB)),'background updates never pull another project history');
 deltaRuntime.dispose();base.listProjects=originalList;base.readProjectUpdates=originalUpdates;
 console.log('intelligence runtime: persisted intake; first configured agent; isolated system calls; debounce; stale rerun; confirmation; failures; project-scoped delta reads');
}
void main();
