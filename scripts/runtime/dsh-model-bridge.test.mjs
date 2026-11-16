import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgeService, createBridgeServer } from '../agent-bridge.mjs';

const peer = fileURLToPath(new URL('./fixtures/dsh-model-peer.mjs', import.meta.url));
const route = model => ({ api: 'openai-completions', baseURL: 'https://private-gateway.example.invalid/v1', apiKeyEnv: 'PRIVATE_REFERENCE', models: [{ id: model }] });
const baseConfig = [
  ...['llm', 'session', 'agent', 'tools', 'system-prompt', 'agent-loop', 'sdk-app', 'sdk-jsonrpc-server', 'session-persistence-jsonl', 'tool-bash-persistent', 'settings', 'config-editor', 'hmr'].map(name => ({ id: name, name: `@deepseek-ai/dsh-${name}` })),
  { id: 'sdk-adapter', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { existing: route('sdk-model') } } },
  { id: 'sdk-default', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'existing', model: 'sdk-model' } },
];
const source = model => [
  { id: 'llm-pi-ai', config: { providers: { enterprise: route(model) } } },
  { id: 'agent-default-model', config: { provider: 'enterprise', model } },
];
async function fixture(t, extra = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'qd-model-bridge-')));
  const home = path.join(root, 'dsh'), profile = path.join(home, 'profiles/xlink-desktop');
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
  const sourcePath = path.join(profile, 'cordis.patch.yml');
  await writeFile(sourcePath, JSON.stringify(source('corp-model')));
  const config = path.join(root, 'base.json'), tracePath = path.join(root, 'trace.jsonl'), cli = path.join(root, 'cli.mjs');
  await writeFile(config, JSON.stringify(baseConfig)); await writeFile(tracePath, '');
  await writeFile(cli, `process.env.QD_MODEL_BASE=${JSON.stringify(config)}; process.env.QD_MODEL_TRACE=${JSON.stringify(tracePath)}; await import(${JSON.stringify(peer)});`);
  const options = { dshHome: home, dshModelDirectory: path.join(root, 'private'), ...extra };
  const service = createBridgeService(options);
  t.after(async () => { await service.runtime.close(); await rm(root, { recursive: true, force: true }); });
  const input = { tool: 'dsh', binary: cli, nodePath: process.execPath, projectPath: root };
  const trace = async () => (await readFile(tracePath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  return { root, sourcePath, service, input, trace, options, config };
}

test('bridge discovers private GUI profile, tests model snapshot and restores saved connections after restart', async t => {
  let persisted;
  const f = await fixture(t, { saveConnections: async value => { persisted = structuredClone(value); } });
  const original = await readFile(f.sourcePath, 'utf8');
  const found = await f.service.inspectDshModels(f.input);
  assert.equal(found.candidates[0].profile, 'xlink-desktop'); assert.equal(found.candidates[0].model, 'corp-model');
  assert.equal(found.sdk.model, 'sdk-model');
  assert.doesNotMatch(JSON.stringify(found), /private-gateway|PRIVATE_REFERENCE/);
  assert.equal((await f.trace()).some(frame => frame.kind === 'rpc'), false, 'discovery does not start SDK/model');
  const candidate = found.candidates[0], dshModelSource = { profile: candidate.profile, revision: candidate.revision };
  const defaults = await f.service.test(f.input);
  const receipt = await f.service.test({ ...f.input, dshModelSource, provider: 'old', model: 'old' });
  assert.equal(receipt.status, 'ready'); assert.notEqual(receipt.connectionId, defaults.connectionId);
  assert.deepEqual(receipt.dshModelSource, dshModelSource); assert.deepEqual(receipt.sourceModel, { provider: 'enterprise', model: 'corp-model' });
  assert.equal(receipt.provider, undefined); assert.equal(receipt.model, undefined);
  assert.doesNotMatch(JSON.stringify(receipt), /private-gateway|PRIVATE_REFERENCE|digest|dshModelConfig/);
  assert.equal((await f.trace()).some(frame => frame.method === 'session/prompt'), false, 'handshake is not a model test');
  const probe = await f.service.probe({ tool: 'dsh', connectionId: receipt.connectionId, requestId: 'source-probe-1' });
  assert.equal(probe.status, 'connected'); assert.deepEqual(f.service.runtime.listRuns(), []);
  assert.equal(await readFile(f.sourcePath, 'utf8'), original);
  await writeFile(f.sourcePath, JSON.stringify(source('new-source-model')));
  const restarted = createBridgeService({ ...f.options, connections: persisted });
  try {
    assert.equal((await restarted.probe({ tool: 'dsh', connectionId: receipt.connectionId, requestId: 'restart-probe-1' })).status, 'connected');
    const inits = (await f.trace()).filter(frame => frame.method === 'initialize');
    assert(inits.slice(-2).every(frame => frame.params.model === 'corp-model'), 'saved snapshot survives GUI edits and restart');
  } finally { await restarted.runtime.close(); }
});

test('stale source cannot create a connection or start model execution', async t => {
  const f = await fixture(t), candidate = (await f.service.inspectDshModels(f.input)).candidates[0];
  await writeFile(f.sourcePath, JSON.stringify(source('changed')));
  await assert.rejects(f.service.test({ ...f.input, dshModelSource: { profile: candidate.profile, revision: candidate.revision } }), /来源配置已变化/);
  assert.deepEqual(f.service.exportConnections(), []); assert.equal((await f.trace()).some(frame => frame.kind === 'rpc'), false);
});

test('connection persistence failure never leaves a remembered connection', async t => {
  const f = await fixture(t, { saveConnections: async () => { throw new Error('PRIVATE_DISK_ERROR'); } });
  const candidate = (await f.service.inspectDshModels(f.input)).candidates[0];
  await assert.rejects(f.service.test({ ...f.input, dshModelSource: { profile: candidate.profile, revision: candidate.revision } }), /连接记录保存失败/);
  assert.deepEqual(f.service.exportConnections(), []);
});

test('request cannot supply a model patch path or use DSH profiles with another tool', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.test({ ...f.input, dshModelConfig: { path: '/tmp/arbitrary' } }), /检测到的模型来源/);
  await assert.rejects(f.service.test({ ...f.input, tool: 'codex', dshModelSource: {} }), /只有 DSH/);
  await assert.rejects(f.service.test({ ...f.input, dshModelSource: { path: '/tmp/arbitrary' } }), /重新检查/);
  assert.equal((await f.trace()).some(frame => frame.kind === 'rpc'), false);
});

test('inspection dump errors are sanitized and do not imply missing login', async t => {
  const f = await fixture(t, { exec: async (_binary, args) => { if (args.includes('--version')) return { stdout: '0.2.0-rc.2' }; throw new Error('PRIVATE_KEY_SENTINEL'); } });
  const result = await f.service.inspectDshModels(f.input);
  assert.equal(result.sdk.status, 'unavailable'); assert.equal(result.candidates[0].profile, 'xlink-desktop');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_KEY_SENTINEL|登录|private-gateway/);
});

test('model inspection endpoint requires token and permitted origin', async t => {
  const f = await fixture(t), server = createBridgeServer({ token: 'fixture-only', origins: ['http://127.0.0.1:4181'], service: f.service });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/connections/dsh-models`;
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.input) };
    assert.equal((await fetch(url, request)).status, 401);
    request.headers.Authorization = 'Bearer fixture-only'; request.headers.Origin = 'https://untrusted.invalid';
    assert.equal((await fetch(url, request)).status, 403);
    request.headers.Origin = 'http://127.0.0.1:4181';
    const response = await fetch(url, request); assert.equal(response.status, 200);
    assert.equal((await response.json()).candidates[0].profile, 'xlink-desktop');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
