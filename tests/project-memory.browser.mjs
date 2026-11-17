/** Synthetic local storage only. No live Agent or private projects are accessed. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4297';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/memory-design/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
const name = '项目记忆合成验收';
const openMemory = async () => {
  await page.getByRole('button', { name: `切换项目：${name}`, exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await page.getByLabel('项目记忆与管理').getByRole('button', { name: '项目记忆', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '项目记忆', exact: true });
  await dialog.waitFor(); return dialog;
};
try {
  await page.goto(url);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(name);
  await page.getByRole('textbox', { name: '想完成什么 选填' }).fill('让新接手者理解手册规则与自己的下一步。');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('button', { name: `切换项目：${name}`, exact: true }).filter({ visible: true }).waitFor();
  const ids = await page.evaluate(async () => {
    const { applyCollaboration, buildContextPackage } = await import('/src/data/collaboration.ts');
    const library = JSON.parse(localStorage.getItem('quandeck.projects.v1'));
    const snapshot = library.projects[library.activeProjectId]; let seq = 0;
    const run = (type, payload, taskId) => {
      const result = applyCollaboration(snapshot, { projectId: snapshot.project.id, idempotencyKey: 'browser-memory:' + ++seq, type, payload, taskId, expectedVersion: taskId ? snapshot.collaboration.tasks[taskId].version : undefined }, { kind: 'human' });
      if (!result.ok) throw new Error(result.message); return result.resourceId;
    };
    run('record_decision', { kind: 'constraint', text: '手册必须能离线阅读。' });
    const source = run('create_task', { title: '核对手册规则', goal: '核对离线规则', criteria: ['五条规则'], owner: 'me' });
    const submission = run('submit', { title: '规则成果', body: '五条规则：离线、中文、来源、交接、缺失留空。', handoff: { summary: '五条规则已经核对。', completed: ['核对规则'], decisions: [], remaining: [], nextSteps: ['制作手册页面'] } }, source);
    run('review', { submissionId: submission, verdict: 'accepted', checks: [true], note: '合成规则逐条核对' }, source);
    const target = run('create_task', { title: '制作手册页面', goal: '依据规则制作离线页面', criteria: ['能离线阅读'], owner: 'me', dependencies: [source] });
    for (let i = 0; i < 16; i++) run('create_task', { title: '无关日常事项 ' + i, goal: 'UNRELATED_CONTENT_NOT_IN_PACKET', criteria: ['记录'], owner: 'me' });
    const context = buildContextPackage(snapshot, target);
    if (context.prompt.includes('UNRELATED_CONTENT_NOT_IN_PACKET')) throw Error('unrelated memory leaked');
    localStorage.setItem('quandeck.projects.v1', JSON.stringify(library));
    return { source, target, projectId: snapshot.project.id };
  });
  await page.reload();
  let memory = await openMemory();
  assert.match(await memory.innerText(), /让新接手者理解/);
  assert.match(await memory.innerText(), /简报展示 8\/18/);
  assert.doesNotMatch(await memory.innerText(), /实报 tokens|事件水位/);
  await memory.getByRole('button', { name: '任务交接', exact: true }).click();
  await memory.getByRole('searchbox').fill('核对手册规则');
  await memory.getByRole('button', { name: '核对手册规则 已验收', exact: true }).click();
  assert.match(await memory.innerText(), /五条规则已经核对/);
  await memory.getByRole('button', { name: '方向与规范', exact: true }).click();
  assert.match(await memory.innerText(), /手册必须能离线阅读/);
  await memory.getByRole('button', { name: '复盘经验', exact: true }).click();
  await memory.getByRole('button', { name: '记录一次复盘', exact: true }).click();
  for (const [label, value] of [['适用情境', '制作手册页面时'], ['采用的做法', '先核对规则，再制作页面'], ['观察到的结果', '及时发现离线要求'], ['限制与下次调整', '只适用于该项目，来源变化时需重新核对']]) await memory.getByRole('textbox', { name: label, exact: true }).fill(value);
  await memory.getByLabel('作为依据的成果').selectOption({ label: '规则成果' });
  await memory.getByRole('button', { name: '保存候选经验', exact: true }).click();
  await memory.getByText('已保存候选经验', { exact: true }).waitFor();
  await memory.getByRole('button', { name: '确认经验', exact: true }).click();
  await memory.getByText('已确认经验 · v2', { exact: true }).waitFor();
  await memory.getByRole('button', { name: '查看依据', exact: true }).click();
  assert.match(await memory.innerText(), /五条规则：离线、中文、来源、交接、缺失留空/);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await memory.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `memory overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `memory-${width}.png`) });
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('项目记忆与管理').getByRole('button', { name: '项目记忆', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.reload(); memory = await openMemory();
  await memory.getByRole('button', { name: '复盘经验', exact: true }).click();
  await memory.getByText('已确认经验 · v2', { exact: true }).waitFor();
  await page.evaluate(async ({ source }) => {
    const { applyCollaboration } = await import('/src/data/collaboration.ts');
    const library = JSON.parse(localStorage.getItem('quandeck.projects.v1')), snapshot = library.projects[library.activeProjectId];
    const result = applyCollaboration(snapshot, { projectId: snapshot.project.id, type: 'reopen', taskId: source, expectedVersion: snapshot.collaboration.tasks[source].version, idempotencyKey: 'reopen-memory-source', payload: { reason: '合成来源换版检查' } }, { kind: 'human' });
    if (!result.ok) throw Error(result.message);
    localStorage.setItem('quandeck.projects.v1', JSON.stringify(library));
  }, ids);
  await page.reload(); memory = await openMemory();
  await memory.getByRole('button', { name: '复盘经验', exact: true }).click();
  await memory.getByText('来源变化，需复核 · v2', { exact: true }).waitFor();
  await memory.getByRole('button', { name: '撤回', exact: true }).click();
  await memory.getByText('已撤回，历史版本仍可追溯', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ projectCreatedInUI: true, scopedTaskPacket: true, taskSourceRead: true, reflectionCandidateConfirmed: true, reloadPersistence: true, sourceInvalidation: true, withdrawal: true, widths: [320, 768, 1024, 1440], focusRestored: true, errors }, null, 2));
  console.log('memory UI: isolated project, scoped packet, source lookup, reflection lifecycle, reload, 4 widths and focus passed');
} catch (error) { await writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText()); await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; } finally { await browser.close(); }
