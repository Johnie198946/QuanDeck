import assert from 'node:assert/strict';
import { seedNoteAgentSession } from './fixtures/note-agent-session.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4727';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/simple-inbox';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
page.setDefaultTimeout(7500);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const quote = '比较京都到和歌山的路线。';
const first = '第一版建议在大阪换乘。';
const revised = '第二版建议九点从京都站出发。';

try {
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await seedNoteAgentSession(page);
  await page.goto(origin);
  const navigate = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
  await navigate('帮你管');
  const inbox = page.getByRole('main', { name: 'Agent 任务收件箱' });
  await inbox.getByText('还没有发给 Agent 的任务').waitFor();
  await navigate('帮你记');
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  await editor.getByText(quote, { exact: false }).waitFor();
  const points = await editor.evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, start = node.textContent.indexOf(text);
      if (start < 0) continue;
      return [start, start + text.length - 1].map((i, k) => {
        const range = new Range();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        return { x: k ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
      });
    }
    throw Error('测试原文不存在');
  }, quote);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: '发送选段到帮你管' }).click();
  const send = page.getByRole('dialog', { name: '发送到帮你管' });
  const submit = send.getByRole('button', { name: '发给 Codex', exact: true });
  await submit.waitFor();
  await page.screenshot({ path: path.join(output, 'send.png') });
  await submit.click();
  await send.waitFor({ state: 'hidden' });
  const taskId = await page.evaluate(async () => {
    const { runs, projectId, base } = window.inboxTest;
    const tasks = Object.values((await base.getProjectSnapshot(projectId)).tasks);
    if (runs.length !== 1 || tasks.length !== 1 || tasks[0].id !== runs[0].taskId) throw Error('未收到唯一的执行');
    return tasks[0].id;
  });
  await navigate('帮你管');
  const task = inbox.getByRole('button').filter({ hasText: quote.slice(0,-1) });
  await task.waitFor();
  await inbox.getByRole('button', { name: /执行中/ }).first().click();
  await task.click();
  const detail = inbox.getByRole('region', { name: '任务详情' });
  await detail.waitFor();

  async function finish(index, id, text) {
    await page.evaluate(async ({ index, id, text }) => {
      const { runs, finish } = window.inboxTest;
      await finish(runs[index], id, text);
    }, { index, id, text });
  }
  await finish(0, 'v1', first);
  await inbox.getByRole('button', { name: /有成果/ }).first().click();
  if (await task.getAttribute('aria-expanded') !== 'true') await task.click();
  await detail.getByText(first, { exact: true }).first().waitFor();
  await detail.getByRole('form', { name: '回复成果' }).waitFor();
  await page.screenshot({ path: path.join(output, 'received.png') });

  await navigate('帮你记');
  const capsule = page.locator('.qnr-layer .qnr-pill');
  await capsule.click();
  const receipt = page.getByRole('dialog', { name: '笔记任务回执' });
  await receipt.getByText(first, { exact: true }).waitFor();
  const reply = receipt.getByRole('form', { name: '回复成果' });
  const feedback = '请补充京都站的出发时间。';
  await reply.getByRole('textbox').fill(feedback);
  await reply.getByRole('button', { name: '继续修改' }).click();
  await page.waitForFunction(() => window.inboxTest.runs.length === 2);
  const next = await page.evaluate(() => {
    const { runs } = window.inboxTest;
    return { taskId: runs[1].taskId, projectId: runs[1].projectId, originalProject: runs[0].projectId,
      agentId: runs[1].agentId, prompt: runs[1].prompt };
  });
  assert.equal(next.taskId, taskId);
  assert.equal(next.projectId, next.originalProject);
  assert.equal(next.agentId, 'codex');
  assert.ok(next.prompt.includes(feedback) && next.prompt.includes(first));
  await finish(1, 'v2', revised);
  const unread = receipt.locator('.qnr-record-head').filter({ has: page.getByLabel('未读', { exact: true }) });
  await unread.first().click();
  await receipt.getByText(revised, { exact: true }).waitFor();
  await receipt.getByRole('button', { name: '关闭回执' }).click();
  await navigate('帮你管');
  await task.click();
  await detail.getByText(revised, { exact: true }).first().waitFor();
  // Reading a result from another project must keep the reply on the originating task.
  const unrelated = await page.evaluate(async () => {
    const result = await window.inboxTest.api.createProject({ name: '另一项计划' });
    if (!result.ok) throw Error(result.message);
    return result.projectId;
  });
  await navigate('帮你记');
  await navigate('帮你管');
  await task.click();
  const deskReply = detail.getByRole('form', { name: '回复成果' });
  await deskReply.getByRole('textbox').fill('请再补充预计车程。');
  await deskReply.getByRole('button', { name: '继续修改' }).click();
  await page.waitForFunction(() => window.inboxTest.runs.length === 3);
  const third = await page.evaluate(async foreign => {
    const { runs, base } = window.inboxTest;
    return {
      owners: runs.map(r => [r.taskId, r.projectId, r.agentId]),
      prompt: runs.at(-1).prompt,
      otherTasks: Object.keys((await base.getProjectSnapshot(foreign)).tasks),
    };
  }, unrelated);
  assert.deepEqual(third.owners, Array(3).fill([taskId, next.originalProject, 'codex']));
  assert.deepEqual(third.otherTasks, []);
  assert.ok(third.prompt.includes('请再补充预计车程。') && third.prompt.includes(revised));
  assert.deepEqual(errors, []);
  console.log('PASS: selected note → one agent run → inbox → result at original note → feedback → revised result in both views → reply from inbox while another project is active, all on the original task.');
} finally {
  await browser.close();
}
