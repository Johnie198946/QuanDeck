import { mkdtempSync, readFileSync, writeFileSync, existsSync, cpSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalStore } from './local-store.mjs';
import { recoverWorkspaceMaintenance } from './storage-maintenance.mjs';

/** Runs only after --smoke-test selects fresh temporary application data. */
export async function checkMaintenance(core, store, webContents) {
  const require = (condition, message) => { if (!condition) throw new Error('Maintenance smoke: ' + message); };
  const current = (await core.load()).project.id;
  const invoke = (method, value) => webContents.executeJavaScript(`window.quandeckDesktop[${JSON.stringify(method)}](${JSON.stringify(value)})`);
  require(await invoke('getCodexApprovalMode') === 'manual', 'manual approval default');
  for (const mode of ['ai', 'full', 'manual']) {
    await invoke('setCodexApprovalMode', mode);
    require(await invoke('getCodexApprovalMode') === mode && store.read('runtime.codexApprovalMode') === mode, 'approval setting round trip');
  }
  const exported = await invoke('exportProject', current);
  require(exported.projectId === current && JSON.stringify([...exported.files].sort()) === JSON.stringify(['blackboard.md', 'ledger.md', 'project-memory.json', 'project-memory.md']), 'renderer IPC business-memory export result');
  const memory = readFileSync(path.join(exported.generation, 'project-memory.md'), 'utf8');
  require(memory.includes('项目记忆') && memory.includes('为什么做') && memory.includes('去哪里查'), 'native readable project brief with source guidance');
  require(!existsSync(path.join(exported.generation, 'export.json')), 'default projection excludes private audit export');
  const original = readFileSync(path.join(exported.generation, 'ledger.md'), 'utf8');
  require(original.includes('台帐'), 'native ledger file');
  writeFileSync(path.join(exported.generation, 'ledger.md'), 'changed export');
  const repaired = await invoke('exportProject', current);
  require(readFileSync(path.join(repaired.generation, 'ledger.md'), 'utf8').includes('台帐'), 'explicit IPC export repairs generated text');
  const preview = await invoke('previewEraseProject', current);
  require(preview.projectId === current && preview.token && preview.counts.projects >= 1, 'renderer IPC erasure preview');
  let rejected = false;
  try { await invoke('eraseProject', { token: 'not-a-valid-token', confirmation: current }); } catch { rejected = true; }
  require(rejected && (await core.listProjects()).some(p => p.project.id === current), 'bad erasure token rejected before dialog or mutation');

  // No destructive IPC is bypassed. Test destructive mechanics in a second,
  // disposable store, while the live test project remains available to the UI.
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'quandeck-maintenance-smoke-'));
  let isolated;
  try {
    const workspace = path.join(sandbox, 'workspace'); isolated = createLocalStore(workspace);
    const snapshot = structuredClone((await core.listProjects()).find(p => p.project.id === current));
    isolated.write('quandeck.projects.v1', { schema: 1, activeProjectId: current, projects: { [current]: snapshot }, agents: [] });
    const attachment = await isolated.saveAttachment(current, { name: 'smoke-only.txt', bytes: Buffer.from('temporary smoke evidence') });
    const backup = path.join(sandbox, 'backup'); isolated.backup(backup);
    const oldCopy = path.join(sandbox, 'old-copy'); cpSync(backup, oldCopy, { recursive: true });
    const plan = isolated.previewEraseProject(current); isolated.eraseProject({ token: plan.token, confirmation: current });
    require(!isolated.read('quandeck.projects.v1').projects[current] && !existsSync(backup), 'isolated erasure removes project and managed backup');
    require(!existsSync(path.join(workspace, 'attachments', current, attachment.id)), 'isolated attachment erased');
    const recovery = isolated.prepareRestore(oldCopy); isolated.close(); isolated = null; recoverWorkspaceMaintenance(workspace); isolated = createLocalStore(workspace);
    require(!isolated.read('quandeck.projects.v1').projects[current] && recovery.replayedErasureCount === 1, 'erasure survives old-copy restoration');
    require(existsSync(recovery.rollbackPoint), 'verified restore retained rollback point');
  } finally { isolated?.close(); rmSync(sandbox, { recursive: true, force: true }); }
  const projectViews = path.join(store.directory, 'projections', current);
  require(readdirSync(projectViews).filter(name => /^[a-f0-9]{64}$/.test(name)).length <= 20, 'bounded generated views');
  return { ok: true, ipcCodexApprovalModes: true, ipcExport: true, ipcRepair: true, ipcErasePreview: true, ipcInvalidEraseRejected: true, isolatedErasure: true, restoredErasureReplay: true, nativeConfirmationBypassed: false, usesUserData: false };
}
