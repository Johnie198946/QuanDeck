// WorkBuddy Desktop handoff uses macOS Launch Services; no session data or credentials are read.
import { execFile } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const bundleId = 'com.tencent.workbuddy.mac';

export async function detectWorkBuddy({
  platform = process.platform,
  home = os.homedir(),
  apps = ['/Applications/WorkBuddy.app', path.join(home, 'Applications/WorkBuddy.app')],
} = {}) {
  if (platform !== 'darwin') return null;
  for (const app of apps) {
    try {
      const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', path.join(app, 'Contents/Info.plist')], { timeout: 2000, maxBuffer: 65536 });
      const info = JSON.parse(stdout);
      const name = info.CFBundleExecutable;
      if (info.CFBundleIdentifier !== bundleId || typeof name !== 'string' || !/^[\w.-]+$/.test(name) || name === '.' || name === '..') continue;
      const executable = path.join(app, 'Contents/MacOS', name);
      if (!(await stat(executable)).isFile()) continue;
      await access(executable, constants.X_OK);
      const version = info.CFBundleShortVersionString;
      return { app, version: typeof version === 'string' && /^\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/.test(version) ? version : null };
    } catch {}
  }
  return null;
}

export async function openWorkBuddy(app) {
  try { await exec('/usr/bin/open', ['-a', app], { timeout: 5000 }); }
  catch { throw new Error('无法打开 WorkBuddy，请先从“应用程序”打开客户端，再回来重试。'); }
}
