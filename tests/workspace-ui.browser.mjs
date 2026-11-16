/** Isolated UI regression: no real workspace, connection, or model request. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/workspace-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4188');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称').fill('测试旅行项目');
  await page.getByLabel('想完成什么').fill('隔离验证：任务输入、持久化和响应式布局');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('button', { name: '新任务', exact: true }).first().click();
  await page.getByPlaceholder('输入任务标题').fill('双城旅行攻略');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByLabel('补充要求或记录进展').fill('双人旅行，预算2万元，优先小众体验。');
  await page.getByRole('button', { name: '保存到任务', exact: true }).click();
  await page.getByText('已保存，下次派发时交给 Agent').waitFor();
  await page.getByRole('button', { name: '查看全部 ↗', exact: true }).click();
  await page.getByRole('dialog', { name: '已保存的补充' }).getByText('双人旅行，预算2万元，优先小众体验。', { exact: true }).waitFor();
  await page.getByRole('dialog', { name: '已保存的补充' }).getByRole('button', { name: '关闭', exact: true }).click();
  const longNote = '已确认：双人旅行，优先小众体验。\n\n' + '补充细节与参考资料应完整保留，但不占满任务主页面。\n'.repeat(100);
  await page.getByLabel('补充要求或记录进展').fill(longNote);
  await page.getByRole('button', { name: '保存到任务', exact: true }).click();
  await page.getByText('已保存 2 条补充').waitFor();
  assert.ok(await page.locator('.qd-task-input-history p').evaluate(node => node.getBoundingClientRect().height) < 50, 'long notes stay at two lines');
  await page.getByRole('button', { name: '查看全部 ↗', exact: true }).click();
  const reader = page.getByRole('dialog', { name: '已保存的补充' });
  assert.ok((await reader.innerText()).includes('补充细节与参考资料应完整保留'), 'full note is retained');
  await page.screenshot({ path: path.join(output, 'saved-input-reader.png') });
  await reader.press('Escape');
  await reader.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '查看全部 ↗', exact: true }).evaluate(node => node === document.activeElement), true, 'reader restores focus');
  for (const width of [1440, 1024, 768, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, `workspace-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
  }
  await page.reload();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '任务', exact: true }).click();
  await page.getByText('已保存 2 条补充').waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ manualTask: true, persistedInput: true, responsive: [1440, 1024, 768, 320], errors }));
} finally { await browser.close(); }
