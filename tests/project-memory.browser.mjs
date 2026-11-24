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
  assert.match(await memory.innerText(), /简报列出 8\/\d+ 项待推进或需核对任务/);
  assert.match(await memory.innerText(), /全部 18 项任务的完整交接可按需查阅/);
  assert.doesNotMatch(await memory.innerText(), /实报 tokens|事件水位/);
  await memory.getByRole('button', { name: '任务交接', exact: true }).click();
  await memory.getByRole('searchbox').fill('核对手册规则');
  await memory.getByRole('button', { name: '核对手册规则 已验收', exact: true }).click();
  assert.match(await memory.innerText(), /五条规则已经核对/);
  await memory.getByRole('button', { name: '方向与规范', exact: true }).click();
  assert.match(await memory.innerText(), /手册必须能离线阅读/);
  await memory.getByRole('button', { name: '复盘经验', exact: true }).click();
  await memory.getByRole('button', {name:'记一条待核观察'}).click();
  await memory.getByLabel('观察到什么').fill('现场一台机器的图片没有离线缓存');
  await memory.getByRole('button', {name:'保存观察'}).click();
  await memory.getByText('已保存待核观察',{exact:true}).waitFor();
  await memory.getByText('待核观察 · 1',{exact:true}).click();
  await memory.getByRole('button',{name:'补充依据'}).click();
  assert.equal(await memory.getByRole('textbox',{name:'适用情境',exact:true}).inputValue(),'现场一台机器的图片没有离线缓存');
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
  // Pin the exact confirmed lesson in a new task, then visit its accepted artifact in the app.
  await page.evaluate(async ({target}) => {
    const {applyCollaboration}=await import('/src/data/collaboration.ts');
    const library=JSON.parse(localStorage.getItem('quandeck.projects.v1')),snapshot=library.projects[library.activeProjectId];
    function cmd(type,payload) {
      const r=applyCollaboration(snapshot,{projectId:snapshot.project.id,type,payload,taskId:target,expectedVersion:snapshot.collaboration.tasks[target].version,idempotencyKey:crypto.randomUUID()},{kind:'human'});
      if(!r.ok) throw Error(r.message);return r;
    }
    const pack=cmd('build_context',{});if(!pack.context?.memoryLessons?.length) throw Error('missing fixed lesson');
    const id=cmd('submit',{title:'离线阅读测试交付',body:'断网核对通过'}).resourceId;
    cmd('review',{submissionId:id,verdict:'accepted',checks:[true],note:'离线验收通过'});
    localStorage.setItem('quandeck.projects.v1',JSON.stringify(library));
  },ids);
  await page.reload();
  await page.getByRole('button',{name:'查看任务 制作手册页面详情',exact:true}).click();
  await page.getByRole('button', {name:'进入成果地图 查看这项任务的交付内容'}).click();
  await page.locator('.qd-map-index button').filter({hasText:'离线阅读测试交付'}).click();
  const reflection = page.getByRole('region',{name:'本次交付复盘'});
  await reflection.getByRole('button',{name:'有效',exact:true}).waitFor();
  assert.equal(await reflection.getByLabel('适用情境').count(),0);
  await reflection.getByRole('button',{name:'记录新做法',exact:true}).click();
  assert.equal(await reflection.getByLabel('适用情境').inputValue(),'离线阅读测试交付');
  assert.equal(await reflection.getByLabel('观察到的结果').inputValue(),'离线验收通过');
  assert.equal(await reflection.getByLabel('作为依据的成果').count(),0);
  await reflection.getByRole('button',{name:'收起新做法',exact:true}).click();
  await reflection.getByRole('button',{name:'有效',exact:true}).click();
  await reflection.getByLabel('实际情况').fill('预先缓存让现场检查顺利完成');
  await reflection.getByRole('button',{name:'记下反馈'}).click();
  await reflection.getByText('已记下采用效果',{exact:true}).waitFor();
  await page.reload(); memory = await openMemory();
  await memory.getByRole('button', {name:'复盘经验',exact:true}).click();
  await memory.getByText('下游采用反馈',{exact:true}).click();
  assert.match(await memory.innerText(),/预先缓存让现场检查顺利完成/);
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
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ projectCreatedInUI: true, scopedTaskPacket: true, taskSourceRead: true, reflectionCandidateConfirmed: true, observationPromoted:true, acceptedSourcePrefilled:true, pinnedFeedbackPersisted:true, reloadPersistence: true, sourceInvalidation: true, withdrawal: true, widths: [320, 768, 1024, 1440], focusRestored: true, errors }, null, 2));
  console.log('memory UI: isolated project, scoped packet, source lookup, reflection lifecycle, reload, 4 widths and focus passed');
} catch (error) { await writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText()); await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; } finally { await browser.close(); }
