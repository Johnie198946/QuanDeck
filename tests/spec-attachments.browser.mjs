/** Public isolated fixture only. Real native file reader + domain mutation, no model or user database. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSpecAttachmentImporter } from '../desktop/app/spec-attachment-import.mjs';
const { listSpecAttachmentCandidates, recordSpecAttachmentImport } = await import('../desktop/app/workdeck-core.mjs');
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/spec-attachments/ui';
const url = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4287';
await mkdir(output,{recursive:true});
const directory = await mkdtemp(path.join(os.tmpdir(),'quandeck-spec-ui-'));
const file = path.join(directory,'交互规范.md');
const content = '# 完整交互规范\n\n这段正文只存在于本地附件中。\n\n- 键盘操作必须可用。\n- 图片必须记录来源。\n';
await writeFile(file,content);
const browser = await chromium.launch({headless:true,channel:'chrome'});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const {LocalWorkdeckDataSource}=await import('../desktop/app/workdeck-core.mjs');
const api=new LocalWorkdeckDataSource();
const projectId=(await api.createProject({name:'规范附件 · 公开验收',description:'独立测试项目'})).projectId;
const task=(await api.createTaskWithAttachments('编写交互规范',[],projectId)).taskId;
const acceptanceSnapshot=await api.load(), acceptanceTask=acceptanceSnapshot.collaboration.tasks[task], acceptanceSpec=acceptanceSnapshot.collaboration.specs.find(value=>value.key===task&&value.revision===acceptanceTask.specRevision);
const saved=await api.saveTaskOutput({taskSpecRevision:acceptanceSpec.revision,taskId:task,title:'附件规范来源',body:'完整交互规范保存在随附 Markdown 文件中。',attachments:[{id:'native-spec-file',name:'交互规范.md',type:'text/markdown',size:Buffer.byteLength(content)}],status:'published'});
assert(saved.ok,saved.message);
const candidate=(await api.load()).collaboration.tasks[task];
const review=await api.collaborate({projectId,taskId:task,type:'review',idempotencyKey:'confirm-spec-evidence',expectedVersion:candidate.version,payload:{submissionId:candidate.latestSubmissionId,verdict:'accepted',checks:acceptanceSpec.criteria.map(()=>true),note:'已核对规范正文与附件'}});
assert(review.ok,review.message);
const reader=createSpecAttachmentImporter({snapshot:async id=>(await api.listProjects()).find(s=>s.project.id===id),readRun:()=>{throw Error('not used');},attachment:()=>readFile(file),candidates:listSpecAttachmentCandidates,record:recordSpecAttachmentImport,mutate:(id,fn)=>api.mutateRuntimeProject(id,fn)});
try {
  await page.exposeFunction('fixtureCommand',async(name,args)=>api[name](...args));
  await page.exposeFunction('fixtureSpecImport',reader);
  await page.exposeFunction('fixtureBootstrap',()=>Object.fromEntries(storage));
  await page.addInitScript(()=>{
    window.fixtureListeners=[];
    window.quandeckDesktop={platform:'darwin',bootstrap:window.fixtureBootstrap,getConnection:async()=>({baseUrl:location.origin,token:'fixture'}),onStorageError:()=>()=>{},onRunEvent:()=>()=>{},onNavigate:()=>()=>{},onWindowState:()=>()=>{},getWindowState:async()=>({maximized:false,fullscreen:false}),savePreference:async()=>{},command:window.fixtureCommand,importSpecAttachment:window.fixtureSpecImport,onSnapshot:callback=>{window.fixtureListeners.push(callback);return()=>{window.fixtureListeners=window.fixtureListeners.filter(c=>c!==callback);};}};
  });
  api.subscribe(snapshot=>{void page.evaluate(snapshot=>window.fixtureListeners?.forEach(callback=>callback(snapshot)),snapshot).catch(()=>{});});
  await page.goto(url);
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'成果',exact:true}).click();
  const panel=page.getByRole('region',{name:'项目规范与任务来源'});
  await panel.getByRole('button',{name:'建立项目规范'}).click();
  await panel.getByRole('checkbox',{name:/附件规范来源/}).check();
  await panel.getByRole('button',{name:'创建规范修订草案'}).click();
  await panel.getByRole('button',{name:'读取附件正文'}).click();
  await panel.getByRole('textbox',{name:'读取到的完整附件正文'}).waitFor();
  assert.equal(await panel.getByRole('textbox',{name:'读取到的完整附件正文'}).inputValue(),content);
  await panel.getByRole('button',{name:'加入规范草案'}).click();
  assert(await panel.getByRole('checkbox',{name:'我已核对正文、来源及对后续任务的影响'}).isDisabled());
  await panel.getByRole('button',{name:'保存正文'}).click();
  await page.waitForFunction(()=>!document.querySelector('.qd-spec-confirm input')?.disabled);
  await panel.getByRole('checkbox',{name:'我已核对正文、来源及对后续任务的影响'}).check();
  await panel.getByRole('button',{name:'发布项目规范 v1'}).click();
  await panel.getByText('项目规范 v1',{exact:true}).waitFor();
  assert.equal(await panel.getByText(/规范来源有待核对/).count(),0,'generic semantic-review reminder must not mark fresh normative sources as stale');
  await panel.getByText('当前生效正文 · v1',{exact:true}).click();
  await panel.getByText('这段正文只存在于本地附件中。',{exact:true}).waitFor();
  await panel.getByText('已固定 1 份附件来源',{exact:true}).click();
  for(const width of [320,768,1440,1920]){
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:path.join(output,`spec-attachment-${width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);
  }
  const before=await api.load(),created=await api.collaborate({projectId:before.project.id,type:'create_task',idempotencyKey:'spec-context-ui-check',payload:{title:'依据已发布正文执行',goal:'验证正文与来源继承',criteria:['保留正文与来源'],owner:'agent'}});assert(created.ok,created.message);
  const snapshot=await api.load();
  const result={version:snapshot.integration.versions[0],receipts:Object.values(snapshot.integration.attachmentImports)};
  const projected=JSON.parse((await import('../desktop/app/workdeck-core.mjs')).exportCollaboration(snapshot, { includeAudit: true }).json);
  assert(projected.integration.attachmentImports[result.receipts[0].importId].body.includes('键盘操作必须可用。'));
  const built=await api.collaborate({projectId:projectId,type:'build_context',taskId:created.resourceId,idempotencyKey:'context-ui',payload:{}});assert(built.ok,built.message);
  result.context=(await api.load()).collaboration.contextPackages.at(-1).prompt;

  assert(result.context.includes('键盘操作必须可用。')&&result.context.includes(result.receipts[0].fileHash));
  assert.equal(result.version.sections.at(-1).attachmentSources[0].importId,result.receipts[0].importId);
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'checks.json'),JSON.stringify({nativeRead:true,fullTextPreview:true,reviewPublish:true,immutableSource:true,contextInheritsBodyAndHash:true,widths:[320,768,1440,1920],errors},null,2));
  console.log('spec attachment UI: native read, full-text review, save/publish, context inheritance and 4 responsive widths passed');
}finally{await browser.close();await rm(directory,{recursive:true,force:true});}
