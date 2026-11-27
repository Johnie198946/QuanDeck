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
const method = '先确认换乘窗口，再比较路线';
const customTag = '只用两行中文作答';
const body = '周末研讨。'+action+'\n\n'+next+'\n\n'+hidden+'。';
const errors = [];
page.on('pageerror',e=>errors.push(e.message));
async function openNote(page, {withProject = true, profileKind, projectName = '关西旅行'} = {}) {
  await page.addInitScript(({body,method,feature})=>{
    const at='2026-11-25T01:00:00.000Z';
    const note=(id,title,text)=>({id,title,body:text,createdAt:at,updatedAt:at,revision:1,attachments:[],expansions:[],history:[]});
    const notes=[note('route','关西路线研讨',body),note('transfers','换乘核对','一段无关的换乘备忘'),note('cost','预算约束','费用'),note('limit','上限检查','限额'),note('clipboard','编辑器反馈',feature)];
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,decisions:[],notes,inspirationCanvas:{
      nodes:notes.map((n,i)=>({noteId:n.id,x:i*250,y:100})),links:[{id:'route-flow',from:'route',to:'transfers',label:'核对',detail:method,reverseDetail:''},{id:'price-flow',from:'cost',to:'limit',label:'约束',detail:'先核实每人预算，再剔除超支路线',reverseDetail:''}]
    }}));
  },{body,method,feature});
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
      const base = new LocalWorkdeckDataSource(profileKind ? {
        managedWorkspace:async projectId=>'/isolated/managed/'+projectId,
        prepareProjectWorkspace:async(workspacePath,existing,projectId,agentId)=>{
          window.workspacePreparations.push({workspacePath,projectId,agentId});
          return {workspacePath,issues:[],bindings:agentId ? {[agentId]:agentBinding('new-project-connection',workspacePath)} : {}};
        }
      } : undefined);
      window.noteDispatchCalls=[];
      const runtime=createRuntimeDataSource(base,{
        subscribe:callback=>{window.noteDispatchEmit=callback;return ()=>{};},listRuns:()=>[],scan:async()=>({sessions:[]}),control:async()=>({}),
        run:async input=>{window.noteDispatchCalls.push(input);return {runId:'isolated-run',sessionId:'isolated-session',connectionId:input.connectionId,acceptedAt:new Date().toISOString()};}
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

try {
  const drag = await openNote(page);
  await drag();
  assert.match(await page.evaluate(()=>getSelection().toString()),/比较京都[\s\S]*换乘时间。/);
  await page.getByRole('button',{name:'发送选段到帮你管'}).click();
  const dialog=page.getByRole('dialog',{name:'发送到帮你管'});
  await dialog.waitFor();
  await page.waitForFunction(()=>document.querySelector('.qd-handoff-dialog select option[value=codex]'),null,{timeout:5000}).catch(async()=>{throw Error(await dialog.innerText());});
  assert.equal(await dialog.getByLabel('交给谁').inputValue(),'codex');
  const search=dialog.getByRole('textbox',{name:'执行思路'});
  await search.fill('预约');
  await dialog.getByRole('button',{name:'预算约束 → 上限检查',exact:true}).click();
  await dialog.getByRole('button',{name:'移除思路 预算约束 → 上限检查'}).waitFor();
  await search.fill(customTag);
  await search.press('Enter');
  await dialog.getByRole('button',{name:'移除补充 '+customTag}).waitFor();
  await dialog.getByText('随任务发送的 2 条连线').click();
  await dialog.getByText(method,{exact:false}).waitFor();
  await page.screenshot({path:path.join(output,'note-send.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'发给 Codex'}).click();
  await page.getByRole('button',{name:'继续写笔记'}).waitFor();
  const data=await page.evaluate(async()=>({calls:window.noteDispatchCalls,tasks:(await window.noteDispatchStore.load()).tasks}));
  assert.equal(data.calls.length,1,await page.getByRole('dialog').innerText());
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
  await page.getByRole('button',{name:'继续写笔记'}).click();
  await drag();await page.getByRole('button',{name:'发送选段到帮你管'}).click();
  await dialog.waitFor();
  await dialog.getByRole('button',{name:'创建任务并发给 Codex'}).click();
  await page.getByText('已有执行记录，已关联原任务。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.noteDispatchCalls.length),1,'repeated selection has one external execution');
  await page.getByRole('button',{name:'继续写笔记'}).click();
  await page.evaluate(()=>{
    const key='quandeck.personal-knowledge.v1',library=JSON.parse(localStorage.getItem(key));
    library.inspirationCanvas.links[0].detail='先比较价格，再核对换乘';localStorage.setItem(key,JSON.stringify(library));
  });
  await drag();await page.getByRole('button',{name:'发送选段到帮你管'}).click();await dialog.waitFor();
  await dialog.getByText('随任务发送的 2 条连线').click();
  await dialog.getByText(/先比较价格，再核对换乘/).waitFor();
  assert.equal(await page.evaluate(()=>window.noteDispatchCalls.length),1,'changed logic must return to the chooser');
  const projects = () => page.evaluate(() => window.noteDispatchStore.listProjects());
  const [original] = await projects();
  const projectName = '冬季路线比较';
  const newButton = dialog.getByRole('button',{name:'新建项目',exact:true});
  const nameField = dialog.getByRole('textbox',{name:'新项目名称'});
  const create = dialog.getByRole('button',{name:'创建并加入',exact:true});

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
  await dialog.locator('button[type="submit"]').click();
  const confirmation = page.getByRole('dialog',{name:'已加入「'+projectName+'」'});
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
  const retryCreate=retryDialog.getByRole('button',{name:'创建并加入',exact:true});
  await retryCreate.click();
  await retryDialog.getByRole('alert').filter({hasText:'未收到确认 · createProject'}).waitFor();
  const projectsAfterLoss=await retryPage.evaluate(()=>window.noteDispatchStore.listProjects());
  const durableId=projectsAfterLoss.find(p=>p.project.name===projectName).project.id;
  assert.equal(projectsAfterLoss.length,2);
  assert.deepEqual(projectsAfterLoss.find(p=>p.project.id===durableId).tasks,{});
  assert.equal(await retryName.inputValue(),projectName);
  await retryCreate.click();
  await retryPage.getByRole('dialog',{name:'已加入「'+projectName+'」'}).waitFor();
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
  await firstDialog.getByRole('button',{name:'创建并加入'}).click();
  await emptyPage.getByRole('dialog',{name:'已加入「第一个项目」'}).waitFor();
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
      await profileDialog.getByRole('button',{name:'创建并加入'}).click();
      await profilePage.getByRole('dialog',{name:'已加入「'+projectName+'」'}).waitFor();
      assert.equal(await profilePage.evaluate(()=>window.noteDispatchCalls.length),0);
      assert.deepEqual(await profilePage.evaluate(()=>window.workspaceChoices),[]);
      console.log('Passed: conflicting legacy profiles offer save only and do not reuse a historical workspace.');
      continue;
    }
    await profileDialog.getByLabel('交给谁').selectOption('codex');
    await profileDialog.getByText('随任务发送的 1 条连线').click();
    await profileDialog.getByText(method,{exact:false}).waitFor();
    const dispatch=profileDialog.getByRole('button',{name:'创建并发送',exact:true});
    const directory=profileDialog.getByRole('group',{name:'任务文件夹'});
    await directory.getByText('自动创建空文件夹').waitFor();
    await directory.getByText('需要检查源码或现有文件时，请选择包含这些文件的文件夹。').waitFor();
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
    await profilePage.getByRole('dialog',{name:'已加入「'+projectName+'」'}).waitFor();
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
    await profilePage.getByRole('button',{name:'继续写笔记'}).click();
    await selectProfile();
    await profilePage.getByRole('button',{name:'发送选段到帮你管'}).click();
    await profileDialog.getByRole('button',{name:'创建任务并发给 Codex'}).click();
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
  await savedDialog.getByRole('button',{name:'创建任务并发给 Codex'}).click();
  await savedOnlyPage.getByRole('dialog',{name:'已加入「待整理的行程」'}).waitFor();
  const savedRun=await savedOnlyPage.evaluate(async()=>({calls:window.noteDispatchCalls,choices:window.workspaceChoices,snapshot:await window.noteDispatchStore.load()}));
  assert.deepEqual(savedRun.choices,[]);
  assert.equal(savedRun.snapshot.project.workspacePath,'/isolated/managed/'+savedOnly);
  assert.equal(savedRun.calls.length,1);
  assert.equal(savedRun.calls[0].projectId,savedOnly);
  console.log('Passed: first dispatch from an existing unbound project reserves its own workspace without opening a file picker.');
  const featurePage=await browser.newPage({viewport:{width:1380,height:880}});
  await openNote(featurePage,{projectName:'帮你记页面优化'});
  await featurePage.getByRole('button',{name:/编辑器反馈/}).first().click();
  const featureText=featurePage.getByRole('textbox',{name:'笔记正文'}).getByText(feature,{exact:true});
  await featureText.click();
  await featurePage.keyboard.press('Meta+a');
  await featurePage.getByRole('button',{name:'发送选段到帮你管'}).click();
  const featureDialog=featurePage.getByRole('dialog',{name:'发送到帮你管'});
  await featureDialog.getByText('查看验收与交付').click();
  const verification='粘贴到另一个应用后，内容与原文一致。';
  await featureDialog.getByText(verification,{exact:false}).waitFor();
  await featureDialog.screenshot({path:path.join(output,'feature-task.png'),animations:'disabled'});
  await featureDialog.getByRole('button',{name:'创建任务并发给 Codex'}).click();
  await featurePage.getByRole('button',{name:'查看任务',exact:true}).click();
  const detail=featurePage.locator('.qp-task');
  await detail.getByRole('heading',{name:feature,exact:true}).waitFor();
  await detail.getByRole('button',{name:'查看研究与验收要求'}).click();
  await detail.getByText(verification,{exact:true}).waitFor();
  await detail.getByText('可使用的改动，以及实际操作的验证结果。',{exact:true}).waitFor();
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
  assert.deepEqual(errors,[]);
  console.log('Passed: create from an existing project, switch back, cancel, preserve quote and logic, retry after a lost task receipt, empty library, automatic and explicit project folders, and duplicate send receipts.');
  console.log('Lightweight transport: '+prompt.length+' chars; final collected; repeat deduplicated; latest method displayed.');
  console.log('Passed: mouse selection across paragraphs → graph and project → claim → isolated external transport.');
} finally { await browser.close(); }
