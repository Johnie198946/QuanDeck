import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { sendNoteDispatch } from '../src/data/sendNoteDispatch';
import { noteTaskKey } from '../src/data/noteTaskSource';
import { KNOWLEDGE_STORAGE_KEY } from '../src/data/knowledgeNotes';
import { projectMaterialPrompt, projectReceiptFiles } from '../src/data/taskMaterialContext';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput } from '../src/data/runtimeContracts';
const values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
async function testMaterialRecallOnStart() {
  values.clear();
  const base = new LocalWorkdeckDataSource();
  const projectId = (await base.createProject({name:'公开样例项目 Orbit',description:'编写轮班手册',
    setup:{requestId:crypto.randomUUID(),tasks:[],background:'受众是首次值班的同事',understanding:{
      summary:'每个角色都需要独立交接单',sourceId:'fixture:approved',attachments:[],
      recommendations:[{id:'fixture:blue-tag',title:'旧班表',kind:'笔记',quote:'蓝签交给早班',
        reason:'适合现有交接流程',use:'给早班交接单标蓝'}],
    }}})).projectId!;
  await base.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#111111'});
  const calls:RuntimeRunInput[] = [];
  const runtime = createRuntimeDataSource(base, {
    subscribe:()=>()=>{}, listRuns:()=>[], scan:async()=>({sessions:[]}), control:async()=>({}),
    prepareReceiptFiles:async input=>{
      assert.deepEqual(input.ids,['receipt-file']);
      return [{id:'receipt-file',name:'复核表.txt',path:'/verified/project/复核表.txt'}];
    },
    run:async input => {
      calls.push(input);
      return {runId:'recall-run-'+calls.length,sessionId:'recall-source-'+calls.length,
        connectionId:input.connectionId,acceptedAt:new Date().toISOString()};
    },
  });
  try {
    await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'recall-test',projectPath:'/verified/project'});
    const at = '2026-01-01T09:00:00.000Z';
    function receipt(id:string,project?:string) {
      const body = '向同事收集 Orbit 轮班记录';
      return {id,title:'资料来源',body,createdAt:at,updatedAt:at,revision:1,attachments:[],expansions:[],history:[],
        todos:[{id:'todo-'+id,lineIndex:0,text:body,dueAt:at,createdAt:at,completedAt:at,
          outcome:{at,text:'Orbit '+id+' 已收到',url:'https://example.com/'+id,projectId:project}}]};
    }
    values.set(KNOWLEDGE_STORAGE_KEY,JSON.stringify({schema:1,decisions:[],notes:[
      receipt('public-example',projectId),receipt('foreign-example','different-project'),
      ...[1,2,3,4].map(i=>receipt('private-'+i)),
    ]}));
    const ordinary = (await base.createTaskWithAttachments('编写 Orbit 轮班文案',[],projectId)).taskId!;
    const first = await runtime.dispatchProjectTask(projectId,ordinary,'codex');
    assert(first.ok,first.message);
    const text = '复核 Orbit 轮班数据';
    const second = await sendNoteDispatch(runtime,{projectId,text,origin:{
      title:'草稿',key:noteTaskKey('draft',0,text),noteSource:{noteId:'draft',lineIndex:0},dispatch:{agentId:'codex',logic:[]},
    }});
    assert(second.ok,second.message);
    assert.equal(calls.length,2);
    for (const call of calls) {
      for (const source of ['编写轮班手册','受众是首次值班的同事','每个角色都需要独立交接单','蓝签交给早班','给早班交接单标蓝']) {
        assert(call.prompt.includes(source),source);
      }
      assert.match(call.prompt,/向同事收集 Orbit 轮班记录/);
      assert.match(call.prompt,/https:\/\/example.com\/public-example/);
      assert.doesNotMatch(call.prompt,/foreign-example|private-\d/);
    }
    const snapshot = await base.getProjectSnapshot(projectId);
    assert(snapshot);
    assert.equal(snapshot.sessions[first.sessionId!]!.runtime!.context.prompt,calls[0].prompt);
    const unrelated = (await base.createTaskWithAttachments('清点会议室座位',[],projectId)).taskId!;
    assert.equal(projectMaterialPrompt((await base.getProjectSnapshot(projectId))!,unrelated),'');
    const raw=JSON.parse(values.get(KNOWLEDGE_STORAGE_KEY)!);
    const firstReceipt=raw.notes[0].todos[0].outcome;
    firstReceipt.files=[{id:'receipt-file',name:'复核表.txt',type:'text/plain',size:4}];
    // Only an explicit reference to the task grants it the local file.
    values.set(KNOWLEDGE_STORAGE_KEY,JSON.stringify(raw));
    assert.deepEqual(projectReceiptFiles(snapshot,ordinary),[]);
    const bound = (await base.createTaskWithAttachments('校核本周的调研结论',[],projectId)).taskId!;
    firstReceipt.usedBy=[{projectId,taskId:bound}];
    values.set(KNOWLEDGE_STORAGE_KEY,JSON.stringify(raw));
    const dispatch = await runtime.dispatchProjectTask(projectId,bound,'codex');
    assert(dispatch.ok,dispatch.message);
    assert.match(calls.at(-1)!.prompt,/verified\/project\/复核表.txt/);
    assert.deepEqual(projectReceiptFiles(snapshot,ordinary),[]);
    values.set(KNOWLEDGE_STORAGE_KEY,'invalid');
    const fallback = await runtime.dispatchProjectTask(projectId,unrelated,'codex');
    assert(fallback.ok,fallback.message);
    assert.doesNotMatch(calls.at(-1)!.prompt,/example.com/);
    for (const [text, reply] of [['添加夜间模式', false], ['翻译这段日语', true]] as const) {
      const fromNote = {title:'旧笔记',key:noteTaskKey('legacy',0,text),noteSource:{noteId:'legacy',lineIndex:0},dispatch:{agentId:'codex',logic:[]}};
      const {taskId} = await base.createTaskWithAttachments(text,[],projectId,fromNote);
      base.mutateRuntimeProject(projectId,d=>{delete d.projectPlanning!.tasks[taskId!];});
      const result = await runtime.dispatchProjectTask(projectId,taskId!,'codex');
      assert.ok(result.ok,result.message);
      assert.equal(calls.at(-1)?.prompt.includes('直接在最终回复给出结果'),reply,'legacy input: '+text);
    }

  } finally {
    values.delete(KNOWLEDGE_STORAGE_KEY);
    runtime.dispose();
  }
}
async function testSourceDirectoryClaims() {
  values.clear();
  let failFirstBinding = true;
  const base = new LocalWorkdeckDataSource({
    managedWorkspace: async () => '/project/default',
    prepareProjectWorkspace: async (path, existing = {}, _id, agent) => {
      if (path === '/source/one' && failFirstBinding) {
        failFirstBinding = false;
        throw new Error('重新选择目录');
      }
      const binding = {connectionId:'conn-' + path,projectPath:path,tool:'codex' as const,capabilities:{dispatch:true}};
      return {workspacePath:path,bindings:agent ? {...existing,[agent]:binding} : existing,issues:[]};
    },
  });
  const projectId = (await base.createProject({name:'双源码目录'})).projectId!;
  await base.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#111111'});
  const runs: string[] = [];
  const runtime = createRuntimeDataSource(base, {
    subscribe:()=>()=>{},listRuns:()=>[],scan:async()=>({sessions:[]}),control:async()=>({}),
    run:async input=>{
      runs.push(input.connectionId);
      return {runId:'dir-run-'+runs.length,sessionId:'dir-session-'+runs.length,connectionId:input.connectionId,acceptedAt:new Date().toISOString()};
    },
  });
  const send = (noteId:string,sourceDirectory?:string,text = '修改 badge.js 的颜色') => sendNoteDispatch(runtime,{projectId,text,sourceDirectory,origin:{
    title:noteId,key:noteTaskKey(noteId,0,text),noteSource:{noteId,lineIndex:0},dispatch:{agentId:'codex',logic:[]},
  }});
  try {
    const first = await send('same','/source/one');
    assert.equal(first.ok,false);
    assert.equal('retryable' in first && first.retryable,true);
    assert.deepEqual(runs,[],'a failed directory binding must never launch in the project default');
    const second = await send('same','/source/two');
    assert.ok(second.ok,second.message);
    assert.notEqual(first.taskId,second.taskId);
    assert.deepEqual(runs,['conn-/source/two']);
    const retried = await send('same','/source/one');
    assert.ok(retried.ok,retried.message);
    assert.equal(retried.taskId,first.taskId);
    assert.deepEqual(runs,['conn-/source/two','conn-/source/one']);
    for (const [directory,expected] of [['/source/one',first.taskId],['/source/two',second.taskId]] as const) {
      const repeated = await send('same',directory);
      assert.ok(repeated.ok,repeated.message);
      assert.equal(repeated.taskId,expected);
      const joined = await send('same-text-in-another-note',directory);
      assert.equal(joined.dispatchMode,'joined');
      assert.equal(joined.taskId,expected);
    }
    assert.equal(runs.length,2);
    const ordinary = await send('same');
    assert.ok(ordinary.ok,ordinary.message);
    assert.equal((await send('same')).taskId,ordinary.taskId);
    assert.equal(runs.length,3,'default directory retains its own original claim');
    const explicitDefault = await send('default-path-selected-explicitly','/project/default');
    assert.equal(explicitDefault.taskId,ordinary.taskId);
    assert.equal(explicitDefault.dispatchMode,'joined');
    const conflicting = await send('same-file','/project/default','修改 badge.js 的阴影');
    assert.equal(conflicting.dispatchMode,'conflict');
    assert.equal(runs.length,3,'the effective default and the same explicit directory share one owner and protect the same files');
  } finally { runtime.dispose(); }
}
async function main(){
 const base=new LocalWorkdeckDataSource(), projectId=(await base.createProject({name:'附件续谈'})).projectId!;
 await base.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#111111'});
 const taskId=(await base.createTaskWithAttachments('做旅行攻略',[],projectId)).taskId!;
 let listen=(_e:RuntimeEvent)=>{};const prepared:unknown[]=[],sent:unknown[]=[];let exportsFail=false,providerFail=false;let duringPrepare:(()=>void)|undefined;
 const driver:RuntimeDriver={subscribe:f=>{listen=f;return()=>{};},listRuns:()=>[],scan:async()=>({sessions:[]}),run:async input=>({runId:'run-input',sessionId:'source-input',connectionId:input.connectionId,acceptedAt:new Date().toISOString()}),prepareAttachments:async input=>{prepared.push(input);if(exportsFail)throw new Error('copy failed');duringPrepare?.();return input.ids.map(id=>({id,name:id+'.png',path:'/verified/project/'+id+'.png'}));},control:async(_id,_action,payload)=>{sent.push(payload);if(providerFail)throw new Error('unknown provider acceptance');}};
 const runtime=createRuntimeDataSource(base,driver);await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'input-test',projectPath:'/verified/project'});
 const receipt=await runtime.dispatch(taskId,'codex');assert(receipt.ok);const sessionId=Object.values((await base.load()).sessions).find(s=>s.runtime?.runId==='run-input')!.id;
 listen({id:'waiting',sequence:1,sessionId:'source-input',runId:'run-input',at:new Date().toISOString(),status:'waiting_reply'});await runtime.flushRuntime();
 const file={id:'image-1',name:'地图.png',type:'image/png',size:123};
 assert((await base.addTaskInput(projectId,taskId,'','input-files',[file])).ok,'files-only input is valid');
 assert((await base.addTaskInput(projectId,taskId,'','input-files',[file])).ok);
 assert.equal((await base.load()).tasks[taskId].inputs!.length,1);
 assert.equal((await base.addTaskInput(projectId,taskId,'changed','input-files',[file])).ok,false);
 const payload={prompt:'请查看我补充的附件。',inputId:'input-files',attachmentIds:[file.id]};
 exportsFail=true;assert.equal((await runtime.controlSession(sessionId,'reply',payload)).ok,false);assert.equal(sent.length,0,'copy failure never sends a text-only substitute');
 exportsFail=false;assert((await runtime.controlSession(sessionId,'reply',payload)).ok);assert.match(JSON.stringify(sent[0]),/verified\/project\/image-1.png/);
 assert((await runtime.controlSession(sessionId,'reply',payload)).ok);assert.equal(sent.length,1,'accepted input is not resent');
 assert.equal((await runtime.controlSession(sessionId,'reply',{...payload,prompt:'different'})).ok,false,'saved input is immutable');
 base.mutateRuntimeProject(projectId,d=>{delete d.sessions[sessionId].runtime!.controlPending;});
 assert((await base.addTaskInput(projectId,taskId,'新的文字','input-new',[])).ok);
 assert.equal((await runtime.controlSession(sessionId,'reply',{prompt:'新的文字',inputId:'input-new',attachmentIds:['unknown']})).ok,false,'foreign or unsaved files rejected');
 providerFail=true;const next={prompt:'新的文字',inputId:'input-new',attachmentIds:[]};assert.equal((await runtime.controlSession(sessionId,'reply',next)).ok,false);
 assert.equal((await runtime.controlSession(sessionId,'reply',next)).ok,false);assert.equal(sent.length,2,'unknown acceptance not blindly retried');
 const restored=await new LocalWorkdeckDataSource().load();assert.equal(restored.sessions[sessionId].runtime!.controlDeliveries!['input:input-new'].status,'unknown');
 assert.equal(restored.tasks[taskId].attachments![0].id,file.id);
 providerFail=false;await base.addTaskInput(projectId,taskId,'核对图片','input-race',[file]);
 duringPrepare=()=>base.mutateRuntimeProject(projectId,d=>{d.collaboration!.tasks[taskId].claimEpoch++;});
 assert.equal((await runtime.controlSession(sessionId,'reply',{prompt:'核对图片',inputId:'input-race',attachmentIds:[file.id]})).ok,false,'claim changes during asynchronous export fence the old reply');
 assert.equal(sent.length,2);
 runtime.dispose();await testMaterialRecallOnStart();await testSourceDirectoryClaims();console.log('task input attachment delivery and project material recall tests passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
