// Only a validated source thread UUID can be passed to a locally installed Codex app.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const exec = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function codexThreadUrl(sessionId) {
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) throw new Error('源端会话 ID 无效');
  return `codex://threads/${sessionId}`;
}
export async function openCodexDesktop(sessionId, options = {}) {
  const url = codexThreadUrl(sessionId);
  if ((options.platform ?? process.platform) !== 'darwin') return false;
  const execute = options.exec ?? exec;
  const checkExecutable = options.checkExecutable ?? (async executable => { if (!(await stat(executable)).isFile()) return false; await access(executable, constants.X_OK); return true; });
  const home = options.home ?? os.homedir();
  const apps = options.apps ?? ['/Applications/Codex.app', '/Applications/ChatGPT.app', path.join(home, 'Applications/Codex.app'), path.join(home, 'Applications/ChatGPT.app')];
  for (const app of apps) {
    try {
      const result = await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', path.join(app, 'Contents/Info.plist')], { timeout: 2000, maxBuffer: 65536 });
      const info = JSON.parse(result.stdout);
      const executable = info.CFBundleExecutable;
      if (info.CFBundleIdentifier !== 'com.openai.codex' || !Array.isArray(info.CFBundleURLTypes) || !info.CFBundleURLTypes.some(type => Array.isArray(type.CFBundleURLSchemes) && type.CFBundleURLSchemes.includes('codex')) || typeof executable !== 'string' || !/^[\w.-]+$/.test(executable) || ['.', '..'].includes(executable)) continue;
      if (!await checkExecutable(path.join(app, 'Contents/MacOS', executable))) continue;
      await execute('/usr/bin/open', ['-a', app, url], { timeout: 5000 });
      return true;
    } catch { /* An absent or unavailable desktop app falls back to the verified CLI. */ }
  }
  return false;
}
