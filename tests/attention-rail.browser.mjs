import assert from 'node:assert/strict';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:950}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4173')+'/tests/attention-rail.preview.html');
  const rail=page.getByRole('region',{name:'需要你处理的执行'});
  await rail.getByRole('heading',{name:'需要你处理'}).waitFor();
  const compact=page.getByRole('region',{name:'任务紧凑待办'});
  await compact.getByRole('button',{name:/回复：交付到哪里/}).click();
  const question=rail.getByRole('region',{name:'Agent 提问'}), approval=rail.getByRole('region',{name:'操作授权'});
  await question.getByRole('radio',{name:'南京'}).check();
  await question.getByRole('button',{name:'发送回答'}).click();
  await rail.getByRole('alert').waitFor();
  assert(await question.getByRole('radio',{name:'南京'}).isChecked());
  assert(!(await compact.getByRole('radio',{name:'南京'}).isChecked()),'independent radio groups');
  await approval.getByRole('button',{name:/允许本次/}).click();
  await approval.waitFor({state:'detached'});
  assert(await question.getByRole('radio',{name:'南京'}).isChecked());
  await question.getByRole('button',{name:'发送回答'}).click();
  await rail.waitFor({state:'detached'});
  assert.equal(await compact.getByRole('button').count(),0);
  const calls=await page.evaluate(()=>window.railControls);
  assert.deepEqual(calls.map(x=>[x.id,x.action,x.payload.requestId,x.payload.requestToken]),[
    ['s1','reply','q','question-token'],['s2','reply','p','permission-token'],['s1','reply','q','question-token']]);
  assert.equal(calls[1].payload.approvalOptionId,'p-once');
  assert.deepEqual(calls[2].payload.answer,{answers:{city:{answers:['南京']}}});
  // A desktop host exposes the native reviewer choice. The browser fixture records
  // only host calls; the runtime contract separately checks both source decisions.
  await page.addInitScript(()=>{
    window.nativeCalls=[];
    window.quandeckDesktop={
      onNavigate:()=>()=>{},
      setCodexApprovalMode:async mode=>{window.nativeCalls.push({mode});},
      controlRun:async (id,action,payload)=>{window.nativeCalls.push({id,action,payload});return {ok:true};}
    };
  });
  await page.reload();
  const delegate=rail.getByRole('button',{name:'以后由 AI 审批'});
  if (process.env.APPROVAL_SCREENSHOT) await approval.screenshot({path:process.env.APPROVAL_SCREENSHOT});
  await delegate.click();
  await delegate.waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>window.nativeCalls), [
    {mode:'ai'},{id:'run-s2',action:'reply',payload:{requestId:'p',requestToken:'permission-token',delegateToAI:true}}
  ]);
  assert.equal(await question.getByRole('button',{name:'发送回答'}).count(),1);
  assert.deepEqual(errors,[]);
  console.log('Rail inline approval, structured answer, identity, retry retaining selection and zero remaining reminders passed.');
} finally { await browser.close(); }
