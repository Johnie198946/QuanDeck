import path from 'node:path';
import { tmpdir } from 'node:os';
import { realpath, open, mkdir, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseOfficePreview } from './office-preview.mjs';

export const PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'pdf', 'docx', 'xlsx', 'pptx', 'csv', 'txt', 'md', 'html', 'htm'];
const types = { png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'], pdf: ['pdf', 'application/pdf'], docx: ['document'], xlsx: ['spreadsheet'], pptx: ['slides'], csv: ['text'], txt: ['text'], md: ['text'], diff: ['text'], patch: ['text'], html: ['html'], htm: ['html'] };
const kindOf = file => types[path.extname(file).slice(1).toLowerCase()];
const inside = (root, file) => file !== root && file.startsWith(root + path.sep);
const maximum = kind => kind === 'video' ? 120 * 1024 * 1024 : 20 * 1024 * 1024;
export function parseAttachment(bytes, file) {
  const type = kindOf(file); if (!type) throw new Error('此文件格式暂不支持预览');
  if (bytes.length > maximum(type[0])) throw new Error('文件过大，无法在此预览');
  if (type[0] === 'html') return { kind: 'html', html: bytes.toString('utf8') };
  if (['document', 'spreadsheet', 'slides'].includes(type[0])) {
    return parseOfficePreview(bytes, type[0]);
  }
  if (type[0] === 'text') return { kind: 'text', text: bytes.toString('utf8').slice(0, 100000), truncated: bytes.length > 100000 };
  if (type[0] === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('PDF 文件内容无效');
  return { kind: type[0], mime: type[1], bytes: Uint8Array.from(bytes) };
}
async function readBounded(file, root) {
  const target = await realpath(file);
  if (root && !inside(root, target)) throw new Error('只能预览当前项目内的文件');
  const type = kindOf(target); if (!type) throw new Error('此文件格式暂不支持预览');
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum(type[0])) throw new Error('文件过大或不是普通文件');
    // readFile could grow without bound if a source modifies the file concurrently.
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    if (length !== info.size) throw new Error('文件正在变化，请保存后重试');
    return { target, bytes: bytes.subarray(0, length) };
  } finally { await handle.close(); }
}
export function createAttachmentPreview({ readRun }) {
  async function rootFor(runId) {
    const run = await readRun(runId);
    if (!run?.projectPath) throw new Error('会话未关联本地项目');
    return realpath(run.projectPath);
  }
  async function targetFor(root, file) {
    if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('附件路径无效');
    if (/^file:/i.test(file)) {
      // File URLs are explicitly encoded. Decode once using the platform rules;
      // remote shares and encoded separators must not become local file access.
      let local;
      try {
        const url = new URL(file);
        if (url.hostname && url.hostname !== 'localhost') throw new Error('remote file');
        local = fileURLToPath(url);
        if (local.includes('\0')) throw new Error('invalid path');
      } catch { throw new Error('附件文件链接无效'); }
      return realpath(local);
    }
    const absolute = value => path.isAbsolute(value) ? value : path.resolve(root, value);
    try { return await realpath(absolute(file)); }
    catch (error) {
      // Saved filesystem paths can legitimately contain '%' or '%20'. Prefer
      // that exact file. Markdown URLs encode Unicode/spaces; only a missing
      // literal path permits one decoding pass, never a recursive fallback.
      if (error?.code !== 'ENOENT' || !/%[\da-f]{2}/i.test(file)) throw error;
      let decoded;
      try { decoded = decodeURIComponent(file); } catch { throw new Error('附件文件链接无效'); }
      if (decoded.includes('\0')) throw new Error('附件路径无效');
      return realpath(absolute(decoded));
    }
  }
  async function resolve(runId, file) {
    const root = await rootFor(runId);
    const target = await targetFor(root, file);
    if (!inside(root, target)) throw new Error('只能查看当前项目内的文件');
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('附件不是普通文件');
    return { name: path.basename(target), path: target, size: info.size };
  }
  async function preview(runId, file) {
    const root = await rootFor(runId);
    const { target, bytes } = await readBounded(await targetFor(root, file), root);
    return { name: path.basename(target), path: target, size: bytes.length, ...parseAttachment(bytes, target) };
  }
  async function importFiles(runId, files) {
    if (!Array.isArray(files) || files.length > 8) throw new Error('一次最多选择 8 个附件');
    const root = await rootFor(runId);
    let destination = root;
    for (const segment of ['.quandeck', 'discussion-attachments']) {
      destination = path.join(destination, segment);
      await mkdir(destination, { recursive: true });
      if ((await lstat(destination)).isSymbolicLink() || !inside(root, await realpath(destination))) throw new Error('附件目录无效');
    }
    const output = [];
    for (const file of files) {
      const { bytes } = await readBounded(file);
      const name = path.basename(file).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(-160);
      const target = path.join(destination, randomUUID() + '-' + name);
      const handle = await open(target, 'wx', 0o600);
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      output.push({ name, path: target, size: bytes.length });
    }
    return output;
  }
  return { preview, resolve, importFiles };
}

