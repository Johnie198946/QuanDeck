import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const {chromium} = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/agenda';
await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-27T10:45:00+08:00'));
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4546');
  await page.getByRole('region',{name:'任务管理',exact:true}).waitFor();
  await page.evaluate(async () => {
    const {localDataSource:api} = await import('/src/data/repository.ts');
    const {projectId} = await api.createProject({name:'TokenOps 主打材料'});
    const addTask = async title => (await api.createTaskWithAttachments(title,[],projectId)).taskId;
    const ai = await addTask('整理客户案例'), allDay = await addTask('验收演示文稿');
    const overnight = await addTask('导出昨日指标');
    await api.setTaskOwner(ai,'agent');
    const unscheduled = await addTask('检查开发任务输出');
    await api.setTaskOwner(unscheduled,'agent');
    await api.addPlan({taskId:ai,title:'整理客户案例',date:'2026-11-27',start:'13:30',minutes:90,kind:'fixed'},projectId);
    await api.addPlan({taskId:overnight,title:'导出昨日指标',date:'2026-11-26',start:'23:00',minutes:120,kind:'fixed'},projectId);
    await api.updateProjectPlanning(projectId,{kind:'task',taskId:allDay,expectedRevision:0,fields:{start:'2026-11-27',end:'2026-11-27'}});
    const trip = await addTask('安排次周行程'), gate = await addTask('周末审批');
    await api.updateProjectPlanning(projectId,{kind:'task',taskId:trip,expectedRevision:1,fields:{start:'2026-11-28',end:'2026-12-02'}});
    await api.updateProjectPlanning(projectId,{kind:'task',taskId:gate,expectedRevision:2,fields:{end:'2026-11-29'}});
    const at='2026-11-26T06:00:00Z';
    const todo = (id,text,dueAt,completedAt) => ({id,text,createdAt:at,lineIndex:0,dueAt,completedAt});
    const note = {id:'review',title:'验收',body:'核实材料',createdAt:at,updatedAt:at,revision:1,attachments:[],expansions:[],history:[],todos:[
      todo('done','收到黄映乾的材料','2026-11-26T09:00:00+08:00','2026-11-27T09:20:00+08:00'),
      todo('early','提前交付邀请函','2026-11-29T12:00:00+08:00','2026-11-27T08:20:00+08:00'),
      todo('late','确认案例引用许可','2026-11-25T16:00:00+08:00'),
      todo('future','寄出纸质材料','2026-11-28T11:30:00+08:00'),
    ]};
    note.todos.forEach((todo, index) => {todo.lineIndex = index;});
    note.body = note.todos.map(t => t.text).join('\n');
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,notes:[note],decisions:[]}));
  });
  await page.reload();
  const schedule=page.getByRole('region',{name:'日程',exact:true});
  const board=page.getByRole('region',{name:'任务管理',exact:true});
  await board.getByRole('button',{name:'甘特图',exact:true}).click();
  const chart=board.getByRole('region',{name:'任务时间轴'});
  const row=title=>chart.locator('.qhg-task').filter({hasText:title});
  await row('整理客户案例').waitFor();
  await row('检查开发任务输出').getByText('默认截止 24:00',{exact:true}).waitFor();
  async function checkStack() {
    const a=await schedule.boundingBox(), b=await board.boundingBox();
    assert(a.y+a.height <= b.y+1 && Math.abs(a.x-b.x)<2 && Math.abs(a.width-b.width)<2);
  }
  await checkStack();
  assert.equal(await chart.locator('.qhg-head time').count(),24);
  const aiBar = row('整理客户案例').getByRole('button',{name:'打开日程 整理客户案例 13:30 – 15:00'});
  const rect = await aiBar.evaluate(el=>[parseFloat(el.style.left),parseFloat(el.style.width)]);
  assert.deepEqual(rect,[56.25,6.25]);
  await row('导出昨日指标').getByRole('button',{name:'打开日程 导出昨日指标 00:00 – 01:00'}).waitFor();
  const dateOnly = row('验收演示文稿').getByText('日期计划 · 未定时',{exact:true});
  await dateOnly.waitFor();
  assert.equal(await aiBar.getAttribute('data-type'),'planned');
  const available = row('确认案例引用许可').locator('.qgt-band[data-type=window]');
  await available.waitFor();
  assert.deepEqual(await available.evaluate(el=>[parseFloat(el.style.left),Math.round(parseFloat(el.style.width))]),[0,67]);
  assert.match(await available.getAttribute('title'),/原定/);
  const metrics = await aiBar.evaluate(el=>({
    height:el.getBoundingClientRect().height, width:el.getBoundingClientRect().width, color:getComputedStyle(el).backgroundColor
  }));
  assert(metrics.height>=16 && metrics.width>20);
  assert.notEqual(await available.evaluate(el=>getComputedStyle(el).backgroundColor),metrics.color);
  await row('收到黄映乾的材料').getByText('已完成',{exact:true}).waitFor();
  await row('收到黄映乾的材料').getByText('完成 09:20',{exact:true}).waitFor();
  await row('提前交付邀请函').getByText('完成 08:20',{exact:true}).waitFor();
  await row('确认案例引用许可').getByRole('button',{name:'打开日程 确认案例引用许可 16:00'}).waitFor();
  await row('寄出纸质材料').waitFor({state:'hidden'});
  await board.screenshot({path:path.join(output,'hourly-gantt.png')});
  const filter = board.getByLabel('甘特图完成状态');
  await filter.selectOption('done');
  assert.equal(await chart.locator('.qhg-task').count(),2);
  await row('提前交付邀请函').getByRole('button',{name:/打开日程 提前交付邀请函/}).click();
  await schedule.locator('[data-agenda-key="note:review:early"][data-located]').waitFor();
  await row('收到黄映乾的材料').getByRole('button',{name:/打开日程 收到黄映乾的材料/}).click();
  await schedule.locator('[data-agenda-key="note:review:done"][data-located]').waitFor();
  assert.equal(await schedule.getByRole('button',{name:/27/}).first().getAttribute('aria-pressed'),'true');
  await filter.selectOption('open');
  await row('收到黄映乾的材料').waitFor({state:'hidden'});
  await row('整理客户案例').waitFor();
  await board.getByRole('button',{name:'下一时段'}).click();
  await row('寄出纸质材料').waitFor();
  await row('检查开发任务输出').waitFor({state:'hidden'});
  await row('整理客户案例').waitFor({state:'hidden'});
  await board.getByRole('button',{name:'回到今天'}).click();
  await board.getByRole('button',{name:'一周',exact:true}).click();
  assert.equal(await chart.locator('.qhg-head time').count(),7);
  const weekBar = row('安排次周行程').locator('.qgt-band');
  await row('检查开发任务输出').getByText('11/27 24:00 截止',{exact:true}).waitFor();
  assert.equal(await weekBar.getAttribute('data-type'),'planned');
  assert.equal(await weekBar.getAttribute('data-cut-right'),'true');
  const weekBounds = await weekBar.evaluate(el=>[+parseFloat(el.style.left).toFixed(2),+parseFloat(el.style.width).toFixed(2)]);
  assert.deepEqual(weekBounds,[71.43,28.57]);
  assert.equal(await row('周末审批').locator('.qgt-band').getAttribute('data-type'),'calendar');
  await row('周末审批').getByText('截止日 11/29',{exact:true}).waitFor();
  assert.equal(await row('整理客户案例').locator('.qgt-band[data-type=planned]').count(),1);
  const overnightStart = await row('导出昨日指标').locator('.qgt-band').evaluate(el=>parseFloat(el.style.left));
  assert(Math.abs(overnightStart - (3+23/24)/7*100)<.001);
  await row('确认案例引用许可').locator('.qgt-band[data-type=window]').waitFor();
  await board.screenshot({path:path.join(output,'weekly-gantt.png')});
  await board.getByRole('button',{name:'六周',exact:true}).click();
  assert.equal(await chart.locator('.qhg-head time').count(),6);
  const sixWeekWidth = await row('安排次周行程').locator('.qgt-band').evaluate(el=>+parseFloat(el.style.width).toFixed(2));
  assert.equal(sixWeekWidth,11.9);
  await board.getByRole('button',{name:'日视图',exact:true}).click();
  await filter.selectOption('all');
  await page.setViewportSize({width:390,height:844});
  await checkStack();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await board.screenshot({path:path.join(output,'hourly-gantt-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS desktop/mobile stack; both completion states; daily 24-hour placement, half-hour starts, durations, midnight clipping, date-only work, AI and carried notes; completed on a later day; completion filters, anchor navigation, day/week/six-week bar length, source colors, availability windows, calendar deadlines and cross-period clipping.');
} finally {
  await browser.close();
}
