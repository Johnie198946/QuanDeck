import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeDriver } from './driver.mjs';
import { checkCodexApprovalReceipt, codexApprovalPolicy } from './codex-approval-mode.mjs';

const binary = fileURLToPath(new URL('./fixtures/protocol-peer.mjs', import.meta.url));
const input = { dispatchId: 'dispatch', connectionId: 'local', projectId: 'p', taskId: 't', agentId: 'codex', prompt: 'report-approval-policy' };
const expected = {
  manual: ['on-request', 'user', 'workspaceWrite'],
  ai: ['on-request', 'auto_review', 'workspaceWrite'],
  full: ['never', 'user', 'dangerFullAccess'],
};
function createDriver(getCodexApprovalMode, model) {
  return createRuntimeDriver({
    getConnection: () => ({ connectionId:'local', tool:'codex', projectPath:path.dirname(binary), binary, nodePath:process.execPath, model }),
    getCodexApprovalMode,
  });
}
async function waitFor(read) {
  for (let i = 0; i < 200; i++) {
    const value = read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Expected source receipt');
}
function assertPolicy(record, mode) {
  const receipt = JSON.parse(record.lastReply);
  assert.deepEqual([receipt.approvalPolicy, receipt.approvalsReviewer, receipt.sandbox.type], expected[mode]);
}

test('host selection controls native permissions across start, next turn, and paused resume', async () => {
  let mode = 'manual';
  const driver = createDriver(() => mode);
  try {
    const first = await driver.run({...input, codexApprovalMode:'full'});
    const read = () => driver.read(first.runId);
    await waitFor(() => read().events.some(e => e.turnCompleted));
    assertPolicy(read(), 'manual');
    for (const next of ['ai', 'full', 'manual']) {
      if (next === 'full') await driver.control(first.runId, 'stop');
      mode = next;
      const cursor = read().sequence;
      await driver.control(first.runId, next === 'full' ? 'resume' : 'reply', {prompt: input.prompt});
      await waitFor(() => read().events.some(e => e.sequence > cursor && e.turnCompleted));
      assertPolicy(read(), mode);
      assert.equal(read().sessionId, first.sessionId);
    }
  } finally { await driver.close(); }
});

test('unconfirmed automatic policy blocks before task dispatch, manual supports older receipts', async () => {
  for (const mode of ['ai','full']) {
    const driver = createDriver(() => mode, 'unconfirmed-approval');
    try {
      await assert.rejects(driver.run(input), /未确认所选工具授权/);
      const [run] = driver.listRuns();
      assert.equal(run.acceptance, 'rejected');
      assert.equal(run.events.some(e => e.message || e.turnCompleted), false);
    } finally { await driver.close(); }
  }
  checkCodexApprovalReceipt('manual', {thread:{id:'older-client'}});
  assert.throws(() => checkCodexApprovalReceipt('manual', { sandbox:{type:'dangerFullAccess'} }), /未确认/);
  assert.throws(() => codexApprovalPolicy('unexpected'), /有效/);
});

test('native approval modes never answer a source question or resolve an existing permission retroactively', async () => {
  let mode = 'manual';
  const driver = createDriver(() => mode);
  try {
    const r = await driver.run({...input, prompt:'permission'});
    const read = () => driver.read(r.runId);
    await waitFor(() => read().events.find(e => e.request));
    mode = 'full';
    await assert.rejects(driver.control(r.runId, 'reply', {prompt:'continue'}), /先处理当前授权/);
    assert.equal(read().status, 'waiting_permission');
    await driver.control(r.runId, 'reply', {requestId:'88', decision:'rejected'});
    await waitFor(() => read().events.some(e => e.turnCompleted));
    const cursor = read().sequence;
    await driver.control(r.runId, 'reply', {prompt:'question'});
    const question = await waitFor(() => read().events.find(e => e.sequence > cursor && e.request?.kind === 'question'));
    assert.equal(read().status, 'waiting_reply');
    assert.equal(read().events.some(e => e.requestResolved === question.request.id), false);
  } finally { await driver.close(); }
});

test('one explicit choice continues the same source thread with native review for successive operations', async () => {
  let mode = 'manual';
  const driver = createDriver(() => mode, 'sequential-approval');
  try {
    const run = await driver.run({...input, prompt:'permission'});
    const read = () => driver.read(run.runId);
    const request = await waitFor(() => read().events.find(e => e.request)?.request);
    assert.equal(request.canDelegateToAI, true);
    const choice = {requestId:request.id,requestToken:request.token,delegateToAI:true};
    await assert.rejects(driver.control(run.runId,'reply',choice), /授权方式或请求已变化/);
    mode = 'ai';
    await assert.rejects(driver.control(run.runId,'reply',{...choice,requestToken:'stale'}), /请求已更新/);
    await driver.control(run.runId,'reply',choice);
    const question = await waitFor(() => read().events.find(e => e.request?.kind==='question')?.request);
    const events = read().events;
    assert.equal(read().sessionId, run.sessionId);
    assert.equal(events.filter(e => e.request?.kind==='permission').length, 1);
    assert.deepEqual(events.filter(e => e.log?.label.startsWith('AI 已')).map(e => e.log.detail), ['approved','denied']);
    assert.equal(events.some(e=>e.requestResolved===question.id),false);
    await assert.rejects(driver.control(run.runId,'reply',choice),/请求已更新/);
    await driver.control(run.runId,'reply',{requestId:question.id,requestToken:question.token,answer:{ answers:{design:{answers:['A']}} }});
    await waitFor(() => read().events.some(e=>e.turnCompleted));
    const next = await driver.run({...input,dispatchId:'another-task',taskId:'next'});
    await waitFor(() => driver.read(next.runId).events.some(e=>e.turnCompleted));
    assertPolicy(driver.read(next.runId),'ai');
    mode='manual';
    const manual = await driver.run({...input,dispatchId:'back-to-manual',taskId:'third',prompt:'permission'});
    await waitFor(() => driver.read(manual.runId).events.some(e=>e.request?.kind==='permission'));
  } finally { await driver.close(); }
});

test('delegation preserves an outstanding business question and honors source-side resolution', async () => {
  let mode='manual';
  const driver=createDriver(()=>mode);
  try {
    const mixed=await driver.run({...input,prompt:'mixed-requests'});
    const read=()=>driver.read(mixed.runId);
    await waitFor(()=>read().events.some(e=>e.request?.kind==='question'));
    const permission=read().events.find(e=>e.request?.kind==='permission').request;
    mode='ai';
    await assert.rejects(driver.control(mixed.runId,'reply',{requestId:permission.id,requestToken:permission.token,delegateToAI:true}),/先处理当前问题/);
    assert.equal(read().events.some(e=>e.requestResolved),false);
    mode='manual';
    const other=await driver.run({...input,dispatchId:'resolved-dispatch',taskId:'other',prompt:'already-resolved'});
    await waitFor(()=>driver.read(other.runId).events.some(e=>e.turnCompleted));
    const events=driver.read(other.runId).events;
    assert.equal(events.filter(e=>e.requestResolved==='88').length,1);
    await assert.rejects(driver.control(other.runId,'reply',{requestId:'88',decision:'allowed-once'}),/请求已过期/);
  } finally { await driver.close(); }
});
