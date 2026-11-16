/** Isolated browser storage/profile; no real projects or Agent requests. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/overview-tree/ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const dimension = name => page.getByRole('navigation', { name: '总览维度' }).getByRole('button', { name, exact: true });
const activeProject = () => page.evaluate(() => JSON.parse(localStorage.getItem('quandeck.projects.v1')).activeProjectId);
try {
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4213');
  await page.getByRole('heading', { name: '先给想做的事一个位置' }).waitFor();
  await page.screenshot({ path: path.join(output, 'empty.png') });
  await page.evaluate(async () => {
    const { createOverviewFixtures } = await import('/tests/overview-tree.fixture.ts');
    const { persistProjectLibrary } = await import('/src/data/projectStorage.ts');
    const snapshots = createOverviewFixtures();
    persistProjectLibrary({ schema: 1, activeProjectId: snapshots[0].project.id, projects: Object.fromEntries(snapshots.map(snapshot => [snapshot.project.id, snapshot])), agents: snapshots[0].agents, defaultAgent: 'codex' });
  });
  await page.reload();
  await page.getByRole('heading', { name: '项目总览', exact: true }).waitFor();
  const stored = await page.evaluate(() => localStorage.getItem('quandeck.projects.v1'));
  assert.equal(await page.getByRole('button', { name: '收起 我要去泰国玩', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '展开 曼谷与芭提雅图文攻略', exact: true }).count(), 1, 'projects start with only the current project expanded');
  await page.getByRole('button', { name: '展开 QuanDeck 体验优化', exact: true }).click();
  assert.equal(await activeProject(), 'overview-travel', 'expansion does not switch active project');
  await page.getByRole('button', { name: '查看任务 完成产品使用说明详情', exact: true }).click();
  await page.getByRole('complementary', { name: '选中事项详情' }).getByRole('heading', { name: '完成产品使用说明', exact: true }).waitFor();
  assert.equal(await activeProject(), 'overview-travel', 'reading another project is local selection only');
  await page.getByLabel('搜索项目与任务').fill('bangkok transfer');
  const outline = page.getByRole('list', { name: '项目与任务层级' });
  assert.equal(await outline.locator('[data-overview-node]').count(), 4, 'search keeps only matching path');
  await page.getByRole('button', { name: '查看任务 曼谷 → 芭提雅交通 Bangkok transfer详情', exact: true }).click();
  await page.getByRole('complementary', { name: '选中事项详情' }).getByText('本轮已完成 2/4 步', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await dimension('任务').click();
  assert.equal(await page.getByRole('button', { name: '收起 曼谷与芭提雅图文攻略', exact: true }).count(), 1, 'task mode expands first-level children');
  const taskButton = page.getByRole('button', { name: '查看任务 曼谷与芭提雅图文攻略详情', exact: true });
  await taskButton.focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('button', { name: '展开 曼谷与芭提雅图文攻略', exact: true }).count(), 1);
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '展开 路线与交通', exact: true }).click();
  await page.getByRole('button', { name: '查看任务 曼谷 → 芭提雅交通 Bangkok transfer详情', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('quandeck.projects.v1')), stored, 'selection/search/expansion do not mutate project truth');
  assert.equal(await page.getByRole('list', { name: '任务与子任务层级' }).getByRole('img', { name: '本轮已完成 2/4 步' }).count(), 1, 'source step counts appear directly in the outline');
  for (const width of [1920, 1440, 1024, 768, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(550);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `task view horizontal overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `tasks-${width}.png`) });
  }
  const trigger = page.getByRole('button', { name: '查看任务 确定两座城市的住宿详情', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '确定两座城市的住宿详情' });
  await dialog.waitFor();
  await dialog.getByText('曼谷住宿是否沿用考山路的酒店？', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'detail-320.png') });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true, 'detail close restores keyboard focus');
  await dimension('项目').click();
  for (const width of [320, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(550);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `project view horizontal overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `projects-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.qd-outline-children').first().evaluate(node => getComputedStyle(node).animationName), 'none', 'respects reduced motion');
  await page.getByRole('navigation', { name: '总览任务筛选' }).getByRole('button', { name: '待我处理', exact: true }).click();
  assert.equal(await page.getByRole('list', { name: '项目与任务层级' }).locator('[data-overview-node]').count(), 3, 'attention filter keeps project/root/context');
  await page.getByRole('button', { name: '查看任务 确定两座城市的住宿详情', exact: true }).click();
  await page.getByRole('button', { name: '处理待办', exact: true }).click();
  await page.getByRole('heading', { name: '确定两座城市的住宿', exact: true }).waitFor();
  assert.equal(await activeProject(), 'overview-travel');
  await page.getByRole('button', { name: '返回上一页', exact: true }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '总览', exact: true }).click();
  await dimension('任务').click();
  await page.getByRole('button', { name: '新任务', exact: true }).click();
  await page.getByPlaceholder('输入任务标题').waitFor();
  assert.deepEqual(errors, []);
  const checks = { responsive: [320, 768, 1024, 1440, 1920], hierarchyBothTabs: true, ancestorSearch: true, keyboardExpandCollapse: true, projectScopedSelection: true, noTruthMutation: true, detailEscapeFocus: true, realTaskDetailEntry: true, reducedMotion: true, sourceStepProgress: true, errors };
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(checks, null, 2)); console.log(JSON.stringify(checks));
} finally { await browser.close(); }
