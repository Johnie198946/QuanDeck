import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(7000);
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321');
  const created = await page.evaluate(async () => {
    const { localDataSource: api } = await import('/src/data/repository.ts');
    if (window.quandeckDesktop || (await api.listProjects()).length) throw new Error('Expected a fresh test profile');
    const { projectId } = await api.createProject({ name: '纸本展览' });
    await api.createTaskWithAttachments('核对展签', [], projectId);
    const snapshot = await api.getProjectSnapshot(projectId);
    const { savedProjectBriefInput } = await import('/src/data/projectBriefAgentInput.ts');
    const { evidenceKey, rows } = savedProjectBriefInput(snapshot, []);
    return { projectId, evidenceKey, row: rows.find(r => r.kind === 'task') };
  });
  await page.reload();
  await page.getByRole('region', { name: '项目进展', exact: true }).waitFor();
  // Install only the optional assistance method after loading the ordinary web data source.
  await page.evaluate(({ projectId, evidenceKey, row }) => {
    window.testBriefCalls = 0;
    window.quandeckDesktop = { distillProjectBrief: async (id, revision) => {
      if (id !== projectId || revision !== evidenceKey) throw new Error('测试发现项目或资料版本不符');
      window.testBriefCalls++;
      if (window.testBriefCalls === 1) throw new Error('Agent 暂未连接');
      return { sourceCount: 2, availableCount: 2, provider: 'codex', generatedAt: new Date().toISOString(),
        points: [{ text: '展签需要核对。', citations: [{ sourceId: row.id, quote: row.title }] }] };
    } };
  }, created);
  await page.getByRole('button', { name: '查看简报 纸本展览' }).click();
  const button = page.getByRole('button', { name: '从资料里看变化' });
  await button.click();
  const analysis = page.getByRole('region', { name: 'AI 提炼' });
  await analysis.getByText('Agent 暂未连接', {exact: false}).waitFor();
  await analysis.getByRole('button', { name: '重试' }).click();
  await analysis.getByText('展签需要核对。', {exact: true}).waitFor();
  await button.click();
  assert.equal(await analysis.getByText('展签需要核对。').count(), 0);
  await button.click();
  await analysis.getByText('展签需要核对。').waitFor();
  assert.equal(await page.evaluate(() => window.testBriefCalls), 2);
  await page.evaluate(() => { delete window.quandeckDesktop; });
  await analysis.getByRole('button', { name: '核对展签', exact: true }).click();
  await page.getByRole('heading', { name: '核对展签', exact: true }).first().waitFor();
  console.log('Project brief opens on demand, retries, reuses its result and opens the cited task.');
} finally { await browser.close(); }
