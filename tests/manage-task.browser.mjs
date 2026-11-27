import { openProjectTools } from './fixtures/project-tools.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { seedManagePrototype } from './fixtures/manage-prototype.mjs';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4321';
const output=process.env.QUANDECK_UI_OUTPUT||'output/manage-prototype/tasks';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.setDefaultTimeout(8000);
  const errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const ids=await seedManagePrototype(page,origin);
  await page.evaluate(async ids=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const {taskKey}=await import('/src/data/collaboration.ts');
    const profiles=[{id:'codex',name:'Codex',color:'#376bbc'},{id:'claude',name:'Claude Code',color:'#b96443'}];
    for(const profile of profiles) {
      const result=await api.registerAgent({...profile,short:profile.name});
      if(!result.ok) throw Error(result.message);
    }
    localStorage.setItem('quandeck.configured-agents.v1',JSON.stringify(profiles.map(profile=>({
      id:profile.id, agentId:profile.id, tool:profile.id, projectPath:'/prototype-test', scope:'application',
      connectionId:'fixture-'+profile.id, capabilities:{dispatch:true},
    }))));
    for(const [taskId,workItemId,prev,prevItem] of [[ids.design,ids.routing,ids.research,undefined],[ids.rehearsal,undefined,ids.design,ids.routing]]) {
      const snapshot=await api.load(), key=taskKey(taskId,workItemId);
      const result=await api.collaborate({projectId:ids.ppt,type:'set_dependencies',taskId,workItemId,
        idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.collaboration.tasks[key].version,
        payload:{dependencies:[taskKey(prev,prevItem)]}});
      if(!result.ok) throw Error(result.message);
    }
  },ids);
  // Simulate connected desktop profiles in this isolated browser. No Agent process is launched.
  await page.addInitScript(()=>{
    const source=()=>import('/src/data/repository.ts').then(module=>module.localDataSource);
    window.quandeckDesktop={
      platform:'test', bootstrap:async entries=>Object.fromEntries(Object.entries(entries).filter(([key])=>key!=='quandeck.projects.v1')),
      getConnection:async()=>({baseUrl:'http://127.0.0.1:4175',token:''}),
      onStorageError:()=>()=>{}, onNavigate:()=>()=>{},
      onSnapshot:listener=>{
        let dispose,active=true;
        void source().then(api=>{if(active)dispose=api.subscribe(listener);});
        return ()=>{active=false;dispose?.();};
      },
      command:async(name,args)=>(await source())[name](...args),
      compareTaskAgents:async()=>{throw Error('Screenshot test may not send a task');}
    };
  });
  await page.reload();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你管',exact:true}).click();
  await openProjectTools(page);
  const tabs=page.getByRole('navigation',{name:'项目页签'});
  await tabs.getByRole('button',{name:'任务',exact:true}).click();
  const tree=page.locator('.qp-tree');
  const link=name=>tree.getByRole('button',{name,exact:true});
  await link('智能路由页面').click();
  const detail=page.locator('.qp-task');
  await detail.getByRole('heading',{name:'智能路由页面'}).waitFor();
  assert.equal(await detail.locator('.qp-task-section').count(),4);
  await page.screenshot({path:path.join(output,'task-sheet.png')});
  const statement=detail.getByText('采用意图识别与规则判断的组合方案。',{exact:true});
  await statement.evaluate(node=>{
    const r=document.createRange();r.selectNodeContents(node);
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
    node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  });
  await detail.getByRole('button',{name:'讨论这段'}).click();
  await detail.getByLabel('询问选中文字').fill('依据是什么？');
  await page.keyboard.press('Escape');
  assert.equal(await detail.locator('.qp-passage').count(),0);
  const dispatch=detail.getByRole('button',{name:'分派',exact:true});
  await dispatch.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'分派任务',exact:true});
  await dialog.waitFor();
  await dialog.getByText('查看随任务发送的资料',{exact:false}).click();
  await dialog.getByText('一页架构图与一页案例对照。',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  const unowned=link('智能路由页面').locator('..');
  const handle=await page.evaluateHandle(()=>new DataTransfer());
  await unowned.dispatchEvent('dragstart',{dataTransfer:handle});
  const dock=page.locator('[data-product-dock]');
  await dock.getByText('Codex',{exact:true}).waitFor();
  await dock.getByText('Claude Code',{exact:true}).waitFor();
  const codex=dock.getByRole('button',{name:/Codex/});
  assert.equal(await codex.isEnabled(),true);
  await codex.dispatchEvent('dragover',{dataTransfer:handle});
  await page.screenshot({path:path.join(output,'dispatch-dock.png')});
  await dock.locator('button.is-over').dispatchEvent('drop',{dataTransfer:handle});
  await dialog.getByRole('checkbox',{name:/Claude Code/}).check();
  await dialog.getByRole('button',{name:'分别生成方案'}).waitFor();
  await page.screenshot({path:path.join(output,'dispatch-confirmation.png')});
  await page.keyboard.press('Escape');
  await tabs.getByRole('button',{name:'甘特图',exact:true}).click();
  await page.locator('.qp-gantt').getByRole('heading',{name:'智能路由页面'}).waitFor();
  for(const row of await page.locator('.qp-gantt-row').all()){
    const [label,track]=await Promise.all([row.locator('.qp-gantt-label').boundingBox(),row.locator('.qp-track').boundingBox()]);
    assert.equal(label.y,track.y);assert.equal(label.height,track.height);
  }
  assert.equal(await page.locator('.qp-gantt-connections path').count(),2);
  await page.screenshot({path:path.join(output,'gantt.png')});
  const openProject=async id=>{
    await page.getByLabel('切换项目').selectOption(id);
    await page.waitForFunction(id=>document.querySelector('[aria-label="切换项目"]').value===id,id);
  };
  const shiftBar=async name=>{
    const bar=page.locator('.qp-bar-body').and(page.getByRole('button',{name,exact:true}));
    const rect=await bar.boundingBox(), track=await bar.locator('xpath=../..').boundingBox();
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+track.width/42*3,y,{steps:9});await page.mouse.up();
    await page.getByRole('button',{name:'确认排期'}).waitFor();
  };
  const dates=async()=>page.evaluate(async ids=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const {planningTask}=await import('/src/data/projectPlanning.ts');
    const project=(await api.listProjects()).find(p=>p.project.id===ids.ppt);
    return planningTask(project,ids.design,ids.routing).start;
  },ids);
  const original=await dates();
  await shiftBar('智能路由页面');
  await openProject(ids.trip);
  assert.equal(await page.getByRole('button',{name:'确认排期'}).count(),0);
  assert.ok(await page.getByRole('button',{name:'撤销排期'}).isDisabled());
  assert.equal(await dates(),original);
  await page.getByRole('checkbox',{name:'所有项目'}).check();
  await shiftBar('智能路由页面');
  assert.equal(await page.getByLabel('切换项目').inputValue(),ids.trip,'cross-project selection retains the calendar context');
  await page.getByRole('button',{name:'确认排期'}).click();
  await page.getByRole('button',{name:'确认排期'}).waitFor({state:'hidden'});
  assert.notEqual(await dates(),original);
  await openProject(ids.ppt);
  assert.ok(await page.getByRole('button',{name:'撤销排期'}).isDisabled(),'old undo cannot modify a different project view');
  await page.getByRole('checkbox',{name:'所有项目'}).uncheck();
  await page.getByRole('button',{name:'收起 方案设计'}).click();
  assert.equal(await page.locator('.qp-gantt-label').getByRole('button',{name:'智能路由页面',exact:true}).count(),0);
  await page.getByRole('button',{name:'月',exact:true}).click();
  await page.getByRole('button',{name:'月',pressed:true}).waitFor();
  await tabs.getByRole('button',{name:'任务',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow on narrow window');
  assert.deepEqual(errors,[]);
  console.log('Task sheet, passage discussion, keyboard assignment, drag dock, calendar alignment, collapse, scales and 390px layout passed');
} finally { await browser.close(); }
