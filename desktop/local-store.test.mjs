import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLocalStore } from './app/local-store.mjs';

test('disk library survives restart and does not replace current projects with renderer migration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quandeck-store-'));
  try {
    const first = createLocalStore(directory);
    assert.equal(first.storage.getItem('quandeck.projects.v1'), null);
    first.migrate({ 'quandeck.demo.v3': '{"mock":true}', 'quandeck.projects.v1': JSON.stringify({ schema: 1, projects: { real: {} }, agents: [] }) });
    assert.equal(first.storage.getItem('quandeck.demo.v3'), null);
    const second = createLocalStore(directory);
    second.migrate({ 'quandeck.projects.v1': JSON.stringify({ schema: 1, projects: {}, agents: [] }) });
    assert.deepEqual(second.read('quandeck.projects.v1', {}).projects, { real: {} });
    second.write('settings', { compact: true });
    assert.equal(JSON.parse(await readFile(path.join(directory, 'workspace.json.previous'), 'utf8'))['settings'], undefined);
    await writeFile(path.join(directory, 'workspace.json'), 'broken');
    assert.throws(() => createLocalStore(directory), /原文件已保留/);
    assert.equal(await readFile(path.join(directory, 'workspace.json'), 'utf8'), 'broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('native attachments keep bytes, isolate projects and reject traversal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quandeck-files-'));
  try {
    const store = createLocalStore(directory);
    const item = await store.saveAttachment('project-a', { name: '成果.txt', type: 'text/plain', bytes: Buffer.from('真实成果') });
    assert.equal((await createLocalStore(directory).attachment('project-a', item.id)).toString(), '真实成果');
    await assert.rejects(() => store.attachment('project-b', item.id), /ENOENT/);
    await assert.rejects(() => store.attachment('../', item.id), /标识无效/);
    await store.removeAttachment('project-a', item.id);
    await assert.rejects(() => store.attachment('project-a', item.id), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
