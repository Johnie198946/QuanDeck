import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || "playwright");
const output = process.env.QUANDECK_UI_OUTPUT || "output/delivery-contract-ui";
const base = process.env.QUANDECK_UI_URL || "http://127.0.0.1:4339";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.route("**/*", (route) =>
  new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${base}/tests/delivery-contract-ui.preview.html?fault=retry`);
  await page.getByText("项目最终路线正文", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".qd-map-index button").filter({ hasText: "任务独立资料" }).count(),
    0,
    "project excludes task-only output",
  );
  await page.getByText("贡献关系 · 1 份来源", { exact: true }).click();
  await page.getByRole("button", { name: /任务独立资料/ }).click();
  await page.getByRole("region", { name: "任务成果汇总" }).waitFor();
  await page.getByText("任务独立资料正文", { exact: true }).waitFor(); // Navigation selects the exact contribution, not the first task output.
  assert.equal(
    await page.getByText("项目最终路线正文", { exact: true }).count(),
    0,
    "slot shows only its own body",
  );
  await page.getByRole("button", { name: "阅读已发布版本", exact: true }).click();
  const published = page.getByRole("dialog", { name: "任务已发布交付", exact: true });
  await published.getByText("正式 v2 的固定正文", { exact: true }).waitFor();
  await published.getByLabel("选择已发布版本").selectOption("fixture-published-v1");
  await published.getByText("正式 v1 的固定正文", { exact: true }).waitFor();
  assert.equal(
    await published.getByText("任务独立资料正文", { exact: true }).count(),
    0,
    "published reader uses frozen receipt, not current map",
  );
  await published.getByRole("button", { name: /独立图文文件/ }).click();
  await published
    .frameLocator(".qd-html-document")
    .getByRole("heading", { name: "独立文件交付验收", exact: true })
    .waitFor();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(
      await published.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      `published overflow ${width}`,
    );
  }
  await page.keyboard.press("Escape");
  await page.locator(".qd-map-index button").filter({ hasText: "独立图文文件" }).click();
  await page
    .frameLocator(".qd-html-document")
    .getByRole("heading", { name: "独立文件交付验收", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("unrelated.txt", { exact: true }).count(),
    0,
    "file slot excludes unrelated attachments",
  );
  await page.getByRole("button", { name: "沉浸阅读", exact: true }).click();
  await page.getByRole("dialog", { name: "沉浸阅读：route-guide.html" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "项目地图", exact: true }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `map overflow ${width}`,
    );
    await page.screenshot({ path: path.join(output, `map-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "发布项目成果", exact: true }).click();
  await page.getByText("路线成果尚待验收", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "确认发布", exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "无清单任务", exact: true }).click();
  const entry = page.getByRole("button", { name: "定义交付件", exact: true });
  await entry.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "定义交付件", exact: true });
  await dialog.waitFor();
  await dialog.getByLabel("交付名称", { exact: true }).fill("可打印行程");
  await dialog.getByLabel("内容形式").selectOption("file");
  await dialog.getByLabel("验收条件", { exact: true }).fill("日期与路线完整\n可打印阅读");
  await dialog.getByLabel("调整原因", { exact: true }).fill("新增纸质版交付需求");
  await dialog.getByRole("button", { name: "预览变更", exact: true }).click();
  await dialog.getByText("核对后生效 · v0 → v1", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      Object.keys(window.deliveryUi.source.peek().collaboration.goalPlans).some((id) =>
        id.startsWith("delivery:"),
      ),
    ),
    false,
    "preview does not persist",
  );
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      `dialog overflow ${width}`,
    );
    await page.screenshot({ path: path.join(output, `change-${width}.png`) });
  }
  await dialog.getByRole("button", { name: "确认变更", exact: true }).click();
  await dialog.getByText("连接暂时中断，草稿已保留", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("交付名称", { exact: true }).inputValue(), "可打印行程");
  await dialog.getByRole("button", { name: "确认变更", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.locator(".qd-map-index button").filter({ hasText: "可打印行程" }).waitFor();
  const receipt = await page.evaluate(() => ({
    calls: window.deliveryUi.calls,
    previews: window.deliveryUi.previews,
  }));
  assert.equal(receipt.calls.length, 2);
  assert.equal(
    receipt.calls[0].idempotencyKey,
    receipt.calls[1].idempotencyKey,
    "retry retains identity",
  );
  assert.equal(receipt.calls[0].operations[0].slot.contract.kind, "file");
  await page.getByRole("button", { name: "调整交付清单", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "调整交付件", exact: true });
  await edit.getByLabel("修改", { exact: true }).check();
  await edit.getByRole("radio", { name: /可打印行程/ }).check();
  await edit.getByLabel("交付名称", { exact: true }).fill("纸质行程手册");
  await edit.getByLabel("调整原因", { exact: true }).fill("明确对外名称");
  await edit.getByRole("button", { name: "预览变更", exact: true }).click();
  await edit.getByText("核对后生效 · v1 → v2", { exact: true }).waitFor();
  await edit.getByLabel("交付名称", { exact: true }).fill("行程手册最终版");
  assert.equal(
    await edit.getByRole("button", { name: "确认变更", exact: true }).count(),
    0,
    "editing invalidates preview",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "调整交付清单", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
    "close restores focus",
  );
  assert.deepEqual(errors, []);
  const checks = {
    widths: [320, 768, 1024, 1440],
    scopeSeparation: true,
    distinctBodies: true,
    contributionDrilldown: true,
    realFilePreview: true,
    immutablePublicationHistory: true,
    isolatedAttachment: true,
    emptyTaskEntry: true,
    readOnlyPreview: true,
    publicationGate: true,
    retryIdempotence: true,
    draftRetained: true,
    previewInvalidation: true,
    keyboard: true,
    errors,
  };
  await writeFile(path.join(output, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(JSON.stringify(checks));
} finally {
  await browser.close();
}
