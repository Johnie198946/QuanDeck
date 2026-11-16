import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeDriver, initializeRuntime } from './driver.mjs';

const peer = fileURLToPath(new URL('./fixtures/dsh-model-peer.mjs', import.meta.url));
const selected = { provider: 'profile-provider', model: 'profile-model', reasoningEffort: 'high' };
const route = model => ({ api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'QD_FIXTURE_API_KEY', models: [{ id: model }] });
const modelPatch = [
  { id: 'adapter', config: { providers: { 'sdk-provider': route('sdk-model'), [selected.provider]: route(selected.model) } } },
  { id: 'default-model', config: selected },
];
const required = ['llm', 'session', 'agent', 'tools', 'system-prompt', 'agent-loop', 'sdk-app', 'sdk-jsonrpc-server'];
const baseConfig = () => [
  ...required.map(name => ({ id: name, name: `@deepseek-ai/dsh-${name}` })),
  { id: 'adapter', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { 'sdk-provider': route('sdk-model') } } },
  { id: 'default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'sdk-provider', model: 'sdk-model' } },
  ...['session-persistence-jsonl', 'tool-bash-persistent', 'agent-instructions', 'hmr', 'settings', 'config-editor'].map(name => ({ id: name, name: `@deepseek-ai/dsh-${name}` })),
  { id: 'custom-tools', name: 'custom-tools', config: { token: 'source-only-test-value' } },
];
const systemInput = { connectionId: 'model-source', projectId: 'test-project', tool: 'dsh', kind: 'connectivity', prompt: 'hello', outputSchema: { type: 'object' }, maxTokens: 256, timeoutMs: 6000 };
const withFixture = async callback => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'quandeck-model-runtime-')));
  const modelConfigDirectory = path.join(root, 'private-models');
  await mkdir(modelConfigDirectory, { mode: 0o700 });
  const baseFile = path.join(root, 'sdk-config.json'), traceFile = path.join(root, 'trace.jsonl');
  const content = JSON.stringify(modelPatch), digest = createHash('sha256').update(content).digest('hex');
  const ref = { path: path.join(modelConfigDirectory, `${digest}.json`), digest, profile: 'desktop-profile', revision: 'a'.repeat(64), ...selected };
  await writeFile(ref.path, content, { mode: 0o600 });
  await writeFile(baseFile, JSON.stringify(baseConfig())); await writeFile(traceFile, '');
  const connection = { connectionId: 'model-source', tool: 'dsh', binary: 'dsh-contract-fixture', projectPath: root, dshModelConfig: ref };
  const commandInvocation = (_binary, args) => ({ binary: process.execPath, args: [peer, ...args], env: { QD_MODEL_BASE: baseFile, QD_MODEL_TRACE: traceFile } });
  const trace = async () => (await readFile(traceFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  try { await callback({ root, ref, content, baseFile, traceFile, trace, connection, options: { commandInvocation, modelConfigDirectory } }); }
  finally { await rm(root, { recursive: true, force: true }); }
};

test('model snapshot overlays SDK defaults and startup, overrides old metadata, and survives close/source changes', async () => withFixture(async ({ connection, options, ref, content, baseFile, trace }) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const rpc = await initializeRuntime({ ...connection, provider: 'old-provider', model: 'old-model' }, options);
    try { assert.deepEqual(rpc.sourceModel, { provider: selected.provider, model: selected.model }); }
    finally { await rpc.close('shutdown'); }
    assert.equal(await readFile(ref.path, 'utf8'), content);
    const changed = baseConfig(); changed.find(row => row.id === 'default-model').config.model = 'changed-sdk-default';
    await writeFile(baseFile, JSON.stringify(changed));
  }
  const frames = await trace(), dumps = frames.filter(frame => frame.kind === 'dump'), inits = frames.filter(frame => frame.method === 'initialize');
  assert.equal(dumps.length, 2); assert.equal(inits.length, 2);
  for (const frame of dumps) { assert.deepEqual(frame.patches, [ref.path]); assert.deepEqual(frame.defaults, selected); }
  for (const frame of inits) { assert.deepEqual(frame.patches, [ref.path]); assert.deepEqual(frame.params, { cwd: connection.projectPath, ...selected }); }
  assert.equal(frames.some(frame => frame.method === 'session/prompt'), false);
}));

test('managed DSH task dispatch uses the selected persistent snapshot through createRuntimeDriver', async () => withFixture(async ({ connection, options, ref, trace }) => {
  const driver = createRuntimeDriver({ getConnection: () => connection, ...options });
  try {
    const run = await driver.run({ dispatchId: 'model-dispatch', connectionId: connection.connectionId, projectId: 'project', taskId: 'task', agentId: 'dsh', prompt: 'business task' });
    assert.equal(run.acceptance, 'acknowledged');
    const init = (await trace()).find(frame => frame.method === 'initialize');
    assert.deepEqual(init.patches, [ref.path]); assert.deepEqual(init.params, { cwd: connection.projectPath, ...selected });
  } finally { await driver.close(); }
  await access(ref.path);
}));

