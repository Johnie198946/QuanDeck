/** Install synthetic business receipts in a fresh browser, then follow both visible recovery buttons. */
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:950}});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
  await page.getByLabel('项目名称',{exact:true}).fill('本项目');
  await page.getByRole('button',{name:'创建项目',exact:true}).click();
  const journal = page.getByRole('region',{name:'项目任务'});
  const field = journal.getByRole('textbox',{name:'记录想法或输入任务'});
  await field.fill('准备本次检查');
  await field.press('Enter');
  await journal.getByRole('button',{name:'讨论方案',exact:true}).click();
  await page.locator('[data-plan-id]').waitFor();
  const planId = await page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('quandeck.projects.v1'));
    const s = lib.projects[lib.activeProjectId], plan = Object.values(s.ideaPlans)[0];
    const old = {...structuredClone(s),project:{...s.project,id:'other',name:'另一项目'}};
    const at = '2026-03-01T10:00:00Z';
    function session(project,id,incident,stale=false) {
      const taskId = stale ? 'planning:'+plan.id+':root:1' : plan.taskId;
      return {id,agentId:'codex',title:stale?'旧讨论':'检查旧连接',status:stale?'waiting_reply':'failed',origin:'dispatch',taskId,dispatchPhase:'acknowledged',lastActivity:at,startedAt:at,
        tokens:null,step:null,percent:null,subAgents:[],rounds:[],runtime:{
          runId:'run-'+id,taskId,projectId:project.project.id,dispatchId:'dispatch-'+id,connection:{connectionId:'test',projectPath:'/fixture',tool:'codex'},
          incident:{id:'health-'+id,status:incident,code:'network',kind:'failure',detectedAt:at,message:'网络断开',title:'网络断开'},
          purpose:stale?'discussion':'execution',planId:stale?plan.id:undefined,context:{capturedAt:at,taskTitle:'测试',prompt:''},eventIds:[],
          submissionIssue:stale?{code:'DISCUSSION_CONTEXT_STALE',message:'方案已更新',messageId:'old-reply',at}:undefined
        }};
    }
    s.sessions.old=session(s,'old','resolved',true);
    s.sessions.historic=session(s,'historic','resolved');
    s.sessions.historic.status='paused';
    s.sessions.retry=session(s,'retry','recovering');
    s.sessions.retry.status='running';
    s.sessions.retry.runtime.incident.kind='attention';
    old.sessions={other:session(old,'other','open')};
    lib.projects.other=old;
    localStorage.setItem('quandeck.projects.v1',JSON.stringify(lib));
    return plan.id;
  });
  await page.reload();
  const all = page.getByRole('button',{name:'任务提醒，全部项目，2 项待处理',exact:true});
  await all.click();
  let dialog = page.getByRole('dialog',{name:/待处理提醒/});
  await dialog.getByRole('navigation',{name:'选择任务提醒'}).getByRole('button',{name:/另一项目/}).click();
  await dialog.getByRole('button',{name:'检查连接',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'关闭任务提醒'}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'任务',exact:true}).click();
  await page.getByRole('button',{name:'任务提醒，当前项目，1 项待处理',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'待处理提醒 · 1'});
  assert.equal(await dialog.getByText('另一项目',{exact:true}).count(),0);
  assert.equal(await dialog.getByRole('button',{name:'检查连接',exact:true}).count(),0);
  assert.equal(await dialog.getByText('换一位 Agent 接着做',{exact:true}).count(),0);
  await page.setViewportSize({width:360,height:760});
  await dialog.getByRole('button',{name:'查看最新方案',exact:true}).click();
  await page.locator('[data-plan-id="'+planId+'"]').waitFor();
  await page.setViewportSize({width:1440,height:950});
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'任务',exact:true}).click();
  const attention=page.getByRole('region',{name:'等你处理'});
  await attention.getByRole('button',{name:/查看最新方案/}).click();
  await page.locator('[data-plan-id="'+planId+'"]').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Scoped task reminders: multi-project overview, active project bell and rail, resolved history omitted, exact stale-plan navigation and connection actions passed.');
} finally { await browser.close(); }
