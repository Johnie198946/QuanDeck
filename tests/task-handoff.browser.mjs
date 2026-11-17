import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4327';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
const goto = async query => { await page.goto(`${base}/tests/task-handoff.preview.html${query ? `?${query}` : ''}`); await page.locator('[data-case="source"] .qd-task-handoff').waitFor(); };
const open = () => page.locator('[data-case="source"]').getByRole('button', { name: '交给新任务 →', exact: true }).click();
try {
  await goto();
  check('accepted summary is visible without expanding provenance', (await page.locator('[data-case="source"]').innerText()).includes('深蓝 17'));
  check('unstarted successor is waiting instead of already claimed', (await page.locator('.qd-handoff-successors').innerText()).includes('等待执行'));
  await page.locator('[data-case="target"] summary').click();
  check('target displays the fixed source handoff and review', (await page.locator('[data-case="target"]').innerText()).includes('来源验收'));
  await open();
  check('create-only is the default', !await page.getByLabel('创建后立即执行').isChecked());
  check('dialog focuses the task title', await page.getByLabel('新任务名称').evaluate(element => element === document.activeElement));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.matches('[data-case="source"] .qd-handoff-create'));
  check('Escape restores trigger focus', await page.locator('[data-case="source"] .qd-handoff-create').evaluate(element => element === document.activeElement));
  await goto('fault=retry'); await open();
  await page.getByLabel('新任务名称').fill('14D：新的页面开发');
  await page.getByLabel('这一步要完成什么').fill('按照固定的深蓝 17 规范完成页面');
  await page.getByRole('button', { name: '创建交接任务', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '连接暂时中断' }).waitFor();
  check('failed creation preserves the goal', await page.getByLabel('这一步要完成什么').inputValue() === '按照固定的深蓝 17 规范完成页面');
  await page.getByRole('button', { name: '创建交接任务', exact: true }).click();
  await page.locator('output[data-open-task]:not([data-open-task=""])').waitFor();
  check('retry reuses the same idempotency key', await page.evaluate(() => window.handoffCalls.length === 2 && window.handoffCalls[0].idempotencyKey === window.handoffCalls[1].idempotencyKey));
  check('default submission does not execute', await page.evaluate(() => window.handoffCalls.every(call => call.execute === false)));
  await goto(); await open();
  await page.getByLabel('交接到', { exact: true }).selectOption({ label: '14D：已有的开发任务' });
  check('existing target displays its own goal', (await page.locator('.qd-handoff-target').innerText()).includes('原有目标：完成设置页'));
  check('existing target does not expose editable replacement goal', await page.getByLabel('这一步要完成什么').count() === 0);
  await page.getByRole('button', { name: '交接给任务', exact: true }).click();
  await page.locator('output[data-open-task]:not([data-open-task=""])').waitFor();
  check('existing target submits a versioned target reference without replacing goal', await page.evaluate(() => window.handoffCalls.length === 1 && !!window.handoffCalls[0].targetTaskKey && Number.isInteger(window.handoffCalls[0].expectedTargetVersion) && window.handoffCalls[0].goal === undefined));
  await goto('fault=dispatch'); await open(); await page.getByLabel('创建后立即执行').check();
  await page.getByRole('button', { name: '创建并执行', exact: true }).click();
  await page.locator('output[data-open-task]:not([data-open-task=""])').waitFor();
  check('dispatch failure opens the created task instead of offering another creation', await page.getByRole('dialog').count() === 0 && await page.evaluate(() => window.handoffCalls.length === 1 && window.handoffCalls[0].execute));
  for (const state of ['candidate', 'stale']) {
    await goto(`state=${state}`);
    check(`${state} source cannot create a handoff`, await page.locator('[data-case="source"] .qd-handoff-create').count() === 0);
    await page.getByLabel('查任务、结论或 Agent Session ID').fill('21E');
    check(`${state} memory search cannot create a handoff`, await page.locator('.qd-memory-handoff-action').count() === 0);
  }
  await goto();
  await page.getByLabel('查任务、结论或 Agent Session ID').fill('21E');
  check('accepted memory search offers handoff on its matching card', await page.locator('.qd-memory-matches article').getByRole('button', { name: '交给新任务', exact: true }).count() === 1);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await open();
    check(`${width}px dialog fits the viewport`, await page.getByRole('dialog').evaluate(element => { const r = element.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && element.scrollWidth <= element.clientWidth; }));
    if (process.env.SCREENSHOT_PATH && (width === 320 || width === 1440)) await page.screenshot({ path: process.env.SCREENSHOT_PATH.replace(/\.png$/, `-dialog-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    check(`${width}px handoff panel has no horizontal overflow`, await page.locator('[data-case="source"] .qd-task-handoff').evaluate(element => element.scrollWidth <= element.clientWidth));
  }
  check('no JavaScript errors', errors.length === 0);
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) { console.error(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0, 4000) }, null, 2)); throw error; }
finally { await browser.close(); }
