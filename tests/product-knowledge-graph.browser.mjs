import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/knowledge-graph-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const external = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
await page.addInitScript(() => {
  const at = '2026-11-24T10:00:00Z';
  const note = (id, title, body, extra = {}) => ({
    id, title, body, createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [], ...extra,
  });
  const notes = [
    note('route', '京都赏枫路线', '京都赏枫路线，先订两晚酒店。\n预算：3000 元\nhttps://example.test/route'),
    note('backup', '京都赏枫路线备选', '京都赏枫路线，需要两晚住宿。\n预算：5000 元\nhttps://example.test/route'),
    note('museum', '京都赏枫路线 · 博物馆', '京都赏枫路线的景点清单。'),
    note('river', '河岸鸟类观测', '西岸的候鸟记录。', { archivedAt: at }),
    note('blank', '暂存标题', ''),
    note('expansion', '近郊散步', '本篇只写了时间。', {
      expansions: [{ id: 'ref', at, selection: { quote: '时间', before: '', after: '', offset: 0 }, question: '路线是什么？', answer: '京都赏枫路线和寺院', sourceIds: ['fixture'] }],
    }),
    note('attachment', '出生证明附件', '', { attachments: [{ id: 'mock-image', name: '无敏感内容的示例.png', type: 'image/png', size: 1 }] }),
  ];
  localStorage.setItem('quandeck.personal-knowledge.v1', JSON.stringify({ schema: 1, notes, decisions: [] }));
});
const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
const node = id => page.locator(`.qd-library-node[data-note-id="${id}"]`);
try {
  await page.goto(origin);
  await nav('帮你想').click();
  await page.getByRole('heading', { name: '知识图谱' }).waitFor();
  await page.getByText('7 篇笔记', { exact: false }).waitFor();
  await node('river').waitFor();
  await node('blank').waitFor();
  await node('attachment').waitFor();
  assert.equal(await page.locator('.qd-library-node').count(), 7);
  assert.match(await node('river').textContent(), /暂无连线/);
  assert.doesNotMatch(await node('expansion').textContent(), /暂无连线/);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.qd-library-wires');
    const ctx = canvas?.getContext('2d');
    return ctx && ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((alpha, i) => i % 4 === 3 && alpha > 0);
  });
  await page.screenshot({ path: path.join(output, 'knowledge-graph-overview.png'), animations: 'disabled' });
  await page.getByText('连线怎么来的？', { exact: true }).click();
  await page.getByText(/无需调用大模型/).waitFor();
  await page.getByText('连线怎么来的？', { exact: true }).click();
  await node('route').press('Enter');
  await page.getByRole('heading', { name: '两处「预算」数值不同' }).waitFor();
  await page.getByText('预算：5000 元', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'knowledge-graph-evidence.png'), animations: 'disabled' });
  const areas = await Promise.all([node('route').boundingBox(), node('backup').boundingBox(), node('museum').boundingBox()]);
  assert.notEqual(new Set(areas.map(item => item?.y)).size, 1, 'connected notes are not all in the same row');
  await page.getByRole('button', { name: '忽略', exact: true }).click();
  await page.getByText('已忽略这条发现。').waitFor();
  assert.equal(await page.getByRole('heading', { name: '两处「预算」数值不同' }).count(), 0);
  await page.getByRole('checkbox', { name: '显示已忽略' }).check();
  await page.getByRole('heading', { name: '两处「预算」数值不同' }).waitFor();
  await page.getByRole('button', { name: '重新保留' }).click();
  await page.getByText('已保留这条关联。').waitFor();
  await page.getByRole('searchbox', { name: '查找图中笔记' }).fill('候'); // Body text does not alter title filtering.
  await page.getByText('没有匹配标题的笔记。').waitFor();
  await page.getByRole('searchbox', { name: '查找图中笔记' }).fill('河岸');
  await node('river').waitFor();
  assert.equal(await page.locator('.qd-library-node').count(), 1);
  await page.getByRole('button', { name: '查看全部笔记' }).click();
  await node('backup').waitFor();
  for (const width of [1024, 768, 320]) {
    await page.setViewportSize({ width, height: 820 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.evaluate(() => { document.body.style.zoom = '1.15'; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'knowledge-graph-mobile.png'), animations: 'disabled' });
  await node('backup').click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '笔记与连线详情');
  await page.getByRole('heading', { name: '京都赏枫路线备选', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'graph calculation did not make a network request');
  console.log('All seven notes represented; expansion linkage, former archive, drawn edges, keyboard, evidence, dismiss/restore, filtering and 320px verified');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'knowledge-graph-failed.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
