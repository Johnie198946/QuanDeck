import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

// Office relationships address entries inside the ZIP package.
function packagePath(folder, target) {
  const segments = target.startsWith('/') ? [] : [folder];
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segments.length) return '';
      segments.pop();
    } else segments.push(part);
  }
  return segments.join('/');
}
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
    const file = packagePath('xl', target);
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
    const file = packagePath('ppt', target);
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
export function parseOfficePreview(bytes, kind) {
  if (bytes.length > 20 * 1024 * 1024) throw new Error('文件过大，无法在此预览');
  const entries = officeEntries(bytes);
  const result = kind === 'document' ? documentPreview(entries) : kind === 'spreadsheet' ? spreadsheetPreview(entries) : presentationPreview(entries);
  return { ...result, ...officeCover(entries) };
}
