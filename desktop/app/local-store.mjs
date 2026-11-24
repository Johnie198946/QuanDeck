import { readStoredProjectLibrary, readStoredProject, PROJECT_PARTITIONS_FORMAT } from './project-partitions.mjs';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, copyFileSync, readdirSync, lstatSync, rmSync, linkSync, unlinkSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createStorageMaintenance, createDurableOutbox, recoverWorkspaceMaintenance, storageDigest } from './storage-maintenance.mjs';

const PROJECTS = 'quandeck.projects.v1';
const MIGRATIONS = 'quandeck.storage-migrations.v1';
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
function factsOf(value, { projects, memo } = {}) {
  const library = typeof value === 'string' ? JSON.parse(value) : value;
  if (library.schema !== 1 || !library.projects || Array.isArray(library.projects) || !Array.isArray(library.agents)) throw new Error('项目数据格式无效');
  const facts = new Map();
  const sourceBindings = new Map();
  for (const [project, snapshot] of Object.entries(library.projects)) {
    // Source ownership is global even when only one project needs re-indexing.
    for (const link of snapshot.collaboration?.executionLinks ?? []) {
      if (link.projectId !== project || !link.tool || !link.connectionId || !link.sourceSessionId || !link.runId) throw new Error('执行来源绑定不完整');
      const sourceKey = JSON.stringify([link.tool,link.connectionId,link.sourceSessionId]);
      const owner = JSON.stringify([project,link.runId]);
      if (sourceBindings.has(sourceKey) && sourceBindings.get(sourceKey) !== owner) throw new Error('同一源会话不能绑定多个项目运行');
      sourceBindings.set(sourceKey, owner);
    }
    if (projects && !projects.has(project)) continue;
    const add = (collection, id, record) => {
      const key = JSON.stringify([project, collection, id]);
      if (facts.has(key)) throw new Error('历史记录标识重复');
      const raw = JSON.stringify(record), prior = memo?.get(key);
      facts.set(key, { project, collection, id, raw, payload: prior?.raw === raw ? prior.payload : canonical(record) });
    };
    const append = (collection, records) => {
      if (!Array.isArray(records)) throw new Error(`历史记录格式无效：${collection}`);
      for (const record of records) {
        if (!record || typeof record.id !== 'string') throw new Error('历史记录缺少标识');
        add(collection, record.id, record);
      }
    };
    append('usageAccounting.receipts', snapshot.usageAccounting?.receipts ?? []);
    append('contextEvidenceReads', snapshot.contextEvidenceReads ?? []);
    if (snapshot.integration) {
      for (const name of ['revisions', 'versions', 'events']) append(`integration.${name}`, snapshot.integration[name]);
      append('integration.reviews', snapshot.integration.reviews ?? []);
      for (const [id, record] of Object.entries(snapshot.integration.attachmentImports ?? {})) add('integration.attachmentImports',id,record);
      for (const [id, record] of Object.entries(snapshot.integration.deliveryPublicationReceipts ?? {})) add('integration.deliveryPublicationReceipts',id,record);
      for (const [id, record] of Object.entries(snapshot.integration.receipts ?? {})) add('integration.receipts',id,record);
    }
    for (const collection of INTELLIGENCE_FACTS) {
      if (!snapshot.intelligence) break;
      const records = snapshot.intelligence[collection];
      if (!Array.isArray(records)) throw new Error(`智能分拣记录格式无效：${collection}`);
      for (const record of records) {
        if (!record || typeof record.id !== 'string') throw new Error('智能分拣记录缺少标识');
        const indexedCollection = 'intelligence.' + collection;
        add(indexedCollection, record.id, record);
      }
    }
    const c = snapshot.collaboration;
    if (!c) continue;
    for (const [planId, versions] of Object.entries(c.goalPlans ?? {})) {
      if (!Array.isArray(versions) || versions.some(record => record.id !== planId || !Number.isInteger(record.version) || record.version < 1)) throw new Error('目标交付版本格式无效');
      append('goalPlans', versions.map(record => ({ ...record, planId, id: `${planId}:${record.version}` })));
    }
    append('governance.reads', c.governance?.reads ?? []);
    append('executionLinks', c.executionLinks ?? []);
    append('handoffs', c.handoffs ?? []);
    append('handoffTransfers', c.handoffTransfers ?? []);
    for (const field of ['memoryNotes', 'memoryObservations', 'memoryFeedback']) append(field, c[field] ?? []);
    for (const collection of FACTS) {
      if (!Array.isArray(c[collection])) throw new Error(`协作记录格式无效：${collection}`);
      for (const record of c[collection]) {
        if (!record || typeof record.id !== 'string') throw new Error('协作记录缺少标识');
        add(collection, record.id, record);
      }
    }
    for (const [id, record] of Object.entries(c.receipts ?? {})) add('receipts',id,record);
  }
  return facts;
}

