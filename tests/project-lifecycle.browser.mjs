/** Isolated browser storage only; no Agent calls, native deletion or user data. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4294';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/project-lifecycle-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
const name = '生命周期 · 合成验收';
try {
  await page.goto(url);
  await page.getByRole('heading', { name: '先给想做的事一个位置' }).waitFor();
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(name);
  await page.getByRole('textbox', { name: '想完成什么 选填' }).fill('验证独立项目的业务记忆、可选归档和恢复。所有内容均为合成测试。');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  const picker = () => page.getByRole('button', { name: `切换项目：${name}`, exact: true }).filter({ visible: true });
  await picker().click();
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await page.getByRole('button', { name: '项目记忆', exact: true }).click();
  const memory = page.getByRole('dialog', { name: '项目记忆', exact: true });
  await memory.waitFor();
  assert.match(await memory.innerText(), /验证独立项目的业务记忆/);
  assert.match(await memory.innerText(), /为什么做/);
  assert.doesNotMatch(await memory.innerText(), /实报 tokens|事件水位|connection=/);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `page overflow at ${width}`);
    assert.equal(await memory.evaluate(node => node.scrollWidth > node.clientWidth), false, `memory overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `memory-${width}.png`) });
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '项目记忆', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '归档项目', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: `归档“${name}”？` });
  await confirmation.getByRole('button', { name: '归档项目', exact: true }).click();
  await page.getByRole('heading', { name: '先给想做的事一个位置' }).waitFor();
  await page.getByRole('button', { name: '切换项目：尚无项目', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: '已归档项目', exact: true }).click();
  const archive = page.getByRole('dialog', { name: '已归档项目', exact: true });
  await archive.getByText(name, { exact: true }).waitFor();
  await archive.getByRole('button', { name: '恢复项目', exact: true }).click();
  await archive.getByText('没有归档项目', { exact: true }).waitFor();
  await archive.getByRole('button', { name: '关闭', exact: true }).click();
  await picker().click();
  await page.getByRole('button', { name: `删除项目 ${name}`, exact: true }).click();
  // A browser cannot silently fall back to the former soft-delete endpoint.
  await page.getByText('请在更新后的桌面版中删除项目', { exact: true }).waitFor();
  assert.equal(await picker().count(), 1);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ emptyStartup: true, memory: true, widths: [320,768,1024,1440], focusRestored: true, archiveRestore: true, browserCannotSoftDelete: true, nativeDeletionTested: false, errors }, null, 2));
  console.log('project lifecycle UI: empty startup, memory, 4 widths, focus, archive/restore and native-only delete boundary passed');
} finally { await browser.close(); }
