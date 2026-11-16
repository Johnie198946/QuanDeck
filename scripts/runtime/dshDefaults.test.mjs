import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDshDefaults, resolveDshDefaults } from './dshDefaults.mjs';

const entry = (config = 'provider: source-provider\n    model: source-model') => `# == source package, patched by user profile\n- id: custom-default-name\n  name: '@deepseek-ai/dsh-agent-default-model'\n  config:\n    ${config}\n`;
test('reads the source default plugin instead of choosing the first provider or model', () => {
  const unrelated = '- id: provider\n  name: adapter\n  config:\n    apiKey: secret-should-not-escape\n    provider: wrong-provider\n    model: wrong-model\n    dynamic: !!js process.exit(99)\n';
  assert.deepEqual(parseDshDefaults(unrelated + entry('provider: "公司 provider"\n    model: "选定 model"\n    reasoningEffort: high')), { provider: '公司 provider', model: '选定 model', reasoningEffort: 'high' });
});
test('missing, duplicate, disabled, dynamic, malformed, and non-string defaults fail with source-tool guidance', () => {
  for (const config of [
    '[]', entry() + entry(), entry().replace('  config:', '  disabled: true\n  config:'),
    entry().replace('  config:', '  disabled: !!js process.env.DISABLED\n  config:'),
    entry('provider: !!js process.env.PROVIDER\n    model: source-model'),
    entry('provider: source-provider\n    model: !!js process.env.MODEL'),
    entry('provider: source-provider\n    model: source-model\n    reasoningEffort: !!js process.env.EFFORT'),
    entry('provider: source-provider\n    model: 42'), entry('provider: source-provider'),
    entry('provider: ""\n    model: source-model'),
    entry('provider: source-provider\n    provider: duplicate\n    model: source-model'),
    'secret-should-not-escape: [bad YAML',
  ]) {
    assert.throws(() => parseDshDefaults(config), error => /请先在 DSH 中设置默认模型/.test(error.message) && !/secret-should-not-escape|process.env/.test(error.message));
  }
});
test('reads active nested defaults but rejects ambiguous dynamic ancestry', () => {
  const nested = `- id: group\n  name: group\n  group: true\n  config:\n${entry().split('\n').filter(line => line && !line.startsWith('#')).map(line => `    ${line}`).join('\n')}\n`;
  assert.deepEqual(parseDshDefaults(nested), { provider: 'source-provider', model: 'source-model' });
  assert.throws(() => parseDshDefaults(nested.replace('group: true', 'group: !!js process.env.GROUP')), /DSH/);
});
test('configuration command preserves cwd/environment, is bounded, and never returns secret fields', async () => {
  const connection = { projectPath: '/项目 路径' }, invocation = { binary: '/Node 路径', args: ['/CLI 路径.js', 'sdk', '--dump-config'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  let calls = 0;
  const execute = async (binary, args, options) => {
    calls++; assert.equal(binary, invocation.binary); assert.deepEqual(args, invocation.args);
    assert.equal(options.cwd, connection.projectPath); assert.equal(options.timeout, 10000); assert.equal(options.maxBuffer, 2 * 1024 * 1024); assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
    return { stdout: entry(`provider: source-provider\n    model: model-${calls}\n    apiKey: secret-should-not-escape`) };
  };
  assert.deepEqual(await resolveDshDefaults(connection, invocation, { execute }), { provider: 'source-provider', model: 'model-1' });
  assert.deepEqual(await resolveDshDefaults(connection, invocation, { execute }), { provider: 'source-provider', model: 'model-2' });
  assert.deepEqual(connection, { projectPath: '/项目 路径' });
  await assert.rejects(resolveDshDefaults(connection, invocation, { execute: async () => { throw Object.assign(Error('secret-should-not-escape'), { stdout: 'secret-should-not-escape', stderr: 'secret-should-not-escape' }); } }), error => /DSH/.test(error.message) && !JSON.stringify(error).includes('secret-should-not-escape') && !error.message.includes('secret-should-not-escape'));
});
test('legacy complete explicit overrides still work without reading source configuration', async () => {
  const execute = async () => assert.fail('must not inspect configuration for an explicit route');
  assert.deepEqual(await resolveDshDefaults({ provider: ' old-provider ', model: ' old-model ' }, {}, { execute }), { provider: 'old-provider', model: 'old-model' });
  await assert.rejects(resolveDshDefaults({ provider: 'old-provider' }, {}, { execute }), /旧连接.*重新测试/);
});
