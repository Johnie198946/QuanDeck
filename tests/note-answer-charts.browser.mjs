import assert from "node:assert/strict";
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.QUANDECK_UI_URL || "http://127.0.0.1:4349";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 840 } });
const errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error(e.message);
});
const flag = "1. 确认排练时间";
const chart = {
  type: "area",
  title: "两次排练",
  labels: ["周二", "周三"],
  series: [{ label: "人数", values: [2, 5] }],
};
const md =
  "排练统计。\n\n```quandeck-chart\n" +
  JSON.stringify(chart) +
  "\n```\n\n![现场座位](attachment:seats)\n\n![排练室](https://images.example.test/room.png)";
const stamp = "2026-01-01T00:00:00.000Z";
const fixture = {
  schema: 1,
  decisions: [],
  notes: [
    {
      id: "sample",
      title: "排练清单",
      body: flag,
      createdAt: stamp,
      updatedAt: stamp,
      attachments: [{ id: "seats", name: "seats.png", size: 68, type: "image/png" }],
      history: [],
      revision: 1,
      expansions: [
        {
          id: "e1",
          at: stamp,
          selection: { quote: flag, offset: 0 },
          question: "排练情况",
          answer: md,
          sourceIds: ["sample"],
          actionPlan: {
            status: "pending",
            changes: [
              {
                noteId: "sample",
                noteTitle: "排练清单",
                revision: 1,
                label: flag,
                start: 3,
                end: flag.length,
                expected: flag.slice(3),
                operation: "strike",
              },
            ],
          },
        },
      ],
    },
  ],
};
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
  "base64",
);
let remote = 0;
await page.route("https://images.example.test/**", (route) => {
  remote++;
  return route.fulfill({ contentType: "image/png", body: pixel });
});
try {
  await page.goto(base);
  await page.getByRole("navigation", { name: "主导航" }).waitFor();
  await page.evaluate(
    ({ fixture, bytes }) => {
      const key = "quandeck.personal-knowledge.v1";
      localStorage.setItem(key, JSON.stringify(fixture));
      window.quandeckDesktop = {
        platform: "darwin",
        readKnowledge: async () => localStorage.getItem(key),
        readKnowledgeImage: async () => bytes,
        compareKnowledge: async (previous, next) => {
          if (localStorage.getItem(key) !== previous) return false;
          localStorage.setItem(key, next);
          return true;
        },
      };
      window.dispatchEvent(new Event("quandeck:personal-knowledge"));
    },
    { fixture, bytes: [...pixel] },
  );
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "帮你记", exact: true })
    .click();
  const card = page.locator('[data-answer-id="e1"]');
  const figure = card.locator("figure.qn-answer-chart");
  await figure.scrollIntoViewIfNeeded();
  for (const type of ["bar", "line", "area", "dot", "donut"]) {
    await figure.getByRole("combobox").selectOption(type);
    assert.equal(await figure.getAttribute("data-chart-style"), type);
    assert.equal((await figure.locator("svg title").count()) > 0, true);
    assert.ok(
      await figure
        .locator("svg *")
        .evaluateAll((nodes) => nodes.some((el) => getComputedStyle(el).animationName !== "none")),
    );
  }
  await figure.getByText("查看数据表").click();
  assert.equal(await figure.locator("tbody tr").nth(1).innerText(), "周三\t5");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await figure
      .locator("svg *")
      .evaluateAll((nodes) => nodes.some((el) => getComputedStyle(el).animationName !== "none")),
    false,
  );
  const local = card.getByRole("img", { name: "现场座位" });
  await local.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector('img[alt="现场座位"]')?.naturalWidth === 1,
  );
  assert.equal(remote, 0);
  await card.getByRole("button", { name: /加载图片.*排练室/ }).click();
  await page.waitForFunction(() => document.querySelector('img[alt="排练室"]')?.naturalWidth === 1);
  assert.equal(remote, 1);
  await card.getByRole("button", { name: "确认修改笔记" }).click();
  await card.getByText("已保存的修改").waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("quandeck.personal-knowledge.v1")).notes[0].body,
    ),
    "1. ~~确认排练时间~~",
  );
  await page.getByRole("button", { name: "全屏阅读", exact: true }).click();
  const reader = page.getByRole("dialog", { name: "笔记全屏阅读" });
  await reader.getByRole("img", { name: "两次排练" }).waitFor();
  await reader.getByRole("combobox", { name: "图表样式" }).selectOption("line");
  await reader.getByRole("button", { name: "退出全屏阅读" }).click();
  assert.deepEqual(errors, []);
  console.log(
    "Passed: 5 animated chart styles, exact values, reduced motion, note and remote images, fullscreen and confirmed editor change.",
  );
} finally {
  await browser.close();
}
