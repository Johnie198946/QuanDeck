/** Isolated results and passive-HTML regression; no user database or Agent is used. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/results-immersive/ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], network = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:') && !/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//.test(request.url())) network.push(request.url()); });
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const html = `<!doctype html><html><head><title>旅行图文</title><style>body{font:16px/1.7 sans-serif;background:#f6f3ed;color:#183e34;padding:32px}main{max-width:1100px;margin:auto}h1{font-size:40px}.hero{display:grid;grid-template-columns:1fr 1fr;gap:32px}img{width:100%;height:200px;object-fit:cover;background:#bbccc0}section{padding:24px 0;border-top:1px solid #ccc}@media(max-width:600px){body{padding:16px}.hero{display:block}h1{font-size:28px}}</style></head><body><main><div class="hero"><div><p>双城慢旅行</p><h1>曼谷与芭提雅</h1><p>老街、河畔艺术与海边日常。</p></div><img src="${image}" alt="离线照片" /></div><section><h2>每天怎么走</h2><p>周四 · 曼谷老城；周五 · 海边；周六 · 渔村。</p><a href="https://www.google.com/maps/dir/?api=1&destination=Bangkok">Google 路线</a></section><iframe title="路线总览" src="https://www.google.com/maps/embed?pb=fixture"></iframe></main><script>window.parent.__xss=true</script><img src="https://example.invalid/tracker.png" onerror="window.parent.__xss=true"><a href="javascript:alert(1)">坏链接</a><form action="https://example.invalid/send"><input></form><iframe srcdoc="<script>alert(1)</script>"></iframe><meta http-equiv="refresh" content="0;url=https://example.invalid"><base href="https://example.invalid/"></body></html>`;
try {
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4198');
  const sanitized = await page.evaluate(async source => { const { prepareHtmlPreview } = await import('/src/components/runtime/sanitizeHtmlDocument.ts'); return prepareHtmlPreview(source); }, html);
  assert.equal(sanitized.maps.length, 1); assert.equal(sanitized.hasExternalImages, true);
  assert.doesNotMatch(sanitized.html, /<script|<iframe|<form|onerror=|javascript:|http-equiv="refresh"|<base|tracker\.png/);
  assert.match(sanitized.html, /script-src 'none'/);
  assert.match(sanitized.html, /data:image\/png/);
  const rejected = await page.evaluate(async () => { const { prepareHtmlPreview } = await import('/src/components/runtime/sanitizeHtmlDocument.ts'); return prepareHtmlPreview('<iframe src="https://www.google.com.evil.test/maps/embed"></iframe><iframe src="https://user:password@www.google.com/maps/embed"></iframe><iframe src="https://www.google.com/search?q=attack"></iframe><img src="file:///private/secret"><img src="data:image/svg+xml;base64,PHN2Zz4="><a href="java&#x73;cript:alert(1)">unsafe</a><div onmouseover="alert(1)">safe</div>'); });
  assert.equal(rejected.maps.length, 0); assert.doesNotMatch(rejected.html, /file:|javascript:|onmouseover|data:image\/svg|<iframe/);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称').fill('沉浸成果测试');
  await page.getByLabel('想完成什么').fill('验证图文文档、地图及不同窗口尺寸');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('button', { name: '新任务', exact: true }).first().click();
  await page.getByRole('textbox',{name:'记录想法或输入任务'}).fill('双城图文旅行攻略');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('button', { name: '提交候选成果', exact: true }).first().click();
  await page.getByLabel('成果标题').fill('曼谷与芭提雅图文攻略');
  await page.getByLabel('结果内容').fill('## 交付说明\n\n路线、每日安排和图文资料已整理，地图可按需打开。');
  await page.locator('dialog input[type=file]').setInputFiles({ name: 'guide.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await page.getByRole('button', { name: '提交待验收', exact: true }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '成果', exact: true }).click();
  await page.locator('.qd-map-task-directory > summary').click();
  await page.locator('.qd-map-task-directory').getByRole('button',{name:'双城图文旅行攻略',exact:true}).click();
  await page.locator('.qd-html-document').waitFor();
  await page.frameLocator('.qd-html-document').getByRole('heading', { name: '曼谷与芭提雅', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator('.qd-html-map').count(), 0);
  assert.deepEqual(network, [], 'passive preview must not make external requests');
  for (const width of [1920, 1440, 1024, 768, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(550);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({name: el.className, x: Math.round(el.getBoundingClientRect().x), width: Math.round(el.getBoundingClientRect().width)})).slice(0,12)));
    await page.screenshot({ path: path.join(output, `results-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '沉浸阅读', exact: true }).click();
  assert.equal(await page.getByRole('dialog', {name:'沉浸阅读：guide.html'}).count(), 1);
  assert.equal(await page.locator('.qd-output-preview.is-expanded').count(), 1);
  await page.screenshot({ path: path.join(output, 'expanded.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.qd-output-preview.is-expanded').count(), 0);
  await page.waitForFunction(() => document.activeElement?.textContent === '沉浸阅读');
  await page.locator('.qd-focused-results').waitFor();
  for (const width of [1920, 1024, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(500);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log(await page.evaluate(() => [...document.querySelectorAll('*')].filter(n => n.getBoundingClientRect().right > innerWidth + 1).map(n => ({tag:n.tagName,cls:n.className,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width})).slice(0,20)));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `focused overflow ${width}`);
    const heading = await page.evaluate(() => {
      const topbar = document.querySelector('.qd-topbar').getBoundingClientRect();
      const title = document.querySelector('.qd-focused-head h1').getBoundingClientRect();
      return { navigationBottom: topbar.bottom, titleTop: title.top, titleBottom: title.bottom };
    });
    assert(heading.titleTop >= heading.navigationBottom && heading.titleBottom <= 1000, `result title remains below navigation at ${width}px`);
    if (width === 1920) assert(await page.locator('.qd-map-reader').evaluate(node => node.getBoundingClientRect().width) > 1000, 'large windows use the available document canvas');
    await page.screenshot({ path: path.join(output, `focused-${width}.png`) });
  }
  const iframe = page.locator('.qd-html-document');
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-popups allow-popups-to-escape-sandbox');
  assert.deepEqual(errors, []);
  const result = { responsive: [1920, 1440, 1024, 768, 320], htmlStoredInOutput: true, passiveSandbox: true, externalNetworkBeforeConsent: network, errors };
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
