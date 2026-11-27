import { openProjectTools } from './fixtures/project-tools.mjs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({channel:'chrome', headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
try {
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  let repositoryModule;
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/src/data/repository.ts') repositoryModule = response.url();
  });
  // Keep Vite source edits in parallel tasks from reloading this isolated test mid-click.
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(origin);
  await page.getByRole('navigation',{name:'主导航'}).waitFor();
  const titles = ['规划大阪到京都的住宿','规划京都站到岚山的住宿','确认午餐人数','实现导出按钮'];
  const workspace = {role:'code',source:'/sample',directory:'/sample-worktrees/export',branch:'codex/export',baseSha:'a'.repeat(40)};
  assert(repositoryModule);
  await page.evaluate(async ({titles,workspace,repositoryModule}) => {
    const { localDataSource:api } = await import(repositoryModule);
    if (window.quandeckDesktop || (await api.listProjects()).length) throw Error('Expected isolated test data');
    const project = await api.createProject({name:'周末行程'});
    for (const title of titles) {
      const task = await api.createTaskWithAttachments(title, [], project.projectId);
      if (!task.ok) throw Error(task.message);
      await api.setTaskOwner(task.taskId, 'agent');
      if (title === titles[3]) api.mutateRuntimeProject(project.projectId, snapshot => {
        const sessionId = 'sample-session', at = new Date().toISOString();
        snapshot.tasks[task.taskId].sessionIds.push(sessionId);
        snapshot.sessions[sessionId] = {id:sessionId,agentId:'codex',title,origin:'dispatch',taskId:task.taskId,
          status:'archived',startedAt:at,endedAt:at,lastActivity:at,step:null,tokens:null,rounds:[],subAgents:[],
          runtime:{runId:'sample-run', dispatchId:'sample-dispatch', projectId:project.projectId, taskId:task.taskId,
            purpose:'execution',connection:{connectionId:'sample',tool:'codex',projectPath:workspace.source},
            context:{capturedAt:at,taskTitle:title,prompt:''},sequence:1,eventIds:[],taskWorkspace:workspace}};
      });
    }
  }, {titles,workspace,repositoryModule});
  const openProjects = () => page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你管',exact:true}).click();
  await page.reload();
  await openProjects();
  await openProjectTools(page);
  const panel = page.getByRole('region',{name:'共同决定',exact:true});
  const button = label => panel.getByRole('button',{name:label,exact:true});
  await button('核对范围').first().click();
  await panel.getByLabel('要共同决定什么').fill('京都住宿');
  await panel.getByLabel('适用范围').fill('两位旅客，12 月 8 日入住一晚');
  await button('建立共同决定').click();
  const addOption = async text => {
    await button('添加备选方案').click();
    await panel.getByRole('textbox',{name:'备选方案'}).fill(text);
    await button('保存备选方案').click();
    await panel.getByRole('list',{name:'备选方案'}).getByText(text,{exact:true}).waitFor();
  };
  await addOption('京都站附近');
  await addOption('岚山附近');
  await button('选择此方案').first().click();
  await panel.getByLabel('选择理由').fill('方便晚到的旅客');
  await button('确认采用方案').click();
  await panel.locator('.qs-selected').getByText(/京都站附近/).waitFor();
  await button(titles[1]).click();
  await page.getByRole('heading',{name:titles[1],exact:true}).waitFor();
  await panel.locator('.qs-selected').getByText(/京都站附近/).waitFor();
  await button('改用此方案').click();
  await panel.getByLabel('选择理由').fill('抵达时间提前，第二天在岚山集合');
  await button('确认更换方案').click();
  await button(titles[0]).click();
  await page.getByRole('heading',{name:titles[0],exact:true}).waitFor();
  await panel.locator('.qs-selected').getByText(/岚山附近/).waitFor();
  await page.locator('.qp-tree').getByRole('button',{name:titles[2],exact:true}).click();
  assert.equal(await panel.getByRole('heading',{name:'京都住宿'}).count(),0);
  await page.reload();
  await openProjects();
  await openProjectTools(page);
  await panel.locator('.qs-selected').getByText(/岚山附近/).waitFor();
  await panel.locator('summary').filter({hasText:'决定记录'}).click();
  await panel.getByText('方便晚到的旅客',{exact:true}).waitFor();
  await panel.getByText('抵达时间提前，第二天在岚山集合',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await button('关联更多任务').click();
  await panel.getByRole('checkbox',{name:titles[2],exact:true}).check();
  await button('保存关联').click();
  await button(titles[2]).click();
  await page.getByRole('heading',{name:titles[2],exact:true}).waitFor();
  await panel.locator('.qs-selected').getByText(/岚山附近/).waitFor();
  await button('解除关联').click();
  await panel.getByRole('checkbox',{name:titles[2],exact:true}).uncheck();
  await button('确认解除关联').click();
  await panel.getByRole('heading',{name:'京都住宿'}).waitFor({state:'hidden'});
  await button('关联任务').click();
  await panel.getByLabel('要共同决定什么').fill('核对抵达人数');
  await panel.getByLabel('适用范围').fill('抵达车站时的同行人员');
  await panel.getByRole('checkbox',{name:titles[0],exact:true}).check();
  await button('建立共同决定').click();
  await panel.getByRole('heading',{name:'核对抵达人数'}).waitFor();
  await button('解除关联').click();
  await panel.getByRole('checkbox',{name:titles[0],exact:true}).uncheck();
  await button('解除这项共同决定').click();
  await panel.getByRole('heading',{name:'核对抵达人数'}).waitFor({state:'hidden'});
  assert.equal(await page.locator('.qw-task-workspace').count(),0);
  await page.locator('.qp-tree').getByRole('button',{name:titles[3],exact:true}).click();
  await page.locator('.qw-task-workspace summary').click();
  await page.getByText(workspace.directory,{exact:true}).waitFor();
  await page.getByText(workspace.baseSha,{exact:true}).waitFor();
  await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{value:{writeText:async s => { window.testClipboard = s; }}}));
  await page.getByRole('button',{name:'复制工作树信息'}).click();
  assert.equal(await page.evaluate(() => window.testClipboard), [workspace.directory,workspace.branch,workspace.baseSha].join('\n'));
  await page.addInitScript(workspace => {
    window.quandeckDesktop = {platform:'darwin', bootstrap:async()=>({}), getConnection:async()=>({baseUrl:'http://127.0.0.1:4175',token:'fixture'}), onStorageError:()=>()=>{}, onRunEvent:()=>()=>{},
      getRun:async id=>({runId:id,sessionId:'sample-session',purpose:'execution',status:'done',events:[],taskWorkspace:workspace})};
  },workspace);
  await page.goto(origin+'/?run=sample-run');
  await page.locator('.qw-task-workspace summary').click();
  await page.getByText(workspace.directory,{exact:true}).waitFor();
  await page.getByText(workspace.baseSha,{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Shared decision UI passed: scope review, options, explicit confirmation, change history, task navigation, isolation, persistence, narrow layout and bound task workspace in both pages.');
} catch (cause) {
  console.error((await page.locator('body').innerText()).slice(-3500));
  throw cause;
} finally { await browser.close(); }
