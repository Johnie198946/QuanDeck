/** Native Windows Electron/ASAR launch contract, using a protocol fixture, never a real model. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createBridgeService } from '../scripts/agent-bridge.mjs';

assert.equal(process.platform, 'win32', 'Run on the native Windows build runner');
const require = createRequire(import.meta.url);
const packagerRequire = createRequire(require.resolve('@electron/packager'));
const { createPackage } = await import(pathToFileURL(packagerRequire.resolve('@electron/asar')).href);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const install = path.join(root, 'output', 'desktop', 'QuanDeck-win32-x64');
const resources = path.join(install, 'resources');
const archive = path.join(resources, 'app.asar');
const runtime = path.join(resources, 'runtime');
const wrapper = path.join(runtime, 'cli', 'bin', 'dsh.cmd');
const work = await mkdtemp(path.join(os.tmpdir(), 'quandeck-dsh-desktop-'));
const evidence = { kind: 'Native Electron Desktop launcher with rc2 protocol fixture; not an xLink vendor test', ok: false, checks: [] };
let service, ownsArchive = false, ownsRuntime = false;
const absent = async name => { try { await access(name); throw Error('Refusing to replace existing path: ' + name); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
try {
  await access(path.join(install, 'QuanDeck.exe'));
  await absent(archive); await absent(runtime);
  const entryFolder = path.join(work, 'asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host');
  await mkdir(path.join(entryFolder, 'lib'), { recursive: true });
  await writeFile(path.join(entryFolder, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-host', type: 'module' }));
  await copyFile(path.join(root, 'scripts/runtime/fixtures/dsh-rc2-peer.mjs'), path.join(entryFolder, 'lib/cli.js'));
  ownsArchive = true;
  await createPackage(path.join(work, 'asar'), archive);
  ownsRuntime = true;
  await mkdir(path.dirname(wrapper), { recursive: true });
  await writeFile(wrapper, '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0..\\..\\..\\..\\QuanDeck.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*\r\nexit /b %errorlevel%\r\n');
  service = createBridgeService();
  const receipt = await service.test({ tool: 'dsh', binary: wrapper, projectPath: work, provider: 'deepseek-official', model: 'test-contract' });
  assert.equal(receipt.status, 'ready'); assert.equal(receipt.protocol, 'legacy-rc2');
  assert.equal(receipt.capabilities.resume, false); assert.equal(receipt.capabilities.permissions, false);
  evidence.checks.push('verified Desktop wrapper launches actual Windows Electron with Node mode and ASAR CLI entry; no standalone Node required');
  const run = await service.runtime.run({ connectionId: receipt.connectionId, dispatchId: 'native-rc2', projectId: 'native-test', taskId: 'native-test', agentId: 'dsh', prompt: 'hello' });
  const wait = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('No rc2 fixture receipt'); };
  await wait(() => service.runtime.read(run.runId).lastReply === 'rc2 第 1 轮回报');
  assert.equal(service.runtime.read(run.runId).controls.canReply, true);
  await service.runtime.control(run.runId, 'reply', { prompt: 'second round' });
  await wait(() => service.runtime.read(run.runId).lastReply === 'rc2 第 2 轮回报');
  assert.equal(service.runtime.read(run.runId).tokens, 40);
  assert.equal(service.runtime.read(run.runId).sessionId, run.sessionId);
  await service.runtime.control(run.runId, 'stop');
  assert.equal(service.runtime.read(run.runId).controls.canResume, false);
  await assert.rejects(service.runtime.control(run.runId, 'resume', { prompt: 'must not send' }));
  evidence.checks.push('new dispatch and same-process follow-up preserve session; stopped session cannot silently become a new execution');
  evidence.ok = true;
} catch (error) { evidence.error = String(error.stack || error); throw error; }
finally {
  let cleanupError;
  try { await service?.runtime.close(); } catch (error) { cleanupError = error; }
  for (const target of [...(ownsArchive ? [archive] : []), ...(ownsRuntime ? [runtime] : []), work]) {
    try { await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { cleanupError ||= error; }
  }
  if (cleanupError) { evidence.ok = false; evidence.cleanupError = String(cleanupError); }
  await writeFile(path.join(root, 'output/dsh-launcher-install-check.json'), JSON.stringify(evidence, null, 2));
  if (cleanupError) throw cleanupError;
}
