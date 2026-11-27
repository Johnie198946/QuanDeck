import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
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
  // A real blocker is a request for input even when an older result exists.
  await capsule.click();
  await form.getByRole('textbox').fill('请结合这张路线图继续修改。');
  await form.getByRole('button', {name:'继续修改'}).click();
  await page.waitForFunction(() => window.inboxTest.runs.length === 3);
  const reason = '请补充路线截图，或选择你想继续修改的成果。';
  await page.evaluate(async reason => {
    // Attach a synthetic route sketch to the paragraph referenced by the note.
    const {mutateKnowledge} = await import('/src/data/knowledgeStore.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 72;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle='#e4f4ef'; ctx.fillRect(0,0,120,72);
    ctx.strokeStyle='#43847c'; ctx.lineWidth=4; ctx.beginPath();
    ctx.moveTo(10,52); ctx.lineTo(40,35); ctx.lineTo(70,42); ctx.lineTo(105,15); ctx.stroke();
    const png = await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const file={id:'route-sketch',name:'换乘路线.png',type:'image/png',size:png.size};
    const bytes=new Uint8Array(await png.arrayBuffer());
    window.quandeckDesktop.readKnowledgeImage=async (noteId,fileId)=>{
      if (noteId!=='route' || fileId!==file.id) throw Error('Wrong origin picture');
      return Array.from(bytes);
    };
    window.inboxTest.prepareAttachments=async ({projectId,ids,imageIds})=>{
      if (projectId!==window.inboxTest.projectId || ids.join(',')!=='project-route-sketch' || imageIds?.join(',')!==ids.join(',')) throw Error('Wrong picture delivery');
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      return [{id:ids[0],name:file.name,path:'/isolated/travel/route-sketch.png',sha256,imageUrl:canvas.toDataURL()}];
    };
    window.quandeckDesktop.saveAttachment=async (projectId,input)=>{
      if (projectId!==window.inboxTest.projectId || input.name!==file.name ||
          input.bytes.byteLength!==png.size || !new Uint8Array(input.bytes).every((byte,index)=>byte===bytes[index])) {
        throw Error('Screenshot bytes or destination changed');
      }
      return {...file,id:'project-route-sketch'};
    };
    await mutateKnowledge(library=>{
      const note=library.notes.find(item=>item.id==='route');
      note.body='![路线](attachment:'+file.id+')\n\n如图，'+note.body;
      note.attachments.push(file); note.revision++;
    });
    const { projectId, taskId, base, runs, finish } = window.inboxTest;
    const snapshot = await base.getProjectSnapshot(projectId);
    const sender = Object.values(snapshot.sessions).find(session=>session.runtime?.runId === runs[2].runId);
    if (!sender) throw Error('Missing bound session for the revision');
    const bound = sender.runtime.collaboration;
    const detail = reason + '\n\n已经核对了前两版路线。\n\n[材料核对](ops/change-manifests/materials.md)\n\n任务记录：\ntask_id: ' + taskId
      + '\nworktree: /local/travel/' + 'travel-route-v3-'.repeat(15) + '\nhealth_check: 未运行';
    await finish(runs[2], 'missing-route-image', '<quandeck-submission>' + JSON.stringify({
      schemaVersion: 'quandeck.runtime.v1', kind:'blocker', idempotencyKey:'missing-image', binding:bound, payload:{reason:detail},
    }) + '</quandeck-submission>');
    const updated = await base.getProjectSnapshot(projectId);
    const item = updated.sessions[sender.id];
    const {blockedTaskSession} = await import('/src/data/blockedTask.ts');
    const {selectProductAttention} = await import('/src/data/productAttention.ts');
    const open = selectProductAttention([updated]);
    if (!open.some(alert=>alert.blockedSessionId === sender.id)) throw Error('Structured blocker hidden by '+JSON.stringify(open.map(row=>[row.kind,row.label,row.title])));
    if (!blockedTaskSession(updated,item)) throw Error('Not a resumable blocker: '+JSON.stringify({
      issue:item.runtime.submissionIssue, purpose:item.runtime.purpose, source:item.source,
      origin:item.origin, phase:item.dispatchPhase, task:updated.collaboration.tasks[taskId]?.status,
    }));
  }, reason);
  const alert = reader.locator('.qnr-record').filter({ has: page.getByText('等待补充',{exact:true}) });
  await alert.locator('.qnr-record-head').click();
  await alert.getByText(reason, {exact:true}).waitFor();
  const technical = alert.getByLabel('执行记录原文');
  assert.equal(await technical.isVisible(), false);
  const output = process.env.QUANDECK_UI_OUTPUT || 'output/receipt';
  await mkdir(output, {recursive:true});
  await page.setViewportSize({width:1440,height:900});
  await reader.getByText('成果 · v1', {exact:true}).waitFor();
  await reader.getByText('成果 · v2', {exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'blocked-desktop.png')});
  await page.setViewportSize({width:320,height:780});
  const repair = alert.locator('summary').filter({hasText:'补充材料并继续原任务'});
  await repair.focus();
  await page.keyboard.press('Enter');
  await alert.getByRole('form',{name:'补充任务材料'}).waitFor();
  await alert.getByLabel('换乘路线.png').waitFor();
  await alert.getByLabel('换乘路线.png').check();
  await page.screenshot({path:path.join(output,'blocked-mobile.png')});
  assert(await reader.evaluate(el=>el.scrollWidth <= el.clientWidth + 1), 'mobile drawer overflows: ' + await reader.evaluate(el=>Array.from(el.querySelectorAll('*')).filter(node=>node.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map(node=>node.tagName+'.'+node.className).join(' ')));
  await repair.press('Enter');
  const logs = alert.locator('summary').filter({hasText:'执行记录'});
  await logs.focus();
  await page.keyboard.press('Space');
  await technical.waitFor();
  assert.match(await technical.innerText(), /health_check: 未运行/);
  assert(await reader.evaluate(el=>el.scrollWidth <= el.clientWidth + 1), 'long path overflows');
  await logs.press('Enter');
  await repair.press('Enter');
  const supplement = '请基于第二版和附图补充换乘步行时间。';
  await alert.getByRole('textbox').fill(supplement);
  await alert.getByRole('combobox').selectOption({index:1});
  await alert.getByRole('button',{name:'发送并继续原任务'}).click();
  await page.waitForFunction(()=>window.inboxTest.runs.length===4 || !!document.querySelector('.qnr-recover [role=alert]'));
  if (await alert.getByRole('alert').isVisible()) throw Error(await alert.getByRole('alert').innerText());
  const sent = await page.evaluate(async()=>{
    const {base,runs,taskId,projectId} = window.inboxTest;
    const snapshot=await base.getProjectSnapshot(projectId);
    const input=snapshot.tasks[taskId].inputs.find(item=>item.blockedSessionId);
    return {original:runs[3].projectId===projectId && runs[3].taskId===taskId, input, prompt:runs[3].prompt};
  });
  assert(sent.original);
  assert.equal(sent.input.text,supplement);
  assert.deepEqual(sent.input.attachments.map(file=>file.id),['project-route-sketch']);
  assert(sent.input.resultReference && sent.prompt.includes(sent.input.resultReference));
  await page.keyboard.press('Escape');
  await reader.waitFor({state:'hidden'});
  await page.evaluate(async()=>{
    const {runs,emit,api}=window.inboxTest;
    emit(runs[3],{status:'waiting_permission', request:{id:'test-confirm',kind:'permission',prompt:'测试执行需要用户确认'}});
    await api.flushRuntime();
  });
  await capsule.click();
  const permission=reader.locator('.qnr-record').filter({hasText:'待授权'}).first();
  if (await permission.locator('.qnr-record-head').getAttribute('aria-expanded')!=='true') await permission.locator('.qnr-record-head').click();
  await permission.getByRole('button',{name:'处理提醒'}).click();
  const approval=page.locator('.qd-product-monitor-card.is-selected');
  await approval.getByRole('button',{name:'查看授权'}).click();
  await approval.getByText('测试执行需要用户确认',{exact:true}).waitFor();
  await page.getByRole('button',{name:'返回笔记',exact:true}).click();
  await permission.waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: inline revision, prior versions, live blocker, keyboard disclosures, mobile layout, original screenshot and chosen result returned to the same task.');
} finally {
  await browser.close();
}
