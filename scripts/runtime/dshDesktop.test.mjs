import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDshDesktopCommand } from './dshDesktop.mjs';

const root = 'C:\\Users\\用户名 目录\\AppData\\Local\\Programs\\xLink DSH\\Desktop';
const binary = path.win32.join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
const wrapper = (exe = 'xLink DSH.exe') => ['@echo off', 'setlocal DisableDelayedExpansion', 'set "ELECTRON_RUN_AS_NODE=1"', `"%~dp0..\\..\\..\\..\\${exe}" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*`, 'exit /b %errorlevel%'].join('\r\n') + '\r\n';
function fixture(exe = 'xLink DSH.exe') {
  const archive = path.win32.join(root, 'resources', 'app.asar');
  const executable = path.win32.join(root, exe);
  const checked = [];
  const options = { readFile: async file => { assert.equal(file, binary); return wrapper(exe); }, isFile: async file => { checked.push(file); return [archive, executable].includes(file); }, realpath: async file => file };
  return { archive, executable, checked, options };
}

test('Desktop launcher resolves actual branded EXE and physical ASAR for metadata and SDK', async () => {
  for (const name of ['DeepSeek Harness.exe', 'xLink DSH.exe', '超聚变 DSH 企业版.exe']) {
    const f = fixture(name);
    for (const args of [['--version'], ['sdk']]) {
      const invocation = await resolveDshDesktopCommand(binary, args, f.options);
      assert.deepEqual(invocation, { binary: f.executable, args: ['--expose-internals', path.win32.join(f.archive, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'), ...args], env: { ELECTRON_RUN_AS_NODE: '1' } });
    }
    assert.deepEqual(new Set(f.checked), new Set([f.executable, f.archive]), 'never stat a virtual file inside app.asar');
  }
});

test('only harmless BOM, line endings, blank lines and token whitespace vary', async () => {
  const f = fixture();
  const text = '\uFEFF  ' + wrapper().replace(/\r\n/g, '\n\n').replace('echo off', 'echo\t off').replace('setlocal Disable', 'setlocal\tDisable').replace('--expose-internals ', '--expose-internals\t').trim() + '\n';
  assert.ok(await resolveDshDesktopCommand(binary, ['sdk'], { ...f.options, readFile: async () => text }));
});

test('unknown wrappers and additional commands are never interpreted', async () => {
  const f = fixture();
  const samples = ['', '@echo off\r\nnode other.js %*', wrapper() + 'echo injected\r\n', wrapper().replace('@echo off', '@echo off & whoami'), wrapper().replace('setlocal DisableDelayedExpansion', 'setlocal EnableDelayedExpansion'), wrapper().replace(' --expose-internals', ' --inspect --expose-internals'), wrapper().replace(' %*', ' %* & calc.exe'), wrapper().replace('lib\\cli.js', 'lib\\other.js'), wrapper().replace('"ELECTRON_RUN_AS_NODE=1"', '"ELECTRON_RUN_AS_NODE=0"'), wrapper().replace('..\\..\\..\\..\\xLink', '..\\..\\..\\..\\..\\xLink')];
  for (const text of samples) assert.equal(await resolveDshDesktopCommand(binary, ['sdk'], { ...f.options, readFile: async () => text }), null);
  assert.deepEqual(f.checked, [], 'unverified batch content does not reach filesystem target probes');
});

test('shell executable names, metacharacters and escaping installation paths are refused', async () => {
  for (const exe of ['powershell.exe', 'PWSH.exe', 'cmd.exe', 'wscript.exe', '..\\elsewhere.exe', 'evil&calc.exe', 'evil%PATH%.exe', 'evil!name.exe', 'evil^name.exe', 'evil(name).exe', 'evil..exe']) {
    const f = fixture(exe);
    assert.equal(await resolveDshDesktopCommand(binary, ['sdk'], f.options), null, exe);
  }
  const f = fixture();
  for (const file of [binary.replace('\\Desktop\\', '\\Desktop\\..\\Desktop\\'), binary.replace('xLink DSH', 'xLink%DSH'), binary.replace('C:\\', '\\\\server\\share\\'), binary.replace('dsh.cmd', 'dsh.bat'), binary.replace('\\resources\\', '\\other\\')]) {
    assert.equal(await resolveDshDesktopCommand(file, ['sdk'], f.options), null);
  }
});

test('missing executable or physical archive rejects the wrapper', async () => {
  const f = fixture();
  for (const absent of [f.archive, f.executable]) assert.equal(await resolveDshDesktopCommand(binary, ['sdk'], { ...f.options, isFile: async file => file !== absent }), null);
});

test('junctions and symlinks cannot redirect launcher targets outside the installation', async () => {
  const f = fixture();
  for (const redirected of [binary, f.executable, f.archive]) {
    assert.equal(await resolveDshDesktopCommand(binary, ['sdk'], { ...f.options, realpath: async file => file === redirected ? 'C:\\Elsewhere\\' + path.win32.basename(file) : file }), null);
  }
  assert.equal(await resolveDshDesktopCommand(binary, ['sdk'], { ...f.options, realpath: async file => file === f.executable ? path.win32.join(root, 'powershell.exe') : file }), null);
});

test('arguments remain separate argv data and malformed arguments fail closed', async () => {
  const f = fixture();
  const args = ['sdk', 'literal & %PATH% $(whoami)'];
  const result = await resolveDshDesktopCommand(binary, args, f.options);
  assert.deepEqual(result.args.slice(2), args);
  for (const args of [null, 'sdk', [undefined], ['sdk\0']]) assert.equal(await resolveDshDesktopCommand(binary, args, f.options), null);
});
