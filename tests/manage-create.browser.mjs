/** A saved project draft must reopen at the same step, with its questions, files and task selection. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium} = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/product/manage-create';
await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:'chrome', headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = [];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/*', route=>new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  async function openDraft() {
    await page.goto(origin);
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你管'}).click();
    await page.getByRole('button',{name:'项目工具',exact:true}).click();
    await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
    await page.locator('.qp-step-title').first().waitFor();
  }
  async function save() {
    await page.getByRole('button',{name:'保存草稿'}).click();
    await page.getByRole('status').getByText('草稿已保存').waitFor();
  }
  await openDraft();
  assert.equal(await page.locator('.qp-step-title').count(),3);
  assert.ok(await page.getByRole('button',{name:'确认创建'}).isDisabled());
  await page.getByLabel('项目名称').fill('TokenOps 海外演讲 PPT');
  await page.getByLabel('项目目标').fill('用 20 分钟讲清智能路由的工作原理与业务价值，并用一个客户场景演示。');
  await page.getByLabel('负责人').fill('林舟');
  await page.getByLabel('截止日期').fill('2026-12-11');
  await page.locator('.qp-create-file-list').evaluate(zone=>{
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['听众为产品负责人'], '演讲简报.txt', {type:'text/plain'}));
    zone.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));
  });
  await page.getByRole('button',{name:'移除 演讲简报.txt'}).waitFor();
  await save();
  await openDraft();
  assert.equal(await page.getByLabel('项目名称').inputValue(),'TokenOps 海外演讲 PPT');
  await page.getByRole('button',{name:'移除 演讲简报.txt'}).waitFor();
  await page.screenshot({path:path.join(output,'create-details.png')});
  // Exercise the normal button and draft store, with a synthetic source Agent at the IPC boundary.
  const attachAgent = () => page.evaluate(()=>{
    window.quandeckDesktop = {analyzeProject:async input=>{
      window.projectUnderstandingCalls = (window.projectUnderstandingCalls || 0) + 1;
      if (new TextDecoder().decode(input.files[0].bytes) !== '听众为产品负责人') throw Error('缺少附件原件');
      if (!input.information.includes('已有技术演示，需要补充业务场景')) throw Error('缺少项目背景');
      const updated = input.information.includes('客服工单');
      if (updated && !input.previousQuestions?.includes('现场演示使用哪个案例？')) throw Error('补充回答缺少原问题');
      return {summary:updated?'为产品负责人讲清客服工单的路由和成本。':'为产品负责人准备一场 20 分钟的演讲。',
        sourceId:'fixture',questions:updated?[]:['现场演示使用哪个案例？'],tasks:[],
        attachments:[{name:input.files[0].name,status:'read'}],
        recommendations:[{id:'idea:1',title:'路由演示顺序',kind:'帮你想 · 灵感',quote:'先演示选择结果，再解释成本。',reason:'演讲需要还原模型选择的过程。',use:'用作客户案例的开场。'}]};
    }};
  });
  await page.getByLabel('项目背景（可选）').fill('已有技术演示，需要补充业务场景');
  await attachAgent();
  await page.getByRole('button',{name:'理解需求',exact:true}).click();
  await page.getByText('现场演示使用哪个案例？').waitFor();
  await page.getByText('用作客户案例的开场。').waitFor();
  assert.equal(await page.evaluate(()=>window.projectUnderstandingCalls),1);
  assert.ok(await page.getByRole('button',{name:'确认创建'}).isEnabled());
  await page.getByLabel('路由演示顺序').uncheck();
  await page.evaluate(()=>{delete window.quandeckDesktop;});
  await page.getByLabel('补充资料或回答').fill('采用客服工单的模型选择案例。');
  await page.getByText('现场演示使用哪个案例？').waitFor();
  await save();
  await page.getByLabel('补充资料或回答').fill('采用客服工单的模型选择案例，补充一页成本对照。');
  const nav = page.getByRole('navigation',{name:'主导航'});
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  await nav.getByRole('button',{name:'帮你管'}).click();
  await page.getByRole('button',{name:'项目工具',exact:true}).click();
  await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
  await page.getByLabel('补充资料或回答').waitFor();
  assert.equal(await page.getByLabel('补充资料或回答').inputValue(),'采用客服工单的模型选择案例，补充一页成本对照。');
  await page.getByText('现场演示使用哪个案例？').waitFor();
  assert.ok(await page.getByRole('button',{name:'确认创建'}).isDisabled());
  await attachAgent();
  await page.getByRole('button',{name:'更新理解'}).click();
  await page.getByText('为产品负责人讲清客服工单的路由和成本。').waitFor();
  assert.ok(!await page.getByLabel('路由演示顺序').isChecked());
  await page.evaluate(()=>{delete window.quandeckDesktop;});
  await page.screenshot({path:path.join(output,'create-research.png')});
  await page.getByRole('button',{name:'校准任务',exact:true}).click();
  await page.getByRole('button',{name:'添加任务',exact:true}).click();
  await page.getByLabel('任务名称').fill('方案设计');
  await page.getByLabel('验收标准').fill('演示结构覆盖听众、业务目标与案例。');
  await page.getByRole('button',{name:'拆出子任务'}).click();
  await page.getByLabel('任务名称').fill('智能路由页面');
  await page.getByLabel('验收标准').fill('用一张图解释请求如何分配给模型。');
  await save();
  await openDraft();
  assert.equal(await page.getByLabel('任务名称').inputValue(),'智能路由页面');
  assert.equal(await page.getByLabel('上级任务').locator('option:checked').innerText(),'方案设计');
  await page.screenshot({path:path.join(output,'create-tasks.png')});
  await page.setViewportSize({width:360,height:780});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  // The previous Mac build wrote the draft itself without a step or selection.
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('quandeck-project-create-draft',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;
      const tx=db.transaction('draft','readwrite');
      const store=tx.objectStore('draft');
      const read=store.get('current');
      read.onsuccess=()=>{
        const {step,furthest,analysis,selected,...legacy}=read.result;
        store.put(legacy,'current');
      };
      tx.oncomplete=()=>{db.close();resolve();};
      tx.onerror=()=>reject(tx.error);
    };
  }));
  await openDraft();
  assert.equal(await page.getByLabel('任务名称').inputValue(),'方案设计');
  await page.getByRole('button',{name:'智能路由页面',exact:true}).click();
  await page.getByRole('button',{name:'确认创建'}).click();
  await page.getByRole('navigation',{name:'项目页签'}).waitFor();
  await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
  assert.equal(await page.getByLabel('项目名称').inputValue(),'');
  // A previous response can arrive after the user changes the goal. Only the latest answer may become project memory.
  await page.getByLabel('项目名称').fill('路线手册');
  await page.getByLabel('项目目标').fill('第一稿');
  await page.evaluate(async ()=>{
    const {projectKnowledgeCandidates} = await import('/src/data/projectKnowledgeCandidates.ts');
    const {emptyKnowledge} = await import('/src/data/knowledgeNotes.ts');
    const library = emptyKnowledge();
    library.inspirationCanvas = {links:[], nodes:[['router','备用节点切换','服务拥塞时将后续请求送至空闲实例。'],
      ['music','钢琴指法','拇指按住白键。']].map(([noteId,title,detail])=>({noteId,x:0,y:0,idea:{title,detail,origin:'manual'}}))};
    const reply = goal => {
      const choices = projectKnowledgeCandidates(library,[],goal);
      if (!['idea:router','idea:music'].every(id=>choices.some(item=>item.id===id))) throw Error('Agent 缺少可供判断的跨领域候选');
      const method = choices.find(item=>item.id==='idea:router');
      return {summary:goal+'的理解',sourceId:'source-'+goal,questions:[],tasks:[],attachments:[],
        recommendations:[{...method,quote:method.excerpt,reason:'空闲服务与人少的入口都能接手积压工作。',use:'引导观众到人少的入口。'}]};
    };
    window.quandeckDesktop={analyzeProject:async ({goal})=>{
      if (goal==='第一稿') return await new Promise(resolve=>{window.resolvePrevious=()=>resolve(reply(goal));});
      return reply(goal);
    }};
  });
  await page.getByRole('button',{name:'理解需求',exact:true}).click();
  await page.waitForFunction(()=>typeof window.resolvePrevious==='function');
  await page.locator('.qp-step-title').first().click();
  await page.getByLabel('项目目标').fill('根据各入口排队人数安排观众入场');
  await page.getByRole('button',{name:'理解需求',exact:true}).click();
  await page.getByText('根据各入口排队人数安排观众入场的理解',{exact:true}).waitFor();
  await page.evaluate(()=>window.resolvePrevious());
  await page.getByText('引导观众到人少的入口。').waitFor();
  assert.equal(await page.getByText('钢琴指法').count(),0,'an unrelated candidate considered by the Agent must not appear as a recommendation');
  await page.getByRole('checkbox',{name:'备用节点切换'}).uncheck();
  await page.evaluate(()=>{delete window.quandeckDesktop;});
  await page.getByRole('button',{name:'确认创建',exact:true}).click();
  await page.getByRole('navigation',{name:'项目页签'}).waitFor();
  const stored=await page.evaluate(()=>{
    const lib=JSON.parse(localStorage.getItem('quandeck.projects.v1'));return lib.projects[lib.activeProjectId];
  });
  assert.equal(stored.project.understanding.summary,'根据各入口排队人数安排观众入场的理解');
  assert.deepEqual(stored.project.understanding.recommendations,[]);
  assert.equal(Object.keys(stored.tasks).length,0,'a project may be created before adding tasks');
  assert.deepEqual(errors,[]);
  console.log('PASS: attachment drop, draft resume in all three steps, AI questions survive answers, selected child restored, legacy draft recovered, last edits persisted on navigation, published draft cleared, confirmation creates project, narrow layout.');
} finally {await browser.close();}
