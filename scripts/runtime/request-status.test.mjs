import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRuntimeDriver } from './driver.mjs';

// A silent App Server peer: after an answer it deliberately emits no progress event.
// This reproduces the native UI bug that ordinary fast-finishing fixtures conceal.
async function harness() {
  const writes = [];
  let child, onAnswer;
  const driver = createRuntimeDriver({
    getConnection: () => ({ connectionId: 'connection', tool: 'codex', binary: '/test/codex', projectPath: '/test/project' }),
    spawnProcess() {
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let exited = false;
      child.kill = () => { if (!exited) { exited = true; child.emit('exit', 0); child.emit('close', 0); } };
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        const message = JSON.parse(chunk.toString());
        writes.push(message);
        if (message.method === 'initialize') send({ id: message.id, result: {} });
        if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread' } } });
        if (message.method === 'turn/start') {
          send({ id: message.id, result: { turn: { id: 'turn' } } });
          send({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
        }
        if (message.method === 'turn/interrupt') send({ id: message.id, result: {} });
        if (!message.method) onAnswer?.(message);
        done();
      } });
      child.stdin.on('finish', child.kill);
      return child;
    },
  });
  function send(message) { child.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }
  const run = await driver.run({ dispatchId: 'dispatch', connectionId: 'connection', projectId: 'project', taskId: 'task', prompt: 'Create the requested guide' });
  return {
    driver, writes, child, runId: run.runId,
    read: () => driver.read(run.runId),
    send,
    onAnswer(callback) { onAnswer = callback; },
    request(id, kind = 'permission') { send({ id, method: kind === 'permission' ? 'item/commandExecution/requestApproval' : 'item/tool/requestUserInput', params: { threadId: 'thread', reason: 'Task operation', questions: [{ id: 'choice', question: 'Choose an option' }] } }); },
    answer(id, decision = 'allowed-once') { return driver.control(run.runId, 'reply', { requestId: String(id), decision }); },
    question(id) { return driver.control(run.runId, 'reply', { requestId: String(id), answer: { answers: { choice: { answers: ['A'] } } } }); },
    close: () => driver.close(),
  };
}

for (const decision of ['allowed-once', 'rejected', 'cancelled']) {
  test(`answering the last permission (${decision}) resumes status without another source event`, async () => {
    const h = await harness();
    try {
      h.request(1);
      assert.equal(h.read().status, 'waiting_permission');
      const result = await h.answer(1, decision);
      assert.equal(result.status, 'running');
      assert.equal(result.events.at(-1).requestResolved, '1');
      assert.equal(result.events.at(-1).status, 'running');
      assert.deepEqual(h.writes.find(message => message.id === 1 && message.result).result, { decision: ({ 'allowed-once': 'accept', rejected: 'decline', cancelled: 'cancel' })[decision] });
      const sent = h.writes.length;
      await assert.rejects(h.answer(1), /过期/);
      assert.equal(h.writes.length, sent);
    } finally { await h.close(); }
  });
}

test('pending permissions take priority; resolving each outstanding request preserves the remaining wait', async () => {
  const h = await harness();
  try {
    h.request(1);
    h.request(2, 'question');
    h.request(3);
    assert.equal(h.read().status, 'waiting_permission');
    h.send({ method: 'item/started', params: { threadId: 'thread', item: { type: 'commandExecution', command: 'ongoing independent work' } } });
    assert.equal(h.read().status, 'waiting_permission');
    assert.equal((await h.answer(1)).status, 'waiting_permission');
    assert.equal((await h.answer(3)).status, 'waiting_reply');
    assert.equal((await h.question(2)).status, 'running');
    assert.deepEqual(h.read().events.filter(event => event.requestResolved).map(event => [event.requestResolved, event.status]), [['1', 'waiting_permission'], ['3', 'waiting_reply'], ['2', 'running']]);
  } finally { await h.close(); }
});

test('a question alone resumes immediately and preserves the exact answer object', async () => {
  const h = await harness();
  try {
    h.request(7, 'question');
    assert.equal(h.read().status, 'waiting_reply');
    assert.equal((await h.question(7)).status, 'running');
    assert.deepEqual(h.writes.find(message => message.id === 7 && message.result).result, { answers: { choice: { answers: ['A'] } } });
  } finally { await h.close(); }
});

for (const [sourceStatus, expected] of [['completed', 'waiting_reply'], ['interrupted', 'paused'], ['failed', 'failed']]) {
  test(`a request from a ${sourceStatus} turn cannot send an answer or revive the run`, async () => {
    const h = await harness();
    try {
      h.request(1);
      h.send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: sourceStatus } } });
      const sent = h.writes.length;
      await assert.rejects(h.answer(1), /过期|停止/);
      assert.equal(h.writes.length, sent);
      assert.equal(h.read().status, expected);
      h.request(2);
      assert.equal(h.read().status, expected);
      assert.ok(h.writes.at(-1).error);
    } finally { await h.close(); }
  });
}

for (const [action, expected] of [['stop', 'paused'], ['cancel', 'cancelled'], ['archive', 'done']]) {
  test(`a stale response after ${action} cannot change status or send a source answer`, async () => {
    const h = await harness();
    try {
      h.request(1);
      await h.driver.control(h.runId, action);
      const sent = h.writes.length;
      await assert.rejects(h.answer(1), /过期/);
      assert.equal(h.writes.length, sent);
      assert.equal(h.read().status, expected);
    } finally { await h.close(); }
  });
}

test('failed reply transmission keeps the request pending', async () => {
  const h = await harness();
  try {
    h.request(1);
    h.child.stdin.destroy();
    await assert.rejects(h.answer(1), /连接已关闭/);
    assert.equal(h.read().status, 'waiting_permission');
    assert.equal(h.read().events.some(event => event.requestResolved === '1'), false);
  } finally { h.child.kill(); await h.close(); }
});

test('source completion during reply wins over the local resolved-request status', async () => {
  const h = await harness();
  try {
    h.request(1);
    h.onAnswer(() => h.send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }));
    assert.equal((await h.answer(1)).status, 'waiting_reply');
    assert.equal(h.read().events.at(-1).requestResolved, '1');
    assert.equal(h.read().events.at(-1).status, undefined);
  } finally { await h.close(); }
});