test('DSH hello/title/summary/classification/integration use the same route before isolation, without business runs', async () => withFixture(async ({ connection, options, ref, trace }) => {
  const events = [], driver = createRuntimeDriver({ getConnection: () => connection, ...options, onEvent: event => events.push(event) });
  try {
    for (const kind of ['connectivity', 'title', 'summary', 'classify', 'integration']) {
      const receipt = await driver.assist({ ...systemInput, requestId: `model-${kind}`, kind, prompt: kind === 'title' ? 'TITLE' : 'hello' });
      assert.equal(receipt.toolPolicy, 'isolated-no-tool-plugins'); assert.equal(receipt.contextPolicy, 'new-isolated-session');
      assert.deepEqual(receipt.output, kind === 'title' ? { title: '已选模型标题' } : { reply: 'hello' });
    }
    assert.deepEqual(driver.listRuns(), []); assert.deepEqual(events, []);
    const frames = await trace(), dumps = frames.filter(frame => frame.kind === 'dump'), inits = frames.filter(frame => frame.method === 'initialize');
    assert.equal(dumps.length, 10); assert.equal(inits.length, 5);
    for (const frame of dumps) {
      assert.deepEqual(frame.defaults, selected); assert.equal(frame.patches[0], ref.path);
      if (frame.patches.length === 2) assert.equal(path.basename(frame.patches[1]), 'system.patch.json');
      else assert.equal(frame.patches.length, 1);
    }
    for (const frame of inits) {
      assert.equal(frame.isolated, true); assert.equal(frame.patches[0], ref.path); assert.equal(frame.patches.length, 2);
      assert.equal(path.basename(frame.patches[1]), 'system.patch.json');
      assert.deepEqual(frame.params, { cwd: frame.params.cwd, ...selected });
      assert.notEqual(frame.params.cwd, connection.projectPath); await assert.rejects(access(frame.params.cwd));
    }
  } finally { await driver.close(); }
  await access(ref.path);
}));

test('invalid or untrusted model snapshots fail before any DSH process and do not create system business records', async () => withFixture(async ({ connection, options, ref, trace, root }) => {
  const cases = [
    { connection, options: { ...options, modelConfigDirectory: undefined } },
    { connection: { ...connection, dshModelConfig: { ...ref, path: path.join(root, 'untrusted.json') } }, options },
    { connection: { ...connection, dshModelConfig: { ...ref, digest: '0'.repeat(64) } }, options },
  ];
  for (const [index, entry] of cases.entries()) {
    await assert.rejects(initializeRuntime(entry.connection, entry.options), failure => failure.code === 'DSH_MODEL_SNAPSHOT_INVALID');
    const events = [], driver = createRuntimeDriver({ getConnection: () => entry.connection, ...entry.options, onEvent: event => events.push(event) });
    try {
      await assert.rejects(driver.assist({ ...systemInput, requestId: `bad-snapshot-${index}` }), failure => failure.acceptance === 'rejected' && failure.actualTokens === 0);
      assert.deepEqual(driver.listRuns(), []); assert.deepEqual(events, []);
    } finally { await driver.close(); }
  }
  assert.deepEqual(await trace(), []);
}));

test('snapshot digest is rechecked at subsequent normal and system starts', async () => withFixture(async ({ connection, options, ref, trace }) => {
  const rpc = await initializeRuntime(connection, options); await rpc.close('shutdown');
  const before = await trace(); await appendFile(ref.path, ' ');
  await assert.rejects(initializeRuntime(connection, options), failure => failure.code === 'DSH_MODEL_SNAPSHOT_INVALID');
  const driver = createRuntimeDriver({ getConnection: () => connection, ...options });
  try {
    await assert.rejects(driver.assist({ ...systemInput, requestId: 'changed-snapshot' }), failure => failure.acceptance === 'rejected' && failure.actualTokens === 0);
    assert.deepEqual(driver.listRuns(), []); assert.deepEqual(await trace(), before);
  } finally { await driver.close(); }
}));

test('SDK plugin drift cannot silently ignore the chosen model patch', async () => withFixture(async ({ connection, options, baseFile, trace }) => {
  const changed = baseConfig(); changed.find(row => row.id === 'default-model').id = 'new-default-id';
  await writeFile(baseFile, JSON.stringify(changed));
  await assert.rejects(initializeRuntime(connection, options), /模型快照未.*生效/);
  const driver = createRuntimeDriver({ getConnection: () => connection, ...options });
  try {
    await assert.rejects(driver.assist({ ...systemInput, requestId: 'drifted-sdk' }), failure => failure.acceptance === 'rejected' && failure.actualTokens === 0);
    assert.deepEqual(driver.listRuns(), []); assert.equal((await trace()).some(frame => frame.kind === 'rpc'), false);
  } finally { await driver.close(); }
}));
