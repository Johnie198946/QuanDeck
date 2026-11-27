import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4385';
const out = process.env.QUANDECK_UI_OUTPUT || 'output/home-todos';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 930 }, timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
page.setDefaultTimeout(8_000);
const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
const body = page.getByRole('textbox', { name: '笔记正文' });
const title = page.getByRole('textbox', { name: '笔记标题' });
const add = page.getByRole('button', { name: '将此行设为待办', exact: true });
const send = page.getByRole('button', { name: '发送此行到帮你管', exact: true });
const schedule = page.getByRole('region', { name: '日程', exact: true });
const noteName = '旅行准备';
const lines = ['今天下班前核对京都路线', '下午四点前联系大阪民宿', '整理两人的行李清单', '明天上午九点取车'];
const notes = () => page.evaluate(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes);
const checkboxAtHome = text => schedule.getByRole('checkbox', { name: new RegExp(text) });
const homeLine = text => schedule.getByRole('button', { name: new RegExp(text) });
async function hoverLine(text) {
  const point = await body.evaluate((editor, value) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.data.indexOf(value);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + value.length);
      const box = range.getBoundingClientRect();
      return {x: box.left + 3, y: box.top + box.height / 2};
    }
    throw Error('未找到笔记文字 ' + value);
  }, text);
  await page.mouse.move(point.x, point.y);
}
async function caretAtEnd(text) {
  await body.evaluate((editor, value) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.data.includes(value)) continue;
      editor.focus();
      const range = document.createRange();
      range.setStart(node, node.data.length);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return;
    }
    throw Error('没有找到原行 ' + value);
  }, text);
}
try {
  await page.clock.setFixedTime(new Date('2026-11-26T09:05:00+08:00'));
  await page.goto(origin);
  await nav('帮你记').click();
  await page.getByRole('button', { name: /^(新建|新建笔记)$/ }).first().click();
  await title.fill(noteName);
  await body.focus();
  for (const [index, line] of [...lines, '查一下车站的行李寄存位置'].entries()) {
    if (index) await page.keyboard.press('Enter');
    await page.keyboard.insertText(line);
  }
  for (const [index, line] of lines.entries()) {
    if (index === 0) await hoverLine(line);
    else { await page.mouse.move(0, 0); await caretAtEnd(line); }
    await add.click();
    await page.waitForFunction(value => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1') || '{}').notes?.some(n => n.todos?.some(t => t.text === value)), line);
  }
  const todos = (await notes()).find(n => n.title === noteName).todos;
  assert.deepEqual(todos.map(row => row.dueAt), [
    '2026-11-26T10:00:00.000Z', '2026-11-26T08:00:00.000Z', '2026-11-26T09:05:00.000Z', '2026-11-27T01:00:00.000Z',
  ]);
  const pill = page.locator('.qd-note-time').filter({ hasText: '18:00' }).first();
  await page.mouse.move(0, 0);
  const before = await pill.boundingBox();
  await pill.hover(); await page.waitForTimeout(400);
  const after = await pill.boundingBox();
  assert(after.width > before.width + 12, '指向时间后展开月日');
  assert.match(await pill.textContent(), /11-26/);
  await hoverLine('查一下车站的行李寄存位置');
  await add.waitFor();
  await page.screenshot({ path: path.join(out, 'note-line-actions.png'), animations: 'disabled' });
  await hoverLine(lines[1]);
  await send.click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('新项目名称').fill('关西旅行');
  await modal.getByRole('button', { name: '发送', exact: true }).click();
  await modal.getByRole('button', { name: '继续写笔记' }).click();
  await hoverLine(lines[1]);
  await send.click();
  await modal.getByRole('button', { name: '发送', exact: true }).click();
  await modal.getByRole('button', { name: '查看任务' }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '帮你管' }).waitFor();
  const records = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('quandeck.projects.v1')).projects));
  const project = records.find(p => p.project.name === '关西旅行');
  assert.equal(Object.values(project.tasks).length, 1, '同一行重发没有生成重复任务');
  const task = Object.values(project.tasks)[0];
  assert.equal(task.title, lines[1]);
  assert.match(task.inputs[0].text, /旅行准备/);
  assert.deepEqual(task.sessionIds, [], '发送未立即启动 Agent');
  await nav('首页').click();
  await homeLine(lines[1]).waitFor();
  assert.equal(await schedule.getByRole('checkbox').count(), 3);
  const buttons = await schedule.getByRole('listitem').allTextContents();
  assert.deepEqual(buttons.map(t => lines.find(v => t.includes(v))), [lines[1], lines[2], lines[0]], '按截止时间排序');
  const sidebar = await nav('首页').boundingBox(), agenda = await schedule.boundingBox();
  assert(sidebar.x + sidebar.width <= agenda.x);
  await page.screenshot({ path: path.join(out, 'home-today.png'), animations: 'disabled' });
  await checkboxAtHome(lines[1]).click();
  await schedule.getByRole('checkbox', {name:'重新打开「' + lines[1] + '」'}).waitFor();
  await page.reload();
  await schedule.waitFor();
  assert(await checkboxAtHome(lines[1]).isChecked());
  await homeLine(lines[1]).click();
  const original = page.getByRole('checkbox', { name: '重新打开待办 · ' + lines[1] });
  await original.waitFor(); assert(await original.isChecked());
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-todo-id'));
  await original.click();
  await page.getByRole('checkbox', { name: '完成待办 · ' + lines[1] }).waitFor();
  await nav('首页').click();
  assert(!await checkboxAtHome(lines[1]).isChecked());

  // Completing a todo leaves it on the schedule. Removing that state keeps the note text.
  await checkboxAtHome(lines[1]).click();
  await homeLine(lines[1]).click();
  const originalBody = (await notes()).find(note => note.title === noteName).body;
  const remove = page.getByRole('button', { name: '取消待办', exact:true });
  const capsule = page.getByRole('button', { name: /16:00，查看待办操作/ });
  // Exercise viewport-edge placement with the real trigger and menu. Dock
  // just this row in each corner, leaving the popover's own styles untouched.
  await capsule.evaluate(button => { button.parentElement.dataset.testAnchor = 'true'; });
  for (const x of ['left', 'right']) {
    for (const y of ['top', 'bottom']) {
      const dock = await page.addStyleTag({content:`
        .qd-note-line-tools[data-test-anchor] { position:fixed!important; inset:auto!important;
          ${x}:3px!important; ${y}:3px!important; transform:none!important; z-index:999!important; }
        .qd-note-line-tools[data-test-anchor] > .qd-note-transient-tools {display:none;}
      `});
      await capsule.focus();
      await capsule.press('Enter');
      const panel = page.getByRole('group', {name:'待办操作'});
      await panel.waitFor();
      await page.waitForFunction(() => {
        const menu = document.querySelector('.qd-todo-options:popover-open');
        const box = menu.getBoundingClientRect();
        return box.width && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      },null,{timeout:1300}).catch(() => {throw Error('超出视口边界 ' + x + '/' + y);});
      const box = await remove.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:8});
      assert(await remove.evaluate(el => el.matches(':hover')), x+'/'+y);
      await page.keyboard.press('Escape');
      await panel.waitFor({state:'hidden'});
      await dock.evaluate(el=>el.remove());
    }
  }
  await capsule.evaluate(button => {delete button.parentElement.dataset.testAnchor;});
  await capsule.focus();
  await capsule.press('Enter');
  await remove.waitFor();
  await page.mouse.move(4, 4);
  assert(await remove.isVisible(), '打开后移开鼠标，仍能操作取消待办');
  await page.keyboard.press('Escape');
  await remove.waitFor({ state:'hidden' });
  assert(await capsule.evaluate(el => el === document.activeElement), 'Esc 后焦点回到时间');
  await capsule.click();
  await title.click();
  await remove.waitFor({ state:'hidden' });
  await capsule.click();
  await remove.waitFor();
  const panelBox = await page.getByRole('group', {name:'待办操作'}).boundingBox();
  const timeBox = await capsule.boundingBox();
  assert(Math.abs(panelBox.x - timeBox.x) <= 2 && Math.abs(panelBox.y - timeBox.y - timeBox.height) <= 8,
    '菜单应紧贴所选时间胶囊 ' + JSON.stringify({panelBox,timeBox}));
  await page.screenshot({ path:path.join(out, 'note-remove-todo.png'), animations:'disabled' });
  const removeBox = await remove.boundingBox();
  const x = removeBox.x + removeBox.width / 2, y = removeBox.y + removeBox.height / 2;
  await page.mouse.move(x, y, { steps: 18 });
  assert(await remove.evaluate(el => el.matches(':hover')), '鼠标可以穿过间隙到达取消按钮');
  await page.mouse.down();
  await page.mouse.up();
  await original.waitFor({state:'detached'});
  assert.equal(await body.getByText(lines[1], {exact:true}).count(), 1);
  await nav('首页').click();
  assert.equal(await checkboxAtHome(lines[1]).count(), 0);
  assert.equal(await schedule.getByRole('checkbox').count(), 2);
  await page.reload();
  await nav('帮你记').click();
  const reopened = (await notes()).find(note => note.title === noteName);
  assert.equal(reopened.body, originalBody);
  assert(!reopened.todos.some(todo => todo.id === todos[1].id));
  await hoverLine(lines[1]);
  await add.click();
  await nav('首页').click();
  await checkboxAtHome(lines[1]).waitFor();
  assert(!await checkboxAtHome(lines[1]).isChecked());
  await schedule.getByRole('button', { name: /^2026-11-27/ }).click();
  await homeLine(lines[3]).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(out, 'home-mobile.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('OK: line hover/caret, four local deadlines, expanding date, deferred project task and repeat send, navigation, daily ordering, persistent two-way completion, original line, remove completed todo, persist ordinary text, restore schedule, next day, mobile.');
} catch (error) {
  await page.screenshot({path: path.join(out, 'home-note-failure.png')}).catch(()=>{});
  throw error;
} finally { await browser.close(); }
