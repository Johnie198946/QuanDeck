import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, copyFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PROJECTS = 'quandeck.projects.v1';
const FACTS = ['specs', 'decisions', 'artifacts', 'submissions', 'reviews', 'checkpoints', 'events', 'contextPackages'];
const INTELLIGENCE_FACTS = ['intakes', 'classifications', 'summaryVersions', 'suggestionEvents'];
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function legacyData(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) throw new Error('invalid');
    return value;
  } catch { throw new Error(`本地数据无法读取，原文件已保留：${file}`); }
}
function factsOf(value) {
  const library = JSON.parse(value);
  if (library.schema !== 1 || !library.projects || Array.isArray(library.projects) || !Array.isArray(library.agents)) throw new Error('项目数据格式无效');
  const facts = new Map();
  const sourceBindings = new Map();
  for (const [project, snapshot] of Object.entries(library.projects)) {
    const append = (collection, records) => {
      if (!Array.isArray(records)) throw new Error(`历史记录格式无效：${collection}`);
      for (const record of records) {
        if (!record || typeof record.id !== 'string') throw new Error('历史记录缺少标识');
        const key = JSON.stringify([project, collection, record.id]);
        if (facts.has(key)) throw new Error('历史记录标识重复');
        facts.set(key, { project, collection, id: record.id, payload: canonical(record) });
      }
    };
    if (snapshot.integration) {
      for (const name of ['revisions', 'versions', 'events']) append(`integration.${name}`, snapshot.integration[name]);
      append('integration.reviews', snapshot.integration.reviews ?? []);
      for (const [id, record] of Object.entries(snapshot.integration.receipts ?? {})) facts.set(JSON.stringify([project,'integration.receipts',id]), {project,collection:'integration.receipts',id,payload:canonical(record)});
    }
    for (const collection of INTELLIGENCE_FACTS) {
      if (!snapshot.intelligence) break;
      const records = snapshot.intelligence[collection];
      if (!Array.isArray(records)) throw new Error(`智能分拣记录格式无效：${collection}`);
      for (const record of records) {
        if (!record || typeof record.id !== 'string') throw new Error('智能分拣记录缺少标识');
        const indexedCollection = 'intelligence.' + collection;
        const factKey = JSON.stringify([project, indexedCollection, record.id]);
        if (facts.has(factKey)) throw new Error('智能分拣记录标识重复');
        facts.set(factKey, { project, collection: indexedCollection, id: record.id, payload: canonical(record) });
      }
    }
    const c = snapshot.collaboration;
    if (!c) continue;
    append('executionLinks', c.executionLinks ?? []);
    for (const link of c.executionLinks ?? []) {
      if (link.projectId !== project || !link.tool || !link.connectionId || !link.sourceSessionId || !link.runId) throw new Error('执行来源绑定不完整');
      const sourceKey = JSON.stringify([link.tool,link.connectionId,link.sourceSessionId]);
      const owner = JSON.stringify([project,link.runId]);
      if (sourceBindings.has(sourceKey) && sourceBindings.get(sourceKey) !== owner) throw new Error('同一源会话不能绑定多个项目运行');
      sourceBindings.set(sourceKey, owner);
    }
    for (const collection of FACTS) {
      if (!Array.isArray(c[collection])) throw new Error(`协作记录格式无效：${collection}`);
      for (const record of c[collection]) {
        if (!record || typeof record.id !== 'string') throw new Error('协作记录缺少标识');
        const key = JSON.stringify([project, collection, record.id]);
        if (facts.has(key)) throw new Error('协作记录标识重复');
        facts.set(key, { project, collection, id: record.id, payload: canonical(record) });
      }
    }
    for (const [id, record] of Object.entries(c.receipts ?? {})) facts.set(JSON.stringify([project, 'receipts', id]), { project, collection: 'receipts', id, payload: canonical(record) });
  }
  return facts;
}

