import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { IntelligenceRuntime, systemConnection } from '../src/data/intelligenceRuntime';
import { intelligenceSourceSeq } from '../src/data/intelligence';
import { applyCollaboration } from '../src/data/collaboration';
import type { RuntimeDriver, RuntimeAssistInput, RuntimeAssistReceipt } from '../src/data/runtimeContracts';
const memory=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)}});
const until=async(check:()=>boolean|Promise<boolean>)=>{for(let i=0;i<300;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
class Provider implements RuntimeDriver {
  calls:RuntimeAssistInput[]=[];businessCalls=0;holdClassify=false;holdSummary=false;holdTitle=false;releases:(()=>void)[]=[];
  subscribe=()=>()=>{};scan=async()=>[];control=async()=>{};
  async run():Promise<never>{this.businessCalls++;throw Error('system AI must not dispatch business work');}
  async assist(input:RuntimeAssistInput):Promise<RuntimeAssistReceipt>{
    this.calls.push(input);
    const schema=input.outputSchema as any,binding=Object.fromEntries(Object.entries(schema.properties.binding.properties).map(([key,value])=>[key,(value as any).const]));
    const data=JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\n')+1));
    if(input.kind==='classify'&&data.intake.text==='ERROR')throw Object.assign(Error('provider unavailable'),{actualTokens:17,sourceSessionId:'failed-source',requestId:input.requestId,acceptance:'acknowledged'});
    const result=input.kind==='title'?{title:'精简后的调研任务'}:input.kind==='classify'?(data.intake.text.startsWith('todo:')?{source:'user_input',intent:'task',decision:'auto_create',reason:'Explicit request',task:{title:data.intake.text.slice(5)}}:{source:'user_input',intent:'note',decision:'keep_note',reason:'A plain note'}):{overview:'Only supplied project facts',completed:[],current:data.ledger.slice(0,1).map((item:any)=>({text:item.title,taskKey:item.key,factRefs:[item.key]})),issues:[],nextActions:data.ledger.length?[{actionId:'verify-evidence',title:'Verify pending evidence',goal:'Check candidate evidence',criteria:['User can inspect the evidence'],reason:'Explicit next step proposal',factRefs:[data.ledger[0].key]}]:[]};
    if(input.kind==='classify'&&data.intake.text==='BAD_BINDING')binding.projectId='foreign';
    const receipt:RuntimeAssistReceipt={requestId:input.requestId,projectId:input.projectId,connectionId:input.connectionId,tool:input.tool,sourceSessionId:`system-source-${this.calls.length}`,output:{schemaVersion:schema.properties.schemaVersion.const,binding,result},actualTokens:50,startedAt:new Date().toISOString(),acceptedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),budgetEnforcement:'soft',tokenLimit:input.maxTokens,budgetExceeded:false,contextPolicy:'new-isolated-session',toolPolicy:input.tool==='dsh'?'isolated-no-tool-plugins':'read-only-isolated'};
    if(input.kind==='title'&&this.holdTitle||input.kind==='classify'&&this.holdClassify||input.kind==='summary'&&this.holdSummary){this.holdClassify=false;this.holdSummary=false;this.holdTitle=false;await new Promise<void>(resolve=>this.releases.push(resolve));}
    return receipt;
  }
}
async function main(){
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
 const invalid=await service.submitIntake('BAD_BINDING',projectA);await service.flush();assert.equal((await base.load()).intelligence!.intakeStates[invalid.inputId!].status,'failed');
 const projectB=(await base.createProject({name:'New project without business binding'})).projectId!;assert.deepEqual((await base.load()).runtimeConnections??{},{});
 const newProject=await service.submitIntake('Just a note',projectB);await service.flush();assert.equal((await base.load()).intelligence!.intakeStates[newProject.inputId!].status,'classified');assert.equal(driver.calls.at(-1)!.connectionId,'first-provider');assert.equal(driver.calls.at(-1)!.projectId,projectB);
 await base.switchProject(projectA);const pinned=service.submitIntake('Pinned at click');await base.switchProject(projectB);const saved=await pinned;await service.flush();assert((await base.listProjects()).find(value=>value.project.id===projectA)!.intelligence!.intakes.some(value=>value.id===saved.inputId),'async initialization cannot reassign a click to the next selected project');
 const longTitle='整理访谈与竞品信息形成完整调研报告，保留需求细节和已知约束，并在提交前检查引用材料是否齐全';
 await base.switchProject(projectB);const block=await base.addBlock('task',longTitle);let titleSnapshot=await base.load();const titleTask=(titleSnapshot.journal.blocks.find(row=>row.id===block) as {taskId:string}).taskId;
 driver.holdTitle=true;const titleRequest=await service.summarizeTaskTitle(titleTask,projectB);assert(titleRequest.ok);await until(()=>driver.releases.length>0);
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
 console.log('intelligence runtime: persisted intake; first configured agent; isolated system calls; debounce; stale rerun; confirmation; failures; new-project and navigation isolation');
}
void main();
