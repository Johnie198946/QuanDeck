/** Browser-local acceptance of manual capture, focus and entry to the actual task plan. */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4520';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('无障碍任务验收');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  const journal = page.getByRole('region', { name: '项目任务' });
  const field = journal.getByRole('textbox', { name: '记录想法或输入任务' });
  await field.fill('让每个任务有清楚的下一步');
  await field.press('Enter');
  const first = journal.locator('[data-task]').filter({ hasText: '让每个任务有清楚的下一步' });
  await first.getByRole('button', { name: '讨论方案', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-task'));
  const project = () => page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('quandeck.projects.v1'));
    return lib.projects[lib.activeProjectId];
  });
  assert.equal(Object.keys((await project()).sessions).length, 0, 'manual capture does not start a conversation');
  assert(!await page.getByText('请在桌面版连接 Agent 后使用 AI 精简标题，原文已保留').count(), 'short manual titles skip AI summarization');
  assert(!await first.getByRole('button', { name: '成果地图' }).isVisible());
  assert(!await first.getByText('补充要求、进展或资料…').isVisible());
  assert(!await journal.locator('.qd-composer-wrap').isVisible());
  assert.equal(await first.getByRole('checkbox').count(),0);
  const manual=first.getByRole('button',{name:'提交候选成果',exact:true});
  await manual.click();
  const editor=page.getByRole('dialog',{name:'提交候选成果'});
  assert.equal(await editor.getByRole('checkbox').count(),0);
  assert(!await editor.getByRole('button',{name:'提交并完成任务',exact:true}).count());
  await editor.getByRole('textbox',{name:'结果内容'}).fill('尚在整理的候选说明。');
  await editor.getByRole('button',{name:'存草稿',exact:true}).click();
  await first.getByRole('button',{name:'继续成果草稿',exact:true}).waitFor();
  assert(!(await project()).tasks[await first.getAttribute('data-task')].completion,'draft cannot complete the task');
  for (const width of [1440,1024,768,320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const button of [first.getByRole('button', {name:'讨论方案',exact:true}),first.getByRole('button',{name:/委派给默认 Agent/})]) {
      const box = await button.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width);
    }
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  }
  await first.getByRole('button', {name:'讨论方案',exact:true}).click();
  await page.locator('[data-plan-id]').waitFor();
  assert(!await page.locator('.qd-grid').getByRole('button',{name:'创建任务',exact:true}).isVisible());
  assert.equal(Object.keys((await project()).sessions).length, 0, 'opening the plan alone does not dispatch');
  await page.getByRole('button',{name:'返回上一页',exact:true}).click();
  await journal.getByRole('button',{name:/已完成\s*0/}).click();
  await journal.getByRole('button', { name: '新任务', exact: true }).click();
  await field.fill('在已完成筛选下创建第二项');
  await field.press('Enter');
  const second = journal.locator('[data-task]').filter({hasText:'在已完成筛选下创建第二项'});
  await second.getByRole('button',{name:'讨论方案',exact:true}).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('在已完成筛选下创建第二项') && document.activeElement?.hasAttribute('data-task'));
  await journal.getByRole('button',{name:'新任务',exact:true}).click();
  await field.fill('从新建时直接进入方案');
  await journal.getByRole('button',{name:'先讨论方案',exact:true}).click();
  await page.locator('[data-plan-id]').waitFor();
  assert.equal(Object.keys((await project()).tasks).length, 3);
  assert.equal(Object.keys((await project()).sessions).length, 0);
  assert.deepEqual(errors, []);
  console.log('Task start: empty and filtered projects, saved-row keyboard focus, two named actions, clean widths 320/768/1024/1440, optional task discussion with no auto-dispatch passed.');
} finally { await browser.close(); }
