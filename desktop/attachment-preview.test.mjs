import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath, truncate } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
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
test('an isolated run can preview its pinned native inputs and its own results only', async t => {
  const {prepareTaskFiles}=await import('./app/task-attachments.mjs');
  const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'quandeck-isolated-attachment-')));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const source=path.join(temp,'source'), directory=path.join(temp,'task');
  await Promise.all([mkdir(source),mkdir(directory)]);
  const binding={connectionId:'c',projectPath:source};
  const input={projectId:'project',taskId:'task',connectionId:'c',ids:['file']};
  const bytes=Buffer.from('original');
  const project={project:{id:'project'},tasks:{task:{attachments:[{id:'file',name:'input.md',size:bytes.length}]}},runtimeConnections:{agent:binding}};
  const pins=await prepareTaskFiles({attachment:()=>bytes},project,binding,input);
  const service=createAttachmentPreview({readRun:()=>({projectId:'project',projectPath:directory,taskWorkspace:{source,directory}}),readPreparedInputs:run=>pins});
  await writeFile(path.join(directory,'out.md'),'result');
  assert.equal((await service.preview('run','out.md')).text,'result');
  assert.equal((await service.preview('run',pins[0].path)).text,'original');
  assert.equal((await service.resolve('run',pathToFileURL(pins[0].path).href)).size,bytes.length);
  const sibling=path.join(path.dirname(pins[0].path),'sibling.md');
  await writeFile(sibling,bytes);
  await assert.rejects(service.preview('run',sibling),/当前项目/);
  await writeFile(pins[0].path,'altered');
  await assert.rejects(service.preview('run',pins[0].path),/派发时/);
  await assert.rejects(service.resolve('run',pins[0].path),/派发时/);
});
test('Selected files cannot escape through a symlinked attachment directory', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'quandeck-preview-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'), other = path.join(base, 'other'); await mkdir(root); await mkdir(other);
  const source = path.join(base, 'note.txt'); await writeFile(source, 'hello'); await symlink(other, path.join(root, '.quandeck'));
  const service = createAttachmentPreview({ readRun: () => ({ projectPath: root }) });
  await assert.rejects(service.importFiles('run', [source]), /目录无效/);
});

test('Markdown attachment paths resolve encoded Unicode once while preserving literal percent filenames', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'quandeck-preview-url-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, '示例项目'), directory = path.join(root, '图文资料'); await mkdir(directory, { recursive: true });
  const image = path.join(directory, '小窗 截图.png'), literal = path.join(directory, '进度%20完成.txt'), spaced = path.join(directory, '进度 完成.txt');
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(literal, 'literal percent'); await writeFile(spaced, 'space');
  const service = createAttachmentPreview({ readRun: () => ({ projectPath: root }) });
  for (const value of [image, encodeURI(image), encodeURI(path.relative(root, image)), pathToFileURL(image).href]) {
    assert.equal((await service.preview('run', value)).kind, 'image');
    assert.equal((await service.resolve('run', value)).path, await realpath(image));
  }
  for (const value of [literal, encodeURI(literal), pathToFileURL(literal).href]) assert.equal((await service.preview('run', value)).text, 'literal percent');
  const percent = path.join(directory, '100%完成.txt'); await writeFile(percent, 'percent');
  assert.equal((await service.preview('run', percent)).text, 'percent');
  assert.equal((await service.preview('run', pathToFileURL(percent).href)).text, 'percent');
  const encodedOnce = path.join(root, '%E5%9B%BE.txt'); await writeFile(encodedOnce, 'not twice');
  assert.equal((await service.preview('run', pathToFileURL(encodedOnce).href)).text, 'not twice');
  await assert.rejects(service.preview('run', encodeURI(encodeURI(image))), { code: 'ENOENT' });
});

test('Encoded attachment URLs retain realpath boundaries and reject remote URLs and decoded escapes', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'quandeck-preview-boundary-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'), other = path.join(base, '外部.txt'); await mkdir(root); await writeFile(other, 'outside');
  await symlink(other, path.join(root, '链接.txt'));
  const service = createAttachmentPreview({ readRun: () => ({ projectPath: root }) });
  for (const method of ['preview', 'resolve']) {
    for (const file of [encodeURI(other), pathToFileURL(other).href, '%2e%2e/%E5%A4%96%E9%83%A8.txt', encodeURI('链接.txt')]) await assert.rejects(service[method]('run', file), /当前项目/);
    for (const file of ['file://remote.invalid/project/file.txt', pathToFileURL(root).href + '/bad%2Ffile.txt', pathToFileURL(root).href + '/bad%00.txt', 'bad%00.txt', 'bad%20%broken.txt']) await assert.rejects(service[method]('run', file), /路径无效|链接无效/);
    await assert.rejects(service[method]('run', '%252e%252e/%E5%A4%96%E9%83%A8.txt'), { code: 'ENOENT' });
  }
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

