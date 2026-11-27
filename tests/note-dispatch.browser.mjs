import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4441';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/note-dispatch';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
const page = await browser.newPage({viewport:{width:1380,height:880},deviceScaleFactor:1});
const action = '比较京都与和歌山的两条路线。';
const next = '列出各自的换乘时间。';
const hidden = '我的随手草稿不应进入本次派发';
const feature = '帮你记需要支持把原文的图片复制出去';
const numberedRequest = '让收藏清单能按颜色筛选。';
const method = '先确认换乘窗口，再比较路线';
const customTag = '只用两行中文作答';
const body = '周末研讨。'+action+'\n\n'+next+'\n\n'+hidden+'。';
const errors = [];
page.on('pageerror',e=>errors.push(e.message));
async function openNote(page, {withProject = true, profileKind, projectName = '关西旅行'} = {}) {
  await page.addInitScript(({body,method,feature,numberedRequest,extraSelection})=>{
    const at='2026-11-25T01:00:00.000Z';
    const note=(id,title,text)=>({id,title,body:text,createdAt:at,updatedAt:at,revision:1,attachments:[],expansions:[],history:[]});
    const notes=[note('route','关西路线研讨',body),note('transfers','换乘核对','一段无关的换乘备忘'),note('cost','预算约束','费用'),note('limit','上限检查','限额'),note('clipboard','编辑器反馈',feature),
      note('numbered','编号反馈',Array.from({length:25},(_,i)=>(i+1)+'. 其他反馈 '+(i+1)).concat('26. '+numberedRequest).join('\n'))];
    const ids=['pic13','pic14','extra14','pic15'];
    const pictureNote=note('picture-feedback','图片反馈',['13. 前条需求','![上一条](attachment:pic13)','14. 描述本条的配图','![正面](attachment:pic14)','![背面](attachment:extra14)','15. 下条需求','![下一条](attachment:pic15)'].join('\n'));
    window.testNotePng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    pictureNote.attachments=ids.map(id=>({id,name:id+'.png',size:atob(window.testNotePng).length,type:'image/png',inline:true}));
    notes.push(pictureNote);
    if(extraSelection) notes.push(note('local-example','隔离选段',extraSelection));
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,decisions:[],notes,inspirationCanvas:{
      nodes:notes.map((n,i)=>({noteId:n.id,x:i*250,y:100})),links:[{id:'route-flow',from:'route',to:'transfers',label:'核对',detail:method,reverseDetail:''},{id:'price-flow',from:'cost',to:'limit',label:'约束',detail:'先核实每人预算，再剔除超支路线',reverseDetail:''}]
    }}));
  },{body,method,feature,numberedRequest,extraSelection:process.env.QUANDECK_UI_NOTE_SELECTION});
  // Run the desktop frontend's real command bridge and repository in this isolated browser.
  await page.addInitScript(({withProject,profileKind,projectName})=>{
    let ready;
    async function backend(){
      const {LocalWorkdeckDataSource}=await import('/src/data/repository.ts');
      const {createRuntimeDataSource}=await import('/src/data/runtimeDataSource.ts');
      const agentBinding=(connectionId,projectPath)=>({tool:'codex',connectionId,projectPath,capabilities:{dispatch:true}});
      window.workspaceChoices=[];
      window.workspacePreparations=[];
      if (profileKind) {
        const saved={id:'saved-config',agentId:'codex',displayName:'Codex',
          ...agentBinding('saved-validation','/isolated/validation')};
        if (profileKind==='application') saved.scope='application';
        const records=[saved];
        if (profileKind==='conflicting') records.push({...saved,id:'second-config',model:'other-model',
          ...agentBinding('second-validation','/isolated/another')});
        localStorage.setItem('quandeck.configured-agents.v1',JSON.stringify(records));
      }
      const referenceFiles=new Map();
      window.storeNotePicture=async(project,file)=>{
        const id='copied-'+file.name.replace('.png','');
        if(!file.contentAddressed) throw Error('缺少稳定附件标识');
        referenceFiles.set(project+':'+id,file);
        return {id,name:file.name,type:file.type,size:file.bytes.byteLength};
      };
      const base = new LocalWorkdeckDataSource(profileKind ? {
        storeProjectFile:async(projectId,file)=>{
          const id=crypto.randomUUID();
          referenceFiles.set(projectId+':'+id,file);
          return {id,name:file.name,type:file.type,size:file.bytes.byteLength};
        },
        managedWorkspace:async projectId=>'/isolated/managed/'+projectId,
        prepareProjectWorkspace:async(workspacePath,existing,projectId,agentId)=>{
          window.workspacePreparations.push({workspacePath,projectId,agentId});
          return {workspacePath,issues:[],bindings:agentId ? {[agentId]:agentBinding('new-project-connection',workspacePath)} : {}};
        }
      } : undefined);
      window.noteDispatchCalls=[];
      const records=[];
      const runtime=createRuntimeDataSource(base,{
        subscribe:callback=>{window.noteDispatchEmit=callback;return ()=>{};},listRuns:()=>records,scan:async()=>({sessions:[]}),control:async()=>({}),
        prepareAttachments:async({projectId,ids,imageIds=[]})=>ids.map(id=>{
          const file=referenceFiles.get(projectId+':'+id);
          if(!file) throw Error('缺少当前项目附件');
          return {id,name:file.name,path:'/isolated/attachments/'+file.name,...(imageIds.includes(id) && {sha256:'a'.repeat(64),imageUrl:'data:image/png;base64,'+window.testNotePng})};
        }),
        run:async (input,images)=>{
          window.receivedPictureIds=images?.map(f=>f.id);
          window.noteDispatchCalls.push(input);
          if(window.rejectNextDispatch){
            window.rejectNextDispatch=false;
            records.push({...input,runId:'stopped-run',acceptance:'rejected',stoppedConfirmed:true,status:'failed',events:[]});
            throw Error('连接暂时不可用');
          }
          return {runId:'isolated-run',sessionId:'isolated-session',connectionId:input.connectionId,acceptedAt:new Date().toISOString()};}
      });
      if (withProject) {
        const project=await base.createProject({name:projectName});
        if(!project.ok) throw new Error(project.message);
        await base.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#385973'});
        const bound=await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'isolated',projectPath:'/isolated/notes-ui',capabilities:{dispatch:true}});
        if(!bound.ok) throw new Error(bound.message);
      }
      window.noteDispatchStore=base;window.noteDispatchRuntime=runtime;
      return runtime;
    }
    window.quandeckDesktop={
      platform:'darwin',bootstrap:async()=>{await (ready??=backend());return {};},getConnection:async()=>({baseUrl:'http://127.0.0.1:9099',token:''}),
      command:async(name,args)=>(await ready)[name](...args),
      readKnowledgeImage:async(noteId,id)=>{
        if(noteId!=='picture-feedback'||!['pic13','pic14','extra14','pic15'].includes(id)) throw Error('原图归属无效');
        return Uint8Array.from(atob(window.testNotePng),c=>c.charCodeAt(0));
      },
      saveAttachment:(project,file)=>window.storeNotePicture(project,file),
      chooseDirectory:async()=>{window.workspaceChoices.push(window.chosenWorkspace ?? null);return window.chosenWorkspace ?? null;},
      onStorageError:()=>()=>{},onNavigate:()=>()=>{},onSnapshot:listener=>window.noteDispatchRuntime.subscribe(listener),
      readKnowledge:async()=>localStorage.getItem('quandeck.personal-knowledge.v1'),
      compareKnowledge:async(old,next)=>{const key='quandeck.personal-knowledge.v1';if(localStorage.getItem(key)!==old)return false;localStorage.setItem(key,next);return true;},
      savePreference:async(key,value)=>localStorage.setItem(key,value)
    };
  },{withProject,profileKind,projectName});
  await page.goto(origin);
  await page.getByRole('button',{name:'帮你记',exact:true}).click({timeout:6500}).catch(async e=>{throw Error((await page.locator('body').innerText()) + ' ' + errors.join(';') + ' '+e.message);});
  const editor=page.getByRole('textbox',{name:'笔记正文'});
  if (!await editor.getByText(next,{exact:true}).isVisible()) await page.getByRole('button',{name:/关西路线研讨/}).first().click();
  await editor.getByText(next,{exact:true}).waitFor();
  const points=await editor.evaluate((el,{action,next})=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    const all=[];
    while(walker.nextNode()) all.push(walker.currentNode);
    return [[action,false],[next,true]].map(([value,end])=>{
      const node=all.find(n=>n.data.includes(value));
      const off=node.data.indexOf(value)+(end?value.length-1:0);
      const r=new Range();r.setStart(node,off);r.setEnd(node,off+1);
      const rect=r.getBoundingClientRect();
      return {x:end?rect.right-1:rect.left+1,y:rect.top+rect.height/2};
    });
  },{action,next});
  return async () => {
    await page.mouse.move(points[0].x,points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x,points[1].y,{steps:12});
    await page.mouse.up();
  };
}

