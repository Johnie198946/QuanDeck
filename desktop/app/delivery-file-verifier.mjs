import path from 'node:path';
import { realpath, open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

const maximum = 25 * 1024 * 1024;
const inside = (root, target) => target !== root && target.startsWith(root + path.sep);
const formats = {
  md: 'text/markdown', txt: 'text/plain', html: 'text/html', csv: 'text/csv', json: 'application/json',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function validateDeliveryBytes(bytes, format) {
  const ext = String(format).toLowerCase().replace(/^\./, '');
  if (!formats[ext]) throw Error(`暂不支持交付格式 ${ext}，请修改交付清单`);
  if (!bytes.length || bytes.length > maximum) throw Error('交付文件须为 1 字节至 25 MB');
  const starts = values => Buffer.from(bytes.subarray(0, values.length)).equals(Buffer.from(values));
  if (['md', 'txt', 'html', 'csv', 'json', 'svg'].includes(ext)) {
    let body;
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw Error('文本交付件须为有效 UTF-8'); }
    if (!body.trim() || body.includes('\0')) throw Error('交付正文为空或不是文本');
    if (ext === 'json') { try { JSON.parse(body); } catch { throw Error('JSON 交付件无法解析'); } }
    if (ext === 'html' && !/<(?:!doctype\s+html|html|body)\b/i.test(body)) throw Error('HTML 交付件缺少文档结构');
    if (ext === 'svg' && !/<svg\b/i.test(body)) throw Error('SVG 交付件缺少图形结构');
  } else if (ext === 'pdf' && !starts([37, 80, 68, 70, 45])) throw Error('文件内容不是 PDF');
  else if (ext === 'png' && !starts([137, 80, 78, 71, 13, 10, 26, 10])) throw Error('文件内容不是 PNG');
  else if (['jpg', 'jpeg'].includes(ext) && !starts([255, 216, 255])) throw Error('文件内容不是 JPEG');
  else if (ext === 'webp' && !(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')) throw Error('文件内容不是 WebP');
  else if (['zip', 'docx', 'xlsx', 'pptx'].includes(ext) && !starts([80, 75, 3, 4])) throw Error('文件内容不是有效压缩容器');
  // This validates the container/type, not the semantic correctness of a PDF/Office document.
  return formats[ext];
}

/** Trusted adapter only. Model paths are resolved against the owned run, never a renderer root. */
export function createDeliveryFileVerifier({ snapshot, readRun, store }) {
  return async input => {
    if (!Array.isArray(input.items) || input.items.length > 64) throw Error('交付件数量无效');
    const project = await snapshot(input.projectId), run = await readRun(input.runId);
    if (!project || project.project.deletedAt || !run?.projectPath || run.projectId !== input.projectId || run.taskId !== input.taskId || (run.workItemId ?? undefined) !== input.workItemId) throw Error('交付文件与执行任务绑定不一致');
    const root = await realpath(run.projectPath);
    const slots = Object.values(project.collaboration?.goalPlans ?? {}).flatMap(versions => versions.at(-1)?.slots ?? []);
    const result = [];
    for (const item of input.items) {
      const slot = slots.find(slot => slot.id === item?.slotId && !slot.retired && slot.taskId === input.taskId && (slot.workItemId ?? undefined) === input.workItemId);
      if (!slot?.contract || slot.contract.kind !== 'file') {
        if (item?.path || item?.attachmentId) throw Error('文件不属于当前任务交付清单');
        continue;
      }
      if (item.contractRevision !== slot.contract.revision) throw Error('交付文件使用旧版清单，请刷新后补交');
      let bytes, name, relative, saved;
      if (item.attachmentId) {
        const artifacts = project.collaboration?.artifacts ?? [];
        const bound = [...(project.tasks[input.taskId]?.attachments ?? []), ...(project.orchestrations?.[input.taskId]?.items?.[input.workItemId]?.attachments ?? []), ...artifacts.filter(a => a.key === (input.workItemId ? `${input.taskId}::${input.workItemId}` : input.taskId)).flatMap(a => a.attachments ?? [])].find(a => a.id === item.attachmentId);
        if (!bound) throw Error('附件未登记在当前任务');
        bytes = Buffer.from(await store.attachment(input.projectId, bound.id)); name = bound.name; saved = bound;
      } else {
        const value = item.path;
        if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) throw Error('请提供项目内文件路径');
        const target = await realpath(path.resolve(root, value));
        if (!inside(root, target)) throw Error('交付文件不在当前项目内');
        const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.size < 1 || before.size > maximum) throw Error('交付件须为不超过 25 MB 的普通文件');
          const buffer = Buffer.alloc(before.size + 1); let length = 0;
          while (length < buffer.length) { const part = await handle.read(buffer, length, buffer.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
          const after = await handle.stat(), resolved = await realpath(target), current = await stat(target);
          if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || resolved !== target || !inside(root, resolved) || current.ino !== before.ino || current.dev !== before.dev) throw Error('交付文件在读取期间变化，请重新提交');
          bytes = buffer.subarray(0, length); name = path.basename(target); relative = path.relative(root, target).split(path.sep).join('/');
        } finally { await handle.close(); }
      }
      const extension = path.extname(name).slice(1).toLowerCase();
      if (extension !== slot.contract.format.toLowerCase().replace(/^\./, '')) throw Error(`“${slot.title}”要求 ${slot.contract.format} 格式`);
      const mimeType = validateDeliveryBytes(bytes, extension), sha256 = createHash('sha256').update(bytes).digest('hex');
      if (!saved) saved = await store.saveAttachment(input.projectId, { name, type: mimeType, bytes });
      result.push({ attachmentId: saved.id, name, bytes: bytes.length, sha256, mimeType, verifiedAt: new Date().toISOString(), ...(["md", "txt", "json"].includes(extension) && bytes.length <= 300000 && bytes.toString("utf8").length <= 100000 ? { textBody: bytes.toString("utf8") } : {}), ...(relative ? { path: item.path, storagePath: relative } : {}) });
    }
    return result;
  };
}

/** Manual output accepts only uploaded attachment IDs, never filesystem paths or caller hashes. */
export function createManualDeliveryFileVerifier(store) {
  return async (snapshot,input) => {
    if(input.projectId&&input.projectId!==snapshot.project.id)throw Error('附件项目已变化');
    const key=input.workItemId?`${input.taskId}::${input.workItemId}`:input.taskId;
    const slots=Object.values(snapshot.collaboration?.goalPlans??{}).flatMap(v=>v.at(-1)?.slots??[]).filter(s=>!s.retired&&s.taskKey===key),result=[];
    for(const item of input.deliveryItems??[]){
      if(item.path)throw Error('请上传本地文件后选择附件');
      if(!item.attachmentId)continue;
      const slot=slots.find(s=>s.id===item.slotId),file=input.attachments?.find(f=>f.id===item.attachmentId);
      if(!file||slot?.contract?.kind!=='file'||slot.contract.revision!==item.contractRevision)throw Error('附件与当前交付项不一致');
      const bytes=Buffer.from(await store.attachment(snapshot.project.id,file.id));
      if(bytes.length!==file.size)throw Error('附件大小与登记记录不一致');
      const extension=path.extname(file.name).slice(1).toLowerCase();
      if(extension!==slot.contract.format)throw Error(`“${slot.title}”要求 ${slot.contract.format} 格式`);
      const mimeType=validateDeliveryBytes(bytes,extension),sha256=createHash('sha256').update(bytes).digest('hex');
      result.push({attachmentId:file.id,name:file.name,bytes:bytes.length,sha256,mimeType,verifiedAt:new Date().toISOString(),...(['md','txt','json'].includes(extension)&&bytes.length<=300000&&bytes.toString('utf8').length<=100000?{textBody:bytes.toString('utf8')}:{})});
    }
    return result;
  };
}
