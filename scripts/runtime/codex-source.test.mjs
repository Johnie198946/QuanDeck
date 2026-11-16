import test from 'node:test';
import assert from 'node:assert/strict';
import { codexThreadUrl, openCodexDesktop } from './codex-source.mjs';
const ID = '019a7d11-6213-7110-9279-000000000001';
const info = { CFBundleIdentifier: 'com.openai.codex', CFBundleExecutable: 'ChatGPT', CFBundleURLTypes: [{ CFBundleURLSchemes: ['codex'] }] };
test('native URL is exact and cannot contain prompt, path or shell arguments', () => {
  assert.equal(codexThreadUrl(ID), `codex://threads/${ID}`);
  for (const invalid of ['demo', `${ID}?prompt=do-this`, `${ID}\n`, '$(touch /tmp/x)']) assert.throws(() => codexThreadUrl(invalid));
});
test('verified renamed Codex app receives only the exact thread URL', async () => {
  const calls = [];
  const opened = await openCodexDesktop(ID, { platform: 'darwin', apps: ['/Applications/ChatGPT.app'], checkExecutable: async () => true, exec: async (...args) => { calls.push(args); return { stdout: JSON.stringify(info) }; } });
  assert.equal(opened, true);
  assert.deepEqual(calls.at(-1).slice(0, 2), ['/usr/bin/open', ['-a', '/Applications/ChatGPT.app', `codex://threads/${ID}`]]);
});
test('unverified app, unsupported platform or rejected launch returns CLI fallback', async () => {
  for (const patch of [{ CFBundleIdentifier: 'other' }, { CFBundleURLTypes: [] }, { CFBundleExecutable: '../bad' }]) {
    let opens = 0;
    assert.equal(await openCodexDesktop(ID, { platform: 'darwin', apps: ['/Applications/ChatGPT.app'], checkExecutable: async () => true, exec: async binary => { if (binary.endsWith('open')) opens++; return { stdout: JSON.stringify({ ...info, ...patch }) }; } }), false);
    assert.equal(opens, 0);
  }
  assert.equal(await openCodexDesktop(ID, { platform: 'win32', exec: async () => { throw new Error('must not call'); } }), false);
  assert.equal(await openCodexDesktop(ID, { platform: 'darwin', apps: ['/Applications/ChatGPT.app'], checkExecutable: async () => true, exec: async binary => { if (binary.endsWith('open')) throw new Error('launch failed'); return { stdout: JSON.stringify(info) }; } }), false);
});
