import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareTaskFiles } from './task-attachments.mjs';
import { createLocalStore } from './local-store.mjs';

/** Real preload IPC upload and SQLite metadata, isolated installer user data only. */
export async function checkTaskAttachments(core, store, webContents) {
  const require = (value, message) => { if (!value) throw new Error('Task attachment smoke: ' + message); };
  const wait = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Task attachment smoke: UI did not reflect persisted attachment');
  };
  const project = await core.createProject({ name: '安装验证 · 任务附件' });
  require(project.ok, 'project creation');
  const id = project.projectId;
  const uploaded = await webContents.executeJavaScript(`window.quandeckDesktop.saveAttachment(${JSON.stringify(id)}, { name: '任务资料.txt', type: 'text/plain', bytes: new TextEncoder().encode('installer attachment bytes').buffer })`);
  require(uploaded.id && uploaded.size === 26, 'real preload upload');
  const created = await webContents.executeJavaScript(`window.quandeckDesktop.command('createTaskWithAttachments', ['核对任务资料', [${JSON.stringify(uploaded)}], ${JSON.stringify(id)}])`);
  require(created.ok && created.taskId, 'create task with attachment through IPC');
  const snapshot = (await core.listProjects()).find(value => value.project.id === id);
  require(snapshot.tasks[created.taskId].attachments[0].id === uploaded.id, 'task metadata');
  await wait(() => webContents.executeJavaScript(`document.body.innerText.includes('核对任务资料')`));
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '附件 1')?.click()`);
  await wait(() => webContents.executeJavaScript(`document.querySelector('dialog[open] .qd-task-attachment-download')?.textContent.includes('任务资料.txt')`));
  const reopened = createLocalStore(store.directory);
  try {
    require(reopened.read('quandeck.projects.v1').projects[id].tasks[created.taskId].attachments[0].id === uploaded.id, 'SQLite reopened metadata');
    require((await reopened.attachment(id, uploaded.id)).toString() === 'installer attachment bytes', 'reopened attachment bytes');
  } finally { reopened.close(); }
  let denied = false; try { await store.attachment('other-project', uploaded.id); } catch { denied = true; }
  require(denied, 'cross-project read rejected');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quandeck-attachment-smoke-'));
  try {
    const binding = { connectionId: 'attachment-smoke', projectPath: directory };
    const scoped = { ...snapshot, runtimeConnections: { smoke: binding } };
    const paths = await prepareTaskFiles(store, scoped, binding, { projectId: id, taskId: created.taskId, connectionId: binding.connectionId, ids: [uploaded.id] });
    require(paths.length === 1 && (await readFile(paths[0].path, 'utf8')) === 'installer attachment bytes', 'Agent-readable copy');
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  await webContents.executeJavaScript(`document.querySelector('button[aria-label="移除任务附件 任务资料.txt"]')?.click()`);
  await wait(async () => !(await core.load()).tasks[created.taskId].attachments.length);
  await wait(() => webContents.executeJavaScript(`!!document.querySelector('dialog[open] .qd-task-attachments-empty')`));
  require((await store.attachment(id, uploaded.id)).length === 26, 'retain dispatched attachment history');
  return { ok: true, ipcUpload: true, persisted: true, reopenedBytes: true, projectIsolation: true, agentReadable: true, detachPreservesBytes: true, rendered: true };
}
