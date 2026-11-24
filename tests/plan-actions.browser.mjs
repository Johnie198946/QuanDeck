import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4316';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
const goto = async status => { await page.goto(`${base}/tests/direction-reading.preview.html?automation=${status}`); await page.getByLabel('切换正文版本').waitFor(); };
const openedExpectedSource = () => page.evaluate(() => {
  const calls = window.directionCommands.filter(command => command.kind === 'open-source');
  const expected = window.expectedRecoverySource;
  return calls.length === 1 && calls[0].input.sessionId === expected.sessionId &&
    calls[0].input.connectionId === expected.connectionId && calls[0].input.tool === expected.tool;
});
try {
  await goto('outdated');
  check('outdated authorization never starts another run on its own', await page.locator('.qd-plan-actions').getByRole('button', { name: /重新开启自动执行|开始自动执行/ }).count() === 0);
  check('loading an outdated plan preserves authorization records', await page.evaluate(() => !window.directionCommands.some(command => command.kind === 'configure')));
  check('outdated state does not claim active execution', (await page.locator('.qd-plan-actions').innerText()).includes('执行版本待更新'));
  for (const [status, label] of [['paused', '处理并恢复'], ['blocked', '查看等待条件']]) {
    await goto(status);
    check(`${status} does not expose repeat dispatch`, await page.locator('.qd-plan-actions').getByRole('button', { name: /开启自动执行|开始自动执行|确认方向并自动执行/ }).count() === 0);
    await page.getByRole('button', { name: label, exact: true }).click();
    check(`${status} opens the bound execution source exactly once`, await openedExpectedSource());
    check(`${status} does not rewrite automation authorization`, await page.evaluate(() => !window.directionCommands.some(command => command.kind === 'configure')));
  }
  await goto('off');
  check('explicitly stopped automation has no implicit resume', await page.getByRole('button', { name: '恢复自动推进', exact: true }).count() === 0);
  await goto('ready');
  check('ready state describes waiting for automatic progression', (await page.locator('.qd-plan-actions').innerText()).includes('等待自动推进'));
  check('ready state has no duplicate start button', await page.locator('.qd-plan-actions').getByRole('button', { name: /开始自动执行|恢复自动推进|重新开启/ }).count() === 0);
  await goto('paused-tasks');
  await page.getByRole('button', { name: '处理并恢复', exact: true }).click();
  check('recovery prioritizes the permission-waiting session over blocked dependents', await openedExpectedSource());
  check('task recovery does not duplicate dispatch', await page.evaluate(() => !window.directionCommands.some(command => command.kind === 'configure')));
  check('no page errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} finally { await browser.close(); }
