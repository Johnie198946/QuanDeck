import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/note-deletion';
await mkdir(output,{recursive:true});
const origin=process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1360,height:900}});
const page=await context.newPage();
const errors=[];
context.on('weberror',e=>errors.push(e.error().message));
const openNotes=async page=>{await page.goto(origin);await page.getByRole('button',{name:'帮你记',exact:true}).click();};
try {
  await page.goto(origin);
  await page.evaluate(async()=>{
    const {saveOutputFile}=await import('/src/data/outputFiles.ts');
    const files=await Promise.all(['orphan','shared'].map(name=>saveOutputFile('personal-knowledge',new File([name],name+'.txt',{type:'text/plain'}))));
    const at='2026-11-26T10:00:00Z';
    const make=(id,title)=>({id,title,body:'联系山庄',revision:1,createdAt:at,updatedAt:at,attachments:[],expansions:[],history:[]});
    const gone=make('delete-me','行程备忘'),keep=make('keep','行李清单');
    gone.attachments=files;
    keep.expansions=[{id:'own',selection:{quote:'联系',offset:0,before:'',after:''},at,question:'怎么办',answer:'您记下的答复',
      memoryRefs:[{kind:'passage',noteId:gone.id,revision:1,start:0,end:2},{kind:'idea',nodeId:'point',title:'私有快照',detail:'旧记录'},
        {kind:'idea',nodeId:'unrelated',title:'另一处',detail:'独立'}],
      sourceIds:['delete-me@1#0-2','idea:point','idea:unrelated','https://example.test/']}];
    gone.todos=[{id:'todo',lineIndex:0,text:'联系山庄',createdAt:at,dueAt:at}];
    const idea={title:'一处灵感',detail:'等待核实',origin:'extracted',source:{noteId:gone.id,revision:1,field:'body',start:0,end:2,digest:'a'.repeat(64)}};
    const board={nodes:[
      {noteId:gone.id,x:1,y:1},{noteId:keep.id,x:2,y:2},{noteId:'point',x:3,y:3,idea},
      {noteId:'unrelated',x:4,y:4,idea:{origin:'manual',title:'另一处',detail:'独立'}},
      {noteId:'ref',x:5,y:5,idea:{origin:'reference',title:'共享附件',detail:'参考',reference:{file:files[1]}}},
    ],links:[{id:'edge',from:'point',to:'unrelated',label:'先后',detail:'',reverseDetail:''}]};
    const edge={from:keep.id,to:keep.id,fromRevision:1,toRevision:1,label:'推断',provider:'codex',explanation:'待验证',evidenceKey:'reason:test',
      anchors:[{noteId:'keep',revision:1,source:'body',start:0,end:2,origin:'用户观点'},{noteId:'delete-me',revision:1,source:'body',start:0,end:2,origin:'用户观点'}]};
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,notes:[gone,keep],decisions:[{evidence:'reason:test',result:'dismissed',at}],
      inspirationCanvas:board,agentGraph:{provider:'codex',at,notes:[{id:gone.id,revision:1},{id:keep.id,revision:1}],edges:[edge],
        reasoning:{version:2,attachmentCoverage:[{noteId:gone.id,fileId:files[0].id,name:'私人附件',status:'read'}],atoms:[{noteId:gone.id,id:'a'},{noteId:keep.id,id:'b'}],findings:[{key:'reason:test',evidence:['a','b']}],
          chunks:[{key:'c1',entries:[{id:'a',offset:0}]},{key:'c2',entries:[{id:'b',offset:0}]}],history:[{finding:{key:'old'},anchors:[{noteId:gone.id}]}]}}}));
    localStorage.setItem('testFileIds',JSON.stringify(files.map(f=>f.id)));
  });
  await openNotes(page);
  const stale=await context.newPage();await openNotes(stale);
  await stale.evaluate(async()=>{
    const drafts=await import('/src/components/knowledge/noteDraft.ts');
    const {notes}=JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1'));
    window.retained=drafts.noteDraftSession(notes[0],true);
    drafts.editDraft(window.retained,{body:'另一个窗口有改动'});
    window.quandeckDesktop={
      readKnowledge:async()=>localStorage.getItem('quandeck.personal-knowledge.v1'),
      compareKnowledge:async(before,next)=>{
        if(localStorage.getItem('quandeck.personal-knowledge.v1')!==before)return false;
        localStorage.setItem('quandeck.personal-knowledge.v1',next);return true;
      },
      expandKnowledge:()=>new Promise(done=>window.deliverLate=done),
      onNoteAnswerProgress:()=>()=>{window.progressDetached=true;},
    };
    const {askNoteQuestion}=await import('/src/components/knowledge/noteQuestion.ts');
    askNoteQuestion(window.retained,{quote:'联系',offset:0,before:'',after:'山庄'},'联系','解释原文');
  });
  const list=page.getByRole('complementary',{name:'笔记列表'});
  const row=list.locator('.qd-note-list-row').filter({hasText:'行程备忘'});
  const trash=row.getByRole('button',{name:'删除笔记',exact:true});
  await row.hover();
  await page.waitForFunction(()=>[...document.querySelectorAll('.qd-note-delete')].some(b=>getComputedStyle(b).opacity==='1'));
  await trash.click();
  const modal=page.getByRole('dialog',{name:'删除「行程备忘」？'});
  await modal.getByText(/待办提醒/).waitFor();
  await modal.getByRole('button',{name:'取消'}).click();assert.equal(await row.count(),1);
  await trash.focus();await page.keyboard.press('Enter');
  await modal.waitFor();await page.screenshot({path:path.join(output,'delete-note.png'),animations:'disabled'});
  await modal.getByRole('button',{name:'删除笔记',exact:true}).click();
  await row.waitFor({state:'detached'});
  const after=await page.evaluate(async()=>{
    const k=JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1'));
    const {scheduleEntries}=await import('/src/data/agendaSchedule.ts');
    return {library:k,agenda:scheduleEntries(k.notes,[])};
  });
  assert.deepEqual(after.library.notes.map(n=>n.id),['keep']);assert.deepEqual(after.agenda,[]);
  assert.deepEqual(after.library.decisions,[]);assert.deepEqual(after.library.agentGraph.edges,[]);
  assert.deepEqual(after.library.agentGraph.reasoning.atoms.map(a=>a.id),['b']);
  assert.deepEqual(after.library.agentGraph.reasoning.chunks.map(c=>c.key),['c2']);
  assert.deepEqual(after.library.agentGraph.reasoning.history,[]);
  assert.deepEqual(after.library.agentGraph.reasoning.attachmentCoverage,[]);
  assert.deepEqual(after.library.notes[0].expansions[0].memoryRefs.map(r=>r.nodeId),['unrelated']);
  assert.deepEqual(after.library.notes[0].expansions[0].sourceIds,['idea:unrelated','https://example.test/']);
  assert.deepEqual(after.library.inspirationCanvas.nodes.map(n=>n.noteId),['keep','unrelated','ref']);
  assert.deepEqual(after.library.inspirationCanvas.links,[]);
  await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).orphanedNoteFiles?.length);
  assert.deepEqual(await page.evaluate(async()=>{
    const {readOutputBlob}=await import('/src/data/outputFiles.ts');
    return Promise.all(JSON.parse(localStorage.testFileIds).map(async id=>{
      try{await readOutputBlob('personal-knowledge',id);return true;}catch{return false;}
    }));
  }),[false,true]);
  await stale.evaluate(async()=>{
    const {flushDraft,editDraft}=await import('/src/components/knowledge/noteDraft.ts');
    editDraft(window.retained,{body:'尝试写回旧笔记'});await flushDraft(window.retained,true);
    window.deliverLate({answer:'删除后才返回的回答',sourceIds:[]});
  });
  await stale.waitForFunction(()=>window.progressDetached===true);
  assert.deepEqual(await stale.evaluate(async()=>{
    const questions=await import('/src/components/knowledge/noteQuestion.ts');
    return [questions.activeNoteQuestion(window.retained), questions.pendingNoteAnswer(window.retained), questions.noteQuestionState(window.retained)].map(Boolean);
  }),[false,false,false]);
  await page.reload();await page.getByRole('button',{name:'帮你记',exact:true}).click();
  assert.equal(await list.getByText('行程备忘',{exact:true}).count(),0);
  await page.getByRole('button',{name:'新建',exact:true}).click();
  await page.getByRole('textbox',{name:'笔记标题'}).fill('临时灵感');
  const draft=list.locator('.qd-note-list-row').filter({hasText:'临时灵感'});
  await draft.waitFor();await draft.hover();await draft.getByRole('button',{name:'删除笔记',exact:true}).click();
  await page.getByRole('dialog',{name:'删除「临时灵感」？'}).getByRole('button',{name:'删除笔记',exact:true}).click();
  await draft.waitFor({state:'detached'});
  assert.ok(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('quandeck.note-draft.v1.')).every(key=>!localStorage[key].includes('临时灵感'))));
  assert.deepEqual(errors,[]);
  console.log('PASS hover, keyboard, cancel, confirm, draft deletion, late autosave and late Agent answer in another window, cross-note references, note todo/reminder removal, orphan-only files, graph history and independently authored cards');
} finally {await browser.close();}
