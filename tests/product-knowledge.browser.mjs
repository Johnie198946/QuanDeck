import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/product/knowledge-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
const box = () => page.getByRole('textbox', { name: '笔记正文' });
const waitForAutoSave = () => page.clock.fastForward(30_200);
async function newNote(title, original) {
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('textbox', { name: '笔记标题' }).fill(title);
  await box().fill(original);
  await waitForAutoSave();
  await page.getByRole('complementary', { name: '笔记列表' }).getByRole('button', { name: new RegExp(title) }).waitFor();
}
try {
  await page.clock.install();
  await page.goto(origin);
  await nav('帮你记').click();
  await page.getByRole('heading', { name: '帮你记' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('quandeck:show-notes', { detail: {
    text: '京都红叶路线，12 月出行。\n预算：3000 元\n参考链接 https://example.org/kyoto', files: [
      new File(['原始文字'], 'source.txt', { type: 'text/plain' }),
    ],
  } })));
  const attachment = box().getByRole('group', { name: '附件预览 · source.txt' });
  await attachment.waitFor();
  await page.getByRole('textbox', { name: '笔记标题' }).fill('京都红叶路线');
  await waitForAutoSave();
  const reference = box().getByRole('link', { name: /example\.org\/kyoto/ });
  assert.equal(await reference.getAttribute('href'), 'https://example.org/kyoto');
  await attachment.getByText('原始文字', { exact: true }).waitFor();
  await newNote('京都红叶路线备选', '另一份京都红叶路线。\n预算：4500 元\n参考链接 https://example.org/kyoto');
  const stats = await page.evaluate(async () => {
    const {localDataSource} = await import('/src/data/repository.ts');
    const projects = await localDataSource.listProjects();
    return { projects: projects.length, tasks: projects.flatMap(item => Object.keys(item.tasks)).length };
  });
  assert.deepEqual(stats, { projects: 0, tasks: 0 });
  await nav('帮你想').click();
  await page.getByRole('heading', { name: '知识图谱' }).waitFor();
  await page.getByRole('region', { name: '图谱笔记' }).locator('.qd-library-node').filter({ hasText: /京都.*备选/ }).click();
  await page.getByRole('heading', { name: '两处「预算」数值不同' }).waitFor();
  await page.screenshot({ path: path.join(output, 'knowledge-graph.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '忽略', exact: true }).click();
  await page.getByText('已忽略这条发现。').waitFor();
  const fixture = await page.evaluate(async () => {
    const {localDataSource: api} = await import('/src/data/repository.ts');
    const first = await api.createProject({ name: '地下水治理方案', description: '水文地质资料' });
    const second = await api.createProject({ name: '供水规划', description: '独立项目' });
    return { first: first.projectId, second: second.projectId };
  });
  assert.ok(fixture.first && fixture.second);
  await page.reload();
  await nav('帮你找').click();
  const search = page.getByRole('textbox', { name: '搜索项目、笔记、任务或成果' });
  await search.fill('帮我找地下水治理方案');
  await search.press('Enter');
  await page.getByRole('button', { name: /地下水治理方案.*水文地质资料/ }).waitFor();
  await search.fill('京都红叶路线');
  await search.press('Enter');
  await page.getByRole('list', { name: '查找结果' }).getByRole('button', { name: /京都红叶路线/ }).first().waitFor();
  assert.equal(await page.getByRole('list', { name: '查找结果' }).getByRole('button', { name: /笔记 · 个人笔记/ }).count(), 2);
  await page.screenshot({ path: path.join(output, 'knowledge-search.png'), animations: 'disabled' });
  await page.getByRole('list', { name: '查找结果' }).getByRole('button', { name: /^京都红叶路线 / }).first().click();
  await box().waitFor();
  await page.waitForFunction(() => document.querySelector('.qd-note-title')?.value === '京都红叶路线');
  await page.evaluate(() => {
    window.quandeckDesktop = {
      platform: 'darwin',
      readKnowledge: async () => localStorage.getItem('quandeck.personal-knowledge.v1'),
      compareKnowledge: async (old, data) => {
        if (old !== localStorage.getItem('quandeck.personal-knowledge.v1')) return false;
        localStorage.setItem('quandeck.personal-knowledge.v1', data);
        return true;
      },
      expandKnowledge: async input => {
        window.testReadOnlyNoteInputs ??= [];
        window.testReadOnlyNoteInputs.push(input);
        const additional = input.usePublicSources ? { sources: [{ url: 'https://example.org/kyoto', title: '京都模拟资料', excerpt: '这段正文带有引用证据。', checkedAt: '2026-11-24T09:00:00.000Z' }] } : {};
        return { answer: input.selection.quote + ' · 测试返回', sourceIds: [input.noteId + '@' + input.revision], ...additional };
      },
    };
  });
  async function ask(readSources) {
    await box().focus();
    await box().evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const offset = text.data.indexOf('京都红叶路线');
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(text, offset); range.setEnd(text, offset + '京都红叶路线'.length);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        return;
      }
      throw Error('selected note does not match expected original');
    });
    assert.equal(await box().evaluate(() => getSelection().toString()), '京都红叶路线');
    await page.getByRole('button', { name: '就这段提问' }).click();
    await page.getByRole('textbox', { name: '补充问题' }).fill('具体了解这段');
    if (readSources) await page.getByRole('checkbox', { name: /公开网页/ }).check();
    await page.getByRole('button', { name: '问 AI 并追加' }).click();
    await page.getByRole('button', { name: '查看所选原文' }).last().waitFor();
  }
  await ask(false);
  await page.getByText('京都红叶路线 · 测试返回', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => Object.keys(window.testReadOnlyNoteInputs[0]).sort()), ['noteId', 'question', 'requestId', 'revision', 'selection']);
  await ask(true);
  await page.getByText('查阅来源 · 1 条', { exact: true }).click();
  await page.getByRole('link', { name: '京都模拟资料', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testReadOnlyNoteInputs[1].usePublicSources), true);
  assert.deepEqual(await page.evaluate(() => window.testReadOnlyNoteInputs[1].publicLinks), ['https://example.org/kyoto']);
  await page.screenshot({ path: path.join(output, 'knowledge-note.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 360, height: 820 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('Browser knowledge: automatic draft save, attachment, no tasks, graph evidence/dismissal, dual-scope search, anchored assistant and optional citation mock and 360 px passed');
} catch (error) { await page.screenshot({ path: path.join(output, 'knowledge-failed.png') }).catch(() => {}); throw error; } finally { await browser.close(); }
