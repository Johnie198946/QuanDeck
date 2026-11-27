import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const body = [
  '# 明天的安排', '', '先核对单价', '再核对数量', '', '- **采购清单**', '- 采购清单', '',
  '> 读完样稿', '', '| 时间 | 任务 |', '| --- | --- |', '| 15:00 | 出发 |', '',
  '```txt', '星期六提交草图', '```', '', '![参考图](https://example.test/guide.png)',
].join('\n');

try {
  const page = await browser.newPage({ viewport: { width: 1050, height: 710 } });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(body => {
    const key = 'quandeck.personal-knowledge.v1';
    if (localStorage.getItem(key)) return;
    const at = '2026-05-20T04:00:00Z';
    localStorage.setItem(key, JSON.stringify({ schema: 1, decisions: [], notes: [
      { id: 'format-sample', title: '行操作测试', body, createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [] },
    ] }));
  }, body);
  await page.goto(origin);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '帮你记' }).click();
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0]);
  for (const [label, occurrence, index] of [
    ['明天的安排', 0, 0], ['再核对数量', 0, 3], ['采购清单', 1, 6], ['采购清单', 0, 5],
    ['读完样稿', 0, 8], ['出发', 0, 12], ['星期六提交草图', 0, 15], ['参考图', 0, 18],
  ]) {
    const point = await editor.evaluate((root, [label, occurrence]) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = node.textContent.indexOf(label);
        if (start < 0 || occurrence-- > 0) continue;
        node.parentElement.scrollIntoView({ block: 'center' });
        const range = new Range();
        range.setStart(node, start);
        range.setEnd(node, start + label.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 2, y: rect.top + rect.height / 2 };
      }
    }, [label, occurrence]);
    assert.ok(point, 'source text visible: ' + label);
    await page.mouse.move(point.x, point.y);
    await page.getByRole('button', { name: '将此行设为待办' }).click({ timeout: 4000 });
    await page.waitForFunction(index => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].todos?.some(t => t.lineIndex === index), index, { timeout: 4000 })
      .catch(error => { throw new Error('Missing original line ' + index + ' after adding ' + label, { cause: error }); });
    assert.equal((await stored()).body, body, 'conversion preserves source Markdown');
  }
  await page.reload();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '帮你记' }).click();
  await page.waitForFunction(() => document.querySelectorAll('button[data-todo-id]').length === 8);
  assert.deepEqual((await stored()).todos.map(t => t.lineIndex).sort((a, b) => a - b), [0, 3, 5, 6, 8, 12, 15, 18]);
  assert.deepEqual(failures, []);
  console.log('Passed editor todo conversion in headings, soft breaks, duplicate lists, quotes, tables, fenced code and image rows.');
} finally {
  await browser.close();
}
