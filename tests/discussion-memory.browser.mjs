import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless:true, channel:'chrome' });
try {
  const page = await browser.newPage({ viewport:{width:1440, height:960} });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  const project = await page.evaluate(async () => {
    const { LocalWorkdeckDataSource } = await import('/src/data/repository.ts');
    const { createRuntimeDataSource } = await import('/src/data/runtimeDataSource.ts');
    const base = new LocalWorkdeckDataSource();
    let emit;
    const prompts = [];
    const runtime = createRuntimeDataSource(base, { subscribe: listener => { emit = listener; return () => {}; },
      control:async (_run, _action, payload) => { prompts.push(payload.prompt); }, scan:async () => [], listRuns:() => [],
      run:async input => ({runId:'synthetic-browser-run', sessionId:'synthetic-browser-session', connectionId:input.connectionId, acceptedAt:new Date().toISOString()}) });
    const name = '纸本核验演练', projectId = (await base.createProject({ name, description:'核对纸本记录过程' })).projectId;
    await base.registerAgent({id:'codex',name:'Codex',short:'C',color:'#333333'});
    await runtime.bindRuntimeConnection('codex', {connectionId:'synthetic-local',tool:'codex',projectPath:'/synthetic'});
    const command = async (type, payload, taskId) => {
      const result = await base.collaborate({ projectId, type, payload, taskId, expectedVersion:taskId ? (await base.load()).collaboration.tasks[taskId].version : undefined, idempotencyKey:crypto.randomUUID() });
      if (!result.ok) throw Error(result.message);
      return result.resourceId;
    };
    const taskId = await command('create_task',{title:'现场交接',goal:'核对',owner:'me',criteria:['确认']});
    const submissionId = await command('submit',{title:'演练记录',body:'两人在交班时签下编号 A17。'},taskId);
    await command('review',{submissionId,verdict:'accepted',checks:[true],note:'已核对'},taskId);
    const artifact = (await base.load()).collaboration.artifacts[0];
    const experience = await command('record_memory_note',{status:'confirmed',situation:'纸本交班核对',action:'交班双方分别签名',outcome:'编号齐全',limitation:'限双人值守',artifactId:artifact.id,artifactHash:artifact.hash});
    await command('record_memory_note',{status:'confirmed',situation:'冷藏运输',action:'出库前读取温度计',outcome:'维持低温',limitation:'仅适用于冷藏箱',artifactId:artifact.id,artifactHash:artifact.hash});
    const planId = await base.ensureProjectPlan(projectId), plan = (await base.load()).ideaPlans[planId];
    const result = await runtime.sendDirectionMessage({projectId,planId,scope:'root',draftVersion:plan.draftVersion,agentId:'codex',messageId:'test-first',text:'纸本交班怎么核对'});
    if (!result.ok) throw Error(result.message);
    const recordAnswer = async (sequence, summary) => {
      emit({id:'receipt-' + sequence,runId:'synthetic-browser-run',sessionId:'synthetic-browser-session',status:'waiting_reply',sequence,at:new Date().toISOString(),
        reply:{id:'answer-' + sequence,text:'<quandeck-conclusion>' + JSON.stringify({summary,confirmed:[],open:[]}) + '</quandeck-conclusion>'}});
      await runtime.flushRuntime();
      return (await base.load()).ideaPlans[planId].discussion.conclusions.at(-1).id;
    };
    const firstReplyId = await recordAnswer(1, '请在交接班时让双方签字。');
    const follow = await runtime.sendDirectionMessage({projectId,planId,scope:'root',draftVersion:plan.draftVersion,agentId:'codex',messageId:'test-followup',conclusionId:firstReplyId,text:'冷藏运输注意什么？'});
    if (!follow.ok || !prompts.at(-1)?.includes('出库前读取温度计')) throw Error(follow.message || 'Missing turn evidence');
    await recordAnswer(2, '运输前核对温度。');
    const note = (await base.load()).collaboration.memoryNotes.find(n => n.id === experience);
    runtime.dispose();
    return {name,projectId,noteId:note.noteId,revision:note.revision,firstReplyId};
  });

  const enter = async () => {
    await page.reload();
    await page.getByRole('button', {name:'方向方案',exact:true}).filter({visible:true}).first().click();
    await page.getByRole('form', {name:'方案意见'}).waitFor();
  };
  await enter();
  const summary = page.getByText('已提供给本次讨论的经验 · 2', {exact:true});
  const scope = page.getByRole('form', {name:'方案意见'});
  await summary.waitFor();
  assert.equal(await scope.getByText('交班双方分别签名').count(),0);
  await summary.click();
  await scope.getByText('交班双方分别签名',{exact:true}).waitFor();
  assert.match(await scope.innerText(), /首次提问/);
  assert.match(await scope.innerText(), /限双人值守/);
  assert.match(await scope.innerText(), /追问/);
  await scope.getByText('出库前读取温度计', {exact:true}).waitFor();
  await scope.getByText('来源：演练记录 · v1',{exact:true}).first().click();
  await scope.getByLabel('来源正文').waitFor();
  assert.match(await scope.getByLabel('来源正文').innerText(), /编号 A17/);
  assert.doesNotMatch(await scope.innerText(), /已采用/);
  if (process.env.EVIDENCE_DIR) {
    await mkdir(process.env.EVIDENCE_DIR,{recursive:true});
    await page.screenshot({path:process.env.EVIDENCE_DIR + '/discussion-memory.png'});
  }
  await page.getByRole('button',{name:'讨论与版本',exact:true}).click();
  const history = page.getByRole('complementary',{name:'讨论与版本'});
  await history.getByLabel('查看结论记录').selectOption(project.firstReplyId);
  await history.getByText('回复时已提供的经验 · 1',{exact:true}).click();
  await history.getByText('交班双方分别签名',{exact:true}).waitFor();
  assert.doesNotMatch(await history.innerText(), /出库前读取温度计/);
  await page.getByRole('button',{name:'收起讨论',exact:true}).click();
  await page.setViewportSize({width:320,height:640});
  const editor = scope.locator('textarea');
  await page.waitForFunction(() => document.querySelector('.qd-ws')?.dataset.discussionNarrow === 'true');
  await editor.scrollIntoViewIfNeeded();
  assert(await editor.evaluate(e => {
    const box = e.getBoundingClientRect();
    return e.contains(document.elementFromPoint(box.x + 8, box.y + 8));
  }), 'the editor is reachable with its lesson details expanded');
  await summary.click();
  await scope.getByText('交班双方分别签名',{exact:true}).waitFor({state:'hidden'});
  assert(await editor.evaluate(e => e.getBoundingClientRect().bottom <= innerHeight));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'讨论这一节',exact:true}).first().click();
  assert.equal(await scope.getByText(/已提供给本次讨论的经验/).count(),0, 'another scope cannot see the first discussion packet');
  await page.getByRole('button',{name:'返回整个方案'}).click();
  await summary.waitFor();
  await page.evaluate(async ({projectId,noteId,revision}) => {
    const { LocalWorkdeckDataSource } = await import('/src/data/repository.ts');
    const db = new LocalWorkdeckDataSource();
    const result = await db.collaborate({projectId,type:'record_memory_note',payload:{status:'withdrawn',noteId,expectedRevision:revision},idempotencyKey:crypto.randomUUID()});
    if (!result.ok) throw Error(result.message);
  },project);
  await enter();
  await summary.click();
  await scope.getByText(/现已撤回/).waitFor();
  assert.deepEqual(errors,[]);
  console.log('discussion memory browser passed: acknowledged first and follow-up context, opt-in reading, exact source, historical reply cutoff, section isolation, withdrawal across reload');
} finally {
  await browser.close();
}