function publishedPreviewFixture() {
  const bytes = Buffer.from('<h1>Original</h1>');
  const receipt = { slotId: 'slot', contractRevision: 1, kind: 'file', format: 'html', attachmentId: 'f',
    fileName: 'published.html', bytes: bytes.length, contentHash: createHash('sha256').update(bytes).digest('hex'), verifiedAt: '2026-11-17T00:00:00Z' };
  const artifact = { id: 'artifact-v1', outputId: 'out', key: 'task', hash: 'artifact-body-hash', deliveryReceipts: [structuredClone(receipt)] };
  const version = { id: 'published-v1', sourcePins: [{ artifactId: artifact.id, artifactHash: artifact.hash, taskKey: artifact.key }],
    deliveryPublication: { scopeKey: 'project:p', items: [{ slotId: 'slot', artifactId: artifact.id,
      contract: { revision: 1, kind: 'file', format: 'html' }, receipt: structuredClone(receipt) }] } };
  // Native storage reloads JSON. The preview must not depend on in-memory object identity.
  const snapshot = JSON.parse(JSON.stringify({ project: { id: 'p' }, outputs: { out: { attachments: [{ id: 'f', name: 'current.html', size: bytes.length }] } },
    collaboration: { artifacts: [artifact] }, integration: { versions: [version] } }));
  const reference = { versionId: version.id, artifactId: artifact.id, slotId: receipt.slotId };
  let reads = 0, storedBytes = bytes;
  const store = { snapshot: id => id === 'p' ? snapshot : null, attachment: async (project, file) => {
    reads++; assert.equal(project, 'p'); assert.equal(file, 'f'); return storedBytes;
  } };
  return { snapshot, reference, store, bytes, reads: () => reads, replaceBytes: value => { storedBytes = value; } };
}

test('Published attachment preview survives current output edits and deletion using the frozen receipt', async () => {
  const { previewOutputAttachment } = await import('./app/attachment-preview.mjs');
  const f = publishedPreviewFixture();
  f.snapshot.outputs.out = { attachments: [{ id: 'replacement', name: 'changed.pdf', size: 999 }] };
  const edited = await previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference);
  assert.equal(edited.name, 'published.html'); assert.equal(edited.html, f.bytes.toString());
  delete f.snapshot.outputs.out;
  // A later artifact for the same output cannot replace the exact published artifact.
  f.snapshot.collaboration.artifacts.push({ ...f.snapshot.collaboration.artifacts[0], id: 'artifact-v2', hash: 'new-body-hash', deliveryReceipts: [] });
  const deleted = await previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference);
  assert.equal(deleted.html, f.bytes.toString()); assert.equal(f.reads(), 2);
  await assert.rejects(previewOutputAttachment(f.store, 'p', 'out', 'f'), /不存在/, 'ordinary previews still require a current output');
});

test('Published attachment identity is checked before reading any bytes and never falls back to current output', async () => {
  const { previewOutputAttachment } = await import('./app/attachment-preview.mjs');
  const f = publishedPreviewFixture();
  for (const reference of [null, {}, { ...f.reference, versionId: 'unknown' }, { ...f.reference, artifactId: 'other' },
    { ...f.reference, slotId: 'other' }, { ...f.reference, path: '/private/file' }]) {
    await assert.rejects(previewOutputAttachment(f.store, 'p', 'out', 'f', reference), /引用无效|不匹配/);
  }
  for (const args of [['other', 'out', 'f'], ['p', 'other', 'f'], ['p', 'out', 'other']]) {
    await assert.rejects(previewOutputAttachment(f.store, ...args, f.reference), /不存在|不匹配/);
  }
  const v = f.snapshot.integration.versions[0], artifact = f.snapshot.collaboration.artifacts[0];
  v.sourcePins[0].artifactHash = 'not-the-published-artifact';
  await assert.rejects(previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference), /不匹配/);
  v.sourcePins[0].artifactHash = artifact.hash;
  artifact.deliveryReceipts[0].contentHash = '0'.repeat(64);
  await assert.rejects(previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference), /不匹配/);
  f.snapshot.project.deletedAt = '2026-11-17T00:01:00Z';
  await assert.rejects(previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference), /不存在/);
  assert.equal(f.reads(), 0);
});

