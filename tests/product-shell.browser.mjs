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
  const page = await browser.newPage({viewport:{width:1440,height:930},timezoneId:'Asia/Shanghai'});
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
  const schedule = page.getByRole('region', { name: '日程', exact: true });
  await schedule.getByRole('heading', { name: '今天的日程' }).waitFor();
  await schedule.getByText('这一天还没有日程').waitFor();
  assert.equal(await page.getByRole('region', { name: '待核对的资料关联' }).count(), 0);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').textContent(), '跳到页面内容');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'qd-page-content');

  await page.getByRole('button',{name:'写笔记',exact:true}).click();
  await page.getByLabel('笔记标题',{exact:true}).fill('测试记录');
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  await page.getByRole('button',{name:'写笔记',exact:true}).click();
  assert.equal(await page.getByLabel('笔记标题',{exact:true}).inputValue(), '');
  await page.getByRole('button',{name:/测试记录/}).click();
  assert.equal(await page.getByLabel('笔记标题',{exact:true}).inputValue(), '测试记录');
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  await page.evaluate(async()=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const {projectId}=await api.createProject({name:'小型展览',description:'交付图文手册'});
    if(!projectId) throw Error('Fixture project was not created');
    const now=new Date();
    const date=now.toLocaleDateString('sv-SE');
    for(const title of ['更新展板目录','确认门票样式','领导交办：核对展品名单','检查海报']) {
      const task=await api.createTaskWithAttachments(title,[],projectId);
      if(!task.taskId) throw Error(task.message);
      if(title==='检查海报'){
        const edit=await api.updateProjectPlanning(projectId,{kind:'task',taskId:task.taskId,expectedRevision:0,fields:{start:date,end:date}});
        if(!edit.ok) throw Error(edit.message);
      }
      const result=await api.saveTaskOutput({taskId:task.taskId,title,body:'已整理资料，等你核对。',status:'published',projectId});
      if(!result.ok) throw Error(result.message);
    }
  });
  await page.reload();
  await page.getByRole('region', { name: '现在需要处理' }).getByText('4 项', { exact: true }).waitFor();
  const attention=page.getByRole('region',{name:'现在需要处理'});
  const agenda=attention.locator('.qh-agenda > li');
  assert.equal(await agenda.count(),3);
  assert.match(await agenda.first().innerText(),/领导交办/);
  const disclosures=agenda.locator('h3 button[aria-expanded]');
  assert.equal(await disclosures.first().getAttribute('aria-expanded'),'true');
  await disclosures.nth(1).click();
  assert.equal(await disclosures.nth(1).getAttribute('aria-expanded'),'true');
  assert.equal(await disclosures.first().getAttribute('aria-expanded'),'false');
  assert.equal(await agenda.locator('.qh-work-details').count(),1);
  await disclosures.first().click();
  await page.screenshot({path:path.join(output,'home-1440.png'),animations:'disabled'});
  await attention.getByRole('button',{name:'现在需要处理',exact:true}).click();
  assert.equal(await agenda.count(),4);
  const jumps=page.getByRole('navigation',{name:'首页模块'});
  await jumps.getByRole('button',{name:'项目进展'}).click();
  const progress=page.getByRole('region',{name:'项目进展'});
  assert.equal(await progress.getByRole('button',{name:'项目简报',exact:true}).getAttribute('aria-pressed'),'true');
  await progress.getByRole('button',{name:'甘特图',exact:true}).click();
  await progress.getByRole('button',{name:'打开项目 小型展览'}).waitFor();
  const track=progress.locator('.qhp-span');
  assert.equal(await track.count(),1);
  await progress.getByRole('button',{name:'下一时段'}).click();
  assert.equal(await track.count(),0,'A scheduled day must disappear outside its date range');
  await progress.getByRole('button',{name:'上一时段'}).click();
  assert.equal(await track.count(),1);
  await progress.getByRole('button',{name:'列表',exact:true}).click();
  assert.equal(await progress.getByRole('button',{name:'列表',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await track.count(),0,'List mode hides the timeline');
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
  await page.locator('.qd-product-avatar img').first().waitFor();
  await page.getByRole('searchbox',{name:'全局搜索'}).fill('帮我找小型展览');
  await page.getByRole('searchbox',{name:'全局搜索'}).press('Enter');
  await page.getByRole('list',{name:'查找结果'}).getByRole('button',{name:/小型展览/}).first().waitFor();
  await page.reload();
  await page.locator('.qd-product-avatar img').first().waitFor();
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
    const titleSize=parseFloat(await fontSize('.qd-product-home h1'));
    assert(titleSize >= 22 && titleSize <= 40,`Readable home title at ${width}px`);
    const homeBounds=await page.locator('.qd-product-home').boundingBox();
    const navBounds=await nav.boundingBox();
    if(width>=1024) assert(navBounds.x + navBounds.width <= homeBounds.x + 1,`Homepage navigation on the left at ${width}px`);
    const railColor = () => page.locator('.qd-product-navigation').evaluate(el => getComputedStyle(el).backgroundColor);
    const homeRailColor = await railColor();
    if(width===320) assert(navBounds.y+navBounds.height<=homeBounds.y+1,'Mobile homepage navigation precedes content');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`Home fits at ${width}px`);
    await nav.getByRole('button',{name:'帮你盯',exact:true}).click();
    assert.equal(await railColor(), homeRailColor, 'All pages share the same navigation color');
    assert.equal(await fontSize('.qd-product-monitor-heading h1'),displaySize,`Monitor title at ${width}px`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`Monitor fits at ${width}px`);
    await nav.getByRole('button',{name:'帮你管',exact:true}).click();
    assert.equal(await railColor(), homeRailColor, 'Projects and home share the same navigation color');
    assert.equal(await fontSize('.qp-head h2'),displaySize,`Project title at ${width}px`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`Project fits at ${width}px`);
    if (width === 320 || width === 1440) await page.screenshot({path:path.join(output,`project-${width}.png`),animations:'disabled'});
  }
  // The homepage combines actual project appointments with note deadlines in local time.
  await page.clock.setFixedTime(new Date('2026-11-26T09:00:00+08:00'));
  await page.evaluate(async () => {
    const { localDataSource: api } = await import('/src/data/repository.ts');
    const { mutateKnowledge } = await import('/src/data/knowledgeStore.ts');
    const project = (await api.listProjects())[0];
    const { taskId } = await api.createTaskWithAttachments('夜间布展', [], project.project.id);
    await api.addPlan({ title:'夜间布展', taskId, kind:'fixed', date:'2026-11-25', start:'23:40', minutes:40 }, project.project.id);
    const dueAt = '2026-11-25T09:00:00Z';
    const source = 'https://example.test/guide';
    await mutateKnowledge(library => {
      const base = { createdAt:dueAt, updatedAt:dueAt, attachments:[], expansions:[], history:[], revision:1 };
      library.notes.push({ ...base, id:'agenda-note', title:'展览手册', archivedAt:dueAt, body:'核对旧稿\n' + source,
        todos:[{ id:'late', lineIndex:0, text:'核对旧稿', dueAt, createdAt:dueAt }] },
      { ...base, id:'source-note', title:'手册的资料', body:source });
    });
  });
  await nav.getByRole('button', {name:'首页',exact:true}).click();
  const overnight = schedule.getByRole('listitem').filter({ hasText:'夜间布展' });
  await overnight.getByText('00:00', {exact:true}).waitFor();
  assert.match(await overnight.innerText(), /至 00:20/);
  const late = schedule.getByRole('listitem').filter({hasText:'核对旧稿'});
  await late.getByText('逾期 1 天',{exact:true}).waitFor();
  await late.getByRole('checkbox').check();
  await late.getByRole('checkbox',{name:'重新打开「核对旧稿」'}).waitFor();
  await schedule.getByRole('button',{name:/^2026-11-27/}).click();
  assert.equal(await schedule.getByRole('listitem').count(),0,'No past plan or completed note is repeated tomorrow');
  await schedule.getByRole('button',{name:'回到今天'}).click();
  await late.getByRole('checkbox').uncheck();
  await late.getByText('逾期 1 天',{exact:true}).waitFor();
  const related = page.getByRole('region',{name:'待核对的资料关联'});
  await related.getByRole('button',{name:'查看详情'}).click();
  await page.getByRole('heading',{name:'知识图谱'}).waitFor();
  assert.deepEqual(externalRequests,[],'Product shell has no external styling or font requests.');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({fixedNavigation:true,homeShowsThree:true,leaderFirst:true,actionFocus:true,inlineExpansion:true,rowsExpandIndependently:true,homeRailOnLeft:true,settingsFour:true,profilePersists:true,sharedSearch:true,overnightPlan:true,overdueTodo:true,sourcedDiscovery:true,narrow360:true,consistentTitleScales:[320,768,1024,1440],errors}));
} finally { await browser.close(); }
