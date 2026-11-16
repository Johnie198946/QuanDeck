/** Isolated local-file renderer + real preview service. No user data or source Agent. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAttachmentPreview } from '../desktop/app/attachment-preview.mjs';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/inline-attachment';
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4271';
await mkdir(output, { recursive: true });
const base = await mkdtemp(path.join(os.tmpdir(), 'quandeck-inline-attachment-'));
const root = path.join(base, '示例项目'), directory = path.join(root, '图文资料');
await mkdir(directory, { recursive: true });
const files = { spec: path.join(directory, '设计说明.md'), check: path.join(directory, '验收记录.txt'), image: path.join(directory, '小窗 截图.png'), literal: path.join(directory, '完成%20记录.txt') };
await writeFile(files.spec, '# 设计说明\n\n这是隔离的附件阅读样本。');
await writeFile(files.check, '验收记录：附件保留在原句中。');
await writeFile(files.literal, '文件名中的百分号保留。');
const browser = await chromium.launch({ headless: true, ...(process.env.QUANDECK_BROWSER_EXECUTABLE ? { executablePath: process.env.QUANDECK_BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [], revealed = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.setContent('<main style="width:320px;height:180px;background:#f7f6f2;color:#263e37;padding:24px;font:18px sans-serif;box-sizing:border-box"><b>布局验收示例</b><div style="display:flex;gap:12px;margin-top:20px"><div style="background:#dce6df;width:170px;height:80px"></div><div style="background:#e8d9ce;width:70px;height:80px"></div></div></main>');
  await page.locator('main').screenshot({ path: files.image });
  const service = createAttachmentPreview({ readRun: run => { assert.equal(run, 'attachment-fixture'); return { projectPath: root }; } });
  await page.exposeFunction('__previewLocal', async (run, file) => { requests.push(file); const value = await service.preview(run, file); return 'bytes' in value ? { ...value, bytes: Array.from(value.bytes) } : value; });
  await page.exposeFunction('__revealLocal', async (run, file) => { revealed.push(await service.resolve(run, file)); });
  const markdown = `设计资料：[**设计说明**](${encodeURI(files.spec)})、[验收记录](${encodeURI(files.check)})，以及[百分号文件](${pathToFileURL(files.literal).href})。\n\n页面截图：[小窗截图](${encodeURI(files.image)})、[文件链接截图](${pathToFileURL(files.image).href})。\n\n[危险链接](javascript:alert(1)) [远程文件](file://remote.invalid/secret.png)`;
  const initial = { runId: 'attachment-fixture', sessionId: 'fixture-session', title: '附件阅读验收', purpose: 'execution', tool: 'codex', projectPath: root, status: 'paused', controls: { canReply: false, canResume: false }, events: [{ id: 'reply', at: '2026-11-17T00:00:00Z', message: { id: 'reply', role: 'assistant', text: markdown } }] };
  await page.addInitScript(initial => {
    window.quandeckDesktop = { platform: 'darwin', bootstrap: async () => ({}), getConnection: async () => ({ baseUrl: 'http://127.0.0.1:1', token: 'isolated-fixture' }), onStorageError: () => () => {}, onRunEvent: () => () => {}, getRun: async () => initial, previewRunAttachment: (run, file) => window.__previewLocal(run, file), revealRunAttachment: (run, file) => window.__revealLocal(run, file) };
  }, initial);
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  await page.goto(origin + '/?run=attachment-fixture');
  await page.getByRole('button', { name: '预览附件：设计说明', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.qd-inline-attachment img')].length === 2 && [...document.querySelectorAll('.qd-inline-attachment img')].every(image => image.complete && image.naturalWidth > 0));
  assert.equal(requests.length, 2, 'only visible local images load automatically; documents wait for a click');
  assert.ok(requests.every(value => value.includes('%E5') && value.endsWith('.png')), 'percent-encoded Chinese paths reach the real preview service');
  assert.equal(await page.locator('a[href^="javascript:"],a[href^="file:"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: '预览附件：远程文件' }).count(), 0);
  const paragraph = page.locator('.qd-markdown-paragraph').filter({ hasText: /^设计资料：/ });
  assert.equal(await paragraph.locator('section.qd-attachment').count(), 0, 'no block cards inside the sentence');
  const boxes = await paragraph.locator('.qd-inline-attachment>button').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { y: box.y, height: box.height }; }));
  assert.equal(boxes.length, 3); assert.ok(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y)) < 3, 'document links stay on one compact line');
  assert.ok((await paragraph.boundingBox()).height < 70, 'punctuation is not split into tall attachment blocks');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, `inline-attachments-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}`);
  }
  await page.getByRole('button', { name: '预览附件：小窗截图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '附件：小窗截图' });
  await dialog.locator('.qd-attachment-image').waitFor();
  await page.waitForFunction(() => document.querySelector('dialog .qd-attachment-image')?.naturalWidth > 0);
  await dialog.getByRole('button', { name: '在文件夹中查看' }).click();
  assert.equal(revealed.at(-1).name, '小窗 截图.png');
  await page.screenshot({ path: path.join(output, 'image-preview-390.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth > document.querySelector('dialog').clientWidth), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: '预览附件：小窗截图', exact: true }).evaluate(element => element === document.activeElement), true, 'keyboard focus returns to the originating link');
  await page.getByRole('button', { name: '预览附件：百分号文件', exact: true }).click();
  await page.getByRole('dialog').getByText('文件名中的百分号保留。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  assert.deepEqual(errors, []);
  const result = { ok: true, realLocalPreviewService: true, unicodeMarkdownAndFileUrls: true, literalPercentFile: true, compactInlinePunctuation: true, visibleImageThumbnails: 2, responsiveWidths: [1440, 390], imagePreviewAndReveal: true, escapeAndFocusReturn: true, blockedRemoteFile: true, consoleErrors: errors };
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  await writeFile(path.join(output, 'failure.txt'), JSON.stringify({ errors, body: await page.locator('body').innerText() }, null, 2));
  throw error;
} finally { await browser.close(); await rm(base, { recursive: true, force: true }); }
