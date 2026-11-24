/** Isolated Chrome profile/storage; production commands create all fixture receipts. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/delivery-map/ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const titles = { airport: '凌晨抵达 · 路线与地图', photos: '街巷与海岸 · 图文片段', hotels: '住宿 · 等你确定', packing: '出发清单' };
const chapter = id => page.locator('.qd-map-index button[data-delivery-slot]').filter({ hasText: titles[id] });
try {
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4228');
  await page.evaluate(async () => {
    const { createDeliveryFixture } = await import('/tests/delivery-map.fixture.ts');
    const result = await createDeliveryFixture();
    window.deliveryFixture = { planId: result.planId, leaf: result.binding('airport') };
  });
  await page.reload();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '成果', exact: true }).click();
  await page.getByRole('heading', { name: '项目成果地图', exact: true }).waitFor();
  await page.getByRole('heading', { name: '1 / 4 件必需成果已验收' }).waitFor();
  const stored = await page.evaluate(() => localStorage.getItem('quandeck.projects.v1'));
  await page.evaluate(() => {
    window.mapExpansionAnimations = 0;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) { if (this.classList.contains('qd-delivery-map')) window.mapExpansionAnimations++; return original.apply(this, args); };
  });
  const states = await page.locator('.qd-map-index button[data-delivery-slot]').evaluateAll(nodes => nodes.map(node => node.dataset.state));
  assert.deepEqual(states, ['candidate', 'accepted', 'empty', 'changes_requested']);
  assert.equal(await page.getByRole('navigation',{name:'交付全貌'}).count(),0,'each deliverable has one navigation entry');
  const firstView=await page.locator('.qd-map-reader').boundingBox();
  const provenance=await page.getByRole('region',{name:'项目规范与任务来源'}).boundingBox();
  assert(firstView && provenance && firstView.y < provenance.y && firstView.y < 550,
    'the result reader precedes project settings and is reachable on the first screen');
  assert.equal(await page.getByRole('button', { name: '查看任务与执行', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /合并|整合为完整成果|重新拼接/ }).count(), 0);
  await chapter('hotels').click();
  await page.getByRole('heading', { name: '住宿 · 等你确定，这里先留白', exact: true }).waitFor();
  assert.equal(await page.locator('.qd-map-reader .qd-delivery-document').count(), 0, 'empty slot contains no fake document');
  await page.screenshot({ path: path.join(output, 'empty-slot-1440.png') });
  await chapter('packing').click();
  await page.getByText('成果已退回，需要修改', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '待修改的原稿', exact: true }).waitFor();
  await chapter('airport').focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '凌晨抵达，先到酒店休息', exact: true }).waitFor();
  for (const width of [320, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1100 }); await page.waitForTimeout(550);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    assert.equal(await page.locator('.qd-map-reader').evaluate(node => node.getBoundingClientRect().width > 200), true);
    await page.screenshot({ path: path.join(output, `map-${width}.png`), fullPage: true });
  }
  assert(await page.evaluate(() => window.mapExpansionAnimations > 0), 'expanding the window triggers the settling animation');
  assert.equal(await page.getByRole('button', { name: /旧版路线记录/ }).count(), 0, 'unmapped task history does not appear in project final outputs');
  assert.equal(await page.evaluate(() => localStorage.getItem('quandeck.projects.v1')), stored, 'reading/selecting/resizing never changes truth');
  await page.getByRole('button', { name: '任务成果地图', exact: true }).click();
  await page.getByRole('region', { name: '任务成果汇总' }).waitFor();
  assert.equal(await page.locator('.qd-map-index button[data-delivery-slot]').count(), 1, 'subtask summary directly scopes to its own map');
  assert.equal(await chapter('airport').count(), 1);
  await page.setViewportSize({ width: 320, height: 1100 }); await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'subtask summary fits 320');
  await page.screenshot({ path: path.join(output, 'subtask-320.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animationCount = await page.evaluate(() => window.mapExpansionAnimations);
  await page.setViewportSize({ width: 1920, height: 1100 }); await page.waitForTimeout(550);
  assert.equal(await page.evaluate(() => window.mapExpansionAnimations), animationCount, 'reduced motion suppresses the window expansion animation');
  assert.deepEqual(errors, []);
  const checks = { widths: [320, 768, 1024, 1440, 1920], states, emptySlot: true, retainedReturnedText: true, projectFinalScope: true, directTaskScope: true, noManualMerge: true, keyboardSelection: true, noTruthMutation: true, expansionAnimation: true, reducedMotion: true, errors };
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(checks, null, 2)); console.log(JSON.stringify(checks));
} finally { await browser.close(); }
