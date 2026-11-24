/** Exercise actionable tasks and disclosure using only a fresh browser-local project. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const {chromium} = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4173';
const output = process.env.QUANDECK_UI_OUTPUT;
if (output) await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  // Use the same Vite module instance as the mounted provider after hot updates.
  let repositoryModule;
  page.on('response', response=>{
    if (new URL(response.url()).pathname==='/src/data/repository.ts' && !repositoryModule) repositoryModule=response.url();
  });
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin ? r.continue() : r.abort());
  await page.goto(origin);
  await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
  await page.getByLabel('项目名称',{exact:true}).fill('展览手册');
  await page.getByRole('button',{name:'创建项目',exact:true}).click();
  await page.getByRole('region',{name:'项目任务'}).waitFor();
  const ids = await page.evaluate(async()=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const {project}=await api.load();
    const add=async title=>(await api.createTaskWithAttachments(title,[],project.id)).taskId;
    const closed=await add('核对已印票签');
    const {submitAndReviewOutput}=await import('/tests/manual-acceptance.fixture.ts');
    const accepted=await submitAndReviewOutput(api,{taskId:closed,title:'已印票签',body:'已核对印次与票号。',status:'published'});
    if (!accepted.ok) throw Error(accepted.message);
    const candidate=await add('交付目录清单');
    const submitted=await api.saveTaskOutput({taskId:candidate,title:'目录清单',body:'已核对展品和目录编号。',status:'published'});
    if (!submitted.ok) throw Error(submitted.message);
    const running=await add('整理展签');
    const parent=await add('制作手册');
    const children=[];
    for (const title of ['收集展品说明','排版图文','校对手册']) {
      const result=await api.addManualSubtask(parent,parent,title);
      if (!result.ok) throw Error(result.message);
      children.push(result.itemId);
    }
    const key='quandeck.projects.v1',lib=JSON.parse(localStorage.getItem(key)),s=lib.projects[project.id];
    const session=(id,title,status)=>({id,agentId:'codex',title,origin:'dispatch',status,startedAt:s.now,lastActivity:s.now,tokens:null,step:null,rounds:[],subAgents:[],source:{connectionId:'local-fixture',sessionId:'source-'+id,tool:'codex'}});
    s.sessions['layout']={...session('layout','核对展签编号','running'),taskId:running,step:{label:'核对展签编号',completed:1,total:2}};
    s.tasks[running].sessionIds=['layout'];
    s.collaboration.tasks[running].status='running';
    s.sessions['illustrations']=session('illustrations','确认封面用图','waiting_reply');
    s.sessions['capture']=session('capture','收集展品说明','paused');
    const o=s.orchestrations[parent];
    for(const [i,id] of children.entries()){
      const item=o.items[id];
      item.status=i ? 'blocked' : 'paused';
      item.dependsOnTaskIds=i ? [children[i-1]] : [];
      s.collaboration.tasks[parent+'::'+id].status=item.status;
    }
    o.items[children[0]].attemptIds=['capture-attempt'];
    o.attempts['capture-attempt']={id:'capture-attempt',workItemId:children[0],sessionId:'capture',kind:'initial',status:'paused',startedAt:s.now,tokens:null,rounds:[],source:s.sessions.capture.source};
    localStorage.setItem(key,JSON.stringify(lib));
    return {parent,candidate,closed,running};
  });
  repositoryModule=undefined;
  await page.reload();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'任务',exact:true}).click();
  await page.evaluate(async()=>{
    const {gateway}=await import('/src/integration/gateway.ts');
    window.testOpened=[];
    gateway.openSource=async input=>{window.testOpened.push(input.sessionId);return {status:'opened',message:'已打开隔离会话'}};
  });
  const journal=page.getByRole('region',{name:'项目任务'});
  const parent=journal.locator('[data-task="'+ids.parent+'"]');
  const candidate=journal.locator('[data-task="'+ids.candidate+'"]');
  const running=journal.locator('[data-task="'+ids.running+'"]');
  await running.getByText(/Codex 正在执行 · 核对展签编号/).waitFor();
  await running.locator('.qd-task-subtask-status').filter({hasText:'本轮已完成 1/2 步'}).waitFor();
  const activeIds=await journal.locator('.qd-blocks > [data-task]').evaluateAll(rows=>rows.map(row=>row.dataset.task));
  assert.deepEqual(activeIds,[ids.candidate,ids.running,ids.parent]);
  for(const width of [1440,768,320]) {
    await page.setViewportSize({width,height:960});
    const waitingArea = width >= 960 ? page.getByRole('complementary',{name:'Agent 与执行'}) : journal;
    await waitingArea.getByRole('button',{name:'回复：确认封面用图'}).waitFor();
    await parent.getByText('0/3 项子任务完成',{exact:true}).waitFor();
    await parent.getByText('2 项等待前置',{exact:true}).waitFor();
    await journal.getByText(/项目中有 [1-9]\d* 项任务尚未交付完整候选/).waitFor();
    await candidate.getByText('目录清单',{exact:true}).waitFor();
    assert(!await journal.locator('[data-task="'+ids.closed+'"]').isVisible());
    await candidate.getByText('验收成果',{exact:true}).waitFor();
    assert.equal(await page.locator('.qd-col-rail').isVisible(),width >= 960);
    assert.equal(await parent.getByRole('region',{name:'任务进展轨迹'}).count(),0);
    const resume=parent.getByRole('button',{name:'回到原会话',exact:true});
    const box=await resume.boundingBox();
    assert(box && box.x>=0 && box.x+box.width<=width);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(output)await page.screenshot({path:output+'/tasks-'+width+'.png',animations:'disabled'});
  }
  const completedGroup=journal.locator('.qd-completed-group');
  await completedGroup.locator('summary').first().click();
  await completedGroup.getByText('已印票签',{exact:true}).waitFor();
  const notes=completedGroup.locator('[data-task="'+ids.closed+'"] > .qd-card-foot > .qd-annotation-history');
  await notes.locator('> summary').click();
  await notes.getByRole('textbox',{name:'我的批注'}).fill('票签需要标明日期');
  await notes.getByRole('button',{name:'保存批注'}).click();
  await notes.getByRole('button',{name:'修改我的批注'}).click();
  await notes.getByRole('textbox',{name:'我的批注'}).fill('票签需要标明出发日期');
  await notes.getByRole('button',{name:'保存批注'}).click();
  await notes.locator('.qd-annotation-editor blockquote').filter({hasText:'票签需要标明出发日期'}).waitFor();
  await notes.locator('.qd-annotation-records >summary').click();
  assert.equal(await candidate.getByText('票签需要标明出发日期',{exact:true}).count(),0);
  await notes.getByRole('button',{name:'查看修改前原文'}).first().click();
  assert.match(await page.evaluate(()=>document.activeElement.textContent),/票签需要标明日期/);
  await notes.locator('> summary').click();
  await completedGroup.locator('summary').first().click();
  const reviews=journal.getByRole('button',{name:'1 份候选成果可分别验收',exact:true});
  await reviews.click();
  await candidate.getByText('验收成果',{exact:true}).waitFor();
  assert.equal(await parent.count(),0);
  await reviews.click();
  await journal.getByRole('button',{name:'回复：确认封面用图'}).click();
  await parent.getByRole('button',{name:'回到原会话',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.testOpened),['source-illustrations','source-capture']);
  await parent.getByText('任务详情与记录',{exact:true}).click();
  await parent.getByText('校对手册',{exact:true}).first().waitFor();
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('complementary',{name:'Agent 与执行'}).waitFor();
  assert(!await journal.getByRole('region',{name:'等你处理'}).isVisible());
  await journal.getByRole('button',{name:'收起执行面板',exact:true}).click();
  await journal.getByRole('button',{name:'回复：确认封面用图'}).waitFor();
  assert(repositoryModule,'loaded repository module');
  await page.evaluate(async({running,repositoryModule})=>{
    const {localDataSource:api}=await import(repositoryModule);
    const {project}=await api.load();
    window.panelControls=[];
    const permission={id:'read',token:'permission-1',kind:'permission',prompt:'允许读取展签清单？',
      permissionOptions:[{id:'once',scope:'once',label:'允许本次',description:'只读取展签清单'}]};
    const question={id:'edition',token:'question-1',kind:'question',prompt:'选择印刷版本',
      questions:[{id:'edition',question:'采用哪版？',options:[{label:'修订版'},{label:'初版'}]}]};
    api.controlSession=async(id,action,payload)=>{
      window.panelControls.push({id,action,payload});
      api.mutateRuntimeProject(project.id,s=>{
        const session=s.sessions[id];
        delete session.runtime.requests[payload.requestId];
        session.status=Object.keys(session.runtime.requests).length ? 'waiting_reply' : 'running';
      });
      return {ok:true};
    };
    api.mutateRuntimeProject(project.id,s=>{
      const session=s.sessions.layout;
      session.status='waiting_permission';
      session.runtime={runId:'panel-run',dispatchId:'dispatch-panel',projectId:s.project.id,taskId:running,
        purpose:'execution',connection:{connectionId:'local-fixture',tool:'codex',projectPath:'/synthetic'},
        context:{capturedAt:s.now,taskTitle:session.title,prompt:''},sequence:1,eventIds:[],requests:{read:permission,edition:question}};
    });
  },{running:ids.running,repositoryModule});
  await running.getByRole('button',{name:'处理授权',exact:true}).click();
  const approval=running.getByRole('region',{name:'操作授权'});
  await approval.waitFor();
  if(output) await running.screenshot({path:output+'/row-approval-and-question.png',animations:'disabled'});
  await approval.getByRole('button',{name:/允许本次/}).click();
  await running.getByRole('region',{name:'操作授权'}).waitFor({state:'detached'});
  const question=running.getByRole('region',{name:'Agent 提问'});
  await question.getByRole('radio',{name:'修订版'}).check();
  await question.getByRole('button',{name:'发送回答'}).click();
  await question.waitFor({state:'detached'});
  await running.getByText(/Codex 正在执行/).waitFor();
  const controls=await page.evaluate(()=>window.panelControls);
  assert.deepEqual(controls.map(call=>[call.id,call.action,call.payload.requestId,call.payload.requestToken]),[
    ['layout','reply','read','permission-1'],['layout','reply','edition','question-1']]);
  assert.equal(controls[0].payload.approvalOptionId,'once');
  assert.deepEqual(controls[1].payload.answer,{answers:{edition:{answers:['修订版']}}});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({widths:[1440,768,320],reviewAction:true,pausedAndBlocked:true,replyAndResumeSources:true,disclosure:true,railToggle:true,inlineApprovalAndAnswer:true,completedFold:true,taskPriority:true,errors}));
} finally {await browser.close()}
