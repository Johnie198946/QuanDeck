import { packager } from '@electron/packager';
import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { auditRepository, auditApplication, requireClean, POLICY_VERSION, isApplicationPathAllowed } from '../scripts/clean-release.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const output = path.join(root, 'output');
const repositoryClean = requireClean(await auditRepository(root), 'repository');
const cachedRuntime = process.env.QUANDECK_ELECTRON_CACHE || path.join(output, 'electron-runtime');
const appMetadata = JSON.parse(await readFile(path.join(here, 'app/package.json'), 'utf8'));
const toolsMetadata = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8'));
const electronVersion = toolsMetadata.devDependencies.electron;
const archArgument = process.argv.find(argument => argument.startsWith('--arch='))?.split('=')[1];
if (archArgument && !['arm64', 'x64'].includes(archArgument)) throw new Error('Supported architectures: arm64, x64');
if (process.argv.includes('--mac') && archArgument && archArgument !== 'arm64') throw new Error('macOS installers support Apple Silicon (arm64) only.');
if (process.argv.includes('--win') && archArgument && archArgument !== 'x64') throw new Error('Windows installers support x64 only.');
if (!existsSync(path.join(root, 'dist/index.html'))) throw new Error('Build the frontend first: pnpm build');
process.env.ELECTRON_BUILDER_CACHE ||= path.join(output, 'builder-cache');
process.env.CSC_IDENTITY_AUTO_DISCOVERY ||= 'false';
await mkdir(output, { recursive: true });
await rm(path.join(here, 'app/dist'), { recursive: true, force: true });
await mkdir(path.join(here, 'app/dist'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(here, 'app/dist'), { recursive: true, force: true });
await cp(path.join(root, 'scripts/agent-bridge.mjs'), path.join(here, 'app/agent-bridge.mjs'));
await rm(path.join(here, 'app/runtime'), { recursive: true, force: true });
await cp(path.join(root, 'scripts/runtime'), path.join(here, 'app/runtime'), { recursive: true, force: true, filter: source => !source.endsWith('.test.mjs') && !source.split(path.sep).includes('fixtures') });
await import('./build-core.mjs');
const applicationClean = requireClean(await auditApplication(root, path.join(here, 'app')), 'prepared application');
const targets = process.argv.includes('--mac') ? [['darwin',archArgument || 'arm64']] : process.argv.includes('--win') ? [['win32',archArgument || 'x64']] : [['darwin','arm64'],['win32','x64']];
const artifacts = [];
let sourceCommit = process.env.GITHUB_SHA || null;
let sourceDirty = null;
try {
  sourceCommit ||= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
} catch { /* A source archive or first uncommitted build has no Git revision. */ }
for (const [platform, arch] of targets) {
  if (platform === 'darwin' && process.platform !== 'darwin') throw new Error('Build macOS installers on a Mac.');
  const [unpacked] = await packager({ dir: path.join(here, 'app'), name: 'QuanDeck', appBundleId: 'app.quandeck.desktop',
    appVersion: appMetadata.version, electronVersion, platform, arch,
    icon: path.join(here, 'icons', platform === 'darwin' ? 'QuanDeck.icns' : 'QuanDeck.ico'),
    electronZipDir: existsSync(path.join(cachedRuntime, `electron-v${electronVersion}-${platform}-${arch}.zip`)) ? cachedRuntime : undefined,
    out: path.join(output, 'desktop'), overwrite: true, asar: false, prune: true,
    // First-party runtime allowlist; vendor SDK dependencies remain intact.
    ignore: relative => !isApplicationPathAllowed(relative),
    executableName: 'QuanDeck', win32metadata: { CompanyName: 'QuanDeck', FileDescription: 'QuanDeck', ProductName: 'QuanDeck' } });
  const packagedApp = platform === 'darwin' ? path.join(unpacked, 'QuanDeck.app/Contents/Resources/app') : path.join(unpacked, 'resources/app');
  requireClean(await auditApplication(root, packagedApp), 'packaged application');
  console.log(`Unpacked application: ${unpacked}`);
  if (process.argv.includes('--unpacked')) continue;
  // Sign outside Documents/iCloud so Finder metadata cannot invalidate the bundle.
  let signingDirectory;
  let prepackaged = unpacked;
  if (platform === 'darwin') {
    signingDirectory = await mkdtemp(path.join(os.tmpdir(), 'quandeck-installer-'));
    prepackaged = path.join(signingDirectory, 'QuanDeck.app');
    execFileSync('ditto', ['--noextattr', '--norsrc', path.join(unpacked, 'QuanDeck.app'), prepackaged]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', prepackaged], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', prepackaged], { stdio: 'inherit' });
  }
  try {
    const result = await build({
      projectDir: here, prepackaged, publish: 'never',
      targets: (platform === 'darwin' ? Platform.MAC : Platform.WINDOWS).createTarget(platform === 'darwin' ? 'dmg' : 'nsis', Arch[arch]),
      config: {
        appId: 'app.quandeck.desktop', productName: 'QuanDeck', electronVersion,
        directories: { app: path.join(here, 'app'), output: path.join(output, 'installers'), buildResources: path.join(here, 'icons') },
        artifactName: 'QuanDeck-${version}-${os}-${arch}.${ext}', asar: false,
        mac: { icon: path.join(here, 'icons/QuanDeck.icns'), category: 'public.app-category.productivity', identity: null },
        dmg: { sign: false, icon: path.join(here, 'icons/QuanDeck.icns'), iconSize: 76, title: `QuanDeck ${appMetadata.version}`, backgroundColor: '#f8f7f5', window: { width: 540, height: 360 },
          contents: [{ x: 150, y: 160, type: 'file' }, { x: 390, y: 160, type: 'link', path: '/Applications' }] },
        win: { icon: path.join(here, 'icons/QuanDeck.ico'), signAndEditExecutable: false },
        nsis: { artifactName: 'QuanDeck-${version}-win-${arch}-Setup.${ext}', oneClick: false, perMachine: false, selectPerMachineByDefault: false,
          allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true,
          shortcutName: 'QuanDeck', uninstallDisplayName: 'QuanDeck', deleteAppDataOnUninstall: false,
          installerLanguages: ['zh_CN', 'en_US'], displayLanguageSelector: false, runAfterFinish: true },
      },
    });
    for (const artifact of result) {
      if (!/\.(dmg|exe)$/.test(artifact)) continue;
      artifacts.push({ file: path.basename(artifact), sha256: createHash('sha256').update(await readFile(artifact)).digest('hex'), platform, arch, version: appMetadata.version });
    }
  } finally {
    if (signingDirectory) await rm(signingDirectory, { recursive: true, force: true });
  }
}
if (artifacts.length) {
  const suffix = targets.map(([platform, arch]) => `${platform}-${arch}`).join('_');
  await writeFile(path.join(output, `installer-manifest-${suffix}.json`), JSON.stringify({ version: appMetadata.version, electronVersion, sourceCommit, sourceDirty, builtAt: new Date().toISOString(), cleanRelease: { schema: 1, policyVersion: POLICY_VERSION, ok: true, repository: repositoryClean, application: applicationClean, packagedApplication: true }, artifacts }, null, 2) + '\n');
  console.log(JSON.stringify(artifacts, null, 2));
}
