import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage, exportCollaboration } from '../src/data/collaboration';
import { applyIntegration, inspectIntegration, type IntegrationCommand } from '../src/data/resultIntegration';
import { listSpecAttachmentCandidates, recordSpecAttachmentImport, specAttachmentPin, type SpecAttachmentImport } from '../src/data/specAttachments';
import { currentProjectSpec } from '../src/data/specLineage';
import { BUSINESS_COMMANDS } from '../src/data/commands';

async function main() {
  const { createSpecAttachmentImporter } = await (new Function('url', 'return import(url)'))(pathToFileURL(path.join(process.cwd(), 'desktop/app/spec-attachment-import.mjs')).href);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quandeck-spec-import-'));
  try {
    const root = path.join(directory, 'project'); await mkdir(root);
    const s = createEmptySnapshot({ id: 'public-spec-fixture', name: '附件规范验收' });
    let serial = 0;
    const domain = (type: Parameters<typeof applyCollaboration>[1]['type'], payload: Record<string, unknown>, key?: string, actor: Parameters<typeof applyCollaboration>[2] = {kind:'human'}) => {
      const result = applyCollaboration(s, { projectId: s.project.id, idempotencyKey: `d-${++serial}`, type, taskId: key, expectedVersion: key ? s.collaboration?.tasks[key]?.version : undefined, payload }, actor);
      assert(result.ok, result.message); return result;
    };
    const create = (title: string) => domain('create_task', { title, goal: title, criteria: ['核对正文'], owner: 'agent' }).resourceId!;
    const accepted = (body: string) => {
      const key = create('设计文件 ' + serial), claim = domain('claim', { executor: 'codex' }, key, { kind: 'service' });
      const run = s.collaboration!.runs[claim.resourceId!];
      const result = domain('submit', {title:'设计与交互说明',body,sourceIds:[],unresolved:[],nextSteps:[]}, key, {kind:'runtime',runId:run.id,claimEpoch:run.claimEpoch});
      domain('review', {submissionId:result.resourceId,verdict:'accepted',checks:[true],note:'核对已通过'}, key);
      const artifact = s.collaboration!.artifacts.find(a => a.id === s.collaboration!.tasks[key].acceptedArtifactId)!;
      (s.collaboration!.executionLinks ??= []).push({id:'execution:'+run.id,projectId:s.project.id,taskKey:key,taskId:key,agentId:'codex',tool:'codex',sessionId:'s-'+key,sourceSessionId:'source-'+key,runId:run.id,runtimeRunId:'native-'+key,at:new Date().toISOString(),provenance:'receipt'});
      return { key, artifact };
    };
    const content = '# 规范正文\n\n图片必须有来源。\n键盘操作必须可用。\n';
    await writeFile(path.join(root, '设计与交互.md'), content);
    const source = accepted('[完整规范](设计与交互.md)\n\n[网络规范](https://example.invalid/spec.md)\n\n```md\n[示例](should-not-read.md)\n```');
    const candidate = listSpecAttachmentCandidates(s, source.artifact.id)[0];
    assert.equal(listSpecAttachmentCandidates(s, source.artifact.id).length, 1, 'network and fenced links are never local import candidates');
    let wrongBinding = false, revokeBeforeRecord = false;
    const reader = createSpecAttachmentImporter({
      snapshot: () => s,
      readRun: (id: string) => ({ projectId: wrongBinding ? 'another-project' : s.project.id, taskId: id.replace('native-', ''), projectPath: root }),
      attachment: () => Buffer.from(content), candidates: listSpecAttachmentCandidates, record: recordSpecAttachmentImport,
      mutate: (_id: string, operation: (snapshot: typeof s) => void) => {
        if (revokeBeforeRecord) s.collaboration!.tasks[source.key].status = 'paused';
        operation(s);
      },
    });
    const imported: SpecAttachmentImport = await reader(s.project.id, source.artifact.id, candidate.id);
    assert.equal(imported.body, content, 'full text is read, not a preview excerpt');
    assert.equal(imported.path, '设计与交互.md');
    assert.equal(imported.fileHash, createHash('sha256').update(content).digest('hex'));
    assert.equal(imported.artifactId, source.artifact.id);
    assert.deepEqual(await reader(s.project.id, source.artifact.id, candidate.id), imported, 'same bytes and identity reuse immutable import receipt');
    assert.equal(Object.keys(s.integration!.attachmentImports!).length, 1);
    assert.equal(currentProjectSpec(s), undefined, 'reading a file is not publication or acceptance');
    assert(!(BUSINESS_COMMANDS as readonly string[]).includes('recordSpecAttachmentImport'), 'renderer cannot manufacture native receipts');
    await assert.rejects(reader(s.project.id, source.artifact.id, 'arbitrary-path'), /已验收/);
    wrongBinding = true; await assert.rejects(reader(s.project.id, source.artifact.id, candidate.id), /不匹配/); wrongBinding = false;

    let counter = 0;
    const integrate = (type: IntegrationCommand['type'], payload: IntegrationCommand['payload'], draftId?: string) => applyIntegration(s, { projectId:s.project.id, idempotencyKey:`i-${++counter}`, type, payload, draftId, expectedRevision:draftId?s.integration!.drafts[draftId].revision:undefined });
    const section = {id:'file-spec',title:'设计规范',body:imported.body,sourceIds:[source.artifact.id],attachmentSources:[specAttachmentPin(imported)]};
    const forged = integrate('create',{purpose:'project_spec',title:'项目规范',sourceIds:[source.artifact.id],sections:[{...section,attachmentSources:[{...specAttachmentPin(imported),fileHash:'0'.repeat(64)}]}]});
    assert.equal(forged.ok, false, 'file fingerprint cannot be changed by renderer');
    assert.equal(integrate('create',{purpose:'project_spec',title:'项目规范',sourceIds:[source.artifact.id],sections:[{...section,attachmentSources:[{...specAttachmentPin(imported),importId:'missing'}]}]}).ok, false);
    const draft = integrate('create',{purpose:'project_spec',title:'项目规范',sourceIds:[source.artifact.id],sections:[section]}); assert(draft.ok,draft.message);
    assert.equal(integrate('publish',{expectedBundleVersion:0},draft.draftId).ok, false, 'review remains required');
    const published = integrate('publish',{expectedBundleVersion:0,reviewed:true},draft.draftId); assert(published.ok,published.message);
    const fixed = currentProjectSpec(s)!;
    const exported = exportCollaboration(s, { includeAudit: true }), json = JSON.parse(exported.json);
    assert.equal(json.integration.attachmentImports[imported.importId].body, content);
    assert.equal(json.integration.versions[0].sections[0].attachmentSources[0].fileHash, imported.fileHash);
    assert(exported.ledger.includes(content.trim()) && exported.ledger.includes(imported.fileHash));
    assert(exported.blackboard.includes(fixed.id));
    assert.equal(fixed.sections[0].attachmentSources![0].fileHash, imported.fileHash);
    assert.equal(fixed.sections[0].body, content.trim());
    const next = create('依据完整文件规范执行'), context = buildContextPackage(s, next);
    assert(context.prompt.includes('键盘操作必须可用。') && context.prompt.includes(imported.fileHash) && context.prompt.includes('设计与交互.md'));
    assert.equal(context.projectSpec?.versionId, fixed.id);
    await writeFile(path.join(root, '设计与交互.md'), '# 原文件的新版本\n不得偷偷覆盖已发布规范。');
    const changed: SpecAttachmentImport = await reader(s.project.id, source.artifact.id, candidate.id);
    assert.notEqual(changed.importId, imported.importId);
    assert.equal(currentProjectSpec(s)!.hash, fixed.hash);
    assert.equal(s.integration!.attachmentImports![imported.importId].body, content);
    assert(buildContextPackage(s, next).prompt.includes('键盘操作必须可用。'), 'context is immutable published body, never rereads a mutable file');
    const revision = integrate('create',{purpose:'project_spec',bundleId:fixed.bundleId}); assert(revision.ok, revision.message);
    const inspect = inspectIntegration(s, revision.draftId!);
    const edited = integrate('save',{title:inspect.revision.title,sourceIds:[source.artifact.id],sections:inspect.revision.sections.map(v=>({...v,body:v.body+'\n用户核对后的补充要求。'}))},revision.draftId); assert(edited.ok, edited.message);
    assert.equal(s.integration!.attachmentImports![imported.importId].body, content, 'editing the normative draft does not forge the original file');

    const extra = async (file: string, value?: string | Buffer) => {
      if(value !== undefined) await writeFile(path.join(root, file), value);
      const target = accepted(`[规范](${file})`), link = listSpecAttachmentCandidates(s,target.artifact.id)[0];
      return () => reader(s.project.id,target.artifact.id,link.id);
    };
    await writeFile(path.join(directory,'outside.md'),'outside');
    const outside = await extra('../outside.md'); await assert.rejects(outside(), /当前项目/);
    await symlink(path.join(directory,'outside.md'),path.join(root,'escape.md')); const linked = await extra('escape.md'); await assert.rejects(linked(), /当前项目/);
    const invalid = await extra('invalid.md', Buffer.from([0xc3,0x28])); await assert.rejects(invalid(), /UTF-8/);
    const big = await extra('large.txt', 'a'.repeat(300001)); await assert.rejects(big(), /300000/);
    const nullByte = await extra('binary.txt', 'text\0private'); await assert.rejects(nullByte(), /无效字符/);
    const empty = await extra('empty.txt', '\n  '); await assert.rejects(empty(), /为空/);
    const missing = await extra('missing.txt'); await assert.rejects(missing(), /ENOENT/);
    const encoded = await extra(encodeURIComponent('设计与交互.md')); assert((await encoded()).body.includes('新版本'));
    const absolute = accepted(`[规范](<${pathToFileURL(path.join(await realpath(root),'设计与交互.md')).href}>)`);
    assert((await reader(s.project.id,absolute.artifact.id,listSpecAttachmentCandidates(s,absolute.artifact.id)[0].id)).body.includes('新版本'));
    const other = accepted('附件成果');
    const attachment = {id:'stored-text',name:'registered.md',size:Buffer.byteLength(content),type:'text/markdown'};
    other.artifact.attachments=[attachment]; other.artifact.outputId='stored-output';
    s.outputs['stored-output']={id:'stored-output',taskId:other.key,title:'文件',body:'附件成果',status:'published',at:new Date().toISOString(),attachments:[attachment]} as any;
    const registered=listSpecAttachmentCandidates(s,other.artifact.id)[0];
    const file=await reader(s.project.id,other.artifact.id,registered.id);assert.equal(file.body,content);assert.equal(file.attachmentId,attachment.id);assert.equal(file.path,undefined);
    revokeBeforeRecord=true; await assert.rejects(reader(s.project.id,source.artifact.id,candidate.id),/来源已变化/);
    assert.equal(s.integration!.attachmentImports![imported.importId].body,content);
    console.log('spec attachments: native file read → immutable receipt → review → publish → context; source binding, UTF-8, size, path/symlink, tamper and stale-source boundaries passed');
  } finally { await rm(directory,{recursive:true,force:true}); }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