/** The application snapshot is canonical; facts are its transactional integrity index. */
export function createLocalStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'workspace.sqlite'), legacy = path.join(directory, 'workspace.json');
  const isNew = !existsSync(file);
  // A failed validation must not create a database that masks the original data.
  const imported = isNew && existsSync(legacy) ? legacyData(legacy) : null;
  if (imported?.[PROJECTS]) factsOf(imported[PROJECTS]);
  // Publish a migrated database only after its complete import commits. A crash
  // before rename leaves the original JSON authoritative on the next startup.
  const openingFile = imported ? `${file}.importing-${randomUUID()}` : file;
  let db;
  try {
    db = new DatabaseSync(openingFile);
    const previousSchema = db.prepare('PRAGMA user_version').get().user_version;
    if (previousSchema > 2) throw new Error('数据库来自更新版本，请使用对应版本打开');
    if (previousSchema === 1) {
      // Keep a consistent pre-upgrade database: older builds intentionally refuse schema 2.
      // VACUUM INTO includes committed pages even if a previous build used a WAL journal.
      const backup = `${file}.pre-v2-${randomUUID()}`;
      db.prepare('VACUUM INTO ?').run(backup);
    }
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS immutable_facts (project TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(project, collection, id));
      CREATE TRIGGER IF NOT EXISTS immutable_facts_update BEFORE UPDATE ON immutable_facts BEGIN SELECT RAISE(ABORT, 'immutable fact'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_facts_delete BEFORE DELETE ON immutable_facts BEGIN SELECT RAISE(ABORT, 'immutable fact'); END;
      PRAGMA user_version=2;`);
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed');
  } catch (error) { db?.close(); throw new Error(`本地数据库无法读取，原文件已保留：${file}`, { cause: error }); }
  let get = db.prepare('SELECT value FROM documents WHERE key=?');
  const upsertSql = 'INSERT INTO documents(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=documents.revision+1';
  let upsert = db.prepare(upsertSql);
  function indexFacts(value) {
    const next = factsOf(value);
    for (const row of db.prepare('SELECT project,collection,id,payload FROM immutable_facts').all()) {
      const candidate = next.get(JSON.stringify([row.project, row.collection, row.id]));
      if (!candidate || candidate.payload !== row.payload) throw new Error(`历史协作记录不可修改或移除：${row.collection}/${row.id}。请追加新版本。`);
    }
    const insert = db.prepare('INSERT OR IGNORE INTO immutable_facts(project,collection,id,payload,sha256) VALUES(?,?,?,?,?)');
    for (const row of next.values()) insert.run(row.project, row.collection, row.id, row.payload, digest(row.payload));
  }
  function commit(entries) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, value] of entries) { if (key === PROJECTS) indexFacts(value); upsert.run(key, value); }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (imported) {
    try {
      const backup = `${legacy}.pre-sqlite`;
      if (!existsSync(backup)) copyFileSync(legacy, backup);
      commit(Object.entries(imported));
      db.close(); renameSync(openingFile, file); db = new DatabaseSync(file);
      db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      get = db.prepare('SELECT value FROM documents WHERE key=?'); upsert = db.prepare(upsertSql);
    } catch (error) { try { db.close(); } catch {} rmSync(openingFile, { force: true }); throw error; }
  }
  const storage = {
    getItem: key => get.get(key)?.value ?? null,
    setItem: (key, value) => commit([[key, String(value)]]),
    removeItem: key => {
      if (key === PROJECTS && db.prepare('SELECT 1 FROM immutable_facts LIMIT 1').get()) throw new Error('存在不可变协作历史，请使用受控数据清除流程');
      db.prepare('DELETE FROM documents WHERE key=?').run(key);
    },
  };
  const safe = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
  const attachmentPath = (projectId, id) => {
    if (!safe(projectId) || !safe(id)) throw new Error('附件标识无效');
    return path.join(directory, 'attachments', projectId, id);
  };
  return {
    storage, directory, file,
    close() { db.close(); },
    read(key, fallback) { const value = storage.getItem(key); return value === null ? fallback : JSON.parse(value); },
    write(key, value) { storage.setItem(key, JSON.stringify(value)); },
    migrate(values) {
      const entries = [];
      for (const key of [PROJECTS, 'quandeck.configured-agents.v1', 'quandeck.preferences.v1']) {
        if (storage.getItem(key) !== null || !values?.[key]) continue;
        JSON.parse(values[key]); if (key === PROJECTS) factsOf(values[key]); entries.push([key, values[key]]);
      }
      if (entries.length) commit(entries);
    },
    // Main-process writes cannot interleave with this synchronous snapshot and attachment copy.
    backup(target) {
      const attachmentRoot = path.resolve(directory, 'attachments');
      if (path.resolve(target) === attachmentRoot || path.resolve(target).startsWith(attachmentRoot + path.sep)) throw new Error('备份不能保存在附件目录内');
      if (existsSync(target)) throw new Error('备份目标已存在，未覆盖');
      mkdirSync(target, { recursive: true, mode: 0o700 });
      const files = [];
      try {
        db.prepare('VACUUM INTO ?').run(path.join(target, 'workspace.sqlite'));
        const copy = (from, relative) => {
          const info = lstatSync(from);
          if (info.isSymbolicLink()) throw new Error('备份拒绝符号链接');
          if (info.isDirectory()) { mkdirSync(path.join(target, relative), { recursive: true, mode: 0o700 }); for (const name of readdirSync(from)) copy(path.join(from, name), path.join(relative, name)); }
          else if (info.isFile()) copyFileSync(from, path.join(target, relative));
        };
        if (existsSync(path.join(directory, 'attachments'))) copy(path.join(directory, 'attachments'), 'attachments');
        const scan = relative => { for (const name of readdirSync(path.join(target, relative))) { const next = path.join(relative, name), full = path.join(target, next); if (lstatSync(full).isDirectory()) scan(next); else { const bytes = readFileSync(full); files.push({ path: next.split(path.sep).join('/'), size: bytes.length, sha256: digest(bytes) }); } } };
        scan('');
        writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ schema: 1, createdAt: new Date().toISOString(), storage: 'sqlite-document-v1', files }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return { directory: target, files: files.length };
      } catch (error) { rmSync(target, { recursive: true, force: true }); throw error; }
    },
    async saveAttachment(projectId, input) {
      const bytes = Buffer.from(input.bytes);
      if (bytes.length > 25 * 1024 * 1024) throw new Error('每个文件最多 25 MB');
      const id = randomUUID(), target = attachmentPath(projectId, id), temp = target + '.tmp';
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, target);
      return { id, name: String(input.name).slice(0, 255), type: String(input.type || 'application/octet-stream'), size: bytes.length, sha256: digest(bytes) };
    },
    async attachment(projectId, id) { return readFile(attachmentPath(projectId, id)); },
    async removeAttachment(projectId, id) {
      const target = attachmentPath(projectId, id);
      for (const row of db.prepare("SELECT payload FROM immutable_facts WHERE project=? AND collection='artifacts'").all(projectId)) {
        if (JSON.parse(row.payload).attachments?.some(file => file.id === id)) throw new Error('此附件已进入成果历史，请保留原版本并提交新版');
      }
      await rm(target, { force: true });
    },
  };
}
