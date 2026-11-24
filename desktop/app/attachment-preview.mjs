import path from 'node:path';
import { realpath, open, mkdir, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export const PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'pdf', 'docx', 'xlsx', 'pptx', 'csv', 'txt', 'md', 'html', 'htm'];
const types = { png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'], pdf: ['pdf', 'application/pdf'], docx: ['document'], xlsx: ['spreadsheet'], pptx: ['slides'], csv: ['text'], txt: ['text'], md: ['text'], diff: ['text'], patch: ['text'], html: ['html'], htm: ['html'] };
const kindOf = file => types[path.extname(file).slice(1).toLowerCase()];
const inside = (root, file) => file !== root && file.startsWith(root + path.sep);
const maximum = kind => kind === 'video' ? 120 * 1024 * 1024 : 20 * 1024 * 1024;
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, preserveOrder: true, parseTagValue: false, trimValues: false, maxNestedTags: 80 });
const children = (nodes, key) => (nodes ?? []).flatMap(node => node[key] ? [node] : []);
const one = (nodes, key) => children(nodes, key)[0]?.[key] ?? [];
const textOf = nodes => (nodes ?? []).map(node => node['#text'] ?? Object.entries(node).filter(([key]) => key !== ':@').map(([, value]) => Array.isArray(value) ? textOf(value) : '').join('')).join('');
const attr = (node, key) => node?.[':@']?.['@_' + key];
// PowerPoint slide entries contain both id and r:id. Keep relationship attributes distinct.
const presentationParser = new XMLParser({ignoreAttributes: false, preserveOrder: true, parseTagValue: false, trimValues: false, maxNestedTags: 80, transformTagName: key => key.split(':').at(-1)});
const parseXml = (bytes, parser = xmlParser) => {
  if (!bytes) return [];
  const value = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('不支持包含外部实体的文档');
  return parser.parse(value);
};
function officeEntries(bytes) {
  let expanded = 0, count = 0;
  // Inspect ALL directory entries before allocating decompressed buffers.
  unzipSync(bytes, { filter(entry) {
    expanded += entry.originalSize; count++;
    if (expanded > 40 * 1024 * 1024 || entry.originalSize > 10 * 1024 * 1024 || count > 2000) throw new Error('文档过大，请在本地应用中查看');
    return false;
  } });
  return unzipSync(bytes, { filter: entry => /^(?:docProps\/thumbnail\.(?:png|jpe?g)|ppt\/(?:presentation.xml|_rels\/presentation.xml.rels|slides\/slide\d+\.xml)|word\/document.xml|xl\/(?:workbook.xml|_rels\/workbook.xml.rels|sharedStrings.xml|styles.xml|worksheets\/[^/]+.xml))$/.test(entry.name) });
}
function documentPreview(entries) {
  if (!entries['word/document.xml']) throw new Error('Word 文档内容无效');
  const body = one(one(parseXml(entries['word/document.xml']), 'document'), 'body');
  const blocks = []; let truncated = false;
  for (const node of body) {
    if (blocks.length >= 500) { truncated = true; break; }
    if (node.p) {
      const properties = one(node.p, 'pPr');
      const style = attr(children(properties, 'pStyle')[0], 'val') ?? '';
      const text = textOf(node.p.filter(value => !value.pPr));
      if (!text.trim()) continue;
      blocks.push({ kind: /^Heading[1-6]$/i.test(style) ? 'heading' : one(properties, 'numPr').length ? 'list' : 'paragraph', text: text.slice(0, 20000), level: Number(style.slice(-1)) || 1 });
    } else if (node.tbl) {
      const rows = children(node.tbl, 'tr');
      const table = rows.slice(0, 100).map(row => children(row.tr, 'tc').slice(0, 30).map(cell => children(cell.tc, 'p').map(paragraph => textOf(paragraph.p)).join('\n').slice(0, 4000)));
      blocks.push({ kind: 'table', rows: table }); if (rows.length > 100) truncated = true;
    }
  }
  return { kind: 'document', blocks, truncated, note: '显示正文、标题与表格；复杂排版、图片和批注请在 Word 中查看。' };
}
function spreadsheetPreview(entries) {
  if (!entries['xl/workbook.xml']) throw new Error('Excel 工作簿内容无效');
  const workbook = one(parseXml(entries['xl/workbook.xml']), 'workbook');
  const strings = children(one(parseXml(entries['xl/sharedStrings.xml']), 'sst'), 'si').map(node => textOf(node.si));
  const relationships = children(one(parseXml(entries['xl/_rels/workbook.xml.rels']), 'Relationships'), 'Relationship');
  const definitions = children(one(workbook, 'sheets'), 'sheet');
  const sheets = []; let truncated = definitions.length > 30;
  for (const definition of definitions.slice(0, 30)) {
    const relation = relationships.find(value => attr(value, 'Id') === attr(definition, 'id'));
    if (!relation || attr(relation, 'TargetMode') === 'External') continue;
    const target = attr(relation, 'Target') || '';
    const file = target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/' + target);
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(file) || !entries[file]) continue;
    const rows = children(one(one(parseXml(entries[file]), 'worksheet'), 'sheetData'), 'row');
    const output = [];
    for (const row of rows.slice(0, 200)) {
      const cells = [];
      for (const cell of children(row.row, 'c')) {
        const column = /^([A-Z]+)/i.exec(attr(cell, 'r') ?? '')?.[1];
        const index = column ? [...column.toUpperCase()].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1 : cells.length;
        if (index > 49) { truncated = true; continue; }
        let value = textOf(one(cell.c, 'v'));
        if (attr(cell, 't') === 's') value = strings[Number(value)] ?? '';
        else if (attr(cell, 't') === 'inlineStr') value = textOf(one(cell.c, 'is'));
        else if (attr(cell, 't') === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        const formula = textOf(one(cell.c, 'f'));
        cells[index] = { text: String(value).slice(0, 4000), ...(formula ? { formula: formula.slice(0, 1000) } : {}) };
      }
      output.push({ number: Number(attr(row, 'r')) || output.length + 1, cells: Array.from({ length: cells.length }, (_, i) => cells[i] ?? { text: '' }) });
    }
    if (rows.length > 200) truncated = true;
    sheets.push({ name: attr(definition, 'name') || `工作表 ${sheets.length + 1}`, rows: output });
  }
  if (!sheets.length) throw new Error('没有可预览的工作表');
  return { kind: 'spreadsheet', sheets, truncated, note: '显示已保存的数据；完整格式和图表请查看原文件。' };
}
function presentationPreview(entries) {
  if (!entries['ppt/presentation.xml']) throw new Error('幻灯片内容无效');
  const presentation = children(parseXml(entries['ppt/presentation.xml'], presentationParser), 'presentation')[0];
  const listed = children(one(presentation?.presentation, 'sldIdLst'), 'sldId');
  const relations = children(one(parseXml(entries['ppt/_rels/presentation.xml.rels']), 'Relationships'), 'Relationship');
  const slides = [];
  const relationAttribute = Object.keys(presentation?.[':@'] ?? {})
    .find(key => key.startsWith('@_xmlns:') && /\/relationships$/.test(attr(presentation, key.slice(2)) ?? ''));
  const relationName = (relationAttribute?.slice('@_xmlns:'.length) || 'r') + ':id';
  for (const item of listed.slice(0, 80)) {
    const link = relations.find(node => attr(node, 'Id') === attr(item, relationName));
    if (!link || attr(link, 'TargetMode') === 'External') continue;
    const target = attr(link, 'Target') || '';
    const file = path.posix.normalize(target.startsWith('/') ? target.slice(1) : 'ppt/' + target);
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(file) || !entries[file]) continue;
    const slide = one(parseXml(entries[file]), 'sld');
    const shapes = children(one(one(slide, 'cSld'), 'spTree'), 'sp');
    const lines = shapes.flatMap(shape => children(one(shape.sp, 'txBody'), 'p')
      .map(paragraph => textOf(paragraph.p).trim().slice(0, 1000)).filter(Boolean));
    slides.push(lines.slice(0, 24));
  }
  if (!slides.length) throw new Error('没有可预览的幻灯片');
  return {kind: 'slides', slides, truncated: listed.length > slides.length, note: '可按页阅读文字，完整排版请打开原文件。'};
}
function officeCover(entries) {
  for (const name of ['docProps/thumbnail.png', 'docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg']) {
    const bytes = entries[name];
    if (!bytes?.length || bytes.length > 4 * 1024 * 1024) continue;
    const png = name.endsWith('.png');
    const expected = png ? [137,80,78,71,13,10,26,10] : [255,216,255];
    if (expected.every((byte, index) => bytes[index] === byte)) return {cover: {mime: png ? 'image/png' : 'image/jpeg', bytes}};
  }
  return {};
}
export function parseAttachment(bytes, file) {
  const type = kindOf(file); if (!type) throw new Error('此文件格式暂不支持预览');
  if (bytes.length > maximum(type[0])) throw new Error('文件过大，无法在此预览');
  if (type[0] === 'html') return { kind: 'html', html: bytes.toString('utf8') };
  if (['document', 'spreadsheet', 'slides'].includes(type[0])) {
    const entries = officeEntries(bytes);
    const result = type[0] === 'document' ? documentPreview(entries) : type[0] === 'spreadsheet' ? spreadsheetPreview(entries) : presentationPreview(entries);
    return { ...result, ...officeCover(entries) };
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
