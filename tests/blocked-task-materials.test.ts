import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import type { RuntimeDriver, RuntimeRunInput, RuntimeRunRecord, RuntimeEvent } from '../src/data/runtimeContracts';
import { noteTaskKey } from '../src/data/noteTaskSource';
import { projectNoteReceipts } from '../src/data/noteReceipts';
import { makeSelection, type KnowledgeNote } from '../src/data/knowledgeNotes';
import { noteDispatchPictureChoices } from '../src/data/noteDispatchPictures';
import { blockedResultChoices } from '../src/data/blockedTask';
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
  const deliveredImages:({id:string;url:string}[]|undefined)[] = [];
  const driver:RuntimeDriver = {
    subscribe:callback=>{listener=callback;return ()=>{};},scan:async()=>[],listRuns:()=>records,
    control:async()=>{controls++;return {stoppedConfirmed:stopped};},
    run:async (input,images)=>{
      calls.push(input);deliveredImages.push(images);
      const record:RuntimeRunRecord = {...input,acceptedAt:new Date().toISOString(),acceptance:'acknowledged',
        runId:'run-'+calls.length,sessionId:'source-'+calls.length,stoppedConfirmed:false,events:[]};
      records.push(record);
      return record;
    },
    prepareAttachments:async input=>input.ids.map(id=>({id,name:id==='picture'?'row.png':'prototype.pdf',path:input.connectionId+'/'+id,sha256:'a'.repeat(64),
      ...(input.imageIds?.includes(id) && {imageUrl:'data:image/png;base64,dGVzdA=='})})),
  };
  const runtime = createRuntimeDataSource(base,driver);
  try {
    const projectId=(await runtime.createProject({name:'样例项目'})).projectId!;
    await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
    const quote = '如图，继续完成这个原型', photo = {id:'original',name:'row.png',type:'image/png',size:27};
    const body = '![原型](attachment:original)\n\n'+quote;
    const selection = makeSelection(body,body.indexOf(quote),body.length), at = new Date().toISOString();
    const note:KnowledgeNote = {id:'note-recovery',title:'修改原型',body,createdAt:at,updatedAt:at,revision:1,history:[],expansions:[],attachments:[photo]};
    const taskId=(await runtime.createTaskWithAttachments(quote,[],projectId,{
      title:note.title,key:noteTaskKey(note.id,2,quote),noteSource:{noteId:note.id,lineIndex:2,selection},
    })).taskId!;
    const otherId=(await runtime.createTaskWithAttachments('另一文档',[],projectId)).taskId!;
    const attachment = {id:'spec-file',name:'prototype.pdf',type:'application/pdf',size:21};
    const referenceTask = (await runtime.createTaskWithAttachments('原型稿',[],projectId)).taskId!;
    assert.ok((await base.saveTaskOutput({projectId,taskId:referenceTask,title:'原型第一版',body:'界面文字按行左对齐',attachments:[attachment]})).ok);
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
    const receipt = projectNoteReceipts([before],[note]).get(note.id)?.[0].receipts.find(row=>row.kind==='提醒');
    assert.equal(receipt?.blockedSessionId,sessionId);
    assert.ok(receipt?.at);
    assert.deepEqual(noteDispatchPictureChoices(note,selection).suggested.map(row=>row.id),[photo.id]);
    assert.equal(calls.length,1,'reading the receipt must never restart execution');
    const resultReference = blockedResultChoices(before).find(artifact=>artifact.key===referenceTask)!.id;
    const invalid = await runtime.restartBlockedTask(sessionId,{inputId:'wrong-project-version',resultReference:'outside-project'});
    assert.equal(invalid.ok,false);assert.equal(invalid.materialsSaved,false);
    assert.equal(controls,0);
    const tooMany = await runtime.restartBlockedTask(sessionId,{inputId:'too-many-pictures',
      attachments:Array.from({length:5},(_,i)=>({...photo,id:'image-'+i}))});
    assert.equal(tooMany.materialsSaved,false);assert.equal(tooMany.ok,false);
    assert.match(tooMany.message ?? '',/4 张图片/);assert.equal(controls,0);
    assert.equal((await base.load()).tasks[taskId].attachments?.length,0);
    const originalContext=before.collaboration!.contextPackages.find(context=>context.id===binding.contextPackageId);
    const file={id:'picture',name:'row.png',type:'image/png',size:27};
    const input={inputId:'same-input',text:'只改截图中的回执',sourceDirectory:'/fixture/source',attachments:[file],resultReference};
    const uncertain=await runtime.restartBlockedTask(sessionId,input);
    assert.equal(uncertain.ok,false);assert.equal(uncertain.materialsSaved,true);
    assert.equal((await base.load()).tasks[taskId].sourceDirectory,undefined);
    assert.equal(calls.length,1);
    assert.equal((await runtime.restartBlockedTask(sessionId,{...input,text:'同一键的其他材料'})).ok,false);
    // Once the user has explicitly pinned a version, archiving its source task must not break retries.
    base.mutateRuntimeProject(projectId,draft=>{draft.collaboration!.tasks[referenceTask].archived=true;});
    assert.equal(blockedResultChoices(await base.load()).some(artifact=>artifact.id===resultReference),false);
    stopped=true;
    const [sent,twice]=await Promise.all([runtime.restartBlockedTask(sessionId,input),runtime.restartBlockedTask(sessionId,input)]);
    assert.ok(sent.ok,sent.message);assert.equal(twice.sessionId,sent.sessionId);
    const after=await base.load(), successor=after.sessions[sent.sessionId!];
    assert.equal(calls.length,2);assert.equal(controls,2);
    assert.equal(after.tasks[taskId].inputs?.filter(row=>row.id===input.inputId).length,1);
    assert.equal(calls[1].connectionId,'/fixture/source-conn');assert.match(calls[1].prompt,/只改截图中的回执/);
    assert.match(calls[1].prompt,/\/fixture\/source-conn\/picture/);
    assert.match(calls[1].prompt,/用户指定据此继续的项目成果/);
    assert.match(calls[1].prompt,/界面文字按行左对齐/);
    assert.ok(calls[1].prompt.includes(resultReference));
    assert.match(calls[1].prompt,/source-conn\/spec-file/);
    assert.deepEqual(deliveredImages[1],[{id:'picture',url:'data:image/png;base64,dGVzdA=='}]);
    assert.equal(after.tasks[taskId].inputs?.find(row=>row.id===input.inputId)?.resultReference,resultReference);
    assert.equal(projectNoteReceipts([after],[note]).get(note.id)?.flatMap(anchor=>anchor.receipts).some(row=>row.blockedSessionId===sessionId) ?? false,false);
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
