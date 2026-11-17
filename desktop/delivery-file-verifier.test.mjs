import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeliveryFileVerifier, validateDeliveryBytes } from './app/delivery-file-verifier.mjs';

async function setup(t, format='md') {
  const directory=await mkdtemp(path.join(tmpdir(),'qd-delivery-file-')),root=path.join(directory,'project');
  const {mkdir}=await import('node:fs/promises');await mkdir(root);t.after(()=>rm(directory,{recursive:true,force:true}));
  const files=new Map(),project={project:{id:'p'},tasks:{t:{attachments:[]}},collaboration:{artifacts:[],goalPlans:{plan:[{slots:[{id:'s',title:'说明文档',taskId:'t',taskKey:'t',contract:{revision:1,kind:'file',format}}]}]}}};
  const verify=createDeliveryFileVerifier({snapshot:async()=>project,readRun:async()=>({projectPath:root,projectId:'p',taskId:'t'}),store:{saveAttachment:async(_id,file)=>{const id=String(files.size+1);files.set(id,Buffer.from(file.bytes));return {id,name:file.name};},attachment:async(_id,id)=>files.get(id)}});
  return {root,directory,files,project,verify,input:{runId:'run',projectId:'p',taskId:'t',items:[{slotId:'s',contractRevision:1,path:`result.${format}`}]}};
}
test('freezes actual bytes, hash and text; later source edits do not modify frozen copy',async t=>{
  const s=await setup(t);await writeFile(path.join(s.root,'result.md'),'# 已核对规范\n内容 A');
  const [receipt]=await s.verify(s.input);assert.equal(receipt.name,'result.md');assert.match(receipt.sha256,/^[a-f0-9]{64}$/);assert.equal(receipt.bytes,Buffer.byteLength('# 已核对规范\n内容 A'));assert.equal(receipt.textBody,'# 已核对规范\n内容 A');
  await writeFile(path.join(s.root,'result.md'),'内容 B');assert.equal(s.files.get(receipt.attachmentId).toString(),'# 已核对规范\n内容 A');
});
test('rejects missing, empty, mismatched extension and fake binary files',async t=>{
  const s=await setup(t,'pdf');await assert.rejects(s.verify(s.input),/ENOENT/);
  await writeFile(path.join(s.root,'result.pdf'),'');await assert.rejects(s.verify(s.input),/普通文件/);
  await writeFile(path.join(s.root,'result.pdf'),'not a pdf');await assert.rejects(s.verify(s.input),/不是 PDF/);
  await writeFile(path.join(s.root,'wrong.txt'),'%PDF-1.7');await assert.rejects(s.verify({...s.input,items:[{slotId:'s',contractRevision:1,path:'wrong.txt'}]}),/要求 pdf/);assert.equal(s.files.size,0);
});
test('rejects path and symlink escape, wrong owner and old revision',async t=>{
  const s=await setup(t);await writeFile(path.join(s.directory,'outside.md'),'secret');await symlink(path.join(s.directory,'outside.md'),path.join(s.root,'escape.md'));
  for(const value of ['../outside.md','escape.md'])await assert.rejects(s.verify({...s.input,items:[{slotId:'s',contractRevision:1,path:value}]}),/不在当前项目/);
  await assert.rejects(s.verify({...s.input,taskId:'another'}),/绑定不一致/);
  await assert.rejects(s.verify({...s.input,items:[{slotId:'s',contractRevision:2,path:'result.md'}]}),/旧版清单/);assert.equal(s.files.size,0);
});
test('attachment IDs must be bound to this task, never arbitrary library IDs',async t=>{
  const s=await setup(t);s.files.set('unrelated',Buffer.from('secret'));
  await assert.rejects(s.verify({...s.input,items:[{slotId:'s',contractRevision:1,attachmentId:'unrelated'}]}),/未登记/);
  s.project.tasks.t.attachments.push({id:'allowed',name:'result.md'});s.files.set('allowed',Buffer.from('valid'));
  const [receipt]=await s.verify({...s.input,items:[{slotId:'s',contractRevision:1,attachmentId:'allowed'}]});assert.equal(receipt.attachmentId,'allowed');
});
test('text validation rejects invalid UTF8 and malformed JSON',()=>{
  assert.throws(()=>validateDeliveryBytes(Buffer.from([255,254]),'md'),/UTF-8/);
  assert.throws(()=>validateDeliveryBytes(Buffer.from('{oops'),'json'),/JSON/);
  assert.equal(validateDeliveryBytes(Buffer.from('{"ok":true}'),'json'),'application/json');
});
