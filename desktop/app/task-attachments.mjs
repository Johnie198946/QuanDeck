import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, readFile, open, link, unlink } from 'node:fs/promises';

const safeId = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const filename = name => String(name).split(/[\\/]/).at(-1).replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(-160) || 'attachment';

/** Exports only references actually owned by this task, into the connected project. */
export async function prepareTaskFiles(store, snapshot, connection, input, frozenReferences) {
  if (!snapshot || snapshot.project.id !== input.projectId || !safeId(input.projectId) || !snapshot.tasks[input.taskId] || !connection?.projectPath || !Object.values(snapshot.runtimeConnections ?? {}).some(value => value.connectionId === input.connectionId && value.projectPath === connection.projectPath)) throw new Error('附件项目或 Agent 连接无效');
  const item = input.workItemId ? snapshot.orchestrations?.[input.taskId]?.items[input.workItemId] : undefined;
  if (input.workItemId && !item) throw new Error('附件子任务不存在');
  const allowed = frozenReferences ?? [...(snapshot.tasks[input.taskId].attachments ?? []), ...(item?.attachments ?? [])];
  if (!Array.isArray(input.ids) || input.ids.length > 40 || new Set(input.ids).size !== input.ids.length) throw new Error('附件请求无效');
  const references = input.ids.map(id => {
    const file = allowed.find(value => value.id === id);
    if (!safeId(id) || !file) throw new Error('附件不属于当前任务');
    return file;
  });
  const rootInfo = await lstat(connection.projectPath);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('附件项目目录存在不安全的链接或文件');
  const root = await realpath(connection.projectPath);
  const directory = async parts => {
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('附件目录存在不安全的链接或文件');
    }
    return current;
  };
  const prepared = [];
  for (const file of references) {
    const bytes = await store.attachment(input.projectId, file.id);
    if (bytes.length !== file.size || bytes.length > 25 * 1024 * 1024 || file.sha256 && hash(bytes) !== file.sha256) throw new Error('附件内容与记录不一致，请重新上传');
    const parent = await directory(['.quandeck', 'attachments', input.projectId, file.id]);
    const target = path.join(parent, filename(file.name));
    const temporary = path.join(parent, `.upload-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes); await handle.sync();
      await handle.close(); handle = undefined;
      // A same-directory hard link publishes only complete bytes and never replaces
      // an existing target. Interrupted writes leave only an ignorable temp file.
      try { await link(temporary, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || hash(await readFile(target)) !== hash(bytes)) throw new Error('附件副本已存在且内容不同，未覆盖');
      }
    } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    prepared.push({ id: file.id, name: file.name, path: target, ...(file.sha256 ? {sha256:file.sha256} : {}) });
  }
  return prepared;
}

/** Only the trusted native driver supplies a freshly built ledger context. No renderer command exposes this helper. */
export async function prepareContextFiles(store,snapshot,connection,input,context) {
  if(context.key !== (input.workItemId ? `${input.taskId}::${input.workItemId}` : input.taskId) || JSON.stringify(input.sources)!==JSON.stringify(context.sources.map(source=>({id:source.id,hash:source.hash}))))throw Error('前置来源版本已变化');
  const files=[];
  for(const source of context.sources){
    const artifact=snapshot.collaboration?.artifacts.find(artifact=>artifact.id===source.id&&artifact.hash===source.hash);
    if(!artifact)throw Error('前置成果已不存在');
    for(const receipt of source.deliveryReceipts??[]){
      if(receipt.kind!=='file')continue;
      const actual=artifact.deliveryReceipts?.find(item=>item.slotId===receipt.slotId&&item.contentHash===receipt.contentHash&&item.attachmentId===receipt.attachmentId);
      const file=artifact.attachments?.find(file=>file.id===receipt.attachmentId);
      if(!actual||!file||file.size!==receipt.bytes)throw Error('固定成果文件记录不一致');
      if(!files.some(value=>value.id===file.id))files.push({...file,sha256:receipt.contentHash});
    }
  }
  return prepareTaskFiles(store,snapshot,connection,{...input,ids:files.map(file=>file.id)},files);
}
