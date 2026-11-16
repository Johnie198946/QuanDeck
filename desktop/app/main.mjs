import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createBridgeServer } from './agent-bridge.mjs';

protocol.registerSchemesAsPrivileged([{ scheme: 'quandeck', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const directory = path.dirname(fileURLToPath(import.meta.url));
let window;
let bridge;
let connection;
app.setName('QuanDeck');
const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) {
  const smokeData = process.env.QUANDECK_SMOKE_DATA || mkdtempSync(path.join(os.tmpdir(), 'quandeck-smoke-data-'));
  mkdirSync(smokeData, { recursive: true });
  app.setPath('userData', smokeData);
}
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
const trusted = (event) => event.sender === window?.webContents && event.senderFrame?.url.startsWith('quandeck://app/');
function requireTrusted(event) { if (!trusted(event)) throw new Error('页面来源无效'); }
function openExternal(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    void shell.openExternal(url.href);
  } catch { /* Invalid source links stay in the app. */ }
}
async function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 680, minHeight: 560,
    title: 'QuanDeck', backgroundColor: '#ffffff', show: false,
    webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('quandeck://app/')) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === window?.webContents && permission === 'clipboard-sanitized-write' && details.requestingUrl.startsWith('quandeck://app/')));
  window.once('ready-to-show', () => { if (!smokeTest) window.show(); });
  await window.loadURL('quandeck://app/');
}
if (ownsInstance) app.whenReady().then(async () => {
protocol.handle('quandeck', (request) => {
  const url = new URL(request.url);
  if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
  let relative;
  try { relative = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
  const root = path.join(directory, 'dist');
  const target = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
  if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(target).href);
});
const token = randomBytes(32).toString('hex');
bridge = createBridgeServer({ token, origins: ['quandeck://app'] });
await new Promise((resolve, reject) => { bridge.once('error', reject); bridge.listen(0, '127.0.0.1', resolve); });
connection = { baseUrl: `http://127.0.0.1:${bridge.address().port}`, token };
ipcMain.handle('connection', event => { requireTrusted(event); return connection; });
ipcMain.handle('directory', async event => {
  requireTrusted(event);
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: '选择任务项目文件夹' });
  return result.canceled ? null : result.filePaths[0];
});
await createWindow();
if (smokeTest) {
  const deadline = Date.now() + 20000;
  let rendered;
  do {
    rendered = await window.webContents.executeJavaScript('({ text: document.body.innerText, rootChildren: document.getElementById("root")?.childElementCount || 0 })');
    if (rendered.rootChildren > 0 && rendered.text.includes('QuanDeck')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  if (!rendered.rootChildren || !rendered.text.includes('QuanDeck')) throw new Error('Application did not render');
  const clean = await window.webContents.executeJavaScript(`(() => {
    const library = JSON.parse(localStorage.getItem('quandeck.projects.v1') || '{"projects":{},"agents":[]}');
    const configured = JSON.parse(localStorage.getItem('quandeck.configured-agents.v1') || '[]');
    return !!document.querySelector('.qd-project-empty') && Object.keys(library.projects).length === 0 && library.agents.length === 0 && Array.isArray(configured) && configured.length === 0;
  })()`);
  if (!clean) throw new Error('Fresh installation must start with no projects, tasks or sample agents');
  const unauthorized = await fetch(connection.baseUrl + '/v1/tools');
  const tools = await fetch(connection.baseUrl + '/v1/tools', { headers: { Authorization: `Bearer ${token}` } });
  if (unauthorized.status !== 401 || tools.status !== 200) throw new Error('Local bridge authentication check failed');
  const result = { ok: true, version: app.getVersion(), platform: process.platform, arch: process.arch,
    renderer: window.webContents.getURL(), rendered: true, cleanStartup: true, bridge: { authorized: tools.status, unauthorized: unauthorized.status } };
  if (process.env.QUANDECK_SMOKE_OUTPUT) await writeFile(process.env.QUANDECK_SMOKE_OUTPUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  app.quit();
  return;
}
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  if (smokeTest) {
    console.error(message);
    if (process.env.QUANDECK_SMOKE_OUTPUT) await writeFile(process.env.QUANDECK_SMOKE_OUTPUT, JSON.stringify({ ok: false, error: message }) + '\n');
    app.exit(1);
  } else { dialog.showErrorBox('QuanDeck 启动失败', message); app.quit(); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => bridge?.close());
