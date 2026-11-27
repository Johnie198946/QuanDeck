import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import type { RuntimeDriver, RuntimeRunInput, RuntimeRunRecord, RuntimeEvent } from '../src/data/runtimeContracts';
import { selectProductAttention } from '../src/data/productAttention';
const values = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),
}});

async function main(){
  let stopped = false;
  const base = new LocalWorkdeckDataSource({
    managedWorkspace:async()=>'/fixture/managed',
    prepareProjectWorkspace:async(path,existing={},_project,agentId)=>({workspacePath:path,issues:[],
      bindings:agentId ? {...existing,[agentId]:{connectionId:path+'-conn',projectPath:path,tool:'codex',capabilities:{dispatch:true}}} : existing}),
  });
  const calls:RuntimeRunInput[] = [], records:RuntimeRunRecord[] = [];
  let listener: (event:RuntimeEvent)=>void = ()=>{};
  let controls=0;
  const driver:RuntimeDriver = {
    subscribe:callback=>{listener=callback;return ()=>{};},scan:async()=>[],listRuns:()=>records,
    control:async()=>{controls++;return {stoppedConfirmed:stopped};},
    run:async input=>{
      calls.push(input);
      const record:RuntimeRunRecord = {...input,acceptedAt:new Date().toISOString(),acceptance:'acknowledged',
        runId:'run-'+calls.length,sessionId:'source-'+calls.length,stoppedConfirmed:false,events:[]};
      records.push(record);
      return record;
    },
    prepareAttachments:async input=>input.ids.map(id=>({id,name:'row.png',path:input.connectionId+'/'+id,sha256:'a'.repeat(64)})),
  };
  const runtime = createRuntimeDataSource(base,driver);
  try {
    const projectId=(await runtime.createProject({name:'样例项目'})).projectId!;
    await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
    const taskId=(await runtime.createTaskWithAttachments('核对单据显示',[],projectId)).taskId!;
    const otherId=(await runtime.createTaskWithAttachments('另一文档',[],projectId)).taskId!;
    const first=await runtime.dispatchProjectTask(projectId,taskId,'codex');
    assert.ok(first.ok,first.message);
    const sessionId=first.sessionId!, original=(await base.load()).sessions[sessionId];
    const binding=original.runtime!.collaboration!;
    const envelope={schemaVersion:'quandeck.runtime.v1',idempotencyKey:'original-blocker',binding,kind:'blocker',payload:{reason:'缺少源码和截图'}};
    listener({id:'blocked',runId:records[0].runId,sessionId:records[0].sessionId,sequence:1,at:new Date().toISOString(),
      reply:{id:'blocker-message',text:'<quandeck-submission>'+JSON.stringify(envelope)+'</quandeck-submission>'},status:'waiting_reply'});
    await runtime.flushRuntime();
    const before=await base.load();
    assert.ok(selectProductAttention([before]).some(row=>row.blockedSessionId===sessionId));
    const originalContext=before.collaboration!.contextPackages.find(context=>context.id===binding.contextPackageId);
    const file={id:'picture',name:'row.png',type:'image/png',size:27};
    const input={inputId:'same-input',text:'只改截图中的回执',sourceDirectory:'/fixture/source',attachments:[file]};
    const uncertain=await runtime.restartBlockedTask(sessionId,input);
    assert.equal(uncertain.ok,false);assert.equal(uncertain.materialsSaved,true);
    assert.equal((await base.load()).tasks[taskId].sourceDirectory,undefined);
    assert.equal(calls.length,1);
    assert.equal((await runtime.restartBlockedTask(sessionId,{...input,text:'同一键的其他材料'})).ok,false);
    stopped=true;
    const [sent,twice]=await Promise.all([runtime.restartBlockedTask(sessionId,input),runtime.restartBlockedTask(sessionId,input)]);
    assert.ok(sent.ok,sent.message);assert.equal(twice.sessionId,sent.sessionId);
    const after=await base.load(), successor=after.sessions[sent.sessionId!];
    assert.equal(calls.length,2);assert.equal(controls,2);
    assert.equal(after.tasks[taskId].inputs?.filter(row=>row.id===input.inputId).length,1);
    assert.equal(calls[1].connectionId,'/fixture/source-conn');assert.match(calls[1].prompt,/只改截图中的回执/);
    assert.match(calls[1].prompt,/\/fixture\/source-conn\/picture/);
    assert.equal(successor.runtime?.predecessorSessionId,sessionId);
    assert.equal(after.sessions[sessionId].runtime?.connection.projectPath,'/fixture/managed');
    assert.equal(after.sessions[sessionId].runtime?.handedOffTo,successor.id);
    assert.deepEqual(after.collaboration!.contextPackages.find(context=>context.id===binding.contextPackageId),originalContext);
    assert.deepEqual(after.collaboration!.artifacts,before.collaboration!.artifacts);
    assert.equal(after.project.workspacePath,'/fixture/managed');
    assert.equal(after.tasks[otherId].sourceDirectory,undefined);
    assert.equal((await runtime.restartBlockedTask(sessionId,input)).sessionId,successor.id);
    assert.equal((await runtime.restartBlockedTask(sessionId,{...input,inputId:'new-input'})).ok,false);
    assert.ok((await runtime.dispatchProjectTask(projectId,otherId,'codex')).ok);
    assert.equal(calls[2].connectionId,calls[0].connectionId);
    console.log('Blocked task: explicit task source, retained materials, stopped receipt, same-task history, concurrency and project isolation passed.');
  } finally {runtime.dispose();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
