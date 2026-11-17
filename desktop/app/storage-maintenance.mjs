import { readStoredProjectLibrary, PROJECT_PARTITIONS_FORMAT } from './project-partitions.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, rmSync, copyFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const PROJECTS_KEY = 'quandeck.projects.v1';
/** Coalesce overlapping drains while preserving requests made during a batch. */
export function createCoalescedDrain(drain) {
  let pending, requested = false;
  function flush() {
    requested = true;
    if (pending) return pending;
    pending = (async () => {
      do { requested = false; await drain(); } while (requested);
    })().finally(() => {
      pending = undefined;
      // A caller can arrive after the loop exits but before this microtask runs.
      if (requested) return flush();
    });
    return pending;
  }
  return flush;
}
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const safe = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
const atomic = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID() + '.tmp', fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, file);
};
const readJSON = (file, fallback) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
const controlFiles = directory => ({ erasures: path.join(path.dirname(directory), path.basename(directory) + '.erasures.json'), backups: path.join(path.dirname(directory), path.basename(directory) + '.backups.json'), restore: path.join(path.dirname(directory), path.basename(directory) + '.restore.json') });
function assertRealTree(root) {
  if (!existsSync(root)) return;
  const info = lstatSync(root);
  if (info.isSymbolicLink()) throw new Error('数据目录不允许符号链接');
  if (info.isDirectory()) for (const entry of readdirSync(root)) assertRealTree(path.join(root, entry));
}
function copyTree(from, to) {
  assertRealTree(from);
  if (lstatSync(from).isDirectory()) { mkdirSync(to, { recursive: true, mode: 0o700 }); for (const name of readdirSync(from)) copyTree(path.join(from, name), path.join(to, name)); }
  else copyFileSync(from, to);
}
function eraseDatabase(db, ids) {
  const libraryRow = db.prepare('SELECT value FROM documents WHERE key=?').get(PROJECTS_KEY);
  db.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
  try {
    db.exec('DROP TRIGGER IF EXISTS immutable_facts_delete');
    for (const id of ids) db.prepare('DELETE FROM immutable_facts WHERE project=?').run(id);
    if (libraryRow) {
      const library = JSON.parse(libraryRow.value);
      if(library.storage===PROJECT_PARTITIONS_FORMAT){
        for(const id of ids)db.prepare('DELETE FROM project_documents WHERE project=?').run(id);
        library.projectIds=library.projectIds.filter(id=>!ids.includes(id));
        if(ids.includes(library.activeProjectId))library.activeProjectId=library.projectIds[0]??null;
      }else{
        for (const id of ids) delete library.projects[id];
        if (ids.includes(library.activeProjectId)) library.activeProjectId = Object.keys(library.projects)[0] ?? null;
      }
      db.prepare('UPDATE documents SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify(library), PROJECTS_KEY);
    }
    // Runtime copies contain prompts and model replies; remove their project-bound rows too.
    const runs = db.prepare('SELECT value FROM documents WHERE key=?').get('runtime.runs');
    if (runs) db.prepare('UPDATE documents SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify(JSON.parse(runs.value).filter(run => !ids.includes(run.projectId))), 'runtime.runs');
    const hasOutbox = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='outbox'").get();
    if (hasOutbox) for (const id of ids) db.prepare('DELETE FROM outbox WHERE project=?').run(id);
    db.exec("CREATE TRIGGER immutable_facts_delete BEFORE DELETE ON immutable_facts BEGIN SELECT RAISE(ABORT, 'immutable fact'); END; COMMIT;");
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  db.exec('VACUUM');
}
function scrubDirectory(directory, ids) {
  const file = path.join(directory, 'workspace.sqlite');
  if (existsSync(file)) { const db = new DatabaseSync(file); try { eraseDatabase(db, ids); } finally { db.close(); } }
  for (const id of ids) for (const category of ['attachments', 'projections']) rmSync(path.join(directory, category, id), { recursive: true, force: true });
  // Legacy migration copies cannot silently reintroduce erased text.
  for (const name of readdirSync(directory)) if (/^workspace\.(json|sqlite\.(pre-|importing-))/.test(name)) rmSync(path.join(directory, name), { force: true });
}
/** Called before opening the live database. A journal makes every rename restartable. */
export function recoverWorkspaceMaintenance(directory) {
  const control = controlFiles(directory), journal = readJSON(control.restore, null);
  if (journal) {
    const prefix = path.resolve(directory) + '.restore-';
    if (!path.resolve(journal.stage).startsWith(prefix) || journal.previous !== directory + '.before-restore') throw new Error('恢复日志路径无效');
    if (existsSync(journal.stage)) {
      if (existsSync(directory)) {
        if (existsSync(journal.previous)) throw new Error('恢复回滚目录已存在，未覆盖');
        renameSync(directory, journal.previous);
      }
      renameSync(journal.stage, directory);
    }
    if (!existsSync(path.join(directory, 'workspace.sqlite'))) throw new Error('恢复数据库缺失，原数据已保留');
    rmSync(control.restore);
  }
  const erased = readJSON(control.erasures, { schema: 1, projects: [] }).projects;
  if (!erased.length) return;
  const ids = erased.map(x => x.projectId);
  if (existsSync(directory)) scrubDirectory(directory, ids);
  const previous = directory + '.before-restore';
  if (existsSync(previous)) scrubDirectory(previous, ids);
  // Known backup copies are explicitly covered by the erasure confirmation.
  const retainedBackups = [];
  for (const backup of readJSON(control.backups, [])) {
    if (backup.projectIds && !backup.projectIds.some(id => ids.includes(id))) { retainedBackups.push(backup); continue; }
    if (!existsSync(backup.directory)) continue;
    const manifest = path.join(backup.directory, 'manifest.json');
    if (!existsSync(manifest) || hash(readFileSync(manifest)) !== backup.manifestHash) throw new Error('备份已变化，隐私清理需要重新核对：' + backup.directory);
    rmSync(backup.directory, { recursive: true });
  }
  atomic(control.backups, retainedBackups);
}
export function createStorageMaintenance(directory, db, getLibrary, collectFacts) {
  const control = controlFiles(directory), previews = new Map();
  const erasedIds = () => new Set(readJSON(control.erasures, { schema: 1, projects: [] }).projects.map(x => x.projectId));
  const validateErase = ({ token, confirmation } = {}) => {
    const plan = previews.get(token);
    if (!plan || confirmation !== plan.projectId || Date.parse(plan.expiresAt) < Date.now() || plan.fingerprint !== hash(getLibrary())) throw new Error('清除确认已过期或数据已变化，请重新预览');
    return structuredClone(plan);
  };
  return {
    validateErase,
    assertNotErased(library) { for (const id of Object.keys(library.projects ?? {})) if (erasedIds().has(id)) throw new Error('此项目已按用户要求永久清除，拒绝旧快照恢复'); },
    registerBackup(target) {
      const backups = readJSON(control.backups, []);
      backups.push({ directory: path.resolve(target), manifestHash: hash(readFileSync(path.join(target, 'manifest.json'))), projectIds: Object.keys(getLibrary().projects ?? {}) });
      atomic(control.backups, backups);
    },
    previewErase(projectId) {
      if (!safe(projectId)) throw new Error('项目标识无效');
      const library = getLibrary(); if (!library.projects?.[projectId]) throw new Error('项目不存在');
      // A derived project's prose may include private facts. Explicitly include dependent
      // projects rather than pretending deleting a source reference erases their prose.
      const affected = new Set([projectId]);
      let changed = true;
      while (changed) { changed = false; for (const [id, snapshot] of Object.entries(library.projects)) {
        if (affected.has(id)) continue;
        const content = JSON.stringify(snapshot);
        if ([...affected].some(source => content.includes(JSON.stringify(source)))) { affected.add(id); changed = true; }
      } }
      const affectedProjectIds = [...affected], token = randomUUID();
      const counts = { projects: affected.size, tasks: 0, artifacts: 0, sessions: 0, attachments: 0 };
      for (const id of affected) {
        const project = library.projects[id]; counts.tasks += Object.keys(project.tasks ?? {}).length; counts.artifacts += (project.collaboration?.artifacts ?? []).length; counts.sessions += Object.keys(project.sessions ?? {}).length;
        const files = path.join(directory, 'attachments', id); if (existsSync(files)) counts.attachments += readdirSync(files).length;
      }
      const plan = { token, projectId, projectName: library.projects[projectId].project?.name ?? projectId, affectedProjectIds, affectedProjects: affectedProjectIds.map(id => ({ id, name: library.projects[id].project?.name ?? id })), counts, backupCount: readJSON(control.backups, []).filter(x => existsSync(x.directory) && (!x.projectIds || x.projectIds.some(id => affected.has(id)))).length, expiresAt: new Date(Date.now() + 300000).toISOString(), fingerprint: hash(library) };
      previews.set(token, plan); return structuredClone(plan);
    },
    erase({ token, confirmation }) {
      const plan = validateErase({ token, confirmation });
      const ledger = readJSON(control.erasures, { schema: 1, projects: [] });
      for (const projectId of plan.affectedProjectIds) if (!ledger.projects.some(x => x.projectId === projectId)) ledger.projects.push({ projectId, erasedAt: new Date().toISOString(), receiptId: randomUUID() });
      // Tombstone first; a crash at every later step will replay this erasure on startup.
      atomic(control.erasures, ledger);
      eraseDatabase(db, plan.affectedProjectIds);
      for (const id of plan.affectedProjectIds) for (const category of ['attachments', 'projections']) rmSync(path.join(directory, category, id), { recursive: true, force: true });
      for (const name of readdirSync(directory)) if (/^workspace\.(json|sqlite\.(pre-|importing-))/.test(name)) rmSync(path.join(directory, name), { force: true });
      const retained = [];
      for (const backup of readJSON(control.backups, [])) {
        if (backup.projectIds && !backup.projectIds.some(id => plan.affectedProjectIds.includes(id))) { retained.push(backup); continue; }
        if (!existsSync(backup.directory)) continue;
        const manifest = path.join(backup.directory, 'manifest.json');
        if (!existsSync(manifest) || hash(readFileSync(manifest)) !== backup.manifestHash) throw new Error('备份已变化，未清理：' + backup.directory);
        rmSync(backup.directory, { recursive: true });
      }
      atomic(control.backups, retained); previews.delete(token);
      return { erasedProjectIds: plan.affectedProjectIds, restartRequired: true, externalCopies: '无法清除用户自行复制、云盘或 Agent 自身保存的副本。' };
    },
    prepareRestore(source) {
      source = path.resolve(source); assertRealTree(source);
      const manifest = readJSON(path.join(source, 'manifest.json'), null);
      if (manifest?.schema !== 1 || !Array.isArray(manifest.files) || !manifest.files.some(x => x.path === 'workspace.sqlite')) throw new Error('备份清单无效');
      const stage = directory + '.restore-' + randomUUID();
      try {
        mkdirSync(stage, { mode: 0o700 });
        for (const file of manifest.files) {
          if (typeof file.path !== 'string' || file.path.includes('\\') || file.path.split('/').some(x => !x || x === '.' || x === '..') || path.isAbsolute(file.path) || !(file.path === 'workspace.sqlite' || file.path.startsWith('attachments/'))) throw new Error('备份文件路径无效');
          const bytes = readFileSync(path.join(source, file.path));
          if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error('备份完整性检查失败：' + file.path);
          const target = path.join(stage, file.path); mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
        }
        const check = new DatabaseSync(path.join(stage, 'workspace.sqlite'));
        try {
          if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || check.prepare('PRAGMA user_version').get().user_version > 3) throw new Error('备份数据库不可用');
          const row = check.prepare('SELECT value FROM documents WHERE key=?').get(PROJECTS_KEY);
          if (row) {
            const library = readStoredProjectLibrary(check); if (library.schema !== 1 || !library.projects || !Array.isArray(library.agents)) throw new Error('备份项目数据无效');
            const expected = collectFacts?.(library);
            if (expected) {
              const rows = check.prepare('SELECT * FROM immutable_facts').all();
              if (rows.length !== expected.size || rows.some(f => expected.get(JSON.stringify([f.project, f.collection, f.id]))?.payload !== f.payload || hash(f.payload) !== f.sha256)) throw new Error('备份事实索引与项目记录不一致');
            }
          }
          if (check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='outbox'").get()) check.exec("UPDATE outbox SET state='unknown', owner=NULL, lease_until=0 WHERE state='delivering'");
          // Restored work never resumes automatically. Tool side effects must be reconciled.
          const runs = check.prepare("SELECT value FROM documents WHERE key='runtime.runs'").get();
          if (runs) check.prepare("UPDATE documents SET value=? WHERE key='runtime.runs'").run(JSON.stringify(JSON.parse(runs.value).map(run => ['done','completed','failed','cancelled','stopped'].includes(run.status) ? run : { ...run, status: 'paused', restoreReconciliationRequired: true })));
        } finally { check.close(); }
        const ids = [...erasedIds()]; if (ids.length) scrubDirectory(stage, ids);
        if (existsSync(directory + '.before-restore')) throw new Error('已有恢复回滚点，请先保留并移走后再恢复');
        atomic(control.restore, { stage, previous: directory + '.before-restore', preparedAt: new Date().toISOString() });
        return { restartRequired: true, rollbackPoint: directory + '.before-restore', files: manifest.files.length, replayedErasureCount: ids.length };
      } catch (error) { rmSync(stage, { recursive: true, force: true }); throw error; }
    },
  };
}

/** Internal projection delivery: reconcile interrupted file writes before retrying. */
export function createDurableOutbox(db, { clock = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0, owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, receipt TEXT, error TEXT);`);
  const read = id => { const row = db.prepare('SELECT * FROM outbox WHERE id=?').get(id); return row ? { ...row, payload: JSON.parse(row.payload), receipt: row.receipt ? JSON.parse(row.receipt) : null } : null; };
  return {
    read,
    list: () => db.prepare('SELECT * FROM outbox ORDER BY rowid').all().map(x => read(x.id)),
    pending: kind => db.prepare("SELECT id FROM outbox WHERE kind=? AND state != 'done' ORDER BY rowid").all(kind).map(x => read(x.id)),
    enqueue({ id, projectId, kind, payload }) {
      if (!safe(id) || !safe(projectId) || typeof kind !== 'string' || kind.length > 100) throw new Error('投递请求无效');
      const fingerprint = hash({ projectId, kind, payload }), prior = read(id);
      if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('幂等键已用于其他内容'); return prior; }
      db.prepare("INSERT INTO outbox(id,project,kind,payload,fingerprint,state) VALUES(?,?,?,?,?,'pending')").run(id, projectId, kind, JSON.stringify(payload), fingerprint); return read(id);
    },
    async deliver(id, adapter, { owner = randomUUID(), leaseMs = 30000, fault } = {}) {
      let item = read(id); if (!item) throw new Error('投递不存在'); if (item.state === 'done') return item;
      if (!adapter || typeof adapter.execute !== 'function' || typeof adapter.query !== 'function') throw new Error('执行器必须提供执行和结果查询');
      if (item.state === 'delivering' && item.lease_until > clock()) return item;
      // Expired delivery means an effect may already exist.
      if (item.state === 'delivering') { db.prepare("UPDATE outbox SET state='unknown' WHERE id=? AND epoch=?").run(id, item.epoch); item = read(id); }
      const claimed = db.prepare("UPDATE outbox SET state='delivering',epoch=epoch+1,owner=?,lease_until=?,attempts=attempts+1 WHERE id=? AND epoch=? AND state IN ('pending','unknown')").run(owner, clock() + leaseMs, id, item.epoch);
      if (!claimed.changes) return read(id);
      const epoch = item.epoch + 1, fence = () => { const current = read(id); if (!current || current.epoch !== epoch || current.owner !== owner || current.state !== 'delivering' || current.lease_until <= clock()) throw new Error('执行权已过期'); };
      try {
        fence(); await adapter.validate?.(item, { epoch, fence });
        let result;
        if (item.state === 'unknown') {
          const observed = await adapter.query(item, { epoch, fence }); fence();
          if (observed?.state === 'done') result = observed.receipt ?? null;
          else if (observed?.state !== 'not_found' || adapter.idempotent !== true) throw new Error('文件投递结果仍未知，需要核对');
        }
        if (result === undefined) { fence(); await fault?.('before_execute'); result = await adapter.execute(item, { epoch, fence, idempotencyKey: item.id }); await fault?.('after_execute'); fence(); }
        db.prepare("UPDATE outbox SET state='done',receipt=?,error=NULL,owner=NULL,lease_until=0 WHERE id=? AND epoch=? AND owner=?").run(JSON.stringify(result ?? null), id, epoch, owner);
      } catch (error) { db.prepare("UPDATE outbox SET state='unknown',error=?,owner=NULL,lease_until=0 WHERE id=? AND epoch=? AND owner=?").run(String(error.message).slice(0, 2000), id, epoch, owner); }
      return read(id);
    },
  };
}

export function projectionAdapter(directory, readSnapshot, exportSnapshot) {
  const paths = item => {
    if (!safe(item.project) || !/^[a-f0-9]{64}$/.test(item.payload.hash)) throw new Error('投影标识无效');
    const root = path.join(directory, 'projections', item.project), generation = path.join(root, item.payload.hash);
    return { root, generation };
  };
  return {
    idempotent: true,
    query(item, { fence }) {
      const { generation, root } = paths(item), file = path.join(generation, 'receipt.json');
      if (!existsSync(file)) return { state: 'not_found' };
      const receipt = readJSON(file);
      if (receipt.projectionSchema !== 'quandeck.project-memory.v1') return { state: 'not_found' };
      for (const name of receipt.files) if (!existsSync(path.join(generation, name)) || hash(readFileSync(path.join(generation, name))) !== receipt.hashes?.[name]) return { state: 'not_found' };
      if (hash(readSnapshot(item.project)) === item.payload.hash) { fence(); atomic(path.join(root, 'current.json'), receipt); }
      return { state: 'done', receipt };
    },
    execute(item, { fence }) {
      const snapshot = readSnapshot(item.project); if (!snapshot) throw new Error('项目已不存在');
      // The queue may contain an earlier change; publish only the exact queued version.
      if (hash(snapshot) !== item.payload.hash) return { superseded: true };
      const { root, generation } = paths(item); assertRealTree(root);
      const exported = exportSnapshot(snapshot); fence();
      mkdirSync(generation, { recursive: true, mode: 0o700 });
      const files = { 'project-memory.md': exported.memory ?? exported.ledger, 'ledger.md': exported.ledger, 'blackboard.md': exported.blackboard, 'project-memory.json': exported.json };
      for (const [name, body] of Object.entries(files)) atomic(path.join(generation, name), body);
      const receipt = { projectionSchema: 'quandeck.project-memory.v1', sourceHash: item.payload.hash, projectId: item.project, generation, generatedAt: new Date().toISOString(), files: Object.keys(files), hashes: Object.fromEntries(Object.entries(files).map(([name, body]) => [name, hash(body)])) };
      // Old generated audit exports are rebuildable diagnostics, never the default memory entry.
      rmSync(path.join(generation, 'export.json'), { force: true });
      atomic(path.join(generation, 'receipt.json'), receipt); fence(); atomic(path.join(root, 'current.json'), receipt);
      // These are rebuildable machine views, not immutable business artifacts. Keep
      // bounded recent views so streaming updates cannot grow disk use forever.
      const recent = readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name) && name !== item.payload.hash && existsSync(path.join(root, name, 'receipt.json'))).sort((a,b) => lstatSync(path.join(root,b,'receipt.json')).mtimeMs - lstatSync(path.join(root,a,'receipt.json')).mtimeMs);
      for (const name of recent.slice(19)) rmSync(path.join(root, name), { recursive: true, force: true });
      return receipt;
    },
  };
}
export { hash as storageDigest };
