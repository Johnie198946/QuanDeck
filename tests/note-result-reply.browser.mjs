import assert from 'node:assert/strict';
import { seedNoteAgentSession } from './fixtures/note-agent-session.mjs';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
const feedback = '请补充京都站的出发时间。';

try {
  await seedNoteAgentSession(page, { received: true });
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '帮你记', exact: true }).click();
  await page.getByRole('complementary', { name: '笔记列表' }).getByRole('button', { name: /旅行准备/ }).waitFor();
  const capsule = page.locator('.qnr-layer .qnr-pill');
  await capsule.click();
  const reader = page.getByRole('dialog', { name: '笔记任务回执' });
  await reader.getByText('第一版建议在大阪换乘。', { exact: true }).waitFor();
  const form = reader.getByRole('form', { name: '回复成果' });
  await form.getByRole('textbox').fill(feedback);
  await form.getByRole('button', { name: '继续修改' }).click();
  await page.waitForFunction(() => window.inboxTest.runs.length === 2);
  await page.evaluate(async feedback => {
    const { base, other, projectId, taskId, runs, finish } = window.inboxTest;
    if (runs[1].projectId !== projectId || runs[1].taskId !== taskId || runs[1].agentId !== 'codex' ||
        !runs[1].prompt.includes(feedback) || !runs[1].prompt.includes('第一版建议在大阪换乘。')) throw Error('修改意见没有进入原任务');
    if ((await base.load()).project.id !== other || Object.keys((await base.getProjectSnapshot(other)).tasks).length) throw Error('修改影响了另一个项目');
    await finish(runs[1], 'v2', '第二版：早上九点从京都站出发。');
  }, feedback);
  const unread = reader.locator('.qnr-record-head').filter({ has: page.getByLabel('未读', { exact: true }) });
  await unread.first().waitFor();
  await reader.getByText('第一版建议在大阪换乘。', { exact: true }).waitFor();
  await unread.first().click();
  await reader.getByText('第二版：早上九点从京都站出发。', { exact: true }).waitFor();
  await reader.getByRole('button', { name: '关闭回执' }).click();
  await capsule.waitFor();
  const evidence = await page.evaluate(async () => {
    const { projectId, taskId, base, other } = window.inboxTest;
    const source = await base.getProjectSnapshot(projectId);
    return {
      quote: [...CSS.highlights.get('qd-returned-passage')][0].toString(),
      bodies: source.collaboration.artifacts.map(a => a.body),
      foreignTasks: Object.keys((await base.getProjectSnapshot(other)).tasks).length,
      taskStillPresent: !!source.tasks[taskId],
      note: JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].body,
    };
  });
  assert.equal(evidence.quote, '比较京都到和歌山的路线。');
  assert.deepEqual(evidence.bodies, ['第一版建议在大阪换乘。', '第二版：早上九点从京都站出发。']);
  assert.equal(evidence.foreignTasks, 0);
  assert(evidence.taskStillPresent);
  assert.equal(evidence.note, '旅行准备：比较京都到和歌山的路线。');
  assert.deepEqual(errors, []);
  console.log('PASS: original note → result → reply → revised result without changing the active project, overwriting the note, or losing the original result.');
} finally {
  await browser.close();
}
