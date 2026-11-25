import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { shareKnowledgeNote } from './app/knowledge-sharing.mjs';

async function fixture(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'quandeck-share-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const staging = path.join(folder, 'shares');
  const reads = [];
  const received = [];
  const dependencies = {
    staging,
    readLibrary: () => ({
      notes: [
        { id: 'note-one', body: '![展览](attachment:picture-one)', attachments: [
          { id: 'picture-one', type: 'image/png', size: 3 },
          { id: 'unused-picture', type: 'image/png', size: 3 },
        ] },
        { id: 'note-two', body: '![侧门](attachment:picture-two)', attachments: [{ id: 'picture-two', type: 'image/png', size: 3 }] },
      ],
    }),
    readAttachment: async id => {
      reads.push(id);
      return Buffer.from([1, 2, 3]);
    },
    showMenu: value => received.push(value),
  };
  return { dependencies, reads, received };
}

test('macOS sharing hands only the selected note text and images to the native menu', async t => {
  const { dependencies, reads, received } = await fixture(t);
  const expired = path.join(dependencies.staging, 'share-123ABC');
  await mkdir(dependencies.staging, { mode: 0o700 });
  await mkdir(expired);
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(expired, old, old);
  assert.equal(await shareKnowledgeNote({ title: '展览', text: '从东门进', noteId: 'note-one' }, dependencies), true);
  assert.deepEqual(reads, ['picture-one']);
  assert.deepEqual(received[0].texts, ['展览\n\n从东门进']);
  const [picture] = received[0].filePaths;
  assert.equal(path.basename(picture), 'image-1.png');
  assert.deepEqual(await readFile(picture), Buffer.from([1, 2, 3]));
  assert.deepEqual(await readdir(dependencies.staging), [path.basename(path.dirname(picture))]);
});

test('failed shares clean up their staging and unsupported hosts use no files', async t => {
  const { dependencies, reads, received } = await fixture(t);
  const input = { title: '展览', text: '从东门进', noteId: 'note-one' };
  assert.equal(await shareKnowledgeNote(input, { ...dependencies, showMenu: undefined }), false);
  assert.deepEqual(reads, []);
  await assert.rejects(shareKnowledgeNote(input, { ...dependencies, readAttachment: async () => Buffer.alloc(0) }), /内容与记录不一致/);
  assert.deepEqual(await readdir(dependencies.staging), []);
  assert.deepEqual(received, []);
  await assert.rejects(shareKnowledgeNote({ ...input, text: 1 }, dependencies), /分享内容无效/);
});
