import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/notes-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
const box = page.getByRole('textbox', { name: '笔记正文' });
const heading = page.getByRole('textbox', { name: '笔记标题' });
const list = page.getByRole('complementary', { name: '笔记列表' });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1') || '{}').notes || []);
const noteButton = title => list.getByRole('button', { name: new RegExp(title) });

try {
  await page.addInitScript(() => {
    const key = 'quandeck.personal-knowledge.v1';
    if (localStorage.getItem(key)) return;
    const at = '2026-10-14T07:00:00.000Z';
    localStorage.setItem(key, JSON.stringify({ schema: 1, decisions: [], notes: [
      { id: 'old-note', title: '旧笔记', body: '旧正文', archivedAt: at, createdAt: at, updatedAt: at, revision: 2, attachments: [], expansions: [], history: [{ revision: 1, title: '旧笔记', body: '前一行', at }] },
      { id: 'remote-note', title: '旧图引用', body: '参照图\n\n![示意](https://example.test/sample.png)', createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [] },
    ] }));
  });
  await page.clock.install();
  await page.goto(origin);
  await nav('帮你记').click();
  await noteButton('旧笔记').waitFor();
  assert.equal(await box.textContent(), '旧正文');
  assert.equal(await page.getByRole('button', { name: /归档|笔记选项|^保存$/ }).count(), 0);
  await page.getByText('改动记录', { exact: true }).click();
  await page.getByRole('cell', { name: '前一行', exact: true }).waitFor();
  await noteButton('旧图引用').click();
  await box.getByText('外部图片 · 示意', { exact: true }).waitFor();
  await box.focus();
  await box.evaluate(node => {
    const range = document.createRange();
    range.setStart(node.querySelector('p').firstChild, 0);
    range.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.keyboard.insertText('看一下');
  await noteButton('旧笔记').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.find(note => note.id === 'remote-note')?.body.includes('看一下'));
  assert.match((await saved()).find(note => note.id === 'remote-note').body, /!\[示意\]\(<https:\/\/example\.test\/sample\.png>\)/);

  await page.getByRole('button', { name: '新建', exact: true }).click();
  await heading.fill('天文观测装备');
  await box.fill('检查电池和目镜');
  await heading.focus();
  assert.equal(await box.textContent(), '检查电池和目镜');
  await box.focus();
  await page.clock.fastForward(28_500);
  assert.equal((await saved()).some(note => note.title === '天文观测装备'), false);
  await page.clock.fastForward(1_500);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.some(note => note.title === '天文观测装备'));
  assert.equal((await saved()).find(note => note.title === '天文观测装备').body, '检查电池和目镜');

  await box.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  assert.equal(await box.locator('b,strong').textContent(), '检查电池和目镜');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await box.locator('b,strong').count(), 0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await box.locator('b,strong').textContent(), '检查电池和目镜');

  await box.evaluate(async node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    await new Promise(requestAnimationFrame);
    const canvas = document.createElement('canvas');
    canvas.width = 150; canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#edf6ff'; ctx.fillRect(0, 0, 150, 90);
    ctx.fillStyle = '#22548a'; ctx.fillText('VIEWFINDER', 15, 30); ctx.strokeRect(12, 40, 126, 30);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], '观测截图.png', { type: 'image/png' }));
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('.qd-writer-content img')?.naturalWidth === 150);
  assert.equal(await page.getByRole('region', { name: '附件' }).count(), 0);
  await noteButton('旧笔记').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.find(note => note.title === '天文观测装备')?.attachments.length === 1);
  await noteButton('天文观测装备').click();
  await page.waitForFunction(() => document.querySelector('.qd-writer-content img')?.naturalWidth === 150);
  assert.equal(await box.locator('b,strong').textContent(), '检查电池和目镜');
  const published = (await saved()).find(note => note.title === '天文观测装备');
  assert.match(published.body, new RegExp('attachment:' + published.attachments[0].id));
  assert.equal(published.history.length, 0);
  await page.screenshot({ path: path.join(output, 'notes-editor.png'), animations: 'disabled' });

  await page.evaluate(() => {
    window.quandeckDesktop = {
      platform: 'darwin',
      readKnowledge: async () => localStorage.getItem('quandeck.personal-knowledge.v1'),
      shareKnowledgeNote: async input => { window.sharedNote = input; return true; },
    };
  });
  await page.getByRole('button', { name: '分享笔记' }).click();
  await page.waitForFunction(() => window.sharedNote);
  const shared = await page.evaluate(() => window.sharedNote);
  assert.equal(shared.noteId, published.id);
  assert.match(shared.text, /检查电池和目镜.*图片/s);
  assert.doesNotMatch(shared.text, /attachment:|blob:/);

  await page.reload();
  await nav('帮你记').click();
  await noteButton('天文观测装备').click();
  await page.waitForFunction(() => document.querySelector('.qd-writer-content img')?.naturalWidth === 150);

  await noteButton('旧笔记').click();
  await box.fill('更新后的文字');
  await nav('首页').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.find(note => note.id === 'old-note')?.body === '更新后的文字');
  await nav('帮你记').click();
  await noteButton('旧笔记').click();
  await page.getByText('改动记录', { exact: true }).click();
  await page.getByRole('cell', { name: '更新后的文字', exact: true }).waitFor();
  await box.fill('');
  await noteButton('天文观测装备').click();
  await noteButton('旧笔记').click();
  await page.getByText('改动记录', { exact: true }).click();
  await page.getByRole('cell', { name: '删除', exact: true }).waitFor();

  const second = await context.newPage();
  const other = second.getByRole('textbox', { name: '笔记正文' });
  await second.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await second.goto(origin);
  await second.getByRole('button', { name: '帮你记', exact: true }).click();
  await second.getByRole('complementary', { name: '笔记列表' }).getByRole('button', { name: /旧笔记/ }).click();
  await other.fill('另一窗口草稿');
  await box.fill('本窗口先保存');
  await nav('首页').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.find(note => note.id === 'old-note')?.body === '本窗口先保存');
  await second.getByRole('button', { name: '首页', exact: true }).click();
  await second.reload();
  await second.getByRole('button', { name: '帮你记', exact: true }).click();
  await second.getByRole('complementary', { name: '笔记列表' }).getByRole('button', { name: /旧笔记/ }).click();
  assert.equal(await other.textContent(), '另一窗口草稿');
  assert.equal((await saved()).find(note => note.id === 'old-note').body, '本窗口先保存');
  await second.close();
  await nav('帮你记').click();
  await page.setViewportSize({ width: 360, height: 820 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('Note editor: idle save, tab/focus retention, draft navigation, legacy archive access, preservation of external picture reference, rich formatting and undo/redo, inline photo across reload, share payload, exact change log, concurrent draft recovery and narrow layout passed');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'notes-failed.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally { await browser.close(); }
