import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath, truncate } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync, strToU8 } from './app/node_modules/fflate/esm/index.mjs';
import { createAttachmentPreview, parseAttachment } from './app/attachment-preview.mjs';
const archive = files => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]))));
const docx = archive({ 'word/document.xml': '<w:document xmlns:w="w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>旅行信息确认</w:t></w:r></w:p><w:p><w:r><w:t>预算 &amp; 行程 &lt;script&gt;</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>曼谷</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2 天</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' });
const xlsx = archive({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="费用" r:id="rId1"/><sheet name="地点" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>机票</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>5000</v></c><c r="D1"><f>SUM(C1:C2)</f><v>8000</v></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>芭提雅</t></is></c></row></sheetData></worksheet>',
});

test('DOCX preview preserves headings, readable entities and tables without injecting markup', () => {
  const result = parseAttachment(docx, '信息.docx');
  assert.equal(result.kind, 'document'); assert.equal(result.blocks[0].kind, 'heading');
  assert.equal(result.blocks[1].text, '预算 & 行程 <script>');
  assert.deepEqual(result.blocks[2].rows, [['曼谷', '2 天']]);
});
test('XLSX preview preserves sheet names, sparse cells, strings and cached results without evaluating formulas', () => {
  const result = parseAttachment(xlsx, '行程.xlsx');
  assert.deepEqual(result.sheets.map(sheet => sheet.name), ['费用', '地点']);
  assert.deepEqual(result.sheets[0].rows[0].cells.map(cell => cell.text), ['机票', '', '5000', '8000']);
  assert.equal(result.sheets[0].rows[0].cells[3].formula, 'SUM(C1:C2)');
  assert.equal(result.sheets[1].rows[0].number, 2); assert.equal(result.sheets[1].rows[0].cells[0].text, '芭提雅');
});
test('Office parsers reject entity definitions and expanded archive resource bombs before rendering', () => {
  assert.throws(() => parseAttachment(archive({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private/key">]><document/>' }), 'bad.docx'), /外部实体/);
  assert.throws(() => parseAttachment(archive({ 'word/document.xml': 'a'.repeat(11 * 1024 * 1024) }), 'large.docx'), /文档过大/);
  assert.throws(() => parseAttachment(Buffer.from('not a document'), 'bad.pdf'), /内容无效/);
});
test('Preview limits table dimensions and does not follow external spreadsheet relationships', () => {
  const data = archive({ 'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="remote" r:id="external"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="external" Target="https://example.com/private.xml" TargetMode="External"/></Relationships>' });
  assert.throws(() => parseAttachment(data, 'external.xlsx'), /没有可预览/);
  const rows = Array.from({ length: 220 }, (_, i) => `<row r="${i+1}"><c r="A${i+1}"><v>3</v></c><c r="ZZ${i+1}"><v>secret</v></c></row>`).join('');
  const limited = parseAttachment(archive({ 'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="many" r:id="r"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r" Target="worksheets/a.xml"/></Relationships>', 'xl/worksheets/a.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>` }), 'rows.xlsx');
  assert.equal(limited.sheets[0].rows.length, 200); assert.equal(limited.sheets[0].rows[0].cells.length, 1); assert.equal(limited.truncated, true);
});
test('Source attachments stay inside the exact run project; user-selected files are copied before sharing', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'quandeck-preview-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'); await mkdir(root);
  const other = path.join(base, 'outside.docx'); await writeFile(other, docx);
  const service = createAttachmentPreview({ readRun: id => { if (id !== 'run') throw new Error('unknown run'); return { projectPath: root }; } });
  await assert.rejects(service.preview('run', other), /当前项目/);
  await assert.rejects(service.preview('run', '../outside.docx'), /当前项目/);
  await symlink(other, path.join(root, 'linked.docx')); await assert.rejects(service.preview('run', 'linked.docx'), /当前项目/);
  const [file] = await service.importFiles('run', [other]); assert.equal(file.name, 'outside.docx'); assert.ok(file.path.startsWith(await realpath(root) + path.sep));
  assert.deepEqual(await readFile(file.path), docx); assert.equal((await service.preview('run', file.path)).kind, 'document');
  await assert.rejects(service.importFiles('unknown', [other]), /unknown/);
});
test('Selected files cannot escape through a symlinked attachment directory', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'quandeck-preview-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'), other = path.join(base, 'other'); await mkdir(root); await mkdir(other);
  const source = path.join(base, 'note.txt'); await writeFile(source, 'hello'); await symlink(other, path.join(root, '.quandeck'));
  const service = createAttachmentPreview({ readRun: () => ({ projectPath: root }) });
  await assert.rejects(service.importFiles('run', [source]), /目录无效/);
});

test('Reveal works independently of preview format, decoding and size while retaining project boundaries', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'quandeck-preview-reveal-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'); await mkdir(root);
  const legacy = path.join(root, 'old.doc'), large = path.join(root, 'large.pdf'), malformed = path.join(root, 'broken.docx');
  await writeFile(legacy, 'legacy Office'); await writeFile(large, '%PDF-1.4'); await truncate(large, 21 * 1024 * 1024); await writeFile(malformed, 'broken zip');
  const service = createAttachmentPreview({ readRun: () => ({ projectPath: root }) });
  for (const file of [legacy, large, malformed]) {
    assert.equal((await service.resolve('run', file)).path, await realpath(file));
    await assert.rejects(service.preview('run', file));
  }
  const outside = path.join(base, 'outside.doc'); await writeFile(outside, 'private');
  await assert.rejects(service.resolve('run', outside), /当前项目/);
  await symlink(outside, path.join(root, 'escape.doc')); await assert.rejects(service.resolve('run', 'escape.doc'), /当前项目/);
  await assert.rejects(service.resolve('run', root), /当前项目/);
  await mkdir(path.join(root, 'folder')); await assert.rejects(service.resolve('run', 'folder'), /普通文件/);
});

test('HTML is transported as inert source, while the renderer owns sanitization and sandboxing', () => {
  const html = '<h1>图文旅行</h1><script>throw new Error("must not execute")</script>';
  const result = parseAttachment(Buffer.from(html), '旅行.HTML');
  assert.equal(result.kind, 'html'); assert.equal(result.html, html);
  assert.throws(() => parseAttachment(Buffer.alloc(21 * 1024 * 1024), 'large.html'), /文件过大/);
});

test('Stored output previews bind project/output/file identity and saved metadata', async () => {
  const { previewOutputAttachment } = await import('./app/attachment-preview.mjs');
  const html = Buffer.from('<h1>保存的成果</h1>');
  let reads = 0;
  const snapshot = { project: { id: 'p' }, outputs: { out: { attachments: [{ id: 'f', name: 'guide.html', size: html.length }] } } };
  const store = { snapshot: id => id === 'p' ? snapshot : null, attachment: async (project, file) => { reads++; assert.equal(project, 'p'); assert.equal(file, 'f'); return html; } };
  assert.equal((await previewOutputAttachment(store, 'p', 'out', 'f')).kind, 'html');
  await assert.rejects(previewOutputAttachment(store, 'other', 'out', 'f'), /不存在/);
  await assert.rejects(previewOutputAttachment(store, 'p', 'other', 'f'), /不存在/);
  await assert.rejects(previewOutputAttachment(store, 'p', 'out', '../secret'), /不存在/);
  assert.equal(reads, 1);
  snapshot.outputs.out.attachments[0].size++;
  await assert.rejects(previewOutputAttachment(store, 'p', 'out', 'f'), /不一致/);
});

test('discussion picture preview resolves exact persisted card and task attachment', async () => {
  const { previewDiscussionAttachment } = await import('./app/attachment-preview.mjs');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  const project = {project:{id:'p'},tasks:{t:{attachments:[{id:'photo',name:'photo.png',type:'image/png',size:bytes.length}]}},ideaPlans:{plan:{taskId:'t',discussion:{conclusions:[{id:'c',visualBlocks:[{id:'b',image:{attachmentId:'photo'}}]}]}}}};
  let reads=0; const service={snapshot:async id=>id==='p'?project:null,attachment:async()=>{reads++;return bytes;}};
  assert.equal((await previewDiscussionAttachment(service,'p','plan','c','b')).kind,'image');
  for (const args of [['other','plan','c','b'],['p','plan','other','b'],['p','plan','c','other']]) await assert.rejects(previewDiscussionAttachment(service,...args));
  assert.equal(reads,1,'invalid bindings cannot read stored bytes');
});
