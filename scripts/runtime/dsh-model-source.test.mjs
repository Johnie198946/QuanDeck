import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, chmod, symlink, readdir } from 'node:fs/promises';
import { stringify } from 'yaml';
import { createDshModelSources, readDshModelConfig } from './dsh-model-source.mjs';

const DEFAULT = '@deepseek-ai/dsh-agent-default-model';
const PI = '@deepseek-ai/dsh-llm-pi-ai';
const DEEP = '@deepseek-ai/dsh-llm-deepseek-api-key';
const SENTINEL = 'PRIVATE_SECRET_MUST_NEVER_ESCAPE';
const modelRoute = (model = 'corp-chat') => ({
  api: 'openai-completions', baseURL: 'https://gateway.example.invalid/v1', apiKeyEnv: 'CORP_GATEWAY_KEY',
  compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
  models: [{ id: model, contextWindow: 65536, maxTokens: 8192, reasoningEfforts: { off: null, high: 'high' } }],
});
const source = (provider = 'corp', model = 'corp-chat') => [
  { id: 'llm-pi-ai', config: { providers: { [provider]: modelRoute(model) } } },
  { id: 'agent-default-model', config: { provider, model, reasoningEffort: 'high' } },
];
const sdk = (providers = {}) => stringify([
  { id: 'sdk-custom-pi', name: PI, config: { providers } },
  { id: 'sdk-custom-default', name: DEFAULT, config: { provider: 'deepseek-official', model: 'deepseek-flash' } },
  { id: 'sdk-native', name: DEEP },
  { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local' },
]);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qd-model-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'dsh'), storageDir = path.join(root, 'private-models');
  await mkdir(path.join(home, 'profiles'), { recursive: true });
  const profile = async (name = 'xlink-desktop', rows = source(), manifest) => {
    const dir = path.join(home, 'profiles', name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest ?? { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
    await writeFile(path.join(dir, 'cordis.patch.yml'), typeof rows === 'string' ? rows : stringify(rows));
    return dir;
  };
  return { root, home, storageDir, profile, manager: createDshModelSources({ home, storageDir }) };
}

test('empty SDK patch with GUI enterprise route becomes a model-only immutable snapshot', async t => {
  const f = await fixture(t), dir = await f.profile();
  await f.profile('sdk', []);
  // An unrelated plugin, including its JS expression, must not be copied or executed.
  const before = `${await readFile(path.join(dir, 'cordis.patch.yml'), 'utf8')}\n- id: harmless-tool\n  name: '@company/tool'\n  config:\n    command: !!js process.exit(91)\n`;
  await writeFile(path.join(dir, 'cordis.patch.yml'), before);
  const inspected = await f.manager.inspect({ sdkConfig: sdk() });
  assert.equal(inspected.sdk.status, 'unavailable', 'inherited official defaults alone do not prove a configured model route');
  assert.equal(inspected.candidates.length, 1);
  const candidate = inspected.candidates[0];
  assert.equal(candidate.profile, 'xlink-desktop'); assert.equal(candidate.status, 'available');
  assert.equal(candidate.provider, 'corp'); assert.equal(candidate.model, 'corp-chat');
  assert.doesNotMatch(JSON.stringify(inspected), /gateway\.example|CORP_GATEWAY_KEY|process\.exit/);
  const ref = await f.manager.prepare(candidate, sdk());
  const patch = JSON.parse(await readFile(ref.path, 'utf8'));
  assert.equal(patch.length, 2);
  assert.deepEqual(patch.map(row => row.id), ['sdk-custom-pi', 'sdk-custom-default']);
  assert.deepEqual(patch[0].config.providers.corp, modelRoute());
  assert.deepEqual(patch[1].config, { provider: 'corp', model: 'corp-chat', reasoningEffort: 'high' });
  assert.equal(await readFile(path.join(dir, 'cordis.patch.yml'), 'utf8'), before);
  assert.equal(await readFile(path.join(f.home, 'profiles', 'sdk', 'cordis.patch.yml'), 'utf8'), '[]\n');
  assert.deepEqual(await readDshModelConfig(ref, { storageDir: f.storageDir }), { path: ref.path, provider: 'corp', model: 'corp-chat', reasoningEffort: 'high' });
  assert.deepEqual(await f.manager.prepare(candidate, sdk()), ref, 'same content may reuse the validated private file');
  if (process.platform !== 'win32') {
    assert.equal((await stat(f.storageDir)).mode & 0o777, 0o700);
    assert.equal((await stat(ref.path)).mode & 0o777, 0o600);
  }
});

test('finds multiple explicitly configured profiles without assuming desktop names', async t => {
  const f = await fixture(t);
  await f.profile('xlink-desktop'); await f.profile('desktop-custom', source('other', 'other-chat'));
  await f.profile('web', []); await f.profile('sdk', source());
  const result = await f.manager.inspect({ sdkConfig: sdk() });
  assert.deepEqual(result.candidates.map(row => row.profile), ['desktop-custom', 'web', 'xlink-desktop']);
  assert.deepEqual(result.candidates.map(row => row.status), ['available', 'unsupported', 'available']);
});

test('home layer replaces complete configs and selection changes invalidate the previous revision', async t => {
  const f = await fixture(t); await f.profile();
  const first = (await f.manager.inspect()).candidates[0];
  await writeFile(path.join(f.home, 'cordis.patch.yml'), stringify(source('shared', 'shared-chat')));
  const changed = (await f.manager.inspect()).candidates[0];
  assert.equal(changed.provider, 'shared'); assert.notEqual(changed.revision, first.revision);
  await assert.rejects(f.manager.prepare(first, sdk()), error => error.code === 'DSH_MODEL_SOURCE_CHANGED');
  const ref = await f.manager.prepare(changed, sdk());
  const patch = JSON.parse(await readFile(ref.path, 'utf8'));
  assert.deepEqual(Object.keys(patch[0].config.providers), ['shared']);
  // A home adapter config that omits the old route must not be deep-merged with it.
  await writeFile(path.join(f.home, 'cordis.patch.yml'), stringify([{ id: 'llm-pi-ai', config: { providers: {} } }]));
  assert.equal((await f.manager.inspect()).candidates[0].status, 'unsupported');
});

test('preserves other SDK providers and complete compatibility settings', async t => {
  const f = await fixture(t); await f.profile();
  const candidate = (await f.manager.inspect()).candidates[0];
  const previous = { existing: { apiKeyEnv: 'EXISTING_KEY' }, corp: modelRoute('old-chat') };
  const ref = await f.manager.prepare(candidate, sdk(previous));
  const providers = JSON.parse(await readFile(ref.path, 'utf8'))[0].config.providers;
  assert.deepEqual(providers.existing, previous.existing);
  assert.deepEqual(providers.corp, modelRoute());
});

test('pins snapshots across source changes and restart instead of silently refreshing them', async t => {
  const f = await fixture(t), dir = await f.profile();
  const original = (await f.manager.inspect()).candidates[0];
  const ref = await f.manager.prepare(original, sdk());
  await writeFile(path.join(dir, 'cordis.patch.yml'), stringify(source('changed', 'new-model')));
  const restarted = createDshModelSources({ home: f.home, storageDir: f.storageDir });
  await assert.rejects(restarted.prepare(original, sdk()), error => error.code === 'DSH_MODEL_SOURCE_CHANGED');
  assert.equal((await readDshModelConfig(ref, { storageDir: f.storageDir })).provider, 'corp');
  await rm(dir, { recursive: true });
  assert.equal((await readDshModelConfig(ref, { storageDir: f.storageDir })).model, 'corp-chat');
});

test('rejects ambiguous, dynamic, secret-bearing, custom model, and malformed sources without leaking contents', async t => {
  const cases = [
    stringify(source()).replace('model: corp-chat', 'model: !!js process.env.MODEL'),
    stringify(source()).replace('baseURL: https://gateway.example.invalid/v1', 'baseURL: !!js process.env.GATEWAY'),
    stringify(source()).replace('apiKeyEnv: CORP_GATEWAY_KEY', `apiKey: ${SENTINEL}`),
    stringify(source()).replace('apiKeyEnv: CORP_GATEWAY_KEY', `apiKeyEnv: CORP_GATEWAY_KEY\n        headers:\n          Authorization: ${SENTINEL}`),
    stringify(source()).replace('baseURL: https://gateway.example.invalid/v1', `baseURL: https://user:${SENTINEL}@gateway.invalid`),
    stringify(source()).replace('baseURL: https://gateway.example.invalid/v1', `baseURL: https://gateway.invalid/v1?key=${SENTINEL}`),
    stringify(source()).replace('model: corp-chat', `model: corp-chat\n    model: ${SENTINEL}`),
    stringify(source()).replace('apiKeyEnv: CORP_GATEWAY_KEY', `apiKeyEnv: !secret ${SENTINEL}`),
    stringify(source()).replace('apiKeyEnv: CORP_GATEWAY_KEY', `apiKeyEnv: &credential CORP_GATEWAY_KEY\n        displayName: *credential`),
    stringify([...source(), { id: 'another-default', name: DEFAULT, config: { provider: 'corp', model: 'corp-chat' } }]),
    stringify(source()).replace('- id: llm-pi-ai', "- id: llm-pi-ai\n  name: '@company/custom-adapter'"),
    stringify([...source(), { id: 'credentials', config: { path: `/private/${SENTINEL}` } }]),
    stringify(source()).replace('- id: llm-pi-ai', '- id: llm-pi-ai\n  disabled: true'),
    stringify(source()).replace('- id: llm-pi-ai', '- id: llm-pi-ai\n  remove: true'),
    stringify(source()).replace('- id: agent-default-model', '- id: agent-default-model\n  disabled: !!js process.env.DISABLED'),
    stringify(source()).replace('api: openai-completions', 'api: unknown-protocol'),
    stringify(source()).replace('models:\n', 'modelOverrides:\n'),
    '- id: broken\n  config: [invalid YAML',
  ];
  for (const [index, config] of cases.entries()) {
    const f = await fixture(t); await f.profile(`case-${index}`, config);
    const result = await f.manager.inspect();
    assert.equal(result.candidates[0].status, 'unsupported', `case ${index}`);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SENTINEL));
    await assert.rejects(f.manager.prepare(result.candidates[0], sdk()), error => !error.message.includes(SENTINEL));
    await assert.rejects(stat(f.storageDir), { code: 'ENOENT' });
  }
});

