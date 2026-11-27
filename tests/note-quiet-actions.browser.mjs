import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4392';
try {
  const page = await browser.newPage({ viewport: { width: 1260, height: 800 } });
  const errors = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const at = '2026-11-26T03:00:00.000Z';
    const body = '核对活动场地\n\n准备观众提问\n\n与讲者确认时间';
    localStorage.setItem('quandeck.personal-knowledge.v1', JSON.stringify({ schema: 1, decisions: [], notes: [{
      id: 'quiet-sample', title: '展览准备', body, createdAt: at, updatedAt: at, revision: 1, attachments: [], history: [], expansions: [],
      todos: [{ id: 'todo-1', text:'核对活动场地', lineIndex: 0, createdAt: at, dueAt: at }],
    }]}));
  });
  await page.goto(origin);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name:'帮你记', exact:true }).click();
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  const add = page.getByRole('button', { name: '将此行设为待办' });
  const send = page.getByRole('button', { name: '发送此行到帮你管' });
  const line = editor.getByText('准备观众提问', { exact: true });
  const existing = page.getByRole('checkbox', { name: /核对活动场地/ });

  async function hidden() {
    assert.equal(await send.count(), 0);
    assert.equal(await add.count(), 0);
    assert(await existing.isVisible(), 'existing todo remains usable while editing');
    assert(await page.locator('.qd-note-time').first().isVisible());
  }
  await line.hover();
  const box = await line.boundingBox();
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + 8 + i * 4, box.y + box.height / 2);
    await page.waitForTimeout(140);
    await hidden();
  }
  await send.waitFor();
  assert.equal(await send.count(), 1);
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await hidden();
  await add.waitFor();
  await page.mouse.move(4, 4);
  await page.waitForTimeout(1000);
  await hidden();

  async function caret(offset) {
    await editor.evaluate((root, offset) => {
      const node = root.lastElementChild.firstChild;
      root.focus();
      const range = new Range();
      range.setStart(node, offset === -1 ? node.length : offset);
      range.collapse(true);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    }, offset);
  }
  await caret(2);
  await page.waitForTimeout(1050);
  await hidden();
  await caret(-1);
  await add.waitFor();
  for (const text of ['和', '地', '点']) {
    await page.keyboard.insertText(text);
    await page.waitForTimeout(210);
    await hidden();
  }
  // The platform may spend several seconds composing a single Chinese character.
  await editor.dispatchEvent('compositionstart');
  await editor.dispatchEvent('compositionupdate', {data:'qu'});
  await page.waitForTimeout(1050);
  await hidden();
  await editor.dispatchEvent('compositionend', {data:'确'});
  await hidden();
  await send.waitFor();
  // Tab past the existing todo into the transient buttons, then use Enter.
  for (let i = 0; i < 5 && !await add.evaluate(button => button === document.activeElement); i++) await page.keyboard.press('Tab');
  assert(await add.evaluate(button => button === document.activeElement), 'keyboard reaches row actions');
  await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: /与讲者确认时间和地点/ }).waitFor();
  assert.equal(await page.getByRole('checkbox').count(), 2);
  await line.hover();
  await send.waitFor();
  const target = await send.boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps: 15});
  await page.mouse.down();
  await page.mouse.up();
  await page.getByRole('dialog', {name:'发送到帮你管'}).waitFor();
  await page.keyboard.press('Escape');
  const measurements = [];
  const samples = [
    { name: '普通正文', width: 1260, zoom: 1, text: '傍晚到东门集合' },
    { name: '窄屏换行', width: 390, zoom: 1, text: '京都和大阪的行程需要一起安排，先确定车站与住宿，再确认集合时间。'.repeat(3) },
    { name: '放大正文', width: 1260, zoom: 1.25, text: '周六下午去看新展览' },
  ];
  for (const { name, width, zoom, text } of samples) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, zoom);
    await editor.fill(text);
    await editor.evaluate(el => {
      const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = new Range();
      range.setStart(text, text.length); range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await add.waitFor();
    const geometry = await editor.evaluate(el => {
      const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = new Range(); range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      const tail = rects.at(-1);
      range.setStart(node,0); range.setEnd(node,2);
      const twoGlyphs = range.getBoundingClientRect().width;
      const add = document.querySelector('[aria-label="将此行设为待办"]').getBoundingClientRect();
      const plane = document.querySelector('.qd-note-transient-tools [aria-label="发送此行到帮你管"]').getBoundingClientRect();
      return { gap: add.left - tail.right, twoGlyphs, rows: rects.length,
        shiftY: Math.abs((tail.top + tail.bottom - add.top - add.bottom) / 2),
        planeRight: plane.right, editorRight: el.getBoundingClientRect().right };
    });
    assert(Math.abs(geometry.gap - geometry.twoGlyphs) < 1.5, name + JSON.stringify(geometry));
    assert(geometry.shiftY < 2, '工具须在最后一行' + JSON.stringify(geometry));
    assert(geometry.planeRight <= geometry.editorRight + 1, '纸飞机不能溢出编辑器');
    if (width === 390) assert(geometry.rows > 1);
    measurements.push({ name, ...geometry });
    if (name === '普通正文' && process.env.QUANDECK_UI_OUTPUT) {
      await mkdir(process.env.QUANDECK_UI_OUTPUT, {recursive:true});
      await page.locator('.qd-writer-sheet').screenshot({path:path.join(process.env.QUANDECK_UI_OUTPUT, 'line-action-spacing.png')});
    }
  }
  if (process.env.QUANDECK_UI_OUTPUT) {
    await writeFile(path.join(process.env.QUANDECK_UI_OUTPUT, 'line-action-spacing.json'), JSON.stringify(measurements,null,2)+'\n');
  }
  console.log(measurements);
  assert.deepEqual(errors, []);
  console.log('Passed quiet row actions: moving, typing and IME hide controls, idle shows one pair, persistent todo, keyboard conversion and paper-plane activation.');
} finally { await browser.close(); }
