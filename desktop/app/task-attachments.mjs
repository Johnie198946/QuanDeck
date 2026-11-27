import { projectConnectionForRun } from './project-connection.mjs';
import path from 'node:path';
import { imageType } from './note-question-images.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, readFile, open, link, unlink, rm } from 'node:fs/promises';

const safeId = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const filename = name => String(name).split(/[\\/]/).at(-1).replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(-160) || 'attachment';

// Older stores used the incoming MIME value in the ID before defaulting an absent type in the saved metadata.
export function matchesStoredFile(file, bytes) {
  if (!file.id.startsWith('delivery-')) return true;
  const types = file.type === 'application/octet-stream' ? [file.type, '', 'undefined'] : [file.type];
  return types.some(type => file.id === 'delivery-'+hash(Buffer.concat([Buffer.from(file.name+'\0'+type+'\0'),bytes])));
}

/** Exports only references actually owned by this task, into the connected project. */
export async function prepareTaskFiles(store, snapshot, connection, input, frozenReferences) {
  if (!snapshot || snapshot.project.id !== input.projectId || !safeId(input.projectId) || !snapshot.tasks[input.taskId] || !connection?.projectPath || connection.connectionId !== input.connectionId || projectConnectionForRun(snapshot,input.connectionId,input.taskId,input.workItemId)?.projectPath !== connection.projectPath) throw new Error('附件项目或 Agent 连接无效');
  const item = input.workItemId ? snapshot.orchestrations?.[input.taskId]?.items[input.workItemId] : undefined;
  if (input.workItemId && !item) throw new Error('附件子任务不存在');
  const allowed = frozenReferences ?? [...(snapshot.project.attachments ?? []), ...(snapshot.tasks[input.taskId].attachments ?? []), ...(item?.attachments ?? [])];
  if (!Array.isArray(input.ids) || input.ids.length > 60 || new Set(input.ids).size !== input.ids.length) throw new Error('附件请求无效');
  const references = input.ids.map(id => {
    const file = allowed.find(value => value.id === id);
    if (!safeId(id) || !file) throw new Error('附件不属于当前任务');
    return file;
  });
  const pictureIds=input.imageIds ?? [];
  if (!Array.isArray(pictureIds) || pictureIds.length>4 || new Set(pictureIds).size!==pictureIds.length ||
      pictureIds.some(id=>!references.some(file=>file.id===id && /^image\/(png|jpeg|gif|webp)$/u.test(file.type))) ||
      references.reduce((size,file)=>size+(pictureIds.includes(file.id) ? file.size : 0),0)>8*1024*1024) throw Error('选定的任务图片不属于本次附件，或超过 4 张 / 8 MB');
  const assertPresent=()=>{if(store.isProjectErased?.(input.projectId))throw Error('项目已永久清除，未交付附件');};
  assertPresent();
  const rootInfo = await lstat(connection.projectPath);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('附件项目目录存在不安全的链接或文件');
  const root = await realpath(connection.projectPath);
  const directory = async parts => {
    let current = root;
    for (const part of parts) {
      assertPresent();
      current = path.join(current, part);
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('附件目录存在不安全的链接或文件');
    }
    return current;
  };
  const prepared = [];
  try {
  for (const file of references) {
    const bytes = Buffer.from(await store.attachment(input.projectId, file.id));
    assertPresent();
    const sha256 = hash(bytes);
    if (bytes.length !== file.size || bytes.length > 25 * 1024 * 1024 || file.sha256 && sha256 !== file.sha256) throw new Error('附件内容与记录不一致，请重新上传');
    const asImage = pictureIds.includes(file.id);
    if (!matchesStoredFile(file, bytes)) throw Error('固定附件已变化，请重新选择');
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
      assertPresent();
      try { await link(temporary, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || hash(await readFile(target)) !== sha256) throw new Error('附件副本已存在且内容不同，未覆盖');
      }
    } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    assertPresent();
    if (asImage && imageType(bytes)!==file.type) throw Error('任务图片格式与实际文件不符：'+file.name);
    prepared.push({ id: file.id, name: file.name, path: target, sha256, ...(asImage && {imageUrl:'data:'+file.type+';base64,'+bytes.toString('base64')}) });
  }
  assertPresent();return prepared;
  } catch(error) {
    if(store.isProjectErased?.(input.projectId)){
      const owned=path.join(root,'.quandeck','attachments',input.projectId);
      // Only this application's project-scoped staging directory is disposable.
      for(const parent of [root,path.join(root,'.quandeck'),path.join(root,'.quandeck','attachments')]){try{const info=await lstat(parent);if(info.isSymbolicLink()||!info.isDirectory())throw Error('托管目录已变化，未清理外部路径');}catch(failure){if(failure.code!=='ENOENT')throw failure;}}
      await rm(owned,{recursive:true,force:true});
    }
    throw error;
  }
}

/** Only the trusted native driver supplies a freshly built ledger context. No renderer command exposes this helper. */
export async function prepareContextFiles(store,snapshot,connection,input,context) {
  if(context.key !== (input.workItemId ? `${input.taskId}::${input.workItemId}` : input.taskId) || JSON.stringify(input.sources)!==JSON.stringify(context.sources.map(source=>({id:source.id,hash:source.hash}))))throw Error('前置来源版本已变化');
  const files=[];
  if (input.reworkReviewId !== context.reworkReview?.reviewId) throw Error('返工意见已变化');
  if (context.reworkReview) {
    const pin = context.reworkReview;
    const artifact = snapshot.collaboration?.artifacts.find(a => a.id === pin.artifactId && a.hash === pin.artifactHash && a.key === (context.discussionTarget?.key ?? context.key));
    if (!artifact) throw Error('待修改交付版本不一致');
    const review = snapshot.collaboration?.reviews?.find(r => r.id === pin.reviewId && r.key === artifact.key && r.submissionId === pin.submissionId && r.verdict === 'needs_changes');
    for (const file of context.reworkEvidence?.attachments ?? []) {
      if (!file.sha256) continue;
      const linked = [...(artifact.attachments ?? []), ...(review?.attachments ?? [])].find(a => a.id === file.id && a.size === file.size && a.name === file.name);
      const digest = linked?.sha256 ?? artifact.deliveryReceipts?.find(r => r.kind === 'file' && r.attachmentId === file.id)?.contentHash;
      if (!linked || !/^[a-f0-9]{64}$/.test(digest ?? '') || digest !== file.sha256) throw Error('待修改交付的附件记录不一致');
      files.push(file);
    }
  }
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