async function loseNextAcknowledgement(page, commandName) {
  await page.evaluate(commandName => {
    const host=window.quandeckDesktop;
    const command=host.command;
    host.command=async (name,args) => {
      const result=await command(name,args);
      if (name===commandName && result?.ok) {
        host.command=command;
        throw Error('未收到确认 · '+name);
      }
      return result;
    };
  },commandName);
}

async function openOptions(dialog) {
  const options = dialog.locator('details.qd-note-send-options');
  if (!await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
}

const receipt = testPage => testPage.locator('.qd-note-send-receipt');

async function checkConflictDispatch() {
  const testPage = await browser.newPage({viewport:{width:1380,height:880}});
  testPage.setDefaultTimeout(8000);
  testPage.on('pageerror', error => errors.push(error.message));
  try {
    await openNote(testPage);
    const editor = testPage.getByRole('textbox',{name:'笔记正文'});
    const quote = '帮你管目前很复杂，帮我简化一下';
    const privateLine = '自己的草稿背景：明天核对成本。';
    const otherVersion = '另一窗口已经保存了报价清单。';
    await editor.fill(privateLine);
    await editor.press('End');
    await editor.press('Enter');
    await testPage.keyboard.insertText(quote);
    const latest = await testPage.evaluate(otherVersion => {
      const key = 'quandeck.personal-knowledge.v1';
      const library = JSON.parse(localStorage.getItem(key));
      const note = library.notes.find(n => n.id === 'route');
      note.revision++;
      note.body = otherVersion;
      note.updatedAt = new Date().toISOString();
      localStorage.setItem(key,JSON.stringify(library));
      return note;
    }, otherVersion);
    // Leaving the editor tries to persist the local draft against the concurrently saved revision.
    await testPage.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'首页',exact:true}).focus();
    await testPage.getByText('核对保存冲突',{exact:true}).waitFor();
    const line = editor.getByText(quote,{exact:true});
    const dialog = testPage.getByRole('dialog',{name:'发送到帮你管'});
    const openPlane = async selected => {
      if (selected) await line.click({clickCount:3});
      else await line.hover();
      await testPage.getByRole('button',{name:selected ? '发送选段到帮你管' : '发送此行到帮你管'}).click();
      await dialog.waitFor().catch(async error => {
        throw Error(error.message+'\n'+await testPage.locator('.qd-note-save-state').innerText());
      });
      await dialog.getByText(/本机草稿/).first().waitFor();
      assert.equal(await dialog.locator('.qd-handoff-source > strong').innerText(),quote);
    };
    const state = () => testPage.evaluate(async () => {
      const notes = JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes;
      const draftKey = Object.keys(localStorage).find(key=>key.startsWith('quandeck.note-draft.v1.route.'));
      return { stored: notes.find(n=>n.id==='route'), draft: draftKey && JSON.parse(localStorage.getItem(draftKey)),
        calls: window.noteDispatchCalls, tasks: Object.values((await window.noteDispatchStore.load()).tasks) };
    });
    await openPlane(true);
    await dialog.screenshot({path:path.join(output,'conflicting-draft.png')});
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    const cancelled = await state();
    assert.deepEqual(cancelled.stored,latest);
    assert.ok(cancelled.draft.body.includes(quote) && cancelled.draft.body.includes(privateLine));
    assert.equal(cancelled.calls.length,0);
    assert.equal(cancelled.tasks.length,0);
    await openPlane(true);
    await dialog.getByRole('button',{name:/发给 Codex/}).click();
    await receipt(testPage).waitFor();
    assert.equal(await dialog.count(),0);
    const sent = await state();
    assert.deepEqual(sent.stored,latest);
    assert.equal(sent.draft.body,cancelled.draft.body);
    assert.equal(sent.tasks.length,1);
    assert.equal(sent.calls.length,1);
    assert.equal(sent.tasks[0].inputs[0].noteSource.noteId,'route');
    assert.equal(sent.tasks[0].inputs[0].noteSource.selection.quote,quote);
    assert.ok(sent.calls[0].prompt.includes(quote));
    for(const excluded of [privateLine,otherVersion]) assert.ok(!sent.calls[0].prompt.includes(excluded));
    // A second confirmation from the line button should resolve the same saved task.
    await openPlane(false);
    await dialog.getByRole('button',{name:/发给 Codex/}).click();
    await receipt(testPage).waitFor();
    const repeated = await state();
    assert.equal(repeated.tasks.length,1);
    assert.equal(repeated.calls.length,1);
    assert.deepEqual(repeated.stored,latest);
    assert.equal(repeated.draft.body,cancelled.draft.body);
    console.log('PASS conflict dispatch: both paper planes open the local quote, cancel keeps both versions, send targets the source note, repeat never starts another run.');
  } finally {
    await testPage.close();
  }
}

