import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, Tray, Menu, nativeImage, Notification } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createBridgeServer, createBridgeService } from './agent-bridge.mjs';
import { createLocalStore } from './local-store.mjs';
import { prepareTaskFiles } from './task-attachments.mjs';
import { projectionAdapter, storageDigest } from './storage-maintenance.mjs';
import { createContextAccess } from './runtime/context-access.mjs';

protocol.registerSchemesAsPrivileged([{ scheme: 'quandeck', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const directory = path.dirname(fileURLToPath(import.meta.url));
let window, bridge, service, connection, store, core, corePromise, commandNames, tray, deriveActivity, scanTimer, contextAccess, projectionExport;
let maintenanceActive = false, projectionDrain;
async function flushProjections() {
  if (!projectionExport || maintenanceActive) return;
  if (projectionDrain) return projectionDrain;
  projectionDrain = (async () => {
    const adapter = projectionAdapter(store.directory, id => store.read('quandeck.projects.v1', {}).projects?.[id], projectionExport);
    for (const item of store.outbox.list().filter(x => x.kind === 'project.projection' && x.state !== 'done')) {
      const result = await store.outbox.deliver(item.id, adapter);
      if (result.state === 'unknown') broadcast('storage-error', '后台台帐导出等待重试：' + result.error);
    }
  })().finally(() => { projectionDrain = null; });
  return projectionDrain;
}
const sources = new Map(), windows = new Set(), notified = new Set();
const preferenceKeys = ['quandeck.configured-agents.v1', 'quandeck.preferences.v1'];
const migrationKeys = ['quandeck.projects.v1', ...preferenceKeys];
app.setName('QuanDeck');
const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest || process.env.QUANDECK_TEST_DATA) {
  const smokeData = process.env.QUANDECK_TEST_DATA || process.env.QUANDECK_SMOKE_DATA || mkdtempSync(path.join(os.tmpdir(), 'quandeck-smoke-data-'));
  mkdirSync(smokeData, { recursive: true }); app.setPath('userData', smokeData);
}
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
function requireTrusted(event) {
  if (![...windows].some(w => !w.isDestroyed() && w.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('quandeck://app/')) throw new Error('页面来源无效');
}
function openExternal(value) {
  try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) void shell.openExternal(url.href); } catch {}
}
function broadcast(name, value) { for (const w of windows) if (!w.isDestroyed()) w.webContents.send(name, value); }
function prepareWindow(options) {
  const w = new BrowserWindow({ backgroundColor: '#ffffff', show: false, ...options,
    webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  windows.add(w); w.on('closed', () => windows.delete(w));
  const publishWindowState = () => { if (!w.isDestroyed()) w.webContents.send('window-state', { maximized: w.isMaximized(), fullscreen: w.isFullScreen() }); };
  for (const name of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) w.on(name, publishWindowState);
  w.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('quandeck://app/')) { event.preventDefault(); openExternal(url); } });
  w.once('ready-to-show', () => { if (!smokeTest) w.show(); }); return w;
}
async function createWindow() {
  window = prepareWindow({ width: 1440, height: 960, minWidth: 680, minHeight: 560, title: 'QuanDeck' });
  await window.loadURL('quandeck://app/'); return window;
}
async function showMain(target) {
  if (!window || window.isDestroyed()) await createWindow();
  if (window.isMinimized()) window.restore(); window.show(); window.focus();
  if (target) window.webContents.send('navigate', target);
}
async function openRun(runId, targetSessionId) {
  service.runtime.read(runId);
  const sourceKey = `${runId}:${targetSessionId || ''}`;
  let w = sources.get(sourceKey);
  if (w && !w.isDestroyed()) { w.show(); w.focus(); return; }
  w = prepareWindow({ width: 860, height: 800, minWidth: 560, minHeight: 480, title: 'QuanDeck · Agent 会话' });
  sources.set(sourceKey, w); w.on('closed', () => sources.delete(sourceKey));
  await w.loadURL(`quandeck://app/?run=${encodeURIComponent(runId)}${targetSessionId ? '&child=' + encodeURIComponent(targetSessionId) : ''}`);
}
async function ensureCore() {
  if (!corePromise) corePromise = (async () => {
    globalThis.localStorage = store.storage;
    const module = await import('./workdeck-core.mjs'); projectionExport = module.exportCollaboration;
    contextAccess = await createContextAccess({ read: async request => {
      if (maintenanceActive) throw new Error('数据维护期间不可读取');
      const snapshot = (await core.listProjects()).find(project => project.project.id === request.projectId);
      if (!snapshot) throw new Error('项目不存在');
      return module.readContextEvidence(snapshot, request, { runId: request.runId, claimEpoch: request.claimEpoch });
    } });
    commandNames = new Set(module.BUSINESS_COMMANDS); deriveActivity = module.deriveProjectActivity;
    const driver = Object.assign(Object.create(service.runtime), { contextAccess: binding => contextAccess.instructions(binding), prepareAttachments: async input => {
      const snapshot = (await core.listProjects()).find(project => project.project.id === input.projectId);
      const binding = snapshot && Object.values(snapshot.runtimeConnections ?? {}).find(value => value.connectionId === input.connectionId);
      return prepareTaskFiles(store, snapshot, binding, input);
    } });
    core = module.createRuntimeDataSource(new module.LocalWorkdeckDataSource(), driver);
    core.subscribe(snapshot => { broadcast('snapshot', snapshot); void updateTray(); void flushProjections().catch(error => broadcast('storage-error', error.message)); });
    await core.syncRuntime(); await updateTray(); await flushProjections();
    void core.syncTrackedSources?.().catch(error => broadcast('storage-error', String(error.message || error)));
    scanTimer = setInterval(() => { void flushProjections().catch(error => broadcast('storage-error', error.message)); void core.syncTrackedSources?.().catch(error => broadcast('storage-error', String(error.message || error))); }, 60000); scanTimer.unref();
    return core;
  })();
  return corePromise;
}
async function updateTray() {
  if (!tray || !core) return;
  const projects = await core.listProjects();
  const active = projects.flatMap(project => deriveActivity(project).entries.filter(entry => entry.state !== 'failed').map(entry => ({ ...entry, project: project.project })));
  const running = active.filter(s => s.state === 'running').length, waiting = active.filter(s => s.state.startsWith('waiting')).length;
  tray.setToolTip(`QuanDeck · ${running} 运行 · ${waiting} 等我`);
  if (process.platform === 'darwin') tray.setTitle(waiting ? ` ${waiting} 等我` : running ? ` ${running}` : '');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 QuanDeck', click: () => void showMain() }, { type: 'separator' },
    ...active.slice(0, 20).map(s => ({ label: `${s.state.startsWith('waiting') ? '● 等我' : s.state === 'queued' ? '排队' : '运行'} · ${s.project.name} / ${s.title}`, click: () => void showMain({ projectId: s.project.id, taskId: s.taskId }) })),
    ...(active.length ? [] : [{ label: '当前没有运行中的任务', enabled: false }]),
    { type: 'separator' }, { label: '退出 QuanDeck', click: () => app.quit() },
  ]));
}
async function controlRun(runId, action, payload) {
  const source = await ensureCore();
  const projects = await source.listProjects();
  for (const project of projects) for (const session of Object.values(project.sessions)) {
    if (session.runtime?.runId === runId) return source.controlSession(session.id, action, payload);
  }
  throw new Error('此执行尚未关联到任务，请返回任务页面同步');
}
async function cleanInstallers() {
  const removed = []; let freedBytes = 0;
  const version = app.getVersion().split('.').map(Number);
  for (const file of await readdir(app.getPath('downloads'))) {
    const match = /^QuanDeck-(\d+)\.(\d+)\.(\d+)-(?:mac-(?:arm64|x64)\.dmg|win-x64-Setup\.exe)$/.exec(file);
    if (!match) continue;
    const parts = match.slice(1).map(Number); const firstDifferent = parts.findIndex((v, i) => v !== version[i]);
    if (firstDifferent < 0 || parts[firstDifferent] >= version[firstDifferent]) continue;
    const target = path.join(app.getPath('downloads'), file); const info = await stat(target);
    if (!info.isFile()) continue;
    await unlink(target); removed.push(file); freedBytes += info.size;
  }
  return { removed, freedBytes };
}
app.on('second-instance', () => void showMain());
if (ownsInstance) app.whenReady().then(async () => {
  protocol.handle('quandeck', request => {
    const url = new URL(request.url); if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
    let relative; try { relative = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const root = path.join(directory, 'dist'); const target = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).href);
  });
  store = createLocalStore(path.join(app.getPath('userData'), 'workspace'));
  for (const key of store.read('runtime.notifiedIncidents', [])) notified.add(key);
  const token = randomBytes(32).toString('hex');
  service = createBridgeService({ openManagedRun: openRun, dshModelDirectory: path.join(app.getPath('userData'), 'dsh-models'), connections: store.read('runtime.connections', []), saveConnections: records => store.write('runtime.connections', records), initialRuns: store.read('runtime.runs', []), saveRuns: records => store.write('runtime.runs', records), onPersistenceError: error => broadcast('storage-error', String(error.message || error)) });
  bridge = createBridgeServer({ token, origins: ['quandeck://app'], service });
  await new Promise((resolve, reject) => { bridge.once('error', reject); bridge.listen(0, '127.0.0.1', resolve); });
  connection = { baseUrl: `http://127.0.0.1:${bridge.address().port}`, token };
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => { requireTrusted(event); return fn(...args); });
  ipcMain.handle('window-state', event => { requireTrusted(event); const target = BrowserWindow.fromWebContents(event.sender); return { maximized: target.isMaximized(), fullscreen: target.isFullScreen() }; });
  ipcMain.handle('window-fullscreen', event => { requireTrusted(event); const target = BrowserWindow.fromWebContents(event.sender); target.setFullScreen(!target.isFullScreen()); });
  handle('connection', () => connection);
  handle('bootstrap', async values => { store.migrate(values); await ensureCore(); return Object.fromEntries(migrationKeys.map(key => [key, store.storage.getItem(key)])); });
  handle('command', async (name, args) => {
    if (maintenanceActive) throw new Error('正在维护数据，请稍后重启工作台');
    const source = await ensureCore();
    if (!commandNames.has(name) || !Array.isArray(args) || typeof source[name] !== 'function') throw new Error('不支持的操作');
    if (name === 'createTaskWithAttachments' || name === 'setTaskAttachments') {
      const project = name === 'createTaskWithAttachments' ? args[2] : args[0];
      const files = name === 'createTaskWithAttachments' ? args[1] : args[2];
      if (!Array.isArray(files) || files.length > 20) throw new Error('附件请求无效');
      if (!(await source.listProjects()).some(value => value.project.id === project)) throw new Error('附件项目不存在');
      for (const file of files) { const bytes = await store.attachment(project, file.id); if (bytes.length !== file.size) throw new Error('附件内容与记录不一致'); }
    }
    return source[name](...args);
  });
  handle('preference', (key, value) => { if (!preferenceKeys.includes(key) || typeof value !== 'string' || value.length > 1024 * 1024) throw new Error('配置项无效'); JSON.parse(value); store.storage.setItem(key, value); });
  handle('preference-compare', (key, expected, value) => {
    if (key !== 'quandeck.configured-agents.v1' || typeof expected !== 'string' || typeof value !== 'string' || value.length > 1024 * 1024) throw new Error('配置项无效');
    if ((store.storage.getItem(key) ?? '[]') !== expected) return false;
    if (!Array.isArray(JSON.parse(value))) throw new Error('配置项无效');
    store.storage.setItem(key, value); return true;
  });
  handle('directory', async () => { const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: '选择任务项目文件夹' }); return result.canceled ? null : result.filePaths[0]; });
  handle('executable', async () => { const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: '选择 Agent CLI 或 JavaScript 入口' }); return result.canceled ? null : result.filePaths[0]; });
  handle('attachment-save', async (project, input) => { if (!(await (await ensureCore()).listProjects()).some(value => value.project.id === project)) throw new Error('附件项目不存在'); return store.saveAttachment(project, input); });
  handle('attachment-remove', (project, id) => store.removeAttachment(project, id));
  handle('attachment-download', async (project, file) => {
    const bytes = await store.attachment(project, file.id);
    const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(file.name), title: '保存附件' });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, bytes); return true;
  });
  handle('run-open', openRun); handle('run-read', id => service.runtime.read(id)); handle('run-control', controlRun);
  handle('installers-clean', cleanInstallers);
  handle('workspace-backup', async () => {
    await service.runtime.flush?.(); await core?.flushRuntime?.();
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: '选择工作台备份位置' });
    if (result.canceled || !result.filePaths[0]) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return store.backup(path.join(result.filePaths[0], `QuanDeck-backup-${stamp}`));
  });
  handle('project-export', async projectId => {
    await ensureCore(); const snapshot = store.read('quandeck.projects.v1', {}).projects?.[projectId];
    if (!snapshot || snapshot.project?.deletedAt) throw new Error('项目不存在');
    const hash = storageDigest(snapshot), adapter = projectionAdapter(store.directory, id => store.read('quandeck.projects.v1', {}).projects?.[id], projectionExport);
    let item = store.outbox.enqueue({ id: 'projection-' + storageDigest({ projectId, hash }), projectId, kind: 'project.projection', payload: { hash } });
    if (item.state === 'done' && (await adapter.query(item, { fence() {} })).state !== 'done') item = store.outbox.enqueue({ id: 'projection-repair-' + randomUUID(), projectId, kind: 'project.projection', payload: { hash } });
    const result = await store.outbox.deliver(item.id, adapter);
    if (result.state !== 'done' || result.receipt?.superseded) throw new Error('导出尚未完成，请重试');
    await shell.openPath(result.receipt.generation); return result.receipt;
  });
  handle('project-erase-preview', projectId => store.previewEraseProject(projectId));
  handle('project-erase', async request => {
    if (maintenanceActive) throw new Error('正在维护数据');
    const plan = store.previewEraseProject(request?.confirmation);
    // The original token remains the authority; fresh preview is used only for native disclosure.
    const live = store.read('runtime.runs', []).filter(run => ['running', 'queued', 'waiting_permission', 'waiting_input'].includes(run.status));
    if (live.length) throw new Error('请先暂停所有运行中的任务，再永久清除项目');
    const result = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '永久清除'], defaultId: 0, cancelId: 0, title: '永久清除项目', message: '将永久清除以下项目及关联历史', detail: plan.affectedProjects.map(p => p.name).join('、') + `\n包括附件、摘要、运行记录及 ${plan.backupCount} 份登记备份。无法撤销。Agent 自身或自行复制的副本需另行清除。` });
    if (result.response !== 1) return null;
    maintenanceActive = true;
    try {
      clearInterval(scanTimer); core?.stopIntelligence?.(); await core?.flushIntelligence?.(); await projectionDrain; core?.dispose?.(); await service.runtime.close(); await service.runtime.flush?.(); await contextAccess?.close();
      const erased = store.eraseProject(request); store.close(); app.relaunch(); app.exit(0); return erased;
    } catch (error) { dialog.showErrorBox('清除未完成', String(error.message || error) + '\n请重启后重新核对；清除登记会在启动时继续处理。'); app.relaunch(); app.exit(1); throw error; }
  });
  handle('workspace-restore', async () => {
    if (maintenanceActive) throw new Error('正在维护数据');
    const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: '选择 QuanDeck 备份文件夹' });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const confirmed = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '恢复并重启'], defaultId: 0, cancelId: 0, title: '恢复工作台', message: '暂停当前任务并恢复备份', detail: '核对文件完整性后恢复；当前数据保留为回滚点。已永久清除的项目不会被恢复，运行任务需要核对后手动继续。' });
    if (confirmed.response !== 1) return null;
    maintenanceActive = true;
    try {
      clearInterval(scanTimer); core?.stopIntelligence?.(); await core?.flushIntelligence?.(); await service.runtime.close(); await service.runtime.flush?.(); await core?.flushRuntime?.(); await projectionDrain; core?.dispose?.(); await contextAccess?.close();
      const restored = store.prepareRestore(selected.filePaths[0]); store.close(); app.relaunch(); app.exit(0); return restored;
    } catch (error) { dialog.showErrorBox('恢复未完成', String(error.message || error)); app.relaunch(); app.exit(1); throw error; }
  });
  service.runtime.subscribe(event => {
    broadcast('run-event', { runId: event.runId });
    queueMicrotask(() => { void core?.flushRuntime?.().catch(error => broadcast('storage-error', String(error.message || error))); });
    if (event.incident?.status === 'open') {
      const key = `health:${event.incident.id}`;
      if (!notified.has(key)) {
        notified.add(key);
        try { store.write('runtime.notifiedIncidents', [...notified].filter(item => item.startsWith('health:')).slice(-500)); }
        catch { broadcast('storage-error', '提醒状态未能保存，任务记录请以工作台为准。'); }
        const preferences = store.read('quandeck.preferences.v1', {});
        if (preferences.notifications !== false && Notification.isSupported() && !smokeTest) {
          const run = service.runtime.read(event.runId);
          const notice = new Notification({ title: event.incident.title, body: event.incident.message });
          notice.on('click', () => void showMain({ projectId: run.projectId, taskId: run.taskId, runId: run.runId, incidentId: event.incident.id }));
          notice.show();
        }
      }
    }
    if (event.fallbackAccepted && event.fallback) {
      const key = `health:fallback:${event.runId}`;
      if (!notified.has(key)) {
        notified.add(key);
        try { store.write('runtime.notifiedIncidents', [...notified].filter(item => item.startsWith('health:')).slice(-500)); }
        catch { broadcast('storage-error', '提醒状态未能保存，任务记录请以工作台为准。'); }
        const preferences = store.read('quandeck.preferences.v1', {});
        if (preferences.notifications !== false && Notification.isSupported() && !smokeTest) {
          const run = service.runtime.read(event.runId), connections = service.exportConnections();
          const target = connections.find(item => item.connectionId === event.fallback.toConnectionId);
          const notice = new Notification({ title: '已换用备用 Agent', body: `${target?.displayName || target?.tool || '备用 Agent'} 已接收任务，原执行与切换原因可以在任务中查看。` });
          notice.on('click', () => void showMain({ projectId: run.projectId, taskId: run.taskId, runId: run.runId, incidentId: `fallback:${run.runId}` }));
          notice.show();
        }
      }
    }
    if (event.request && !notified.has(`${event.runId}:${event.request.id}`)) {
      notified.add(`${event.runId}:${event.request.id}`);
      const preferences = store.read('quandeck.preferences.v1', {});
      if (preferences.notifications !== false && Notification.isSupported() && !smokeTest) {
        const notice = new Notification({ title: event.request.kind === 'permission' ? 'Agent 需要授权' : 'Agent 等待回复', body: String(event.request.prompt).slice(0, 180) });
        notice.on('click', () => void openRun(event.runId)); notice.show();
      }
    }
  });
  if (!smokeTest) {
    const icon = nativeImage.createFromPath(path.join(directory, 'dist/favicon.png')).resize({ width: 18, height: 18 });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon); tray.on('click', () => void showMain());
  }
  await createWindow();
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback([...windows].some(w => w.webContents === contents) && permission === 'clipboard-sanitized-write' && details.requestingUrl.startsWith('quandeck://app/')));
  if (smokeTest) {
    const deadline = Date.now() + 20000; let rendered;
    do {
      rendered = await window.webContents.executeJavaScript('({ text: document.body.innerText, rootChildren: document.getElementById("root")?.childElementCount || 0 })');
      if (rendered.rootChildren > 0 && rendered.text.includes('QuanDeck')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    if (!rendered.rootChildren || !rendered.text.includes('QuanDeck')) throw new Error('Application did not render');
    await ensureCore();
    const clean = (await core.listProjects()).length === 0 && store.read('quandeck.configured-agents.v1', []).length === 0 && await window.webContents.executeJavaScript('!!document.querySelector(".qd-project-empty")');
    if (!clean) throw new Error('Fresh installation must have no sample projects or agents');
    const unauthorized = await fetch(connection.baseUrl + '/v1/tools');
    const tools = await fetch(connection.baseUrl + '/v1/tools', { headers: { Authorization: `Bearer ${token}` } });
    if (unauthorized.status !== 401 || tools.status !== 200) throw new Error('Local authentication check failed');
    const { checkCollaboration } = await import('./smoke-collaboration.mjs');
    const collaboration = await checkCollaboration(core, store);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '任务')?.click()`);
    let taskRendered = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      taskRendered = await window.webContents.executeJavaScript(`!!document.querySelector('.qd-journal') && document.body.innerText.includes('核对人工成果') && !document.querySelector('.qc-workspace')`);
      if (taskRendered) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!taskRendered) throw new Error('Existing task workspace did not render the persisted task');
    const { checkIntelligence } = await import('./smoke-intelligence.mjs');
    const intelligence = await checkIntelligence(core, window.webContents);
    const { checkTaskAttachments } = await import('./smoke-task-attachments.mjs');
    const taskAttachments = await checkTaskAttachments(core, store, window.webContents);
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="关闭任务附件"]')?.click()`);
    const { checkIntegration } = await import('./smoke-integration.mjs');
    const integration = await checkIntegration(core, store, window.webContents);
    if (process.env.QUANDECK_SMOKE_SCREENSHOT) await writeFile(process.env.QUANDECK_SMOKE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    collaboration.rendered = true;
    const result = { ok: true, version: app.getVersion(), platform: process.platform, arch: process.arch, renderer: window.webContents.getURL(), rendered: true, cleanStartup: true, localStorage: true, collaboration, intelligence, taskAttachments, integration, bridge: { authorized: tools.status, unauthorized: unauthorized.status } };
    if (process.env.QUANDECK_SMOKE_OUTPUT) await writeFile(process.env.QUANDECK_SMOKE_OUTPUT, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result)); app.quit(); return;
  }
  app.on('activate', () => void showMain());
}).catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  if (smokeTest) { console.error(message); if (process.env.QUANDECK_SMOKE_OUTPUT) await writeFile(process.env.QUANDECK_SMOKE_OUTPUT, JSON.stringify({ ok: false, error: message }) + '\n'); app.exit(1); }
  else { dialog.showErrorBox('QuanDeck 启动失败', message); app.quit(); }
});
// A closed window leaves actual tasks running; Quit is explicit in the system tray.
app.on('window-all-closed', () => {});
let quitting = false;
app.on('before-quit', event => {
  if (quitting || !service) return; event.preventDefault(); quitting = true; clearInterval(scanTimer);
  void (async () => { core?.stopIntelligence?.(); await service.runtime.close(); await core?.flushIntelligence?.(); await service.runtime.flush?.(); await core?.flushRuntime?.(); })().catch(error => dialog.showErrorBox('退出前保存失败', String(error.message || error))).finally(() => { core?.dispose?.(); void contextAccess?.close(); bridge?.close(); tray?.destroy(); store?.close(); app.quit(); });
});
