/** Independently verifies the new top-level routes with a disposable browser profile. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/product/shell-browser';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:930}});
  const errors=[];
  const externalRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin) return route.continue();
    externalRequests.push(url.hostname);
    return route.abort();
  });
  await page.goto(origin);
  const nav=page.getByRole('navigation',{name:'主导航'});
  await nav.getByRole('button',{name:'首页',exact:true}).waitFor();
  assert.deepEqual(await nav.getByRole('button').allTextContents(),['首页','帮你记','帮你想','帮你管','帮你盯','帮你找']);
  await page.getByRole('heading',{name:'目前没有待办事项'}).waitFor();
  await page.evaluate(async()=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const {projectId}=await api.createProject({name:'小型展览',description:'交付图文手册'});
    if(!projectId) throw Error('Fixture project was not created');
    for(const title of ['更新展板目录','确认门票样式','领导交办：核对展品名单','检查海报']) {
      const task=await api.createTaskWithAttachments(title,[],projectId);
      if(!task.taskId) throw Error(task.message);
      const result=await api.saveTaskOutput({taskId:task.taskId,title,body:'已整理资料，等你核对。',status:'published',projectId});
      if(!result.ok) throw Error(result.message);
    }
  });
  await page.reload();
  await page.getByRole('heading',{name:'有 4 件事需要你处理'}).waitFor();
  const attention=page.getByRole('region',{name:'现在需要处理'});
  assert.equal(await attention.locator('li').count(),3);
  assert.match(await attention.locator('li').first().innerText(),/领导交办/);
  await page.screenshot({path:path.join(output,'home-1440.png'),animations:'disabled'});
  await attention.getByRole('button',{name:'现在需要处理'}).click();
  assert.equal(await attention.locator('li').count(),4);
  const jumps=page.getByRole('navigation',{name:'首页模块'});
  await jumps.getByRole('button',{name:'项目进展'}).click();
  await page.getByRole('region',{name:'项目进展'}).waitFor();
  await jumps.getByRole('button',{name:'返回首页'}).click();
  await attention.getByRole('button',{name:'去验收'}).first().click();
  await page.getByRole('heading',{name:'帮你盯'}).waitFor();
  await page.locator('.qd-product-monitor-card.is-selected').getByText(/领导交办/).first().waitFor();
  await page.screenshot({path:path.join(output,'monitor-1440.png'),animations:'disabled'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  assert.deepEqual(await page.getByRole('tab').allTextContents(),['个人资料','Agent 管理','提醒','数据管理']);
  const image=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=8;
    const context=canvas.getContext('2d');
    context.fillStyle='#1247ab';
    context.fillRect(0,0,8,8);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const avatar=Buffer.from(image,'base64');
  await page.getByLabel('选择头像').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:avatar});
  await page.getByText('头像已保存',{exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭我的设置'}).click();
  await page.locator('.qd-product-avatar img').waitFor();
  await page.getByRole('searchbox',{name:'全局搜索'}).fill('帮我找小型展览');
  await page.getByRole('searchbox',{name:'全局搜索'}).press('Enter');
  await page.getByRole('list',{name:'查找结果'}).getByRole('button',{name:/小型展览/}).first().waitFor();
  await page.reload();
  await page.locator('.qd-product-avatar img').waitFor();
  await page.getByRole('heading',{name:'现在需要处理'}).waitFor();
  await page.setViewportSize({width:360,height:800});
  await page.reload();
  await page.getByRole('heading',{name:'现在需要处理'}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path:path.join(output,'home-360.png'),animations:'disabled'});

  const fontSize = async selector => page.locator(selector).evaluate(element => getComputedStyle(element).fontSize);
  for (const [width, displaySize] of [[320,'26px'],[768,'26px'],[1024,'30px'],[1440,'34px']]) {
    await page.setViewportSize({width,height:900});
    await nav.getByRole('button',{name:'首页',exact:true}).click();
    assert.equal(await fontSize('.qd-home-header h1'),displaySize,`Home title at ${width}px`);
    if (width <= 780) assert(await page.evaluate(() => {
      const navigation = document.querySelector('.qd-product-navigation').getBoundingClientRect();
      const toolbar = document.querySelector('.qd-product-top').getBoundingClientRect();
      return Math.abs(navigation.bottom - toolbar.top) < 1;
    }),`Mobile chrome joins without a layout gap at ${width}px`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`Home fits at ${width}px`);
    await nav.getByRole('button',{name:'帮你盯',exact:true}).click();
    assert.equal(await fontSize('.qd-product-monitor-heading h1'),displaySize,`Monitor title at ${width}px`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`Monitor fits at ${width}px`);
    await nav.getByRole('button',{name:'帮你管',exact:true}).click();
    assert.equal(await fontSize('.qp-head h2'),displaySize,`Project title at ${width}px`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`Project fits at ${width}px`);
    if (width === 320 || width === 1440) await page.screenshot({path:path.join(output,`project-${width}.png`),animations:'disabled'});
  }
  assert.deepEqual(externalRequests,[],'Product shell has no external styling or font requests.');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({fixedNavigation:true,homeShowsThree:true,leaderFirst:true,actionFocus:true,inlineExpansion:true,settingsFour:true,profilePersists:true,sharedSearch:true,narrow360:true,consistentTitleScales:[320,768,1024,1440],errors}));
} finally { await browser.close(); }
