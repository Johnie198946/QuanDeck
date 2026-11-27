import { openProjectTools } from './fixtures/project-tools.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/product/comparison-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const source = () => import('/src/data/repository.ts').then(module => module.localDataSource);
    const alternatives = [
      { agentId: 'codex', title: '先试一场', summary: '用一场小型展览试行。', body: '收集观众反馈后再扩大规模。', sourceSessionId: 'test-a' },
      { agentId: 'claude', title: '先设计动线', summary: '先把导览路线画出来。', body: '安排演练，检查拥堵点。', sourceSessionId: 'test-b' },
    ];
    localStorage.setItem('quandeck.configured-agents.v1', JSON.stringify(alternatives.map(({ agentId }) => ({
      id: agentId, agentId, tool: agentId, scope: 'application', connectionId: 'test-' + agentId, projectPath: '/synthetic',
      capabilities: { dispatch: true },
    }))));
    window.comparisonRequests = [];
    window.quandeckDesktop = {
      platform: 'test',
      bootstrap: async entries => entries,
      getConnection: async () => ({ baseUrl: 'http://127.0.0.1:4175', token: '' }),
      onStorageError: () => () => {},
      onNavigate: () => () => {},
      onSnapshot: listener => {
        let cleanup;
        let mounted = true;
        void source().then(api => { if (mounted) cleanup = api.subscribe(listener); });
        return () => { mounted = false; cleanup?.(); };
      },
      command: async (name, args) => {
        const api = await source();
        if (typeof api[name] !== 'function') throw Error('Unexpected command ' + name);
        return api[name](...args);
      },
      compareTaskAgents: async input => {
        window.comparisonRequests.push(input);
        return { alternatives };
      },
    };
  });
  await page.goto(origin);
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  const target = await page.evaluate(async () => {
    const { localDataSource: api } = await import('/src/data/repository.ts');
    const projectId = (await api.createProject({ name: '展览排期', description: '规划展览现场', setup: {
      requestId: crypto.randomUUID(),
      tasks: [{ key: 'route', title: '安排展览', expected: '说明动线和时间', owner: 'unassigned', deps: [], lineIds: [], include: true, phase: '执行' }],
    } })).projectId;
    await api.registerAgent({ id: 'codex', name: 'Codex', short: 'C', color: '#527f9e' });
    await api.registerAgent({ id: 'claude', name: 'Claude Code', short: 'C', color: '#bd7856' });
    const snapshot = await api.load();
    const taskId = Object.values(snapshot.tasks).find(task => task.title === '安排展览').id;
    const task = snapshot.collaboration.tasks[taskId];
    const spec = snapshot.collaboration.specs.find(record => record.key === taskId && record.revision === task.specRevision);
    return { projectId, taskId, specId: spec.id, expectedSpecRevision: spec.revision };
  });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '帮你管' }).click();
  await openProjectTools(page);
  await page.getByRole('heading', { name: '展览排期', exact: true }).waitFor();
  const dispatch = () => page.evaluate(async target => {
    const { requestProductDispatch } = await import('/src/components/deck/ProductExecution.tsx');
    requestProductDispatch(target);
  }, target);
  await dispatch();
  await page.getByRole('button', { name: '请多个 Agent 出方案' }).click();
  const dialog = page.getByRole('dialog', { name: '请多个 Agent 出方案' });
  await dialog.getByRole('button', { name: '取消' }).click();
  assert.equal(await page.evaluate(() => window.comparisonRequests.length), 0);
  await dispatch();
  await page.getByRole('button', { name: '请多个 Agent 出方案' }).click();
  await dialog.getByRole('button', { name: '取消' }).click();
  await dispatch();
  const assignment=page.getByRole('dialog',{name:'分派任务'});
  await assignment.getByRole('checkbox',{name:/Codex/}).check();
  await assignment.getByRole('checkbox',{name:/Claude/}).check();
  await assignment.getByRole('button',{name:'分别生成方案'}).click();
  const compare = page.getByRole('dialog', { name: '对比方案' });
  await compare.getByRole('heading', { name: '先试一场' }).waitFor();
  await compare.getByRole('heading', { name: '先设计动线' }).waitFor();
  await page.screenshot({ path: path.join(output, 'two-proposals.png'), animations: 'disabled' });
  const current = await page.evaluate(() => window.comparisonRequests[0]);
  assert.deepEqual(current, { ...target, itemId: undefined, agentIds: ['codex', 'claude'] });
  await compare.getByRole('button', { name: '合并方案' }).click();
  await compare.getByLabel('候选标题').fill('先画动线，再小范围试行');
  await compare.getByRole('button', { name: '提交候选成果' }).click();
  await page.getByText('已提交为候选成果，可以在成果页验收。', { exact: true }).waitFor();
  const saved = await page.evaluate(async taskId => {
    const { localDataSource: api } = await import('/src/data/repository.ts');
    const snap = await api.load();
    return { outputs: Object.values(snap.outputs).filter(output => output.taskId === taskId),
      receipts: snap.collaboration.artifacts.filter(artifact => artifact.key === taskId).flatMap(artifact => artifact.deliveryReceipts ?? []),
      status: snap.collaboration.tasks[taskId].status, runs: Object.keys(snap.collaboration.runs).length };
  }, target.taskId);
  assert.equal(saved.outputs.length, 1);
  assert.match(saved.outputs[0].body, /test-a.*test-b/s);
  assert.equal(saved.receipts[0]?.format, 'markdown');
  assert.equal(saved.status, 'in_review');
  assert.equal(saved.runs, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ twoMockProposals: true, confirmationBeforeSend: true, explicitMerge: true, candidateNeedsReview: true, noExecutionLaunched: true, errors }));
} finally {
  await browser.close();
}
