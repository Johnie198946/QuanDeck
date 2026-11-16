import type { OutputAttachment } from './types';
import { desktopHost } from '../integration/desktop';

const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!globalThis.indexedDB) { reject(new Error('当前环境无法保存附件')); return; }
  const request = indexedDB.open('quandeck-output-files', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('无法打开附件存储'));
});
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode); const request = run(tx.objectStore('files'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('附件未保存，请检查磁盘空间')); };
  });
}
export async function saveOutputFile(projectId: string, file: File): Promise<OutputAttachment> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} 超过 25 MB`);
  const host = desktopHost();
  if (host) return host.saveAttachment(projectId, { name: file.name, type: file.type, bytes: await file.arrayBuffer() });
  const id = crypto.randomUUID();
  await transaction('readwrite', store => store.put(file, `${projectId}:${id}`));
  return { id, name: file.name, type: file.type || 'application/octet-stream', size: file.size };
}
export async function removeOutputFile(projectId: string, id: string) {
  const host = desktopHost();
  if (host) { await host.removeAttachment(projectId, id); return; }
  await transaction('readwrite', store => store.delete(`${projectId}:${id}`));
}
export async function downloadOutputFile(projectId: string, attachment: OutputAttachment) {
  const host = desktopHost();
  if (host) {
    try { await host.downloadAttachment(projectId, attachment); return; }
    catch (error) {
      // Existing 0.4 attachments remain accessible during the first desktop upgrade.
      const legacy = await transaction<Blob | undefined>('readonly', store => store.get(`${projectId}:${attachment.id}`));
      if (!legacy) throw error;
    }
  }
  const file = await transaction<Blob | undefined>('readonly', store => store.get(`${projectId}:${attachment.id}`));
  if (!file) throw new Error('本机未找到这个附件，请重新添加');
  const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = attachment.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function fileSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
