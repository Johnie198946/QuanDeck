import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgeService } from '../agent-bridge.mjs';
import { createRpcProcess } from './driver.mjs';
import { classifyIncident, incidentMetadata } from './health.mjs';

const binary = fileURLToPath(new URL('./fixtures/protocol-peer.mjs', import.meta.url));
const input = { dispatchId: 'auth-classification', connectionId: 'primary', projectId: 'p', taskId: 't', agentId: 'a', prompt: 'silent' };
async function withPeer(accountReply, check) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quandeck-health-auth-'));
  const file = path.join(directory, 'peer.mjs');
  await writeFile(file, (await readFile(binary, 'utf8')).replace("result:{account:{type:'chatgpt'}}", accountReply));
  const connection = { connectionId: 'primary', tool: 'codex', binary: file, nodePath: process.execPath, projectPath: directory };
  const service = createBridgeService({ connections: [connection] });
  try { await check(service, file, directory); }
  finally { await service.runtime.close(); await rm(directory, { recursive: true, force: true }); }
}

test('protocol initialization timeout is retryable; a timed-out submitted turn needs reconciliation', async () => {
  const client = createRpcProcess({binary:process.execPath, args:['-e', 'process.stdin.resume()']});
  try {
    await assert.rejects(client.call('initialize', {}, 20), error => classifyIncident(error).code === 'connection_timeout');
    await assert.rejects(client.call('turn/start', {}, 20), error => classifyIncident(error).code === 'unknown_acceptance');
  } finally { await client.close(); }
});

test('explicit authentication failures include missing authentication and expired access credentials', () => {
  for (const message of ['Not authenticated', 'Unauthenticated', 'Access token expired', 'Refresh token has expired', 'Session token is revoked', 'Expired access token', 'Authentication required', 'authentication_error', '401 Unauthorized', '403 Forbidden', '请先在 Agent 中登录']) {
    assert.equal(classifyIncident(new Error(message)).code, 'login', message);
  }
});

test('metadata unavailability and unrelated token wording do not claim login failure', () => {
  for (const message of ['account metadata temporarily unavailable', 'authentication metadata temporarily unavailable', 'authentication service unavailable', 'token usage unavailable', 'Unable to count tokens', 'pagination token expired', 'request 1401 unavailable']) {
    assert.equal(classifyIncident(new Error(message)).code, 'unknown', message);
  }
  assert.equal(classifyIncident('authentication metadata network error').code, 'network');
  assert.equal(classifyIncident('insufficient_quota 429').code, 'quota');
  assert.equal(classifyIncident('429 too many requests').code, 'rate_limit');
});

test('only safe numeric status and recognized authentication codes are retained', () => {
  const error = { code: -32000, message: 'Request failed', token: 'private-token', data: { statusCode: '401', type: 'authentication_error', authorization: 'private-authorization' } };
  assert.deepEqual(incidentMetadata(error), { status: 401, code: 'authentication_error' });
  assert.equal(classifyIncident(error).code, 'login');
  assert.deepEqual(incidentMetadata({ code: 'secret-provider-code', data: { status: '401 token=secret', type: 'private-token' } }), {});
  assert.deepEqual(incidentMetadata({ code: -32601, message: 'method missing' }), {});
  assert.deepEqual(incidentMetadata({ code: 500, data: { httpStatusCode: 401 } }), { status: 401 });
  assert.equal(classifyIncident({ code: 'permission_denied', message: 'EACCES project directory' }).code, 'project');
});

test('RPC error normalization preserves structured authentication evidence without provider payloads', async () => {
  await withPeer("error:{code:-32000,message:'Request failed token=private-secret',data:{status:401,type:'authentication_error',authorization:'private-auth'}}", async (_service, file, directory) => {
    const rpc = createRpcProcess({ binary: process.execPath, args: [file] }, { cwd: directory });
    try {
      await assert.rejects(rpc.call('account/read', {}), error => {
        assert.equal(error.status, 401);
        assert.equal(error.code, 'authentication_error');
        assert.equal(error.data, undefined);
        assert.equal(classifyIncident(error).code, 'login');
        assert.doesNotMatch(error.message + JSON.stringify(error), /private-secret|private-auth/);
        return true;
      });
    } finally { await rpc.close(); }
  });
});

for (const [name, reply] of [
  ['401 in code', "error:{code:401,message:'Request failed'}"],
  ['403 in nested HTTP status', "error:{code:-32000,message:'Request failed',data:{httpStatusCode:403}}"],
  ['structured expired token', "error:{code:-32000,message:'Request failed',data:{code:'token_expired'}}"],
  ['missing required account', 'result:{account:null,requiresOpenaiAuth:true}'],
]) test(`health blocks ${name} before sending a task prompt`, async () => {
  await withPeer(reply, async service => {
    const report = await service.health({ connectionId: 'primary' });
    assert.equal(report.canStart, false);
    assert.equal(report.issue.code, 'login');
    assert.equal(report.checks.find(check => check.key === 'login').status, 'failed');
    assert.equal(report.checks.find(check => check.key === 'protocol').status, 'passed');
    await assert.rejects(service.runtime.run(input), error => error.rejected === true);
    assert.equal(service.runtime.listRuns().some(run => run.events.some(event => event.message?.role === 'user')), false);
  });
});

test('optional authentication metadata failure stays unknown and delegates execution authentication to source', async () => {
  await withPeer("error:{code:-32601,message:'authentication metadata temporarily unavailable'}", async service => {
    const report = await service.health({ connectionId: 'primary' });
    assert.equal(report.canStart, true);
    assert.equal(report.issue, undefined);
    assert.equal(report.checks.find(check => check.key === 'login').status, 'unknown');
    const receipt = await service.runtime.run(input);
    assert.equal(receipt.acceptance, 'acknowledged');
  });
});
