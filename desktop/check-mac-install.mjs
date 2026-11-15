import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Run this check on macOS.');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const { version } = JSON.parse(await readFile(path.join(here, 'app/package.json'), 'utf8'));
const dmg = path.resolve(process.argv[2] || path.join(root, `output/installers/QuanDeck-${version}-mac-${process.arch}.dmg`));
const temp = await mkdtemp(path.join(os.tmpdir(), 'quandeck-install-check-'));
const mount = path.join(temp, 'volume');
const installed = path.join(temp, 'Applications', 'QuanDeck.app');
const smoke = path.join(temp, 'smoke.json');
let mounted = false;
try {
  execFileSync('hdiutil', ['verify', dmg], { stdio: 'inherit' });
  await mkdir(mount);
  execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { stdio: 'inherit' });
  mounted = true;
  if (await readlink(path.join(mount, 'Applications')) !== '/Applications') throw new Error('Missing Applications drag target');
  await mkdir(path.dirname(installed));
  execFileSync('ditto', ['--noextattr', '--norsrc', path.join(mount, 'QuanDeck.app'), installed]);
  execFileSync('codesign', ['--verify', '--deep', '--strict', installed], { stdio: 'inherit' });
  const bundledVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(installed, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  if (bundledVersion !== version) throw new Error(`Wrong app version: ${bundledVersion}`);
  execFileSync(path.join(installed, 'Contents/MacOS/QuanDeck'), ['--smoke-test'], {
    env: { ...process.env, QUANDECK_SMOKE_OUTPUT: smoke, QUANDECK_SMOKE_DATA: path.join(temp, 'profile') },
    timeout: 90000, stdio: 'inherit',
  });
  const launch = JSON.parse(await readFile(smoke, 'utf8'));
  if (!launch.ok || launch.version !== version) throw new Error('Installed application smoke test failed');
  await rm(installed, { recursive: true });
  const result = { ok: true, installer: path.basename(dmg), dmgVerified: true, applicationsLink: true,
    copiedInstallation: true, signatureVerified: true, launch, removedApplication: true };
  await mkdir(path.join(root, 'output'), { recursive: true });
  await writeFile(path.join(root, `output/mac-install-check-${launch.arch}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (mounted) execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' });
  await rm(temp, { recursive: true, force: true });
}
