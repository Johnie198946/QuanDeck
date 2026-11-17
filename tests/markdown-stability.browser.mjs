/** Production renderer, isolated host stub. No source Agent or user database. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4317';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/markdown-stability';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QUANDECK_BROWSER_EXECUTABLE ? { executablePath: process.env.QUANDECK_BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
await page.addInitScript(() => {
  window.previewCalls = [];
  window.quandeckDesktop = {
    platform: 'darwin',
    previewRunAttachment: async (run, file) => {
      window.previewCalls.push({ run, file });
      return { kind: 'html', name: file, html: `<html><body><h1>${file}</h1>${Array.from({ length: 18 }, (_, index) => `<section style="min-height:120px"><h2>攻略章节 ${index + 1}</h2><p>隔离图文攻略正文。后台进展更新时，当前阅读位置应保持不变。</p></section>`).join('')}<p>页尾</p></body></html>`, size: 2048 };
    },
  };
});
const refresh = async detail => {
  const before = await page.getByRole('status', { name: '快照版本' }).textContent();
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('preview-snapshot', { detail })), detail);
  await page.waitForFunction(before => document.querySelector('output').textContent !== before, before);
};
try {
  await page.goto(origin + '/tests/markdown-stability.preview.html');
  const trigger = page.getByRole('button', { name: '预览附件：图文攻略', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '附件：图文攻略' });
  const iframe = dialog.locator('iframe.qd-html-document');
  await iframe.waitFor();
  const initialDialog = await dialog.elementHandle(), initialFrame = await iframe.elementHandle();
  const frame = await initialFrame.contentFrame();
  await frame.getByRole('heading', { name: 'guide-a.html' }).waitFor();
  await frame.evaluate(() => { window.previewReadingMarker = 'kept'; window.scrollTo(0, 350); });
  const scrollY = await frame.evaluate(() => window.scrollY);
  assert.ok(scrollY > 0);
  for (let index = 0; index < 8; index++) await refresh({});
  await refresh({ suffix: '任务最新回执已更新。' });
  assert.equal(await initialDialog.evaluate(element => element === document.querySelector('dialog') && element.open), true, 'same dialog remains open across snapshot updates');
  assert.equal(await initialFrame.evaluate(element => element === document.querySelector('dialog iframe')), true, 'iframe is not recreated');
  assert.equal(await frame.evaluate(() => window.previewReadingMarker), 'kept', 'iframe document survives');
  assert.equal(await frame.evaluate(() => window.scrollY), scrollY, 'reading position survives');
  assert.equal(await page.evaluate(() => window.previewCalls.length), 1, 'same attachment is not repeatedly read');
  await page.screenshot({ path: path.join(output, 'preview-stable-1440.png'), fullPage: true });

  await refresh({ file: 'guide-b.html' });
  assert.equal(await page.getByRole('dialog').count(), 0, 'a different file does not inherit the old open preview');
  await trigger.click();
  await page.frameLocator('iframe.qd-html-document').getByRole('heading', { name: 'guide-b.html' }).waitFor();
  await refresh({ run: 'run-b' });
  assert.equal(await page.getByRole('dialog').count(), 0, 'a different source run resets attachment access');
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await page.frameLocator('iframe.qd-html-document').getByRole('heading', { name: 'guide-b.html' }).waitFor();
  for (let index = 0; index < 4; index++) await refresh({});
  assert.equal(await dialog.count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth > document.querySelector('dialog').clientWidth), false);
  await page.screenshot({ path: path.join(output, 'preview-stable-390.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => window.previewCalls), [{ run: 'run-a', file: 'guide-a.html' }, { run: 'run-a', file: 'guide-b.html' }, { run: 'run-b', file: 'guide-b.html' }]);
  assert.deepEqual(errors, []);
  const result = { ok: true, snapshotRefreshes: 13, sameDialogAndIframe: true, readingPositionPreserved: true, noRepeatedReads: true, fileAndRunReset: true, widths: [1440, 390], escapeFocusReturn: true, pageErrors: errors };
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