/** A published reader may only address the exact receipt frozen into that version. */
function publishedAttachment(project, outputId, attachmentId, reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference) ||
      Object.keys(reference).some(key => !['versionId', 'artifactId', 'slotId'].includes(key)) ||
      !['versionId', 'artifactId', 'slotId'].every(key => typeof reference[key] === 'string' && reference[key].length > 0)) {
    throw new Error('已发布附件引用无效');
  }
  const version = project.integration?.versions?.find(value => value.id === reference.versionId);
  const item = version?.deliveryPublication?.items?.find(value => value.slotId === reference.slotId && value.artifactId === reference.artifactId);
  const artifact = project.collaboration?.artifacts?.find(value => value.id === reference.artifactId && value.outputId === outputId);
  const pin = version?.sourcePins?.find(value => value.artifactId === artifact?.id && value.taskKey === artifact?.key && value.artifactHash === artifact?.hash);
  const receipt = item?.receipt;
  const saved = artifact?.deliveryReceipts?.find(value => value.slotId === reference.slotId && value.attachmentId === attachmentId);
  if (!item || !artifact || !pin || !receipt || !saved || receipt.kind !== 'file' ||
      receipt.slotId !== reference.slotId || receipt.attachmentId !== attachmentId ||
      item.contract?.kind !== 'file' || item.contract.revision !== receipt.contractRevision || item.contract.format !== receipt.format ||
      !['slotId', 'contractRevision', 'kind', 'format', 'attachmentId', 'fileName', 'bytes', 'contentHash', 'verifiedAt'].every(key => saved[key] === receipt[key]) ||
      typeof receipt.fileName !== 'string' || !receipt.fileName || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0 ||
      typeof receipt.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(receipt.contentHash)) {
    throw new Error('已发布附件与成果版本不匹配');
  }
  return { id: attachmentId, name: receipt.fileName, size: receipt.bytes, contentHash: receipt.contentHash };
}

/** Resolve saved metadata, never a renderer-supplied filename/path or today's edited output for a publication. */
export async function previewOutputAttachment({ snapshot, attachment }, projectId, outputId, attachmentId, reference) {
  const project = await snapshot(projectId);
  if (!project || project.project?.id !== projectId || project.project?.deletedAt) throw new Error('成果附件不存在');
  const file = reference === undefined
    ? project.outputs?.[outputId]?.attachments?.find(value => value.id === attachmentId)
    : publishedAttachment(project, outputId, attachmentId, reference);
  if (!file) throw new Error('成果附件不存在');
  const bytes = Buffer.from(await attachment(projectId, attachmentId));
  if (bytes.length !== file.size) throw new Error('附件内容与记录不一致');
  if (file.contentHash && createHash('sha256').update(bytes).digest('hex') !== file.contentHash.toLowerCase()) throw new Error('附件内容校验失败，与已保存版本不一致');
  return { name: file.name, path: '', size: bytes.length, ...parseAttachment(bytes, file.name) };
}

/** A discussion picture can only preview an attachment already registered on this task. */
export async function previewDiscussionAttachment({ snapshot, attachment }, projectId, planId, conclusionId, blockId, optionId) {
  const project = await snapshot(projectId), plan = project?.ideaPlans?.[planId];
  if (!project || project.project?.deletedAt || !plan || !project.tasks?.[plan.taskId]) throw new Error('讨论任务不存在');
  const block = plan.discussion?.conclusions?.find(c => c.id === conclusionId)?.visualBlocks?.find(b => b.id === blockId);
  const picture = optionId ? block?.options?.find(o => o.id === optionId)?.image : block?.image;
  const files = [...(project.tasks[plan.taskId].attachments ?? []), ...Object.values(project.orchestrations?.[plan.taskId]?.items ?? {}).flatMap(item => item.attachments ?? []), ...Object.values(project.outputs ?? {}).filter(output => output.taskId === plan.taskId).flatMap(output => output.attachments ?? [])];
  const file = files.find(file => file.id === picture?.attachmentId);
  if (!file || !/^image\//.test(file.type)) throw new Error('这张图片尚未登记到当前任务');
  const bytes = Buffer.from(await attachment(projectId, file.id));
  if (bytes.length !== file.size) throw new Error('图片内容与记录不一致');
  const parsed = parseAttachment(bytes, file.name);
  if (parsed.kind !== 'image') throw new Error('附件不是可预览的图片');
  return { name: file.name, path: '', size: bytes.length, ...parsed };
}

export async function previewKnowledgeAttachment({ readLibrary, readBytes, thumbnail }, noteId, fileId) {
  const library = readLibrary();
  const file = knowledgeAttachment(library, noteId, fileId);
  if (!file) throw new Error('未找到这篇笔记中的附件');
  const bytes = await readBytes(file.id);
  if (bytes.length !== file.size) throw new Error('附件内容与记录不一致');
  const info = { name: file.name, path: '', size: bytes.length };
  const ext = path.extname(file.name).toLowerCase();
  if (thumbnail && ['.doc', '.xls', '.ppt'].includes(ext)) {
    const directory = await mkdtemp(path.join(tmpdir(), 'quandeck-note-preview-'));
    try {
      const source = path.join(directory, 'preview' + ext);
      await writeFile(source, bytes, { flag: 'wx', mode: 0o600 });
      const image = await thumbnail(source);
      if (!image.length) throw new Error('系统无法预览这个文件，可以下载原件');
      return { ...info, kind: 'image', mime: 'image/png', bytes: image };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  return { ...info, ...parseAttachment(bytes, file.name) };
}

// Files attached to canvas references use the same binary store as note attachments.
export function knowledgeAttachment(library, ownerId, fileId) {
  for (const note of library.notes) {
    if (ownerId && note.id !== ownerId) continue;
    const file = note.attachments?.find(item => item.id === fileId);
    if (file) return file;
  }
  for (const node of library.inspirationCanvas?.nodes ?? []) {
    if (ownerId && node.noteId !== ownerId) continue;
    const file = node.idea?.reference?.file;
    if (file && file.id === fileId) return file;
  }
}
