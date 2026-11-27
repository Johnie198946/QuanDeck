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
  await page.getByRole('button',{name:'理解需求',exact:true}).click();
  // Inject only the research reply, after normal navigation through the local browser data source.
  await page.evaluate(()=>{
    window.quandeckDesktop = {analyzeProject: async ({information})=>{
      if (!information.includes('听众为产品负责人')) throw Error('研究缺少附件内容');
      return {summary:'为产品负责人准备一场 20 分钟的演讲，重点说明智能路由如何帮助客户选择模型。',
        sourceId:'test',questions:['现场演示使用哪个案例？'],tasks:[]};
    }};
  });
  await page.getByRole('button',{name:'开始研究'}).click();
  await page.getByText('现场演示使用哪个案例？').waitFor();
  await page.evaluate(()=>{delete window.quandeckDesktop;});
  await page.getByLabel('补充资料或回答').fill('采用客服工单的模型选择案例。');
  await page.getByText('现场演示使用哪个案例？').waitFor();
  await save();
  await page.getByLabel('补充资料或回答').fill('采用客服工单的模型选择案例，补充一页成本对照。');
  const nav = page.getByRole('navigation',{name:'主导航'});
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  await nav.getByRole('button',{name:'帮你管'}).click();
  await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
  await page.getByLabel('补充资料或回答').waitFor();
  assert.equal(await page.getByLabel('补充资料或回答').inputValue(),'采用客服工单的模型选择案例，补充一页成本对照。');
  await page.getByText('现场演示使用哪个案例？').waitFor();
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
  assert.deepEqual(errors,[]);
  console.log('PASS: attachment drop, draft resume in all three steps, AI questions survive answers, selected child restored, legacy draft recovered, last edits persisted on navigation, published draft cleared, confirmation creates project, narrow layout.');
} finally {await browser.close();}
