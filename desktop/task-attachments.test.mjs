import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLocalStore } from './app/local-store.mjs';
import { prepareTaskFiles, prepareContextFiles } from './app/task-attachments.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quandeck-task-files-'));
  const store = createLocalStore(path.join(root, 'store'));
  const projectPath = path.join(root, 'project'); await mkdir(projectPath);
  const binding = { connectionId: 'connection-a', projectPath };
  try { await run({ root, store, binding, projectPath }); }
  finally { store.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
function scoped(file, binding) {
  const snapshot = { project: { id: 'project-a' }, tasks: { task: { attachments: [file] } }, runtimeConnections: { codex: binding } };
  const input = { projectId: 'project-a', taskId: 'task', connectionId: binding.connectionId, ids: [file.id] };
  return { snapshot, input };
}

test('persisted bytes export under the bound project, safely renamed, without overwriting different bytes', () => fixture(async ({ store, binding, projectPath }) => {
  const file = await store.saveAttachment('project-a', { name: '../../需求:稿.txt', type: 'text/plain', bytes: Buffer.from('actual task material') });
  const { snapshot, input } = scoped(file, binding);
  const reopened = createLocalStore(store.directory);
  try { assert.equal((await reopened.attachment('project-a', file.id)).toString(), 'actual task material'); }
  finally { reopened.close(); }
  const paths = await prepareTaskFiles(store, snapshot, binding, input);
  assert.equal(path.basename(paths[0].path), '需求_稿.txt');
  assert.equal(path.dirname(paths[0].path), path.join(await realpath(projectPath), '.quandeck', 'attachments', 'project-a', file.id));
  assert.equal(await readFile(paths[0].path, 'utf8'), 'actual task material');
  assert.deepEqual(await prepareTaskFiles(store, snapshot, binding, input), paths, 'unchanged copy can be reused after restart');
  await rm(paths[0].path);
  await writeFile(path.join(path.dirname(paths[0].path), '.upload-interrupted.tmp'), 'partial previous write');
  assert.deepEqual(await prepareTaskFiles(store, snapshot, binding, input), paths, 'interrupted temporary writes never block the next delivery');
  assert.equal(await readFile(paths[0].path, 'utf8'), 'actual task material');
  await writeFile(paths[0].path, 'user edited content');
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, input), /未覆盖/);
  assert.equal(await readFile(paths[0].path, 'utf8'), 'user edited content');
}));

test('foreign project/task files and mismatched byte sizes are rejected before export', () => fixture(async ({ store, binding }) => {
  const file = await store.saveAttachment('project-a', { name: '资料.txt', bytes: Buffer.from('safe') });
  const foreign = await store.saveAttachment('project-b', { name: 'private.txt', bytes: Buffer.from('private') });
  const { snapshot, input } = scoped(file, binding);
  await assert.rejects(store.attachment('project-b', file.id), /ENOENT/);
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, { ...input, projectId: 'project-b' }), /无效/);
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, { ...input, taskId: 'other-task' }), /无效/);
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, { ...input, connectionId: 'other-connection' }), /无效/);
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, { ...input, ids: [foreign.id] }), /不属于/);
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, { ...input, ids: [file.id, file.id] }), /无效/);
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, { ...input, workItemId: 'unknown-child' }), /不存在/);
  snapshot.tasks.task.attachments[0] = { ...file, size: file.size + 1 };
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, input), /不一致/);
}));

test('export and stored byte reads refuse symbolic links', { skip: process.platform === 'win32' ? 'Windows symlink privilege is not guaranteed in CI' : false }, () => fixture(async ({ root, store, binding, projectPath }) => {
  const file = await store.saveAttachment('project-a', { name: '资料.txt', bytes: Buffer.from('safe') });
  const { snapshot, input } = scoped(file, binding);
  const outside = path.join(root, 'outside'); await mkdir(outside);
  const linkedProject = path.join(root, 'linked-project'); await symlink(projectPath, linkedProject);
  const linkedBinding = { ...binding, projectPath: linkedProject };
  await assert.rejects(prepareTaskFiles(store, scoped(file, linkedBinding).snapshot, linkedBinding, input), /不安全/);
  await symlink(outside, path.join(projectPath, '.quandeck'));
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, input), /不安全/);
  await rm(path.join(projectPath, '.quandeck'));
  const paths = await prepareTaskFiles(store, snapshot, binding, input);
  const sensitive = path.join(outside, 'sensitive.txt'); await writeFile(sensitive, 'never overwrite');
  await rm(paths[0].path); await symlink(sensitive, paths[0].path);
  await assert.rejects(prepareTaskFiles(store, snapshot, binding, input), /未覆盖/);
  assert.equal(await readFile(sensitive, 'utf8'), 'never overwrite');
  const stored = path.join(store.directory, 'attachments', 'project-a', file.id);
  await rm(stored); await symlink(sensitive, stored);
  await assert.rejects(store.attachment('project-a', file.id), /符号链接/);
  await rm(path.dirname(stored), { recursive: true }); await symlink(outside, path.dirname(stored));
  await assert.rejects(store.saveAttachment('project-a', { name: '资料.txt', bytes: Buffer.from('unsafe write') }), /符号链接/);
  await assert.rejects(store.removeAttachment('project-a', file.id), /符号链接/);
  assert.equal(await readFile(sensitive, 'utf8'), 'never overwrite');
}));

