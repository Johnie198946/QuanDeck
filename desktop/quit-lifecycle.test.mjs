import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

for (const lineEnding of ['LF', 'CRLF']) for (const cleanupFails of [false, true]) test(`Quit fences activation and IPC, drains persistence and exits (cleanup failure: ${cleanupFails}, ${lineEnding})`, async () => {
  // Execute the production lifecycle handlers with Electron replaced by in-memory peers.
  // whenReady is deliberately unresolved: no service, filesystem or real window is opened.
  const source = (await readFile(new URL('./app/main.mjs', import.meta.url), 'utf8'))
    .replace(/\r?\n/g, lineEnding === 'CRLF' ? '\r\n' : '\n')
    .replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('./app/main.mjs', import.meta.url).href));
  const handlers = new Map(), created = [], order = [], load = deferred(), runtime = deferred(), projection = deferred(), evidence = deferred();
  const app = { setName() {}, requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on: (event, handler) => handlers.set(event, handler), exit: code => order.push(`exit:${code}`), quit: () => { throw Error('must not re-enter cancellable quit'); } };
  class Window {
    constructor() { this.handlers = new Map(); created.push(this); this.webContents = { setWindowOpenHandler() {}, on() {}, send() {} }; }
    on(event, handler) { this.handlers.set(event, handler); }
    once(event, handler) { this.handlers.set(event, handler); }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    loadURL() { return load.promise; }
    show() { order.push('show'); }
    focus() { order.push('focus'); }
  }
  const harness = new Function('app', 'BrowserWindow', 'protocol', 'fileURLToPath', 'path', 'dialog', 'console', source + `\nreturn { showMain, openRun, ensureCore, requireTrusted, setState(value) { service=value.service;core=value.core;store=value.store;contextAccess=value.contextAccess;projectionDrain=value.projectionDrain;bridge=value.bridge;tray=value.tray; } };`)(app, Window, { registerSchemesAsPrivileged() {} }, fileURLToPath, path, { showErrorBox: (_title, text) => { throw Error(text); } }, { error: () => order.push('cleanup-error') });
  harness.setState({
    service: { runtime: { close: async () => { order.push('stop-runtime'); await runtime.promise; }, flush: async () => order.push('flush-runtime-store'), read: () => { throw Error('source must not open after quit'); } } },
    core: { stopIntelligence: () => order.push('stop-ai'), flushIntelligence: async () => order.push('flush-ai'), flushRuntime: async () => order.push('flush-domain'), dispose: () => order.push('dispose') },
    store: { close: () => order.push('close-db') }, contextAccess: { close: async () => { order.push('close-evidence'); await evidence.promise; } }, projectionDrain: projection.promise,
    bridge: { close: () => order.push('close-bridge') }, tray: { destroy: () => order.push('destroy-tray') },
  });
  const opening = harness.showMain();
  assert.equal(created.length, 1);
  let prevented = 0;
  handlers.get('before-quit')({ preventDefault: () => prevented++ });
  handlers.get('before-quit')({ preventDefault: () => prevented++ });
  assert.equal(prevented, 2);
  assert.equal(order.filter(item => item === 'stop-runtime').length, 1);
  handlers.get('second-instance')();
  await harness.showMain(); await harness.openRun('known');
  await assert.rejects(harness.ensureCore(), /正在退出/);
  assert.throws(() => harness.requireTrusted({}), /正在退出/);
  created[0].handlers.get('ready-to-show')(); load.resolve(); await opening;
  assert.equal(created.length, 1); assert(!order.includes('show')); assert(!order.includes('close-db'));
  runtime.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert(order.includes('flush-domain')); assert(!order.includes('close-db'));
  projection.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert(order.includes('close-evidence')); assert(!order.includes('close-db'));
  cleanupFails ? evidence.reject(Error('fixture cleanup failed')) : evidence.resolve(); await new Promise(resolve => setImmediate(resolve));
  if (cleanupFails) assert.deepEqual(order.slice(-2), ['cleanup-error', 'exit:0']);
  else assert.deepEqual(order.slice(-4), ['close-bridge', 'destroy-tray', 'close-db', 'exit:0']);
  assert.equal(order.filter(item => item === 'close-db').length, cleanupFails ? 0 : 1);
  assert.equal(order.filter(item => item === 'exit:0').length, 1);
});
