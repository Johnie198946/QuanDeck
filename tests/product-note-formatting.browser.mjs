import assert from 'node:assert/strict';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const body = page.getByRole('textbox', { name: '笔记正文' });
  const brush = page.getByRole('button', { name: '格式刷', exact: true });
  const nav = label => page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: label, exact: true});
  await page.addInitScript(() => {
    const key = 'quandeck.personal-knowledge.v1';
    if (localStorage.getItem(key)) return;
    const at = '2026-11-20T06:00:00Z';
    localStorage.setItem(key, JSON.stringify({schema: 1, decisions: [], notes: [
      {id:'format-note', title:'样式测试', body:'**粗体** 与 *斜体* 正文', createdAt:at, updatedAt:at, revision:1, attachments:[], expansions:[], history:[]},
    ]}));
  });
  await page.goto(origin);
  await nav('帮你记').click();
  await body.waitFor();
  async function selectWord(word) {
    await body.evaluate((node, word) => {
      node.focus();
      const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (text.nextNode()) {
        const start = text.currentNode.textContent.indexOf(word);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(text.currentNode, start);
        range.setEnd(text.currentNode, start + word.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      throw new Error('Missing test word ' + word);
    }, word);
  }
  async function assertMark(word, expected) {
    await selectWord(word);
    assert.deepEqual(await body.evaluate(() => ['bold','italic'].map(command => document.queryCommandState(command))), expected);
  }
  await selectWord('粗体');
  await brush.click();
  assert.equal(await brush.getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');
  assert.equal(await brush.getAttribute('aria-pressed'),'false');
  await selectWord('粗体');
  await brush.click();
  const italic = await body.locator('em').boundingBox();
  assert.ok(italic);
  const middle = italic.y + italic.height / 2;
  await page.mouse.move(italic.x + 1, middle);
  await page.mouse.down();
  await page.mouse.move(italic.x + italic.width - 1, middle, {steps: 8});
  await page.mouse.up();
  assert.equal(await brush.getAttribute('aria-pressed'),'false');
  await assertMark('斜体',[true,false]);

  // Save via a normal navigation, then make sure it was serialized and restored.
  await nav('首页').click();
  await page.reload();
  await nav('帮你记').click();
  await assertMark('斜体',[true,false]);
  await selectWord('正文');
  await brush.click();
  await selectWord('斜体');
  await page.keyboard.up('Shift');
  await assertMark('斜体',[false,false]);

  await body.fill('');
  async function typeMarker(marker) {
    await page.keyboard.insertText(marker);
    await page.keyboard.press('Space');
  }
  await typeMarker('8.');
  await page.keyboard.insertText('第一项');
  await page.keyboard.press('Enter');
  await typeMarker('9');
  await page.keyboard.insertText('第二项');
  assert.equal(await body.locator('ol').getAttribute('start'),'8');
  assert.deepEqual(await body.locator('ol > li').allTextContents(),['第一项','第二项']);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await typeMarker('-');
  await page.keyboard.insertText('买车票');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('查日期');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await typeMarker('2026');
  await page.keyboard.insertText('年的安排');
  assert.deepEqual(await body.locator('ul > li').allTextContents(),['买车票','查日期']);
  assert.match(await body.innerText(),/2026 年的安排/);

  await nav('首页').click();
  await page.reload();
  await nav('帮你记').click();
  assert.equal(await body.locator('ol').getAttribute('start'),'8');
  assert.deepEqual(await body.locator('ol > li').allTextContents(),['第一项','第二项']);
  assert.deepEqual(await body.locator('ul > li').allTextContents(),['买车票','查日期']);
  assert.deepEqual(errors, []);
  // A pasted plain-text line can carry Chinese punctuation and no spaces.
  await page.getByRole('button', {name:'新建', exact:true}).click();
  await body.fill('08、安排拍摄');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('预订车票');
  assert.match(await body.innerText(), /09、预订车票/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.doesNotMatch(await body.innerText(), /10、/);
  console.log('Note formatting passed: marker conversion, contextual bare number, Enter continuation and exit, bullet lists, ordinary years, paint and clear styles, Escape, keyboard application and reopen.');
} finally {
  await browser.close();
}