test('cleanup cannot delete files after metadata is saved, including subtask attachments', () => fixture(async ({ store }) => {
  const file = await store.saveAttachment('project-a', { name: '资料.txt', bytes: Buffer.from('safe') });
  const data = { schema: 1, projects: { 'project-a': { tasks: { task: { attachments: [file] } }, orchestrations: { task: { items: { child: { attachments: [] } } } } } }, agents: [] };
  store.write('quandeck.projects.v1', data);
  await assert.rejects(store.removeAttachment('project-a', file.id), /任务/);
  data.projects['project-a'].tasks.task.attachments = [];
  data.projects['project-a'].orchestrations.task.items.child.attachments = [file];
  store.write('quandeck.projects.v1', data);
  await assert.rejects(store.removeAttachment('project-a', file.id), /任务/);
  data.projects['project-a'].orchestrations.task.items.child.attachments = [];
  store.write('quandeck.projects.v1', data);
  assert.equal((await store.attachment('project-a', file.id)).toString(), 'safe', 'detaching metadata preserves bytes for existing sessions');
}));


test('frozen delivery files use ledger context and reject wrong pins or modified bytes', () => fixture(async ({store,binding})=>{
  const file=await store.saveAttachment('project-a',{name:'original.md',bytes:Buffer.from('frozen result'),contentAddressed:true});
  const {snapshot,input}=scoped(file,binding);snapshot.tasks.task.attachments=[];
  const receipt={slotId:'source-slot',kind:'file',attachmentId:file.id,bytes:file.size,contentHash:file.sha256};
  snapshot.collaboration={artifacts:[{id:'source-artifact',hash:'artifact-hash',attachments:[file],deliveryReceipts:[receipt]}]};
  const context={key:'task',sources:[{id:'source-artifact',hash:'artifact-hash',deliveryReceipts:[receipt]}]};
  const request={...input,sources:[{id:'source-artifact',hash:'artifact-hash'}]};
  const [prepared]=await prepareContextFiles(store,snapshot,binding,request,context);
  assert.equal(await readFile(prepared.path,'utf8'),'frozen result');assert.equal(prepared.sha256,file.sha256);
  await assert.rejects(prepareContextFiles(store,snapshot,binding,{...request,sources:[]},context),/版本已变化/);
  await assert.rejects(prepareTaskFiles(store,snapshot,binding,input),/不属于/,'ordinary task attachment access cannot read dependency files');
  await writeFile(path.join(store.directory,'attachments','project-a',file.id),'other result!');
  await assert.rejects(prepareContextFiles(store,snapshot,binding,request,context),/不一致/);
}));

test('content-addressed delivery freeze is stable across reopen and never overwrites changed bytes', () => fixture(async ({store})=>{
  const input={name:'guide.md',type:'text/markdown',bytes:Buffer.from('same bytes'),contentAddressed:true};
  const first=await store.saveAttachment('project-a',input),reopened=createLocalStore(store.directory);
  try {assert.equal((await reopened.saveAttachment('project-a',input)).id,first.id);}finally{reopened.close();}
  assert.notEqual((await store.saveAttachment('project-a',{...input,bytes:Buffer.from('new bytes')})).id,first.id);
  await writeFile(path.join(store.directory,'attachments','project-a',first.id),'tampered');
  await assert.rejects(store.saveAttachment('project-a',input),/未覆盖/);
}));

test('a file read that completes after project erasure cannot recreate managed copies', () => fixture(async ({store,binding,projectPath}) => {
  const file=await store.saveAttachment('project-a',{name:'late.txt',bytes:Buffer.from('late private material')});
  const {snapshot,input}=scoped(file,binding);snapshot.project.workspacePath=projectPath;snapshot.sessions={};
  store.write('quandeck.projects.v1',{schema:1,agents:[],activeProjectId:'project-a',projects:{'project-a':snapshot}});
  let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const deferred=Object.assign(Object.create(store),{attachment:async(...args)=>{const bytes=await store.attachment(...args);entered();await gate;return bytes;}});
  const preparing=prepareTaskFiles(deferred,snapshot,binding,input);await started;
  const plan=store.previewEraseProject('project-a',{scope:'project'});store.eraseProject({token:plan.token,confirmation:'project-a'});release();
  await assert.rejects(preparing,/永久清除/);
  await assert.rejects(readFile(path.join(projectPath,'.quandeck','attachments','project-a',file.id,'late.txt')),/ENOENT/);
}));
