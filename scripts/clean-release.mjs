import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const POLICY_VERSION = 1;
export const APP_FILES = new Set([
  'package.json', 'package-lock.json', 'main.mjs', 'preload.cjs', 'agent-bridge.mjs', 'workdeck-core.mjs',
  'attachment-preview.mjs', 'delivery-file-verifier.mjs', 'local-store.mjs', 'project-connection.mjs',
  'project-partitions.mjs', 'project-deletion.mjs', 'project-connection-cleanup.mjs', 'project-workspace.mjs', 'run-workflow.mjs', 'spec-attachment-import.mjs',
  'storage-maintenance.mjs', 'task-attachments.mjs', 'smoke-collaboration.mjs', 'smoke-goal-delivery.mjs',
  'smoke-integration.mjs', 'smoke-intelligence.mjs', 'smoke-maintenance.mjs', 'smoke-task-attachments.mjs',
]);
const APP_DIRS = new Set(['dist', 'runtime', 'node_modules']);
const MEDIA = /\.(png|jpe?g|webp|gif|ico|icns|mp4|mov|mp3|wav|pdf|zip)$/i;
const TEXT = /\.(?:[cm]?[jt]sx?|json|md|html|css|svg|ya?ml|toml|txt|py|ps1|sh|cjs|lock)$/i;
const privatePath = /(?:^|\/)(?:ops\/change-manifests|docs\/validation|output|private-artifacts|userData|workspace-state|\.codex|\.claude|\.ssh|\.aws)(?:\/|$)|\.(?:sqlite(?:3)?|db)(?:$|[.-])|\.(?:har|log)$/i;
const credentialPath = /(?:^|\/)(?:\.env(?!\.example$)(?:\.|$)|credentials(?:\.json)?$|auth\.json$|runtime\.connections(?:\.json)?$|id_(?:rsa|ed25519)$)|\.(?:pem|p12|pfx|key)$/i;
const placeholderUser = /^(?:你的用户名|用户名|username|user|test|tester|demo|example|fixture|runner|runneradmin|alice|bob|\$\{?[^}]*\}?)$/i;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function isApplicationPathAllowed(relative) {
  const normalized = relative.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized) return true;
  return APP_FILES.has(normalized) || APP_DIRS.has(normalized.split('/')[0]);
}
export function contentViolations(text) {
  const reasons = [];
  const home = /(?:\/Users\/|\/home\/|[A-Z]:[\\/]+Users[\\/]+)([^\s/\\<>`"']+)/g;
  if ([...text.matchAll(home)].some(match => !placeholderUser.test(match[1]))) reasons.push('personal-home-path');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{50,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}|\bAKIA[A-Z0-9]{16}\b/.test(text)) reasons.push('credential-material');
  return reasons;
}
/** Identify exported runtime data by structure, even when the file was renamed.
 * Synthetic protocol/domain fixtures are only permitted in explicit test paths. */
export function containsProjectData(value) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    if (!Array.isArray(item)) {
      if (typeof item.schema === 'string' && /^quandeck\.(?:collaboration\.export|project|workspace)\./.test(item.schema)) return true;
      if (Object.hasOwn(item, 'quandeck.projects.v1') || Object.hasOwn(item, 'runtime.runs') || Object.hasOwn(item, 'runtime.connections')) return true;
      if (item.schema === 1 && item.projects && typeof item.projects === 'object' && Array.isArray(item.agents)) return true;
      if (item.storage === 'project-partitions-v1' && Array.isArray(item.projectIds)) return true;
      if (item.project && typeof item.project.id === 'string' && (item.collaboration || item.tasks && item.sessions)) return true;
      if (typeof item.projectId === 'string' && typeof item.runId === 'string' && (typeof item.prompt === 'string' || Array.isArray(item.events))) return true;
    }
    pending.push(...Object.values(item).filter(child => child && typeof child === 'object'));
  }
  return false;
}
const isSyntheticFixture = file => /^(?:tests\/|scripts\/runtime\/fixtures\/)/.test(file);
async function pathsUnder(directory, prefix = '', skipVendor = false) {
  const result = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (skipVendor && relative === 'node_modules') continue;
    if (entry.isDirectory()) result.push(...await pathsUnder(directory, relative, skipVendor));
    else result.push(relative);
  }
  return result;
}
export async function scanFiles(directory, files, assets, { application = false } = {}) {
  const approved = new Map(assets.map(asset => [asset.path, asset.sha256]));
  const approvedHashes = new Set(approved.values());
  const violations = [];
  let checked = 0;
  for (const file of files) {
    if (application && !isApplicationPathAllowed(file)) violations.push({ path: file, reason: 'unexpected-application-file' });
    if (privatePath.test(file)) violations.push({ path: file, reason: 'private-runtime-or-evidence-file' });
    if (credentialPath.test(file)) violations.push({ path: file, reason: 'credential-file' });
    const location = path.resolve(directory, file);
    if (!location.startsWith(path.resolve(directory) + path.sep)) { violations.push({ path: file, reason: 'path-escape' }); continue; }
    const stat = await lstat(location);
    if (stat.isSymbolicLink()) { violations.push({ path: file, reason: 'unreviewed-symlink' }); continue; }
    checked++;
    const bytes = await readFile(location);
    if (MEDIA.test(file) && !(application ? approvedHashes.has(sha256(bytes)) : approved.get(file) === sha256(bytes))) violations.push({ path: file, reason: 'unreviewed-binary-asset' });
    if (TEXT.test(file) || path.basename(file) === '.env.example') {
      const text = bytes.toString('utf8');
      for (const reason of contentViolations(text)) violations.push({ path: file, reason });
      if ((application || !isSyntheticFixture(file)) && /^[\s\uFEFF]*[\[{]/.test(text)) {
        try { if (containsProjectData(JSON.parse(text.replace(/^\uFEFF/, '')))) violations.push({ path: file, reason: 'project-or-runtime-export' }); }
        catch { /* Source text is not necessarily a JSON document. */ }
      }
    }
  }
  return { ok: violations.length === 0, checkedFiles: checked, violations };
}
export async function auditRepository(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const { assets } = JSON.parse(await readFile(path.join(root, 'scripts/release-assets.json'), 'utf8'));
  return scanFiles(root, files, assets);
}
export async function auditApplication(root, appDirectory) {
  const { assets } = JSON.parse(await readFile(path.join(root, 'scripts/release-assets.json'), 'utf8'));
  const entries = await readdir(appDirectory);
  const unexpected = entries.filter(entry => !APP_FILES.has(entry) && !APP_DIRS.has(entry));
  // Vendor SDK trees are managed by npm ci/prune, not by the first-party asset allowlist.
  // Preserve them intact; private state and credentials are still banned by path below.
  const files = await pathsUnder(appDirectory, '', true);
  const vendorFiles = (await pathsUnder(path.join(appDirectory, 'node_modules'))).map(file => `node_modules/${file}`);
  const result = await scanFiles(appDirectory, files, assets, { application: true });
  result.violations.push(...unexpected.map(file => ({ path: file, reason: 'unexpected-application-entry' })));
  result.violations.push(...vendorFiles.filter(file => privatePath.test(file) || credentialPath.test(file)).map(file => ({ path: file, reason: 'private-vendor-file' })));
  const required = ['main.mjs', 'preload.cjs', 'workdeck-core.mjs', 'agent-bridge.mjs', 'dist/index.html', 'runtime/driver.mjs'];
  for (const file of required) if (!files.includes(file)) result.violations.push({ path: file, reason: 'missing-runtime-file' });
  result.ok = result.violations.length === 0;
  result.vendorFiles = vendorFiles.length;
  return result;
}
export function requireClean(result, scope) {
  if (!result.ok) throw new Error(`Clean release rejected (${scope}): ${JSON.stringify(result.violations)}`);
  return { ok: true, checkedFiles: result.checkedFiles, ...(result.vendorFiles === undefined ? {} : { vendorFiles: result.vendorFiles }) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const repository = requireClean(await auditRepository(root), 'repository');
    console.log(JSON.stringify({ schema: 1, policyVersion: POLICY_VERSION, ok: true, repository }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
