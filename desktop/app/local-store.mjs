import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, copyFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Main-process persistence. A failed write never replaces the last complete file. */
export function createLocalStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'workspace.json');
  let data = {};
  if (existsSync(file)) {
    try { data = JSON.parse(readFileSync(file, 'utf8')); }
    catch { throw new Error(`本地数据无法读取，原文件已保留：${file}`); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('本地数据格式无效，未覆盖原文件');
  }
  function commit(next) {
    const temp = `${file}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
    if (existsSync(file)) copyFileSync(file, `${file}.previous`);
    renameSync(temp, file); data = next;
  }
  const storage = {
    getItem: key => typeof data[key] === 'string' ? data[key] : null,
    setItem: (key, value) => commit({ ...data, [key]: String(value) }),
    removeItem: key => { const next = { ...data }; delete next[key]; commit(next); },
  };
  const safe = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
  const attachmentPath = (projectId, id) => {
    if (!safe(projectId) || !safe(id)) throw new Error('附件标识无效');
    return path.join(directory, 'attachments', projectId, id);
  };
  return {
    storage, directory,
    read(key, fallback) { const value = storage.getItem(key); return value === null ? fallback : JSON.parse(value); },
    write(key, value) { storage.setItem(key, JSON.stringify(value)); },
    migrate(values) {
      const next = { ...data };
      for (const key of ['quandeck.projects.v1', 'quandeck.configured-agents.v1', 'quandeck.preferences.v1']) {
        if (next[key] !== undefined || !values?.[key]) continue;
        const parsed = JSON.parse(values[key]);
        if (key === 'quandeck.projects.v1' && (parsed.schema !== 1 || !parsed.projects || !Array.isArray(parsed.agents))) throw new Error('旧项目数据格式无效');
        next[key] = values[key];
      }
      if (JSON.stringify(next) !== JSON.stringify(data)) commit(next);
    },
    async saveAttachment(projectId, input) {
      const bytes = Buffer.from(input.bytes);
      if (bytes.length > 25 * 1024 * 1024) throw new Error('每个文件最多 25 MB');
      const id = randomUUID(); const target = attachmentPath(projectId, id);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      return { id, name: String(input.name).slice(0, 255), type: String(input.type || 'application/octet-stream'), size: bytes.length };
    },
    async attachment(projectId, id) { return readFile(attachmentPath(projectId, id)); },
    async removeAttachment(projectId, id) { await rm(attachmentPath(projectId, id), { force: true }); },
  };
}
