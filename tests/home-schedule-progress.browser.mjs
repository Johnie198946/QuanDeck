import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4429';
const out = process.env.QUANDECK_UI_OUTPUT || 'output/home-schedule';
await mkdir(out,{recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',locale:'zh-CN'});
  page.setDefaultTimeout(6500);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-26T11:10:00+08:00'));
  await page.goto(origin);
  await page.evaluate(async () => {
    const { localDataSource: api } = await import('/src/data/repository.ts');
    if(window.quandeckDesktop || (await api.listProjects()).length) throw Error('Use an empty browser profile');
    const {projectId} = await api.createProject({name:'京都摄影手册',timeZone:'Asia/Shanghai'});
    const result = await api.collaborate({type:'create_task',projectId,idempotencyKey:crypto.randomUUID(),
      payload:{title:'校对路线图',goal:'校对路线图',criteria:['能核对换乘'],owner:'me'}});
    if(!result.ok)throw Error(result.message);
    await api.addPlan({taskId:result.resourceId,title:'校对路线图',kind:'flexible',start:'10:30',minutes:30,date:'2026-11-25'},projectId);
    const titles=['联系京都向导','确认温泉旅馆','汇总行程预算'];
    const dates=['2026-11-25T09:00:00+08:00','2026-11-23T13:30:00+08:00','2026-11-26T16:15:00+08:00'];
    const createdAt='2026-11-20T10:00:00+08:00';
    const progress=[{id:'seed',text:'已收到两种房型的报价',at:'2026-11-25T15:40:00+08:00'}];
    const todos=titles.map((text,lineIndex)=>({id:'t-'+lineIndex,text,lineIndex,dueAt:dates[lineIndex],createdAt,...(lineIndex===1?{progress}:{})}));
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,notes:[
      {id:'kyoto',title:'京都行前准备',body:titles.join('\n'),createdAt,updatedAt:createdAt,revision:1,attachments:[],expansions:[],history:[],todos}],decisions:[]}));
  });
  await page.reload();
  const schedule=page.getByRole('region',{name:'日程',exact:true});
  const items=schedule.getByRole('list',{name:'日程事项'}).locator(':scope > li');
  const row=title=>items.filter({has:page.getByText(title,{exact:true})});
  await row('汇总行程预算').waitFor();
  assert.deepEqual(await items.locator('.qh-entry-time time').allTextContents(),['09:00','10:30','13:30','16:15']);
  assert.equal(await row('联系京都向导').locator('.qh-delay-orange').textContent(),'逾期 1 天');
  assert.equal(await row('确认温泉旅馆').locator('.qh-delay-red').textContent(),'逾期 3 天');
  assert.match(await row('校对路线图').locator('.qh-entry-time time').getAttribute('datetime'),/^2026-11-26T02:30/);
  for (const [title,text] of [['确认温泉旅馆','已确认双床房，等前台回复入住时间'],['校对路线图','已核对京都站的换乘站台']]) {
    await row(title).getByRole('button',{name:'写进展'}).click();
    await row(title).getByRole('textbox').fill(text);
    await row(title).getByRole('button',{name:'保存进展'}).click();
    await row(title).getByText(text,{exact:true}).waitFor();
  }
  await page.reload();
  await row('校对路线图').getByText('已核对京都站的换乘站台').waitFor();
  const inn=row('确认温泉旅馆');
  await inn.getByRole('button',{name:'全部 2 条'}).click();
  assert.deepEqual(await inn.getByRole('list',{name:'进展记录'}).locator('p').allTextContents(),['已确认双床房，等前台回复入住时间','已收到两种房型的报价']);
  await schedule.screenshot({path:path.join(out,'schedule-progress.png')});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  await inn.getByRole('button',{name:'写进展'}).click();
  await inn.getByRole('textbox').fill('前台来电确认可提前寄存行李');
  await inn.getByRole('button',{name:'保存进展'}).click();
  await inn.getByRole('button',{name:'全部 3 条'}).waitFor();
  await schedule.screenshot({path:path.join(out,'schedule-progress-mobile.png')});
  await inn.getByRole('checkbox').check();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].todos[1].completedAt?.startsWith('2026-11-26'));
  await page.clock.setFixedTime(new Date('2026-11-27T09:30:00+08:00'));
  await page.reload();
  await row('汇总行程预算').getByText('逾期 1 天').waitFor();
  assert.equal(await inn.count(),0,'completed item stops carrying forward');
  assert.match(await row('汇总行程预算').locator('.qh-entry-time time').getAttribute('datetime'),/^2026-11-27T08:15/);
  await schedule.getByRole('button',{name:/^2026-11-26/}).click();
  assert(await inn.getByRole('checkbox').isChecked());
  await inn.getByText('前台来电确认可提前寄存行李').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Passed desktop and mobile schedule: note and project progress + history persisted; daily carry, original-clock ordering, week navigation, orange/red thresholds, completion.');
} finally {await browser.close();}