test('requires explicit routing and known base; never treats a bare default as configured', async t => {
  const f = await fixture(t);
  await f.profile('unknown-base', source(), { dsh: { profile: { bundles: ['@company/private-base'] } } });
  await f.profile('default-only', [source()[1]]);
  await f.profile('catalog-only', [{ id: 'llm-pi-ai', config: { providers: { corp: { apiKeyEnv: 'CORP_GATEWAY_KEY' } } } }, source()[1]]);
  const result = await f.manager.inspect({ sdkConfig: sdk() });
  assert.equal(result.sdk.status, 'unavailable');
  assert.equal(result.candidates.filter(row => row.status === 'available').length, 0);
});

test('recognized native DeepSeek API-key adapter can be reused without copying account or plugins', async t => {
  const f = await fixture(t);
  const config = { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://deepseek.example.invalid/anthropic', models: [{ id: 'deepseek-flash', contextWindow: 1000000, inputModalities: ['text'] }], thinking: 'enabled' };
  await f.profile('native-desktop', [
    { id: 'llm-deepseek', config },
    { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash' } },
  ]);
  const candidate = (await f.manager.inspect()).candidates[0];
  assert.equal(candidate.status, 'available');
  const ref = await f.manager.prepare(candidate, sdk());
  assert.deepEqual(JSON.parse(await readFile(ref.path, 'utf8')), [{ id: 'sdk-native', config }, { id: 'sdk-custom-default', config: { provider: 'deepseek-official', model: 'deepseek-flash' } }]);
});

test('does not follow source or profile symlinks and bounds file size and candidate count', async t => {
  const f = await fixture(t), dir = await f.profile();
  const outside = path.join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(f.home, 'profiles', 'linked-profile'), 'dir');
  await rm(path.join(dir, 'cordis.patch.yml'));
  await writeFile(path.join(outside, 'source.yml'), stringify(source()));
  await symlink(path.join(outside, 'source.yml'), path.join(dir, 'cordis.patch.yml'));
  const result = await f.manager.inspect();
  assert.deepEqual(result.candidates.map(row => row.profile), ['xlink-desktop']);
  assert.equal(result.candidates[0].status, 'unsupported');
  await rm(path.join(dir, 'cordis.patch.yml'));
  await writeFile(path.join(dir, 'cordis.patch.yml'), ' '.repeat(2 * 1024 * 1024 + 1));
  assert.equal((await f.manager.inspect()).candidates[0].status, 'unsupported');
  for (let i = 0; i < 65; i++) await f.profile(`profile-${String(i).padStart(2, '0')}`);
  const bounded = await f.manager.inspect(); assert.equal(bounded.candidates.length, 64); assert.match(bounded.message, /64/);
  await assert.rejects(f.manager.prepare({ profile: '../outside', revision: 'a'.repeat(64) }, sdk()));
});

test('never reads credential store contents or accepts changed custom credential scope', async t => {
  const f = await fixture(t); await f.profile();
  // A directory at the credential filename would fail if treated as a config file.
  await mkdir(path.join(f.home, '.credentials.yaml'));
  const candidate = (await f.manager.inspect()).candidates[0];
  assert.equal(candidate.status, 'available');
  const customSdk = `${sdk()}\n- id: different-credential-provider\n  name: '@deepseek-ai/dsh-credentials-local'\n  config:\n    path: /other/user/credential-store\n`;
  await assert.rejects(f.manager.prepare(candidate, customSdk), error => !error.message.includes('/other'));
});

test('refuses symlinked profile roots, home patches, and private snapshot directories', async t => {
  const f = await fixture(t); const dir = await f.profile();
  const outside = path.join(f.root, 'outside.yml'); await writeFile(outside, stringify(source()));
  await symlink(outside, path.join(f.home, 'cordis.patch.yml'));
  assert.equal((await f.manager.inspect()).candidates[0].status, 'unsupported');
  await rm(path.join(f.home, 'cordis.patch.yml'));
  const candidate = (await f.manager.inspect()).candidates[0];
  const externalStorage = path.join(f.root, 'external-storage'); await mkdir(externalStorage);
  await symlink(externalStorage, f.storageDir, 'dir');
  await assert.rejects(f.manager.prepare(candidate, sdk()));
  assert.deepEqual(await readdir(externalStorage), []);
  await rm(path.join(f.home, 'profiles'), { recursive: true });
  await symlink(path.dirname(dir), path.join(f.home, 'profiles'), 'dir');
  assert.deepEqual((await f.manager.inspect()).candidates, []);
});

test('runtime rejects tampered, moved, symlinked, secret-bearing, or broad-permission snapshots', async t => {
  const f = await fixture(t); await f.profile();
  const ref = await f.manager.prepare((await f.manager.inspect()).candidates[0], sdk());
  const content = await readFile(ref.path, 'utf8');
  await writeFile(ref.path, `${content} `);
  await assert.rejects(readDshModelConfig(ref, { storageDir: f.storageDir }), { code: 'DSH_MODEL_SNAPSHOT_INVALID' });
  await writeFile(ref.path, content);
  await assert.rejects(readDshModelConfig({ ...ref, model: 'wrong' }, { storageDir: f.storageDir }));
  await assert.rejects(readDshModelConfig({ ...ref, path: path.join(f.root, 'outside.json') }, { storageDir: f.storageDir }));
  await assert.rejects(readDshModelConfig(ref));
  if (process.platform !== 'win32') {
    await chmod(ref.path, 0o644); await assert.rejects(readDshModelConfig(ref, { storageDir: f.storageDir })); await chmod(ref.path, 0o600);
    await chmod(f.storageDir, 0o755); await assert.rejects(readDshModelConfig(ref, { storageDir: f.storageDir })); await chmod(f.storageDir, 0o700);
  }
  const original = path.join(f.root, 'original.json'); await writeFile(original, content, { mode: 0o600 });
  await rm(ref.path); await symlink(original, ref.path);
  await assert.rejects(readDshModelConfig(ref, { storageDir: f.storageDir }));
  await rm(ref.path);
  const unsafe = content.replace('"apiKeyEnv": "CORP_GATEWAY_KEY"', `"apiKey": "${SENTINEL}"`);
  const hash = createHash('sha256').update(unsafe).digest('hex'), unsafePath = path.join(f.storageDir, `${hash}.json`);
  await writeFile(unsafePath, unsafe, { mode: 0o600 });
  await assert.rejects(readDshModelConfig({ ...ref, path: unsafePath, digest: hash }, { storageDir: f.storageDir }), error => error.code === 'DSH_MODEL_SNAPSHOT_INVALID' && !error.message.includes(SENTINEL));
});

test('SDK merge refuses unrecognized entry identity, duplicate rows, or secrets in preserved providers', async t => {
  const f = await fixture(t); await f.profile();
  const candidate = (await f.manager.inspect()).candidates[0];
  for (const bad of [
    sdk().replace(PI, '@company/unknown'),
    `${sdk()}\n- id: duplicate-pi\n  name: '${PI}'\n`,
    sdk({ old: { apiKey: SENTINEL } }),
    sdk().replace('id: sdk-custom-pi', 'id: sdk-custom-default'),
  ]) await assert.rejects(f.manager.prepare(candidate, bad), error => !error.message.includes(SENTINEL));
  await assert.rejects(readdir(f.storageDir), { code: 'ENOENT' });
});
