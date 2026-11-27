import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel:'chrome', headless:true});
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(9000);
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321');
  const expected = await page.evaluate(async () => {
    const {localDataSource:api} = await import('/src/data/repository.ts');
    if (window.quandeckDesktop || (await api.listProjects()).length) throw Error('需要空的测试工作区');
    const {projectId} = await api.createProject({name:'纸本展览'});
    await api.createTaskWithAttachments('核对展签',[],projectId);
    await api.createTaskWithAttachments('另一项未公开计划',[],projectId);
    const snapshot = await api.getProjectSnapshot(projectId);
    const {homeBoardCards} = await import('/src/components/homepage/homeBoardData.ts');
    const {savedTaskBriefInput} = await import('/src/data/taskBrief.ts');
    const card = homeBoardCards([snapshot],[],new Map(),Date.now()).find(row=>row.title==='核对展签');
    const input = savedTaskBriefInput(card.key,snapshot,[]);
    if (JSON.stringify(input.rows).includes('另一项未公开计划')) throw Error('其他任务资料混入');
    return {projectId,key:card.key,...input};
  });
  await page.reload();
  const board=page.getByRole('region',{name:'任务管理',exact:true});
  await board.waitFor();
  await page.evaluate(({projectId,key,revision,rows})=>{
    window.qaBriefCalls=0;
    window.quandeckDesktop={distillTaskBrief:async (askedKey,id,version)=>{
      if (id!==projectId || version!==revision || key!==askedKey) throw Error('任务或版本不符');
      if (++window.qaBriefCalls===1) throw Error('测试连接暂不可用');
      return {provider:'codex',points:[{section:'origin',text:'展签要做最后核对。',source:rows[0].id,quote:'核对展签'}]};
    }};
  },expected);
  assert.equal(await board.getByRole('button',{name:'项目简报',exact:true}).count(),0);
  await board.getByRole('button',{name:'查看任务 核对展签',exact:true}).click();
  const analysis=page.getByRole('region',{name:'任务简报',exact:true});
  await analysis.getByText('测试连接暂不可用',{exact:false}).waitFor();
  await analysis.getByRole('button',{name:'重试'}).click();
  await analysis.getByText('展签要做最后核对。',{exact:true}).waitFor();
  await analysis.getByRole('button',{name:'查看缘由依据'}).click();
  await analysis.getByText('核对展签',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.qaBriefCalls),2);
  const primary = page.getByRole('dialog').getByRole('button',{name:'打开任务',exact:true});
  assert.notEqual(await primary.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  if(process.env.QUANDECK_SCREENSHOT_DIR){
    await mkdir(process.env.QUANDECK_SCREENSHOT_DIR,{recursive:true});
    await page.getByRole('dialog').screenshot({path:path.join(process.env.QUANDECK_SCREENSHOT_DIR,'task-brief.png')});
  }
  console.log('PASS 点击任务默认生成简报、失败可重试、核对具体引文、同项目其他任务隔离。');
} finally { await browser.close(); }