test('Published attachment bytes must match both frozen length and SHA256, including same-length corruption', async () => {
  const { previewOutputAttachment } = await import('./app/attachment-preview.mjs');
  const f = publishedPreviewFixture();
  f.replaceBytes(Buffer.from('<h1>Modified</h1>'));
  assert.equal(Buffer.byteLength('<h1>Modified</h1>'), f.bytes.length);
  await assert.rejects(previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference), /校验失败/);
  f.replaceBytes(Buffer.from('short'));
  await assert.rejects(previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference), /不一致/);
  f.replaceBytes(f.bytes);
  assert.equal((await previewOutputAttachment(f.store, 'p', 'out', 'f', f.reference)).kind, 'html');
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

test('Office previews keep embedded covers and show PowerPoint pages in declared order', () => {
  const picture = Uint8Array.from([137,80,78,71,13,10,26,10,0,1,2,3]);
  const pages = '<p:presentation xmlns:p="urn:ppt" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="two" id="257"/><p:sldId id="256" r:id="one"/></p:sldIdLst></p:presentation>';
  const slide = text => strToU8('<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  const pptx = Buffer.from(zipSync({'ppt/presentation.xml':strToU8(pages), 'ppt/_rels/presentation.xml.rels':strToU8('<Relationships><Relationship Id="one" Target="slides/slide1.xml"/><Relationship Id="two" Target="slides/slide2.xml"/></Relationships>'), 'ppt/slides/slide1.xml':slide('结束'), 'ppt/slides/slide2.xml':slide('开场'), 'docProps/thumbnail.png':picture}));
  const result = parseAttachment(pptx, '图文手册.pptx');
  assert.equal(result.kind,'slides');
  assert.deepEqual(result.slides,[['开场'],['结束']]);
  assert.deepEqual(result.cover.bytes,picture);
});

test('笔记预览按原笔记查找文件，读取已保存内容', async () => {
  const { previewKnowledgeAttachment } = await import('./app/attachment-preview.mjs');
  const file = { id: 'brief', name: '小组行程.docx', size: docx.length };
  const readLibrary = () => ({ notes: [{ id: 'trip', attachments: [file] }, { id: 'other', attachments: [] }] });
  const deps = {readLibrary, readBytes: async id => { assert.equal(id, 'brief'); return docx; }};
  const preview = await previewKnowledgeAttachment(deps, 'trip', 'brief');
  assert.equal(preview.kind, 'document');
  assert.equal(preview.blocks[0].text, '旅行信息确认');
  await assert.rejects(previewKnowledgeAttachment({...deps, readBytes: assert.fail}, 'other', 'brief'), /这篇笔记/);
  await assert.rejects(previewKnowledgeAttachment({...deps, readBytes: async () => Buffer.alloc(0)}, 'trip', 'brief'), /记录不一致/);
});

test('旧 Office 缩略图通过临时副本读取，成功或失败后均清除', async () => {
  const { previewKnowledgeAttachment } = await import('./app/attachment-preview.mjs');
  const readLibrary = () => ({notes:[{id:'one',attachments:[{id:'sheet',name:'行程.xls',size:4}]}]});
  const readBytes = async () => Buffer.from('data');
  for (const fail of [false,true]) {
    let temporary;
    const thumbnail = async file => {
      temporary = file;
      assert.equal(path.extname(file), '.xls');
      assert.equal((await readFile(file)).toString(), 'data');
      if (fail) throw Error('无法读取缩略图');
      return Uint8Array.of(1);
    };
    const operation = previewKnowledgeAttachment({readLibrary,readBytes,thumbnail}, 'one', 'sheet');
    if (fail) await assert.rejects(operation, /无法读取/);
    else assert.equal((await operation).kind, 'image');
    await assert.rejects(readFile(temporary), {code:'ENOENT'});
  }
});

test('An outcome file is readable from its original note and cannot be opened through another note', async () => {
  const {previewKnowledgeAttachment}=await import('./app/attachment-preview.mjs');
  const bytes=Buffer.from('已确认的两组数据');
  const file={id:'received',name:'钉选材料.txt',type:'text/plain',size:bytes.length};
  const library={notes:[{id:'original',attachments:[],todos:[{outcome:{files:[file]}}]}, {id:'other',attachments:[]}]};
  const service={readLibrary:()=>library,readBytes:id=>{assert.equal(id,file.id);return bytes;}};
  assert.equal((await previewKnowledgeAttachment(service,'original',file.id)).text,bytes.toString());
  await assert.rejects(previewKnowledgeAttachment(service,'other',file.id),/未找到/);
});
