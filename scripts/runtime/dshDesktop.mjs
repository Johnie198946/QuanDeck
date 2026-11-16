import path from 'node:path';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';

// Pinned upstream launcher template; branding may change only the EXE filename.
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/cli/dsh.cmd
// original-fs checks the physical archive in Electron, not a virtual path inside it.
const require = createRequire(import.meta.url);
let disk = fs;
try { disk = require('original-fs').promises; } catch { /* Plain Node has no ASAR filesystem patch. */ }
const physicalFile = async file => { try { return (await disk.stat(file)).isFile(); } catch { return false; } };
const terminalNames = new Set(['powershell', 'powershell_ise', 'pwsh', 'cmd', 'bash', 'zsh', 'sh', 'dash', 'fish', 'wt', 'conhost', 'wscript', 'cscript']);
const isLocalPath = value => typeof value === 'string' && /^[a-z]:\\/i.test(value) && !/[\x00-\x1f<>"|?*%!&^]/.test(value) && !value.slice(2).includes(':') && !value.split('\\').some(part => part === '.' || part === '..' || /[ .]$/.test(part));
const inside = (root, file) => { const relative = path.win32.relative(root, file); return !!relative && relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative); };

/** Resolve the verified Desktop shim without executing or interpreting batch code.
 * Unrecognized wrappers return null so callers retain their unsupported-wrapper path.
 * No stat is performed on the CLI entry inside app.asar.
 */
export async function resolveDshDesktopCommand(binary, args, options = {}) {
  if (!isLocalPath(binary) || !/\\resources\\runtime\\cli\\bin\\dsh\.cmd$/i.test(binary) || !Array.isArray(args) || args.some(value => typeof value !== 'string' || value.includes('\0'))) return null;
  const read = options.readFile || disk.readFile;
  const exists = options.isFile || physicalFile;
  const canonical = options.realpath || disk.realpath;
  try {
    const raw = String(await read(binary, 'utf8'));
    if (raw.length > 8192) return null;
    const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length !== 5 || !/^@echo[ \t]+off$/i.test(lines[0]) || !/^setlocal[ \t]+DisableDelayedExpansion$/i.test(lines[1]) || !/^set[ \t]+"ELECTRON_RUN_AS_NODE=1"$/i.test(lines[2]) || !/^exit[ \t]+\/b[ \t]+%errorlevel%$/i.test(lines[4])) return null;
    const launch = /^"%~dp0\.\.\\\.\.\\\.\.\\\.\.\\([^"\\]+\.exe)"[ \t]+--expose-internals[ \t]+"%~dp0\.\.\\\.\.\\\.\.\\app\.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli\.js"[ \t]+%\*$/i.exec(lines[3]);
    if (!launch) return null;
    const exeName = launch[1];
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*\.exe$/iu.test(exeName) || exeName.includes('..') || terminalNames.has(exeName.slice(0, -4).toLowerCase())) return null;
    const root = path.win32.resolve(path.win32.dirname(binary), '..', '..', '..', '..');
    const executable = path.win32.join(root, exeName);
    const archive = path.win32.join(root, 'resources', 'app.asar');
    if (!await exists(executable) || !await exists(archive)) return null;
    const [realRoot, realWrapper, realExecutable, realArchive] = await Promise.all([canonical(root), canonical(binary), canonical(executable), canonical(archive)]);
    if (![realRoot, realWrapper, realExecutable, realArchive].every(isLocalPath) || ![realWrapper, realExecutable, realArchive].every(file => inside(realRoot, file)) || terminalNames.has(path.win32.basename(realExecutable, path.win32.extname(realExecutable)).toLowerCase())) return null;
    return { binary: realExecutable, args: ['--expose-internals', path.win32.join(realArchive, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'), ...args], env: { ELECTRON_RUN_AS_NODE: '1' } };
  } catch { return null; }
}
