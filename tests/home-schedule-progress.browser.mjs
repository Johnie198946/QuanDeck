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
  const repositoryUrls=[];
  page.on('request',req=>{ if(new URL(req.url()).pathname === '/src/data/repository.ts') repositoryUrls.push(req.url()); });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-26T11:10:00+08:00'));
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.getByRole('region',{name:'日程',exact:true}).waitFor().catch(async error=>{console.error(errors,await page.locator('body').innerText());throw error;});
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
  const row=title=>items.filter({has:page.locator('.qh-entry-copy > button > strong').and(page.getByText(title,{exact:true}))});
  await row('汇总行程预算').waitFor().catch(async error=>{console.error(errors,(await page.locator('body').innerText()).slice(0,2400));throw error;});
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
  await inn.getByRole('checkbox',{name:'完成「确认温泉旅馆」'}).click();
  const outcome=page.getByRole('dialog',{name:'记录结果'});
  await outcome.getByLabel('结果说明').fill('旅馆接受提前寄存。');
  await outcome.locator('summary').click();
  await outcome.getByLabel('材料链接').fill('https://example.com/bag');
  await outcome.getByLabel('添加材料文件').setInputFiles({name:'京都凭证.txt',mimeType:'text/plain',buffer:Buffer.from('房间确认')});
  await outcome.getByRole('button',{name:'移除 京都凭证.txt'}).waitFor();
  await outcome.getByRole('button',{name:'取消'}).click();
  await page.reload();
  await inn.getByRole('button',{name:'继续写结果'}).click();
  const resumed=inn.getByRole('region',{name:'记录结果'});
  assert.equal(await resumed.getByLabel('结果说明').inputValue(),'旅馆接受提前寄存。');
  assert.equal(await resumed.getByLabel('材料链接').inputValue(),'https://example.com/bag');
  await resumed.getByRole('button',{name:'移除 京都凭证.txt'}).waitFor();
  await resumed.getByRole('button',{name:'保存并完成日程'}).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].todos[1].completedAt?.startsWith('2026-11-26'));
  await page.clock.setFixedTime(new Date('2026-11-27T09:30:00+08:00'));
  await page.reload();
  await row('汇总行程预算').getByText('逾期 1 天').waitFor();
  assert.equal(await inn.count(),0,'completed item stops carrying forward');
  assert.match(await row('汇总行程预算').locator('.qh-entry-time time').getAttribute('datetime'),/^2026-11-27T08:15/);
  await schedule.getByRole('button',{name:/^2026-11-26/}).click();
  assert(await inn.getByRole('checkbox').isChecked());
  await inn.getByText('前台来电确认可提前寄存行李').waitFor();
  await page.setViewportSize({width:1440,height:1000});
  // A written report may start a new todo. Both rows survive reload with their own times and sources.
  await page.clock.setFixedTime(new Date('2026-11-27T09:30:00+08:00'));
  await page.reload();
  const contact = row('联系京都向导');
  await contact.getByRole('button',{name:'写进展'}).click();
  const text = '已跟进黄映乾要材料，11点再确认一遍';
  await contact.getByRole('textbox').fill(text);
  const nav = page.getByRole('navigation',{name:'主导航'});
  await nav.getByRole('button',{name:'帮你记',exact:true}).click();
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  assert.equal(await contact.getByRole('textbox').inputValue(),text);
  await page.reload();
  assert.equal(await contact.getByRole('textbox').inputValue(),text);
  await contact.getByRole('button',{name:'待跟进',exact:true}).click();
  assert.equal(await contact.getByLabel('下次跟进时间').inputValue(),'2026-11-27T11:00');
  assert.equal(await contact.locator('.qh-entry-time time').innerText(),'09:00');
  await contact.getByRole('button',{name:'创建跟进'}).click();
  const child = row('11点再确认一遍');
  await child.getByRole('button',{name:'原事项 · 联系京都向导'}).waitFor();
  assert.equal(await contact.locator('.qh-entry-time time').innerText(),'12:00');
  assert.equal(await child.locator('.qh-entry-time time').innerText(),'11:00');
  await contact.getByRole('button',{name:'查看跟进',exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.dataset.agendaKey &&
    document.activeElement.querySelector('.qh-entry-copy strong')?.textContent === '11点再确认一遍');
  await child.getByRole('button',{name:'写进展'}).click();
  await child.getByRole('textbox').fill('12点向同事发清单');
  await child.getByRole('button',{name:'保存进展'}).click();
  await child.getByRole('button',{name:'待跟进',exact:true}).click();
  await child.getByRole('button',{name:'创建跟进'}).click();
  await row('12点向同事发清单').getByRole('button',{name:'原事项 · 11点再确认一遍'}).waitFor();
  assert.equal(await child.locator('.qh-entry-time time').innerText(),'13:00');
  await child.getByRole('button',{name:'写进展'}).click();
  await child.getByRole('textbox').fill('收到了材料，已经核过');
  await child.getByLabel('完成日程',{exact:true}).check();
  await child.getByLabel('结果说明').fill('材料已收齐');
  await schedule.screenshot({path:path.join(out,'write-result.png')});
  await child.getByRole('button',{name:'保存并完成日程'}).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].todos.find(t => t.text === '11点再确认一遍')?.completedAt);
  assert.equal(await contact.getByRole('checkbox').isChecked(),false);
  await page.reload();
  await contact.getByRole('button',{name:'跟进已完成'}).waitFor();
  assert.equal(await contact.getByRole('textbox').count(),0);
  await schedule.screenshot({path:path.join(out,'linked-schedule.png')});
  // A future-day draft can be reached from today's view after leaving the homepage.
  await row('汇总行程预算').getByRole('button',{name:'写进展'}).click();
  await row('汇总行程预算').getByRole('textbox').fill('明天14点核对报价');
  await row('汇总行程预算').getByRole('button',{name:'待跟进',exact:true}).click();
  await row('汇总行程预算').getByRole('button',{name:'创建跟进'}).click();
  await schedule.getByRole('button',{name:/^2026-11-28/}).click();
  const future = row('明天14点核对报价');
  await future.getByRole('button',{name:'写进展'}).click();
  await future.getByRole('textbox').fill('已查到一半，回来继续写');
  await nav.getByRole('button',{name:'帮你记',exact:true}).click();
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  await schedule.getByRole('button',{name:'续写草稿 · 明天14点核对报价'}).click();
  assert.equal(await future.getByRole('textbox').inputValue(),'已查到一半，回来继续写');
  await future.getByRole('button',{name:'保存进展'}).click();
  await future.getByText('已查到一半，回来继续写').waitFor();
  await schedule.getByRole('button',{name:'回到今天'}).click();
  const moving = row('联系京都向导');
  await moving.getByRole('button',{name:'写进展'}).click();
  await moving.getByRole('textbox',{name:'进展内容'}).fill('改期到周一下班前');
  assert.equal(await moving.getByLabel('调整后的截止时间').inputValue(),'2026-11-30T18:00');
  await schedule.screenshot({path:path.join(out,'reschedule-preview.png')});
  await moving.getByRole('button',{name:'保存进展并改期'}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].todos[0].dueAt==='2026-11-30T10:00:00.000Z');
  await schedule.getByRole('button',{name:/成果库/}).click();
  await schedule.getByText('旅馆接受提前寄存。',{exact:true}).first().waitFor();
  const projects=page.getByRole('region',{name:'任务管理',exact:true});
  await projects.getByRole('button',{name:'甘特图',exact:true}).click();
  const chart=projects.getByRole('region',{name:'任务时间轴'});
  await projects.getByRole('button',{name:'六周',exact:true}).click();
  const planned=chart.locator('.qhg-task').filter({hasText:'校对路线图'});
  await planned.getByText('进行中',{exact:true}).waitFor();
  assert(await planned.locator('.qgt-band[data-type=planned]').first().isVisible(),'a calendar appointment shows a duration bar');
  // Reuse the same Vite module instance as the application when testing a pushed state update.
  await page.evaluate(async repositoryUrl => {
    const {localDataSource:api} = await import(repositoryUrl);
    const snapshot = await api.load();
    const task = Object.values(snapshot.tasks).find(task=>task.title==='校对路线图');
    const result = await api.updateProjectPlanning(snapshot.project.id,{
      kind:'task',taskId:task.id,expectedRevision:snapshot.projectPlanning?.revision ?? 0,
      fields:{start:'2026-11-27',end:'2026-12-01'},
    });
    if (!result.ok) throw Error(result.message);
  }, repositoryUrls.findLast(url=>new URL(url).searchParams.has('t')) ?? repositoryUrls.at(-1));
  // The home projection must pick up newly saved project dates without reloading the page.
  await planned.locator('.qgt-band').filter({hasText:'11/27 – 12/01'}).waitFor();
  await projects.screenshot({path:path.join(out,'project-gantt.png')});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'chart and result panel must not widen mobile viewport');
  // Two real upgrade scenarios: the old app stored the move as prose and scheduled a late follow-up by default.
  await page.clock.setFixedTime(new Date('2026-11-27T16:58:00+08:00'));
  await page.evaluate(() => {
    const key='quandeck.personal-knowledge.v1', lib=JSON.parse(localStorage.getItem(key));
    const note=lib.notes[0], createdAt='2026-11-27T08:58:00Z', root=note.body.split('\n').length;
    note.body+='\n追台卡\n整理材料';
    note.todos.push({id:'chase',text:'追台卡',lineIndex:root,createdAt,dueAt:'2026-11-27T10:00:00Z'},
      {id:'legacy',text:'整理材料',lineIndex:root+1,createdAt,dueAt:'2026-11-27T15:59:00Z',
       progress:[{id:'old',text:'改期到周一下班前',at:createdAt}]});
    localStorage.setItem(key,JSON.stringify(lib));
  });
  await page.reload();
  const legacy=row('整理材料'),chase=row('追台卡');
  await legacy.getByRole('button',{name:'应用改期'}).click();
  assert.equal(await legacy.getByLabel('新的截止时间').inputValue(),'2026-11-30T18:00');
  await legacy.getByRole('button',{name:'确认改期',exact:true}).click();
  await legacy.getByText(/已改至/).waitFor();
  assert.equal(await legacy.locator('.qh-entry-time time').innerText(),'18:00');
  await schedule.getByRole('button',{name:'回到今天'}).click();
  await chase.getByRole('button',{name:'写进展'}).click();
  await chase.getByLabel('进展内容').fill('已追台卡，等回复');
  await chase.getByRole('button',{name:'待跟进'}).click();
  assert.equal(await chase.getByLabel('下次跟进时间').inputValue(),'2026-11-27T17:00');
  await chase.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await chase.locator('.qh-entry-time time').innerText(),'18:00');
  await chase.getByRole('button',{name:'待跟进'}).click();
  await page.setViewportSize({width:1440,height:980});
  const field=await chase.getByLabel('下次跟进时间').boundingBox();
  assert(field.width>160 && field.height>=24,'editable appointment must expose date and time');
  await chase.screenshot({path:path.join(out,'followup-time-preview.png')});
  await chase.getByRole('button',{name:'创建跟进'}).click();
  await chase.getByRole('button',{name:'调整跟进'}).click();
  await chase.getByLabel('下次跟进时间').fill('2026-11-27T17:30');
  await chase.getByRole('button',{name:'保存跟进时间'}).click();
  await page.waitForFunction(()=>{
    const list=JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].todos;
    const linked=list.filter(t=>t.follows?.parentId==='chase');
    return linked.length===1 && linked[0].dueAt==='2026-11-27T09:30:00.000Z' && list.find(t=>t.id==='chase').dueAt==='2026-11-27T10:30:00.000Z';
  });
  // Real-world wording at the 12-hour boundary, including a saved row from the old parser.
  await page.clock.setFixedTime(new Date('2026-11-28T00:11:00+08:00'));
  const wording = '改到星期一早上12点';
  await page.evaluate(wording => {
    const key = 'quandeck.personal-knowledge.v1';
    const lib = JSON.parse(localStorage.getItem(key)), note = lib.notes[0];
    const createdAt = '2026-11-27T16:11:00.000Z', wrong = '2026-11-29T16:00:00.000Z';
    const lineIndex = note.body.split('\n').length;
    note.body += '\n准备材料样稿\n核对材料样稿';
    note.todos.push({id:'fresh-time',lineIndex,text:'准备材料样稿',createdAt,dueAt:'2026-11-28T08:00:00.000Z'},
      {id:'stored-time',lineIndex:lineIndex+1,text:'核对材料样稿',createdAt,dueAt:wrong,
       progress:[{id:'old-midnight',text:wording,at:createdAt,scheduledFor:wrong}]});
    localStorage.setItem(key, JSON.stringify(lib));
  }, wording);
  await page.reload();
  const fresh = row('准备材料样稿'), stored = row('核对材料样稿');
  await fresh.getByRole('button',{name:'写进展'}).click();
  await fresh.getByLabel('进展内容').fill(wording);
  assert(await fresh.getByRole('button',{name:'请选择时间'}).isDisabled());
  const exactNoon = fresh.getByRole('button',{name:/12:00/}), midnight = fresh.getByRole('button',{name:/00:00/});
  await midnight.click();
  assert.equal(await fresh.getByLabel('调整后的截止时间').inputValue(),'2026-11-30T00:00');
  await exactNoon.click();
  assert.equal(await fresh.getByLabel('调整后的截止时间').inputValue(),'2026-11-30T12:00');
  await fresh.screenshot({path:path.join(out,'choose-noon.png')});
  await page.reload();
  assert.equal(await fresh.getByLabel('进展内容').inputValue(),wording);
  assert.equal(await fresh.getByLabel('调整后的截止时间').inputValue(),'2026-11-30T12:00');
  await fresh.getByRole('button',{name:'保存进展并改期'}).click();
  await fresh.getByText(/已改至/).waitFor();
  assert.equal(await fresh.locator('.qh-entry-time time').innerText(),'12:00');
  assert.equal(await stored.locator('.qh-entry-time time').innerText(),'00:00');
  await stored.getByRole('button',{name:'纠正时间'}).click();
  const correction = stored.getByRole('form',{name:'纠正已保存时间'});
  assert(await correction.getByRole('button',{name:'保存更正'}).isDisabled());
  await correction.getByRole('button',{name:/12:00/}).click();
  await correction.getByRole('button',{name:'保存更正'}).click();
  await page.waitForFunction(()=>{
    const todos=JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].todos;
    const old=todos.find(item=>item.id==='stored-time');
    return !todos.some(item=>item.follows?.parentId===old.id) && old.progress.length===2 &&
      old.progress[0].scheduledFor==='2026-11-29T16:00:00.000Z' && old.progress[1].correctsProgressId==='old-midnight' &&
      old.dueAt==='2026-11-30T04:00:00.000Z';
  });
  await page.reload();
  await schedule.getByRole('button',{name:'下一周'}).click();
  await schedule.getByRole('button',{name:/^2026-11-30/}).click();
  assert.equal(await stored.locator('.qh-entry-time time').innerText(),'12:00');
  assert.equal(await fresh.locator('.qh-entry-time time').innerText(),'12:00');
  await stored.getByRole('button',{name:'全部 2 条'}).click();
  assert.equal(await stored.getByRole('button',{name:'纠正时间'}).count(),1);
  await stored.screenshot({path:path.join(out,'corrected-history.png')});
  assert.deepEqual(errors,[]);
  console.log('Passed desktop and mobile schedule: note and project progress + history persisted; daily carry, original-clock ordering, week navigation, orange/red thresholds, completion, material follow-up and result, project Gantt.');
} finally {await browser.close();}