function migrationCounts(raw) {
  const library = raw ? JSON.parse(raw) : { projects: {}, agents: [] };
  const counts = { projects: 0, tasks: 0, sessions: 0, artifacts: 0, immutableFacts: raw ? factsOf(raw).size : 0, unknownSessionMappings: 0, unknownProjectOwnership: 0, legacyCompletionsWithoutAcceptance: 0 };
  for (const [id, project] of Object.entries(library.projects)) {
    counts.projects++; counts.tasks += Object.keys(project.tasks ?? {}).length; counts.sessions += Object.keys(project.sessions ?? {}).length; counts.artifacts += (project.collaboration?.artifacts ?? []).length;
    if (project.project?.id !== id || !project.collaboration?.governance?.ownerId) counts.unknownProjectOwnership++;
    for (const session of Object.values(project.sessions ?? {})) if (!session.taskId || !session.source?.sessionId || !session.source?.tool || !session.source?.connectionId) counts.unknownSessionMappings++;
    for (const task of Object.values(project.tasks ?? {})) if (task.status === 'done' && !project.collaboration?.tasks?.[task.id]?.acceptedArtifactId) counts.legacyCompletionsWithoutAcceptance++;
  }
  return counts;
}

/** The application snapshot is canonical; facts are its transactional integrity index. */
export function createLocalStore(directory) {
  recoverWorkspaceMaintenance(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'workspace.sqlite'), legacy = path.join(directory, 'workspace.json');
  const isNew = !existsSync(file);
  // A failed validation must not create a database that masks the original data.
  const imported = isNew && existsSync(legacy) ? legacyData(legacy) : null;
  if (imported?.[PROJECTS]) factsOf(imported[PROJECTS]);
  // Publish a migrated database only after its complete import commits. A crash
  // before rename leaves the original JSON authoritative on the next startup.
  const openingFile = imported ? `${file}.importing-${randomUUID()}` : file;
  let db, previousSchema = 0, upgradeBackup = null;
  try {
    db = new DatabaseSync(openingFile);
    previousSchema = db.prepare('PRAGMA user_version').get().user_version;
    if (previousSchema > 3) throw new Error('数据库来自更新版本，请使用对应版本打开');
    if (previousSchema === 1 || previousSchema === 2) {
      // Keep a consistent rollback database: older builds reject the partitioned schema.
      // VACUUM INTO includes committed pages even if a previous build used a WAL journal.
      const backup = `${file}.pre-v3-${randomUUID()}`;
      db.prepare('VACUUM INTO ?').run(backup); upgradeBackup = backup;
    }
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS immutable_facts (project TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(project, collection, id));
      CREATE INDEX IF NOT EXISTS immutable_facts_by_collection ON immutable_facts(collection,project);
      CREATE TRIGGER IF NOT EXISTS immutable_facts_update BEFORE UPDATE ON immutable_facts BEGIN SELECT RAISE(ABORT, 'immutable fact'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_facts_delete BEFORE DELETE ON immutable_facts BEGIN SELECT RAISE(ABORT, 'immutable fact'); END;
      CREATE TABLE IF NOT EXISTS project_documents (project TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);`);
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed');
  } catch (error) { db?.close(); throw new Error(`本地数据库无法读取，原文件已保留：${file}`, { cause: error }); }
  let get = db.prepare('SELECT value FROM documents WHERE key=?');
  const upsertSql = 'INSERT INTO documents(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=documents.revision+1';
  let upsert = db.prepare(upsertSql);
  const library = () => readStoredProjectLibrary(db) ?? {schema:1,activeProjectId:null,projects:{},agents:[],defaultAgent:''};
  let maintenance = createStorageMaintenance(directory, db, library, factsOf), outbox = createDurableOutbox(db);
  // Per-project memoization never requires another project's snapshot or history.
  const indexedProjects = new Map();
  function indexFacts(value, projects, memo) {
    const next = factsOf(value, { projects, memo });
    const rows = [...projects].flatMap(id => db.prepare('SELECT project,collection,id,payload FROM immutable_facts WHERE project=?').all(id));
    const existing = new Set();
    for (const row of rows) {
      const key = JSON.stringify([row.project, row.collection, row.id]); existing.add(key);
      if (next.get(key)?.payload !== row.payload) throw new Error(`历史协作记录不可修改或移除：${row.collection}/${row.id}。请追加新版本。`);
    }
    const bindings = new Map();
    for (const row of db.prepare("SELECT project,payload FROM immutable_facts WHERE collection='executionLinks'").all()) {
      const link=JSON.parse(row.payload); bindings.set(JSON.stringify([link.tool,link.connectionId,link.sourceSessionId]),JSON.stringify([row.project,link.runId]));
    }
    for (const row of next.values()) if(row.collection==='executionLinks') {
      const link=JSON.parse(row.payload),key=JSON.stringify([link.tool,link.connectionId,link.sourceSessionId]),owner=JSON.stringify([row.project,link.runId]);
      if(bindings.has(key)&&bindings.get(key)!==owner)throw Error('同一源会话不能绑定多个项目运行');bindings.set(key,owner);
    }
    const insert = db.prepare('INSERT INTO immutable_facts(project,collection,id,payload,sha256) VALUES(?,?,?,?,?)');
    for (const [key,row] of next) if (!existing.has(key)) insert.run(row.project,row.collection,row.id,row.payload,digest(row.payload));
    return next;
  }
  function writeProjectChanges({metadata,projectIds,updates,removed=[],expectedRevision}, pendingMemo) {
    if(metadata?.schema!==1||metadata.projects!==undefined||!Array.isArray(metadata.agents)||!Array.isArray(projectIds)||projectIds.some(id=>typeof id!=='string'||!id)||new Set(projectIds).size!==projectIds.length||!updates||typeof updates!=='object'||Array.isArray(updates)||!Array.isArray(removed)||removed.some(id=>typeof id!=='string'||!id))throw Error('项目分区写入格式无效');
    const current=db.prepare('SELECT value,revision FROM documents WHERE key=?').get(PROJECTS);
    if(expectedRevision!==undefined&&expectedRevision!==(current?.revision??0))throw Error('项目目录已被其他连接更新，请重新读取后重试');
    maintenance.assertNotErased({projects:Object.fromEntries(projectIds.map(id=>[id,{}]))});
    const dataVersion=db.prepare('PRAGMA data_version').get().data_version;
    let changed=false;
    for(const [id,raw]of Object.entries(updates)) {
      if(!projectIds.includes(id)||typeof raw!=='string')throw Error('项目分区标识无效');
      const prior=db.prepare('SELECT value,revision FROM project_documents WHERE project=?').get(id);
      if(prior?.value===raw)continue;
      const snapshot=JSON.parse(raw),cached=indexedProjects.get(id);
      const memo=cached?.revision===prior?.revision&&cached?.dataVersion===dataVersion?cached.facts:undefined;
      const facts=indexFacts({schema:1,agents:[],projects:{[id]:snapshot}},new Set([id]),memo);
      db.prepare('INSERT INTO project_documents(project,value) VALUES(?,?) ON CONFLICT(project) DO UPDATE SET value=excluded.value,revision=project_documents.revision+1').run(id,raw);
      const hash=storageDigest(snapshot);outbox.enqueue({id:'projection-'+storageDigest({projectId:id,hash}),projectId:id,kind:'project.projection',payload:{hash}});
      pendingMemo.set(id,{revision:(prior?.revision??0)+1,dataVersion,facts});changed=true;
    }
    for(const id of removed) {
      if(projectIds.includes(id))throw Error('项目删除列表与目录冲突');
      if(db.prepare('SELECT 1 FROM immutable_facts WHERE project=? LIMIT 1').get(id))throw Error('历史协作记录不可修改或移除，请使用受控清除流程');
      changed=!!db.prepare('DELETE FROM project_documents WHERE project=?').run(id).changes||changed;pendingMemo.set(id,undefined);
    }
    const physicalIds=db.prepare('SELECT project FROM project_documents').all().map(row=>row.project);
    if(physicalIds.length!==projectIds.length||physicalIds.some(id=>!projectIds.includes(id)))throw Error('项目分区与目录不一致，未覆盖原数据');
    const catalog=JSON.stringify({...metadata,storage:PROJECT_PARTITIONS_FORMAT,projectIds});
    if(changed||catalog!==current?.value)upsert.run(PROJECTS,catalog);
    return (current?.revision??0)+(changed||catalog!==current?.value?1:0);
  }
  function commit(entries, migration) {
    db.exec('BEGIN IMMEDIATE');const pendingMemo=new Map();
    try {
      for(const [key,value]of entries) {
        if(key!==PROJECTS){upsert.run(key,value);continue;}
        const full=JSON.parse(value);factsOf(full,{projects:new Set()});
        const {projects,...metadata}=full,projectIds=Object.keys(projects);
        const existing=db.prepare('SELECT project FROM project_documents').all().map(row=>row.project);
        writeProjectChanges({metadata,projectIds,updates:Object.fromEntries(Object.entries(projects).map(([id,snapshot])=>[id,JSON.stringify(snapshot)])),removed:existing.filter(id=>!projectIds.includes(id))},pendingMemo);
      }
      if(migration) {
        const persisted=library(), before=migrationCounts(migration.before),after=migrationCounts(JSON.stringify(persisted));
        after.immutableFacts=db.prepare('SELECT count(*) AS count FROM immutable_facts').get().count;
        if(canonical(before)!==canonical(after))throw Error('迁移前后项目数量或历史映射计数不一致，未采用迁移');
        const reports=JSON.parse(get.get(MIGRATIONS)?.value??'[]');reports.push({id:randomUUID(),completedAt:new Date().toISOString(),source:migration.source,fromSchema:migration.fromSchema,toSchema:3,before,after,countsVerified:true,backup:migration.backup??null,historicalUnknownsPreserved:true});upsert.run(MIGRATIONS,JSON.stringify(reports));
      }
      db.exec('COMMIT');for(const [id,memo]of pendingMemo)memo?indexedProjects.set(id,memo):indexedProjects.delete(id);
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  // A single transaction changes the directory, copies every snapshot and bumps
  // the schema. A pre-upgrade SQLite backup remains the rollback point.
  if(previousSchema<3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const before=readStoredProjectLibrary(db);
      if(before) {
        const expected=factsOf(before), rows=db.prepare('SELECT project,collection,id,payload,sha256 FROM immutable_facts').all();
        if(rows.length!==expected.size||rows.some(row=>expected.get(JSON.stringify([row.project,row.collection,row.id]))?.payload!==row.payload||digest(row.payload)!==row.sha256))throw Error('迁移事实索引与项目记录不一致，原数据已保留');
        const {projects,...metadata}=before;
        for(const [id,snapshot]of Object.entries(projects))db.prepare('INSERT OR REPLACE INTO project_documents(project,value) VALUES(?,?)').run(id,JSON.stringify(snapshot));
        upsert.run(PROJECTS,JSON.stringify({...metadata,storage:PROJECT_PARTITIONS_FORMAT,projectIds:Object.keys(projects)}));
        if(canonical(before)!==canonical(readStoredProjectLibrary(db)))throw Error('项目分区迁移核对失败');
        const counts=migrationCounts(JSON.stringify(before)),reports=JSON.parse(get.get(MIGRATIONS)?.value??'[]');
        reports.push({id:randomUUID(),completedAt:new Date().toISOString(),source:'project-partition-upgrade',fromSchema:previousSchema,toSchema:3,before:counts,after:counts,countsVerified:true,backup:upgradeBackup,historicalUnknownsPreserved:true});upsert.run(MIGRATIONS,JSON.stringify(reports));
      }
      db.exec('PRAGMA user_version=3; COMMIT');
    }catch(error){db.exec('ROLLBACK');db.close();throw error;}
  }
  if (imported) {
    try {
      const backup = `${legacy}.pre-sqlite`;
      if (!existsSync(backup)) copyFileSync(legacy, backup);
      commit(Object.entries(imported), { source: 'legacy-json', fromSchema: null, before: imported[PROJECTS], backup });
      db.close(); renameSync(openingFile, file); db = new DatabaseSync(file);
      db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      get = db.prepare('SELECT value FROM documents WHERE key=?'); upsert = db.prepare(upsertSql);
      maintenance = createStorageMaintenance(directory, db, library, factsOf); outbox = createDurableOutbox(db);
    } catch (error) { try { db.close(); } catch {} rmSync(openingFile, { force: true }); throw error; }
  }
  const storage = {
    getItem: key => {if(key!==PROJECTS)return get.get(key)?.value??null;const value=readStoredProjectLibrary(db);return value===undefined?null:JSON.stringify(value);},
    readProjectLibrary: () => { db.exec('BEGIN');try { const result={library:library(),revision:db.prepare('SELECT revision FROM documents WHERE key=?').get(PROJECTS)?.revision??0};db.exec('COMMIT');return result; }catch(error){db.exec('ROLLBACK');throw error;} },
    writeProjectLibraryChanges: input => {db.exec('BEGIN IMMEDIATE');const pending=new Map();try{const revision=writeProjectChanges(input,pending);db.exec('COMMIT');for(const [id,memo]of pending)memo?indexedProjects.set(id,memo):indexedProjects.delete(id);return revision;}catch(error){db.exec('ROLLBACK');throw error;}},
    setItem: (key, value) => { if (key === MIGRATIONS) throw new Error('迁移报告仅由系统追加'); if(key==='runtime.runs'){ const erased=maintenance.erasedIds();value=JSON.stringify(JSON.parse(value).filter(run=>!erased.has(run.projectId))); } commit([[key, String(value)]]); },
    removeItem: key => {
      if (key === MIGRATIONS) throw new Error('迁移报告仅由系统追加');
      if (key === PROJECTS && db.prepare('SELECT 1 FROM immutable_facts LIMIT 1').get()) throw new Error('存在不可变协作历史，请使用受控数据清除流程');
      if(key===PROJECTS){db.exec('BEGIN IMMEDIATE');try{db.exec('DELETE FROM project_documents');db.prepare('DELETE FROM documents WHERE key=?').run(key);db.exec('COMMIT');indexedProjects.clear();}catch(error){db.exec('ROLLBACK');throw error;}}else db.prepare('DELETE FROM documents WHERE key=?').run(key);
    },
  };
  const safe = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
  const attachmentPath = (projectId, id) => {
    if (!safe(projectId) || !safe(id)) throw new Error('附件标识无效');
    return path.join(directory, 'attachments', projectId, id);
  };
  return {
    storage, directory, file,
    get outbox() { return outbox; },
    get migrationReports() { return JSON.parse(get.get(MIGRATIONS)?.value ?? '[]'); },
    previewEraseProject: (projectId,options) => maintenance.previewErase(projectId,options),
    erasedProjectIds: () => [...maintenance.erasedIds()],
    isProjectErased: id => maintenance.erasedIds().has(id),
    validateEraseProject: request => maintenance.validateErase(request),
    eraseProject: request => { indexedProjects.clear(); return maintenance.erase(request); },
    readProject: projectId => readStoredProject(db,projectId),
    prepareRestore: source => maintenance.prepareRestore(source),
    close() { db.close(); },
    read(key, fallback) { const value = storage.getItem(key); return value === null ? fallback : JSON.parse(value); },
    write(key, value) { storage.setItem(key, JSON.stringify(value)); },
    migrate(values) {
      const entries = [];
      for (const key of [PROJECTS, 'quandeck.configured-agents.v1', 'quandeck.preferences.v1']) {
        if (storage.getItem(key) !== null || !values?.[key]) continue;
        JSON.parse(values[key]); if (key === PROJECTS) factsOf(values[key]); entries.push([key, values[key]]);
      }
      if (entries.length) commit(entries, { source: 'renderer-localStorage', fromSchema: null, before: entries.find(([key]) => key === PROJECTS)?.[1] ?? storage.getItem(PROJECTS) });
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
        maintenance.registerBackup(target);
        return { directory: target, files: files.length };
      } catch (error) { rmSync(target, { recursive: true, force: true }); throw error; }
    },
    async saveAttachment(projectId, input) {
      if(maintenance.erasedIds().has(projectId))throw Error("此项目已永久清除，拒绝迟到附件");
      const bytes = Buffer.from(input.bytes);
      if (bytes.length > 25 * 1024 * 1024) throw new Error('每个文件最多 25 MB');
      const id = input.contentAddressed === true ? 'delivery-' + digest(Buffer.concat([Buffer.from(String(input.name)+'\0'+String(input.type)+'\0'),bytes])) : randomUUID(), target = attachmentPath(projectId, id), temp = target + '.' + randomUUID() + '.tmp';
      for (const parent of [path.join(directory, 'attachments'), path.dirname(target)]) {
        try { mkdirSync(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const info = lstatSync(parent);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('附件目录不能是符号链接或文件');
      }
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      try {
        if(input.contentAddressed === true){
          try {linkSync(temp,target);}catch(error){if(error.code!=='EEXIST')throw error;const info=lstatSync(target);if(info.isSymbolicLink()||!info.isFile()||digest(readFileSync(target))!==digest(bytes))throw Error('固定附件已存在且内容不同，未覆盖');}
        } else renameSync(temp,target);
      } finally {if(existsSync(temp))unlinkSync(temp);}
      return { id, name: String(input.name).slice(0, 255), type: String(input.type || 'application/octet-stream'), size: bytes.length, sha256: digest(bytes) };
    },
    async attachment(projectId, id) {
      const target = attachmentPath(projectId, id);
      for (const candidate of [path.join(directory, 'attachments'), path.dirname(target), target]) {
        const info = lstatSync(candidate);
        if (info.isSymbolicLink()) throw new Error('附件路径不能是符号链接');
      }
      if (!lstatSync(target).isFile()) throw new Error('附件不是文件');
      return readFile(target);
    },
    async removeAttachment(projectId, id) {
      const target = attachmentPath(projectId, id);
      for (const parent of [path.join(directory, 'attachments'), path.dirname(target)]) {
        if (!existsSync(parent)) return;
        const info = lstatSync(parent);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('附件目录不能是符号链接或文件');
      }
      const project = readStoredProject(db,projectId);
      const targets = [...Object.values(project?.tasks ?? {}), ...Object.values(project?.deletedTasks ?? {}).map(value => value.task), ...Object.values(project?.deletedWorkItems ?? {}).map(value => value.item), ...Object.values(project?.orchestrations ?? {}).flatMap(value => Object.values(value.items ?? {}))];
      if (targets.some(value => value.attachments?.some(file => file.id === id))) throw new Error('此附件仍关联任务，请先移除引用');
      for (const row of db.prepare("SELECT payload FROM immutable_facts WHERE project=? AND collection IN ('artifacts','reviews')").all(projectId)) {
        if (JSON.parse(row.payload).attachments?.some(file => file.id === id)) throw new Error('此附件已进入成果历史，请保留原版本并提交新版');
      }
      await rm(target, { force: true });
    },
  };
}
