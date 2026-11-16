import path from 'node:path';
import { realpath, open, mkdir, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export const PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'html', 'htm'];
const types = { png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'], pdf: ['pdf', 'application/pdf'], docx: ['document'], xlsx: ['spreadsheet'], csv: ['text'], txt: ['text'], md: ['text'], html: ['html'], htm: ['html'] };
const kindOf = file => types[path.extname(file).slice(1).toLowerCase()];
const inside = (root, file) => file !== root && file.startsWith(root + path.sep);
const maximum = kind => kind === 'video' ? 120 * 1024 * 1024 : 20 * 1024 * 1024;
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, preserveOrder: true, parseTagValue: false, trimValues: false, maxNestedTags: 80 });
const children = (nodes, key) => (nodes ?? []).flatMap(node => node[key] ? [node] : []);
const one = (nodes, key) => children(nodes, key)[0]?.[key] ?? [];
const textOf = nodes => (nodes ?? []).map(node => node['#text'] ?? Object.entries(node).filter(([key]) => key !== ':@').map(([, value]) => Array.isArray(value) ? textOf(value) : '').join('')).join('');
const attr = (node, key) => node?.[':@']?.['@_' + key];
const parseXml = bytes => {
  if (!bytes) return [];
  const value = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('不支持包含外部实体的文档');
  return xmlParser.parse(value);
};
function officeEntries(bytes) {
  let expanded = 0, count = 0;
  // Inspect ALL directory entries before allocating decompressed buffers.
  unzipSync(bytes, { filter(entry) {
    expanded += entry.originalSize; count++;
    if (expanded > 40 * 1024 * 1024 || entry.originalSize > 10 * 1024 * 1024 || count > 2000) throw new Error('文档过大，请在本地应用中查看');
    return false;
  } });
  return unzipSync(bytes, { filter: entry => /^(?:word\/document.xml|xl\/(?:workbook.xml|_rels\/workbook.xml.rels|sharedStrings.xml|styles.xml|worksheets\/[^/]+.xml))$/.test(entry.name) });
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
export function parseAttachment(bytes, file) {
  const type = kindOf(file); if (!type) throw new Error('此文件格式暂不支持预览');
  if (bytes.length > maximum(type[0])) throw new Error('文件过大，无法在此预览');
  if (type[0] === 'html') return { kind: 'html', html: bytes.toString('utf8') };
  if (type[0] === 'document') return documentPreview(officeEntries(bytes));
  if (type[0] === 'spreadsheet') return spreadsheetPreview(officeEntries(bytes));
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
  async function resolve(runId, file) {
    if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('附件路径无效');
    const root = await rootFor(runId);
    const target = await realpath(path.isAbsolute(file) ? file : path.resolve(root, file));
    if (!inside(root, target)) throw new Error('只能查看当前项目内的文件');
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('附件不是普通文件');
    return { name: path.basename(target), path: target, size: info.size };
  }
  async function preview(runId, file) {
    if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('附件路径无效');
    const root = await rootFor(runId);
    const { target, bytes } = await readBounded(path.isAbsolute(file) ? file : path.resolve(root, file), root);
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

/** Resolve metadata from the saved output, never a renderer-supplied filename/path. */
export async function previewOutputAttachment({ snapshot, attachment }, projectId, outputId, attachmentId) {
  const project = await snapshot(projectId);
  const output = project?.outputs?.[outputId];
  const file = output?.attachments?.find(value => value.id === attachmentId);
  if (!project || project.project?.deletedAt || !file) throw new Error('成果附件不存在');
  const bytes = Buffer.from(await attachment(projectId, attachmentId));
  if (bytes.length !== file.size) throw new Error('附件内容与记录不一致');
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
