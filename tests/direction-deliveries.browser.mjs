import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4344';
const output = process.env.QUANDECK_UI_OUTPUT || '/private/tmp/quandeck-direction-deliveries-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
try {
  await page.goto(url);
  await page.evaluate(async () => { const { mountDirectionDeliveriesFixture } = await import('/tests/direction-deliveries.fixture.tsx'); await mountDirectionDeliveriesFixture(); });
  for (const [scope, title] of [['业务任务', '业务任务自身说明'], ['子任务', '子任务核对材料'], ['系统整合任务', '项目最终完整攻略'], ['项目', '项目最终完整攻略']]) {
    const section = page.getByRole('region', { name: scope, exact: true });
    await section.getByText(title, { exact: true }).waitFor();
    assert.equal(await section.getByRole('listitem').count(), 1, `${scope} only lists its own output`);
    assert.equal(await section.getByText(/尚未定义|还没有交付清单/).count(), 0);
  }
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    await page.screenshot({ path: `${output}/direction-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify({ exactTaskScope: true, childOwnScope: true, systemAssemblyFinal: true, projectFinalOnly: true, widths: [320, 768, 1024, 1440], errors }, null, 2));
  console.log('Direction delivery UI: task / child / assembly / project exact inventories and four widths passed');
} finally { await browser.close(); }