try {
  await checkConflictDispatch();
  const drag = await openNote(page);
  await drag();
  assert.match(await page.evaluate(()=>getSelection().toString()),/比较京都[\s\S]*换乘时间。/);
  await page.getByRole('button',{name:'发送选段到帮你管'}).click();
  const dialog=page.getByRole('dialog',{name:'发送到帮你管'});
  await dialog.waitFor();
  await page.waitForFunction(()=>document.querySelector('.qd-handoff-dialog select option[value=codex]'),null,{timeout:5000}).catch(async()=>{throw Error(await dialog.innerText());});
  assert.equal(await dialog.getByLabel('交给谁').inputValue(),'codex');
  assert.ok(!await dialog.getByRole('textbox',{name:'执行思路'}).isVisible());
  assert.ok(!await dialog.getByRole('group',{name:'任务文件夹'}).isVisible());
  assert.ok(await dialog.getByRole('button',{name:'发给 Codex',exact:true}).isVisible());
  await dialog.screenshot({path:path.join(output,'compact-dispatch.png')});
  await openOptions(dialog);
  const search=dialog.getByRole('textbox',{name:'执行思路'});
  await search.fill('预约');
  await dialog.getByRole('button',{name:'预算约束 → 上限检查',exact:true}).click();
  await dialog.getByRole('button',{name:'移除思路 预算约束 → 上限检查'}).waitFor();
  await search.fill(customTag);
  await search.press('Enter');
  await dialog.getByRole('button',{name:'移除补充 '+customTag}).waitFor();
  await openOptions(dialog);
  await dialog.getByText('随任务发送的 2 条连线').click();
  await dialog.getByText(method,{exact:false}).waitFor();
  await page.screenshot({path:path.join(output,'note-send.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'发给 Codex'}).click();
  await receipt(page).waitFor();
  const data=await page.evaluate(async()=>({calls:window.noteDispatchCalls,tasks:(await window.noteDispatchStore.load()).tasks}));
  assert.equal(data.calls.length,1);
  const task=Object.values(data.tasks)[0];
  assert.equal(task.inputs[0].noteSource.selection.quote,action+'\n\n'+next);
  assert.equal(task.inputs[0].noteLogic[0].detail,method);
  assert.ok(task.noteWork);
  const prompt=data.calls[0].prompt;
  assert.ok(prompt.includes(method));
  assert.ok(prompt.includes('先核实每人预算，再剔除超支路线'));
  assert.ok(prompt.includes(customTag));
  assert.deepEqual(task.inputs[0].noteCustomTags,[customTag]);
  assert.ok(prompt.includes(action));
  assert.ok(prompt.includes(next));
  assert.ok(prompt.includes('只执行以下认领事项'));
  assert.ok(!prompt.includes(hidden));
  assert.ok(!prompt.includes('一段无关的换乘备忘'));
  assert.ok(!prompt.includes('提交协议 quandeck.runtime.v1'));
  assert.equal(prompt.split(action).length,2,'selected work appears only once');
  assert.ok(prompt.length<1400,'lightweight bound dispatch: '+prompt.length+' characters');
  const received=await page.evaluate(async()=>{
    window.noteDispatchEmit({id:'brief-finished',sequence:1,sessionId:'isolated-session',runId:'isolated-run',at:new Date().toISOString(),
      status:'done',turnCompleted:true,reply:{id:'transport-result',text:'京都经大阪换乘，建议预留十五分钟。'}});
    await window.noteDispatchRuntime.flushRuntime();
    return (await window.noteDispatchStore.load()).collaboration;
  });
  assert.equal(received.submissions.length,1,'plain final collected as candidate by the existing claim');
  assert.equal(received.artifacts[0].body,'京都经大阪换乘，建议预留十五分钟。');
  assert.equal(await dialog.count(),0,'successful send returns to the note');
  await drag();await page.getByRole('button',{name:'发送选段到帮你管'}).click();
  await dialog.waitFor();
  await dialog.getByRole('button',{name:'发给 Codex'}).click();
  await page.getByText('已有执行记录，已关联原任务。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.noteDispatchCalls.length),1,'repeated selection has one external execution');
  assert.equal(await dialog.count(),0,'successful send returns to the note');
  await page.evaluate(()=>{
    const key='quandeck.personal-knowledge.v1',library=JSON.parse(localStorage.getItem(key));
    library.inspirationCanvas.links[0].detail='先比较价格，再核对换乘';localStorage.setItem(key,JSON.stringify(library));
  });
  await drag();await page.getByRole('button',{name:'发送选段到帮你管'}).click();await dialog.waitFor();
  await openOptions(dialog);
  await dialog.getByText('随任务发送的 2 条连线').click();
  await dialog.getByText(/先比较价格，再核对换乘/).waitFor();
  assert.equal(await page.evaluate(()=>window.noteDispatchCalls.length),1,'changed logic must return to the chooser');
  const projects = () => page.evaluate(() => window.noteDispatchStore.listProjects());
  const [original] = await projects();
  const projectName = '冬季路线比较';
  const newButton = dialog.getByRole('button',{name:'新建项目',exact:true});
  const nameField = dialog.getByRole('textbox',{name:'新项目名称'});
  const create = dialog.getByRole('button',{name:'仅保存任务',exact:true});

  await newButton.click();
  assert.equal(await dialog.getByLabel('交给谁').inputValue(),'','the old project binding is scoped to that project');
  await nameField.fill('   ');
  assert.ok(await create.isDisabled(),'a blank project name cannot be submitted');
  await nameField.fill('取消的项目');
  await dialog.getByRole('button',{name:'选择已有项目',exact:true}).click();
  assert.equal(await dialog.getByLabel('目标项目').inputValue(),original.project.id);
  assert.equal(await dialog.getByLabel('交给谁').inputValue(),'codex');
  await newButton.click();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal((await projects()).length,1,'cancel creates no project');

  await drag();
  await page.getByRole('button',{name:'发送选段到帮你管'}).click();
  await newButton.click();
  await nameField.fill(projectName);
  await openOptions(dialog);
  await dialog.getByText('随任务发送的 2 条连线').click();
  await dialog.getByText(/先比较价格，再核对换乘/).waitFor();

  await loseNextAcknowledgement(page,'createTaskWithAttachments');
  await create.click();
  await dialog.getByRole('alert').filter({hasText:'未收到确认 · createTaskWithAttachments'}).waitFor();
  const afterFailure = await projects();
  assert.equal(afterFailure.length,2);
  const provisional = afterFailure.find(p=>p.project.name===projectName);
  assert.ok(provisional);
  assert.equal(Object.keys(provisional.tasks).length,1);
  await dialog.getByRole('button',{name:'仅保存任务'}).click();
  const confirmation = receipt(page).filter({hasText:'尚未派发'});
  await confirmation.getByRole('button',{name:'查看任务'}).waitFor();
  const afterRetry = await projects();
  assert.equal(afterRetry.length,2,'retry reuses the created project');
  const savedProject = afterRetry.find(p=>p.project.id===provisional.project.id);
  assert.equal(Object.keys(savedProject.tasks).length,1,'retry reuses the saved task');
  const [savedTask] = Object.values(savedProject.tasks);
  assert.equal(savedTask.inputs[0].noteSource.noteId,'route');
  assert.equal(savedTask.inputs[0].noteSource.selection.quote,action+'\n\n'+next);
  assert.equal(savedTask.inputs[0].noteLogic[0].detail,'先比较价格，再核对换乘');
  assert.deepEqual(afterRetry.find(p=>p.project.id===original.project.id).tasks,original.tasks);
  assert.equal(await page.evaluate(()=>window.noteDispatchCalls.length),1,'joining a new project does not invoke the old Agent');

  const retryPage=await browser.newPage({viewport:{width:1380,height:880}});
  retryPage.on('pageerror',e=>errors.push(e.message));
  const selectRetry=await openNote(retryPage);
  await selectRetry();
  await retryPage.getByRole('button',{name:'发送选段到帮你管'}).click();
  const retryDialog=retryPage.getByRole('dialog',{name:'发送到帮你管'});
  await retryDialog.getByRole('button',{name:'新建项目',exact:true}).click();
  const retryName=retryDialog.getByRole('textbox',{name:'新项目名称'});
  await retryName.fill(projectName);
  await loseNextAcknowledgement(retryPage,'createProject');
  const retryCreate=retryDialog.getByRole('button',{name:'仅保存任务',exact:true});
  await retryCreate.click();
  await retryDialog.getByRole('alert').filter({hasText:'未收到确认 · createProject'}).waitFor();
  const projectsAfterLoss=await retryPage.evaluate(()=>window.noteDispatchStore.listProjects());
  const durableId=projectsAfterLoss.find(p=>p.project.name===projectName).project.id;
  assert.equal(projectsAfterLoss.length,2);
  assert.deepEqual(projectsAfterLoss.find(p=>p.project.id===durableId).tasks,{});
  assert.equal(await retryName.inputValue(),projectName);
  await retryCreate.click();
  await receipt(retryPage).filter({hasText:'尚未派发'}).waitFor();
  const projectsAfterRetry=await retryPage.evaluate(()=>window.noteDispatchStore.listProjects());
  assert.equal(projectsAfterRetry.length,2);
  assert.equal(Object.keys(projectsAfterRetry.find(p=>p.project.id===durableId).tasks).length,1);
  assert.deepEqual(projectsAfterRetry.find(p=>p.project.name==='关西旅行').tasks,{});
  console.log('Passed: lost createProject acknowledgement, same name resubmitted, one new project and one task.');

  const emptyPage=await browser.newPage({viewport:{width:1380,height:880}});
  emptyPage.on('pageerror',e=>errors.push(e.message));
  const selectFirst=await openNote(emptyPage,{withProject:false});
  await selectFirst();
  await emptyPage.getByRole('button',{name:'发送选段到帮你管'}).click();
  const firstDialog=emptyPage.getByRole('dialog',{name:'发送到帮你管'});
  await firstDialog.getByRole('textbox',{name:'新项目名称'}).fill('第一个项目');
  await firstDialog.getByRole('button',{name:'仅保存任务'}).click();
  await receipt(emptyPage).filter({hasText:'尚未派发'}).waitFor();
  const fromEmpty=await emptyPage.evaluate(()=>window.noteDispatchStore.listProjects());
  assert.equal(fromEmpty.length,1);
  assert.equal(fromEmpty[0].project.name,'第一个项目');
  assert.equal(Object.values(fromEmpty[0].tasks)[0].inputs[0].noteLogic[0].detail,method);
  assert.deepEqual(await emptyPage.evaluate(()=>window.workspaceChoices),[],'save only needs no folder');

  for (const profileKind of ['application','legacy','conflicting']) {
    const profilePage=await browser.newPage({viewport:{width:1380,height:880}});
    profilePage.on('pageerror',e=>errors.push(e.message));
    const selectProfile=await openNote(profilePage,{profileKind});
    await selectProfile();
    await profilePage.getByRole('button',{name:'发送选段到帮你管'}).click();
    const profileDialog=profilePage.getByRole('dialog',{name:'发送到帮你管'});
    await profileDialog.getByRole('button',{name:'新建项目',exact:true}).click();
    await profileDialog.getByRole('textbox',{name:'新项目名称'}).fill(projectName);
    if (profileKind==='conflicting') {
      assert.equal(await profileDialog.getByLabel('交给谁').getByRole('option',{name:'Codex'}).count(),0);
      assert.equal(await profileDialog.getByLabel('交给谁').inputValue(),'');
      await profileDialog.getByRole('button',{name:'仅保存任务'}).click();
      await receipt(profilePage).waitFor();
      assert.equal(await profilePage.evaluate(()=>window.noteDispatchCalls.length),0);
      assert.deepEqual(await profilePage.evaluate(()=>window.workspaceChoices),[]);
      console.log('Passed: conflicting legacy profiles offer save only and do not reuse a historical workspace.');
      continue;
    }
    await openOptions(profileDialog);
    await profileDialog.getByLabel('项目目标').fill('整理春节期间的跨城换乘方案');
    await profileDialog.getByLabel('项目背景（可选）').fill('同行者有大件行李，只选带升降机的车站。');
    await profileDialog.getByText('截止日期、负责人和参考附件').click();
    await profileDialog.getByLabel('负责人').fill('行程负责人');
    await profileDialog.getByLabel('截止日期').fill('2027-01-10');
    if(profileKind==='legacy') await profileDialog.getByLabel('附件 / 参考文件').setInputFiles({
      name:'换乘条件.txt',mimeType:'text/plain',buffer:Buffer.from('车站需要升降机。')
    });
    await profileDialog.getByLabel('交给谁').selectOption('codex');
    await profileDialog.getByText('随任务发送的 1 条连线').click();
    await profileDialog.getByText(method,{exact:false}).waitFor();
    const dispatch=profileDialog.getByRole('button',{name:'创建并发送',exact:true});
    const directory=profileDialog.getByRole('group',{name:'任务文件夹'});
    await directory.getByText('自动创建空文件夹').waitFor();
    assert.equal(await directory.getByRole('checkbox',{name:'本次要修改已有产品源码'}).isChecked(),false);
    if (profileKind==='application') await profilePage.screenshot({path:path.join(output,'new-project.png'),animations:'disabled'});
    // Existing source directories can still be chosen explicitly before the first dispatch.
    let custom=false;
    if(profileKind==='legacy') {
      custom=true;
      await profilePage.evaluate(()=>{window.chosenWorkspace='/isolated/new';});
      await directory.getByRole('button',{name:'使用已有文件夹'}).click();
      await directory.getByText('/isolated/new',{exact:true}).waitFor();
    }
    await dispatch.click();
    await receipt(profilePage).waitFor();
    const run=await profilePage.evaluate(async()=>({
      projects:await window.noteDispatchStore.listProjects(), calls:window.noteDispatchCalls,
      choices:window.workspaceChoices, preparations:window.workspacePreparations,
    }));
    const old=run.projects.find(p=>p.project.name==='关西旅行');
    const created=run.projects.find(p=>p.project.name===projectName);
    assert.equal(run.projects.length,2);
    assert.equal(Object.keys(old.tasks).length,0);
    assert.equal(old.runtimeConnections.codex.projectPath,'/isolated/notes-ui');
    const workspacePath=custom ? '/isolated/new' : '/isolated/managed/'+created.project.id;
    if(profileKind==='legacy'){
      assert.equal(created.project.attachments[0].name,'换乘条件.txt');
      assert.equal(created.project.attachments[0].size,Buffer.byteLength('车站需要升降机。'));
      assert.ok(run.calls[0].prompt.includes('/isolated/attachments/换乘条件.txt'));
    }
    assert.equal(created.project.description,'整理春节期间的跨城换乘方案');
    assert.equal(created.project.ownerName,'行程负责人');
    assert.equal(created.project.deadline,'2027-01-10');
    assert.ok(run.calls[0].prompt.includes(created.project.description));
    assert.ok(run.calls[0].prompt.includes('行程负责人') && run.calls[0].prompt.includes('2027-01-10'));
    assert.ok(run.calls[0].prompt.includes('同行者有大件行李，只选带升降机的车站。'));
    assert.equal(created.project.workspacePath,workspacePath);
    assert.equal(created.runtimeConnections.codex.projectPath,workspacePath);
    const [dispatched]=Object.values(created.tasks);
    assert.equal(dispatched.noteWork.agentId,'codex');
    assert.equal(dispatched.inputs[0].noteSource.selection.quote,action+'\n\n'+next);
    assert.equal(dispatched.inputs[0].noteLogic[0].detail,method);
    assert.deepEqual(run.choices,custom?['/isolated/new']:[]);
    assert.deepEqual(run.preparations.map(p=>[p.workspacePath,p.projectId,p.agentId]),[
      [workspacePath,custom ? undefined : created.project.id,undefined],[workspacePath,created.project.id,'codex']
    ]);
    assert.equal(run.calls.length,1);
    assert.equal(run.calls[0].connectionId,'new-project-connection');
    assert.ok(run.calls[0].prompt.includes(method));
    assert.equal(await profileDialog.count(),0);
    await selectProfile();
    await profilePage.getByRole('button',{name:'发送选段到帮你管'}).click();
    await profileDialog.getByRole('button',{name:'发给 Codex'}).click();
    await profilePage.getByText('已有执行记录，已关联原任务。',{exact:true}).waitFor();
    assert.deepEqual(await profilePage.evaluate(()=>window.workspaceChoices),custom?['/isolated/new']:[]);
    assert.equal(await profilePage.evaluate(()=>window.noteDispatchCalls.length),1);
    console.log('Passed: '+profileKind+' Codex profile dispatched with '+(custom?'an explicitly chosen':'a project-specific automatic')+' workspace and deduplicated a repeated send.');
  }
  const savedOnlyPage=await browser.newPage({viewport:{width:1150,height:850}});
  const selectExisting=await openNote(savedOnlyPage,{profileKind:'application'});
  const savedOnly=await savedOnlyPage.evaluate(async()=>(await window.noteDispatchStore.createProject({name:'待整理的行程'})).projectId);
  await selectExisting();
  await savedOnlyPage.getByRole('button',{name:'发送选段到帮你管'}).click();
  const savedDialog=savedOnlyPage.getByRole('dialog',{name:'发送到帮你管'});
  await savedDialog.getByLabel('目标项目').selectOption(savedOnly);
  await savedDialog.getByRole('button',{name:'发给 Codex'}).click();
  await receipt(savedOnlyPage).waitFor();
  const savedRun=await savedOnlyPage.evaluate(async()=>({calls:window.noteDispatchCalls,choices:window.workspaceChoices,snapshot:await window.noteDispatchStore.load()}));
  assert.deepEqual(savedRun.choices,[]);
  assert.equal(savedRun.snapshot.project.workspacePath,'/isolated/managed/'+savedOnly);
  assert.equal(savedRun.calls.length,1);
  assert.equal(savedRun.calls[0].projectId,savedOnly);
  console.log('Passed: first dispatch from an existing unbound project reserves its own workspace without opening a file picker.');
  // Change the active project and the note. The last successful destination still wins.
  await savedOnlyPage.evaluate(async()=>{
    const store=window.noteDispatchStore;
    const projects=await store.listProjects();
    await store.switchProject(projects.find(entry=>entry.project.name==='关西旅行').project.id);
  });
  await savedOnlyPage.getByRole('button',{name:/编辑器反馈/}).first().click();
  const anotherNote = savedOnlyPage.getByRole('textbox',{name:'笔记正文'}).getByText(feature,{exact:true});
  await anotherNote.click({clickCount:3});
  await savedOnlyPage.getByRole('button',{name:'发送选段到帮你管'}).click();
  assert.equal(await savedDialog.getByLabel('目标项目').inputValue(),savedOnly);
  assert.equal(await savedDialog.getByLabel('交给谁').inputValue(),'codex');
  assert.ok(!await savedDialog.getByRole('textbox',{name:'执行思路'}).isVisible());
  await savedDialog.getByRole('button',{name:'取消'}).click();
  assert.equal(await savedOnlyPage.evaluate(()=>window.noteDispatchCalls.length),1);
  console.log('Passed: another note remembers the previous successful destination without sending or inheriting its method tags.');
  const featurePage=await browser.newPage({viewport:{width:1380,height:880}});
  await openNote(featurePage,{projectName:'帮你记页面优化',profileKind:'application'});
  await featurePage.evaluate(()=>{
    window.chosenWorkspace='/isolated/product-source';
    window.quandeckDesktop.inspectTaskDirectory=async folder=>folder===window.chosenWorkspace ?
      {empty:false,entries:['src/','package.json'],sourceMarkers:['src','package.json']} :
      {empty:false,entries:['prototype/','prototype.zip'],sourceMarkers:[]};
  });
  await featurePage.getByRole('button',{name:/编辑器反馈/}).first().click();
  const featureText=featurePage.getByRole('textbox',{name:'笔记正文'}).getByText(feature,{exact:true});
  await featureText.click();
  await featurePage.keyboard.press('Meta+a');
  await featurePage.getByRole('button',{name:'发送选段到帮你管'}).click();
  const featureDialog=featurePage.getByRole('dialog',{name:'发送到帮你管'});
  await featureDialog.getByText('目录内容：prototype/、prototype.zip').waitFor();
  assert.equal(await featureDialog.getByRole('checkbox',{name:'本次要修改已有产品源码'}).isChecked(),true);
  assert.equal(await featureDialog.getByRole('button',{name:'发给 Codex'}).isDisabled(),true);
  await featureDialog.getByRole('button',{name:'更换文件夹'}).click();
  await featureDialog.getByText('目录内容：src/、package.json').waitFor();
  assert.equal(await featureDialog.getByRole('button',{name:'发给 Codex'}).isEnabled(),true);
  await openOptions(featureDialog);
  await featureDialog.getByText('查看验收与交付').click();
  const verification='粘贴到另一个应用后，内容与原文一致。';
  await featureDialog.getByText(verification,{exact:false}).waitFor();
  await featureDialog.screenshot({path:path.join(output,'feature-task.png'),animations:'disabled'});
  await featureDialog.getByRole('button',{name:'发给 Codex'}).click();
  await featurePage.getByRole('button',{name:'查看任务',exact:true}).click();
  const inbox = featurePage.getByRole('main',{name:'Agent 任务收件箱'});
  await inbox.getByRole('button',{name:new RegExp(feature)}).waitFor();
  const detail = inbox.getByRole('region',{name:'任务详情'});
  await detail.getByText('原始需求',{exact:true}).click();
  await detail.getByText(feature,{exact:true}).waitFor();
  const derived=await featurePage.evaluate(async()=>{
    const s=await window.noteDispatchStore.load();
    const [t]=Object.values(s.tasks);
    return {calls:window.noteDispatchCalls, project:s.project.id, task:t, plan:s.projectPlanning.tasks[t.id], spec:s.collaboration.specs.find(x=>x.key===t.id)};
  });
  assert.equal(derived.calls.length,1);
  assert.equal(derived.calls[0].projectId,derived.project);
  assert.equal(derived.calls[0].taskId,derived.task.id);
  assert.equal(derived.calls[0].noteSourceTask,true);
  assert.match(derived.calls[0].prompt, /提交协议 quandeck\.runtime\.v1.*以 <\/quandeck-submission> 结束/);
  assert.match(derived.calls[0].prompt, /先核对当前项目文件夹和实际随附的资料/);
  assert.equal(derived.spec.goal,feature);
  assert.ok(derived.spec.criteria.includes(verification));
  assert.ok(derived.calls[0].prompt.includes(verification) && derived.calls[0].prompt.includes(derived.plan.deliverable));
  console.log('Passed: notebook requirement creates an executable project task, persists the derived acceptance and deliverable, opens its project task detail, and submits the same specification to the selected transport.');
  const picturePage=await browser.newPage({viewport:{width:1380,height:880}});
  await openNote(picturePage);
  await picturePage.getByRole('button',{name:/图片反馈/}).first().click();
  const pickPicture=async()=>{
    const line=picturePage.getByRole('textbox',{name:'笔记正文'}).getByText('描述本条的配图',{exact:true});
    await line.scrollIntoViewIfNeeded();
    // The list item also contains two pictures. Select its actual text rather than clicking the centre image.
    const points=await line.evaluate(element=>{
      const text=element.firstChild, length='描述本条的配图'.length;
      return [0,length-1].map((offset,index)=>{
        const part=new Range();part.setStart(text,offset);part.setEnd(text,offset+1);
        const box=part.getBoundingClientRect();
        return {x:index ? box.right-1 : box.left+1,y:box.top+box.height/2};
      });
    });
    await picturePage.mouse.move(points[0].x,points[0].y);
    await picturePage.mouse.down();
    await picturePage.mouse.move(points[1].x,points[1].y,{steps:8});
    await picturePage.mouse.up();
    await picturePage.getByRole('button',{name:'发送选段到帮你管'}).click();
    const dialog=picturePage.getByRole('dialog',{name:'发送到帮你管'});
    const gallery=dialog.getByRole('group',{name:'随任务发送的原文图片'});
    assert.equal(await gallery.getByRole('checkbox').count(),2);
    assert.ok(await gallery.getByLabel('pic14.png').isChecked());
    await gallery.getByLabel('extra14.png').uncheck();
    return dialog;
  };
  const firstPicture=await pickPicture();
  await picturePage.evaluate(()=>window.rejectNextDispatch=true);
  await firstPicture.getByRole('button',{name:'发给 Codex'}).click();
  await picturePage.getByRole('button',{name:'重试派发原任务'}).click();
  await receipt(picturePage).waitFor();
  const secondPicture=await pickPicture();
  await secondPicture.getByRole('button',{name:'发给 Codex'}).click();
  await picturePage.getByText('已有执行记录，已关联原任务。',{exact:true}).waitFor();
  const pictureRun=await picturePage.evaluate(async()=>({tasks:(await window.noteDispatchStore.load()).tasks,calls:window.noteDispatchCalls,ids:window.receivedPictureIds}));
  assert.equal(Object.keys(pictureRun.tasks).length,1);
  const [pictureTask]=Object.values(pictureRun.tasks);
  assert.deepEqual(pictureTask.attachments.map(f=>f.name),['pic14.png']);
  assert.deepEqual(pictureTask.inputs[0].attachments.map(f=>f.name),['pic14.png']);
  assert.equal(pictureRun.calls.length,2);
  assert.deepEqual(pictureRun.ids,['copied-pic14']);
  assert.deepEqual(pictureRun.calls.map(call=>call.noteImageIds),[['copied-pic14'],['copied-pic14']]);
  console.log('Passed: selected item 14, excluded one of its two pictures, sent no neighbor images, and reused the same task and picture after retry and repeat.');
  const numberedPage=await browser.newPage({viewport:{width:1380,height:880}});
  numberedPage.on('pageerror',e=>errors.push(e.message));
  await openNote(numberedPage);
  await numberedPage.getByRole('button',{name:/编号反馈/}).first().click();
  const item=numberedPage.getByRole('textbox',{name:'笔记正文'}).getByText(numberedRequest,{exact:true});
  await item.click({clickCount:3});
  await numberedPage.getByRole('button',{name:'发送选段到帮你管'}).click();
  await numberedPage.evaluate(()=>{window.rejectNextDispatch=true;});
  await numberedPage.getByRole('dialog').getByRole('button',{name:'发给 Codex'}).click();
  const failed=numberedPage.getByRole('dialog',{name:'派发需要处理'});
  await failed.getByText(/连接暂时不可用/).waitFor();
  await failed.getByRole('button',{name:'重试派发原任务'}).click();
  await receipt(numberedPage).waitFor();
  const retried=await numberedPage.evaluate(async()=>({s:await window.noteDispatchStore.load(),calls:window.noteDispatchCalls}));
  const tasks=Object.values(retried.s.tasks);
  assert.equal(tasks.length,1);
  assert.equal(tasks[0].inputs[0].noteSource.lineIndex,25);
  assert.equal(tasks[0].inputs[0].noteSource.selection.quote,numberedRequest);
  assert.equal(retried.calls.length,2);
  assert.equal(retried.calls[0].taskId,retried.calls[1].taskId);
  assert.ok(retried.calls[1].prompt.includes(numberedRequest));
  assert.ok(!retried.calls[1].prompt.includes('其他反馈'));
  assert.deepEqual(tasks[0].sessionIds.map(id=>retried.s.sessions[id].dispatchPhase),['rejected','acknowledged']);
  console.log('Passed: selected complete numbered item 26, rejected by the isolated driver, retried the same saved task once and accepted it.');
  if(process.env.QUANDECK_UI_NOTE_SELECTION) {
    const sourcePage=await browser.newPage();
    await openNote(sourcePage);
    await sourcePage.getByRole('button',{name:/隔离选段/}).first().click();
    await sourcePage.getByRole('textbox',{name:'笔记正文'}).click();
    await sourcePage.keyboard.press('Meta+a');
    await sourcePage.getByRole('button',{name:'发送选段到帮你管'}).click();
    await sourcePage.getByRole('dialog').getByRole('button',{name:'发给 Codex'}).click();
    await receipt(sourcePage).waitFor();
    const replay=await sourcePage.evaluate(async()=>({s:await window.noteDispatchStore.load(),calls:window.noteDispatchCalls}));
    assert.equal(replay.calls.length,1);
    const quote=Object.values(replay.s.tasks)[0].inputs[0].noteSource.selection.quote;
    assert.ok(quote.length>0 && process.env.QUANDECK_UI_NOTE_SELECTION.includes(quote) && replay.calls[0].prompt.includes(quote));
    console.log('Passed: selected current source text with Command+A and sent through the isolated project transport.');
  }
  assert.deepEqual(errors,[]);
  console.log('Passed: create from an existing project, switch back, cancel, preserve quote and logic, retry after a lost task receipt, empty library, automatic and explicit project folders, and duplicate send receipts.');
  console.log('Lightweight transport: '+prompt.length+' chars; final collected; repeat deduplicated; latest method displayed.');
  console.log('Passed: mouse selection across paragraphs → graph and project → claim → isolated external transport.');
} finally { await browser.close(); }
