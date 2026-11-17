import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scanFiles, contentViolations, isApplicationPathAllowed, requireClean } from './clean-release.mjs';
const digest = text => createHash('sha256').update(text).digest('hex');
async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'quandeck-clean-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, data] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), data); }
  return root;
}
test('source scanner accepts synthetic fixtures and unchanged approved product assets', async t => {
  const files = { 'tests/example.fixture.json': JSON.stringify({ prompt: 'Synthetic example', project: 'Demo' }), 'public/tutorial/example.png': 'synthetic image' };
  const root = await fixture(t, files);
  const result = await scanFiles(root, Object.keys(files), [{ path: 'public/tutorial/example.png', sha256: digest('synthetic image') }]);
  assert.equal(result.ok, true);
});
test('runtime databases, credentials and private reports fail without echoing contents', async t => {
  const files = { 'workspace.sqlite': 'private conversation', 'workspace.sqlite.pre-v3-backup': 'private backup', 'docs/validation/raw.json': '{"title":"private title"}', 'auth.json': '{"token":"private credential"}' };
  const root = await fixture(t, files); const result = await scanFiles(root, Object.keys(files), []);
  assert.equal(result.violations.length, 4); assert.throws(() => requireClean(result, 'source'), /Clean release rejected/);
  assert.doesNotMatch(JSON.stringify(result), /private conversation|private title|private credential/);
});
test('new or changed binary assets require a fresh privacy review', async t => {
  const root = await fixture(t, { 'public/new.png': 'user screenshot', 'public/approved.png': 'changed screenshot' });
  const result = await scanFiles(root, ['public/new.png', 'public/approved.png'], [{ path: 'public/approved.png', sha256: digest('approved synthetic') }]);
  assert.equal(result.violations.filter(item => item.reason === 'unreviewed-binary-asset').length, 2);
});
test('personal home paths and realistic secrets fail; documented placeholders remain usable', () => {
  const actualPath = '/' + ['Users', 'private-person', 'Projects'].join('/');
  const token = 'ghp_' + 'z'.repeat(36);
  assert.deepEqual(contentViolations(actualPath + " " + token), ['personal-home-path', 'credential-material']);
  assert.deepEqual(contentViolations('/Users/你的用户名/Projects/demo C:\\Users\\username\\Demo /home/runner/work'), []);
});
test('desktop allowlist preserves SDK dependencies but rejects extra app state', async t => {
  assert.equal(isApplicationPathAllowed('node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'), true);
  assert.equal(isApplicationPathAllowed('/runtime/driver.mjs'), true);
  assert.equal(isApplicationPathAllowed('/project-deletion.mjs'), true);
  assert.equal(isApplicationPathAllowed('/local-project.json'), false);
  const root = await fixture(t, { 'local-project.json': '{"project":"private"}' });
  assert.equal((await scanFiles(root, ['local-project.json'], [], { application: true })).ok, false);
});
test('first-party symlinks cannot smuggle files from outside the source tree', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t, { 'outside.txt': 'private' });
  await symlink(path.join(root, 'outside.txt'), path.join(root, 'linked.txt'));
  const result = await scanFiles(root, ['linked.txt'], []);
  assert.equal(result.violations[0].reason, 'unreviewed-symlink');
});
