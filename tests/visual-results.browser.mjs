import { openProjectTools } from './fixtures/project-tools.mjs';
// Exercise the actual conversation and results screens in an isolated browser profile.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseAttachment } from '../desktop/app/attachment-preview.mjs';
const {zipSync, strToU8} = createRequire(new URL('../desktop/app/package.json', import.meta.url))('fflate');
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/visual-workbench/media';
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4186';
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, channel: 'chrome'});
const page = await browser.newPage({viewport:{width:1440,height:1024}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const chart = {title:'示例 · 两个入口有几辆推车',type:'bar',labels:['东门','西门'],series:[{label:'推车（辆）',values:[8,3]}]};
const graph = {version:1,nodes:[{id:'ticket',label:'入口取票',kind:'start'},{id:'models',label:'二楼看模型'},{id:'exit',label:'东门离馆',kind:'end'}],edges:[{from:'ticket',to:'models'},{from:'models',to:'exit'}]};
const followup = process.env.QUANDECK_TEST_AI_ANSWER ? await readFile(process.env.QUANDECK_TEST_AI_ANSWER, 'utf8') : '<quandeck-conclusion>'+JSON.stringify({summary:'先取票，再去二楼看模型，最后从东门出去。',confirmed:[],open:[],visualBlocks:[{id:'visit-route',kind:'flow',title:'参观顺序（示意图）',flow:graph}]})+'</quandeck-conclusion>';
const code = (id, value) => ['```quandeck-'+id,JSON.stringify(value),'```'].join('\n');
let externalReads = 0;
try {
  const runPage = await browser.newPage({viewport:{width:1100,height:1024}});
  runPage.on('pageerror', error => errors.push(error.message));
  await runPage.addInitScript(text => {
    const run = {runId:'visual-proof',sessionId:'019a7d11-6213-7110-9279-000000000003',title:'周末带孩子看模型',purpose:'discussion',workflow:{planId:'exhibit',conclusionId:'first',approved:false,taskCount:0,draftVersion:1,taskId:'tour',projectId:'museum'},tool:'codex',connectionId:'test',projectPath:'/test/museum',status:'waiting_reply',controls:{canReply:true},events:[{id:'first',at:'2026-11-18T09:00:00Z',reply:{id:'first',text}}]};
    window.quandeckDesktop = {platform:'darwin',bootstrap:async()=>({}),getConnection:async()=>({baseUrl:'http://127.0.0.1:4175',token:'test'}),onStorageError:()=>()=>{},onRunEvent:()=>()=>{},getRun:async()=>run};
  }, followup);
  await runPage.goto(origin+'/?run=visual-proof');
  const flow = runPage.locator('.qd-runtime-transcript [data-visual-block="visit-route"]');
  await flow.getByRole('list').waitFor();
  assert.equal(await flow.locator('ol > li').count(),3);
  await flow.screenshot({path:path.join(output,'ai-discussion-flow.png')});
  const actualScreenshot = await flow.screenshot();
  await runPage.close();

  // The same native parser used by Electron reads the Office ZIP before it reaches the renderer.
  const pageXml = title => strToU8('<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>'+title+'</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  const officeBytes = Buffer.from(zipSync({
    'ppt/presentation.xml':strToU8('<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="257" r:id="first"/><p:sldId id="256" r:id="last"/></p:sldIdLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels':strToU8('<Relationships><Relationship Id="first" Target="slides/slide2.xml"/><Relationship Id="last" Target="slides/slide1.xml"/></Relationships>'),
    'ppt/slides/slide2.xml':pageXml('先到入口取票'), 'ppt/slides/slide1.xml':pageXml('最后从东门离开'),
    'docProps/thumbnail.png':actualScreenshot,
  }));
  const office = await browser.newPage({viewport:{width:1100,height:1000}});
  office.on('pageerror', error => errors.push(error.message));
  const parsed = parseAttachment(officeBytes,'参观卡.pptx');
  await office.addInitScript(data => {
    const run={runId:'office-test',title:'参观卡',purpose:'execution',tool:'codex',status:'done',controls:{},events:[{id:'last',at:'2026-11-18T09:00:00Z',reply:{id:'last',text:'[打开参观卡](参观卡.pptx)'}}]};
    window.quandeckDesktop={platform:'darwin',bootstrap:async()=>({}),getConnection:async()=>({baseUrl:'http://127.0.0.1:4175',token:'test'}),onStorageError:()=>()=>{},onRunEvent:()=>()=>{},getRun:async()=>run,previewRunAttachment:async(runId,src)=>runId==='office-test' && decodeURIComponent(src)==='参观卡.pptx' ? data : Promise.reject(Error('附件绑定不匹配'))};
  },{...parsed,cover:{...parsed.cover,bytes:Array.from(parsed.cover.bytes)},name:'参观卡.pptx',path:'参观卡.pptx',size:officeBytes.length});
  await office.goto(origin+'/?run=office-test');
  await office.getByRole('button',{name:'预览附件：打开参观卡'}).click();
  const preview = office.getByRole('dialog');
  await preview.getByRole('heading',{name:'先到入口取票'}).waitFor();
  await office.waitForFunction(()=>document.querySelector('.qd-office-cover img')?.naturalWidth > 100);
  await preview.screenshot({path:path.join(output,'pptx-cover.png')});
  await preview.getByRole('button',{name:'下一页'}).click();
  await preview.getByRole('heading',{name:'最后从东门离开'}).waitFor();
  assert.equal(await preview.getByRole('button',{name:'下一页'}).isDisabled(),true);
  await office.close();

  const patchPage = await browser.newPage({viewport:{width:1100,height:1000}});
  patchPage.on('pageerror', error => errors.push(error.message));
  const patch = ['diff --git a/guide.md b/guide.md','--- a/guide.md','+++ b/guide.md','@@ -1 +1 @@','-先去西门','+先去东门'].join('\n');
  const patchData = { ...parseAttachment(Buffer.from(patch), '路线.diff'), name:'路线.diff', path:'路线.diff', size:Buffer.byteLength(patch) };
  await patchPage.addInitScript(data => {
    const run={runId:'patch-test',title:'路线变更',purpose:'execution',tool:'codex',status:'done',controls:{},events:[{id:'last',at:'2026-11-18T09:00:00Z',reply:{id:'last',text:'[打开路线差异](路线.diff)'}}]};
    window.quandeckDesktop={platform:'darwin',bootstrap:async()=>({}),getConnection:async()=>({baseUrl:'http://127.0.0.1:4175',token:'test'}),onStorageError:()=>()=>{},onRunEvent:()=>()=>{},getRun:async()=>run,previewRunAttachment:async (runId, src)=>{
      if (runId !== 'patch-test' || decodeURIComponent(src) !== data.name) throw Error('附件绑定不匹配');
      return data;
    }};
  }, patchData);
  await patchPage.goto(origin+'/?run=patch-test');
  await patchPage.getByRole('button',{name:'预览附件：打开路线差异'}).click();
  const diff = patchPage.getByRole('region',{name:'代码差异'});
  await diff.getByText('+先去东门',{exact:true}).waitFor();
  await diff.getByText('-先去西门',{exact:true}).waitFor();
  await diff.screenshot({path:path.join(output,'code-diff.png')});
  await patchPage.close();

  await page.route('https://visual-example.invalid/**', async route => { externalReads++; await route.fulfill({contentType:'image/png',body:actualScreenshot}); });
  await page.goto(origin);
  const projects = page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你管',exact:true});
  const tabs = page.getByRole('navigation',{name:'项目页签'});
  await projects.click();
  await openProjectTools(page);
  await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
  await page.getByLabel('项目名称').fill('图文验收');
  await page.getByLabel('项目目标').fill('比较市集入口并附参观顺序示意图');
  await page.getByRole('button',{name:'理解需求',exact:true}).last().click();
  await page.getByRole('button',{name:'校准任务',exact:true}).click();
  await page.getByRole('button',{name:'添加任务',exact:true}).click();
  await page.getByLabel('任务名称').fill('周末集市参观指南');
  await page.getByLabel('验收标准').fill('图表和动线可读');
  await page.getByRole('button',{name:'确认创建',exact:true}).click();
  await tabs.getByRole('button',{name:'任务',exact:true}).click();
  await page.getByRole('button',{name:'周末集市参观指南',exact:true}).click();
  await page.getByRole('button',{name:'提交候选成果',exact:true}).first().click();
  await page.getByLabel('成果标题').fill('周末集市参观指南');
  const body = ['从东门进，有更多推车可借。',code('chart',chart),'![参观顺序](参观顺序.png)','![子目录的图](<deliverables/参观顺序.png>)','![已失效的图片](../outside.png)','![来源图片](https://visual-example.invalid/photo)',code('chart',{title:'缺少数据'})].join('\n\n');
  await page.getByLabel('周末集市参观指南交付正文').fill(body);
  await page.locator('dialog input[type=file]').setInputFiles({name:'参观顺序.png',mimeType:'image/png',buffer:actualScreenshot});
  await page.getByRole('button',{name:'提交待验收',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  // Simulate reopening a persisted runtime artifact. Delivery-contract tests verify
  // the real registration writes this canonical path alongside the immutable attachment ID.
  await page.evaluate(() => {
    const key='quandeck.projects.v1', library=JSON.parse(localStorage.getItem(key));
    const snap=library.projects[library.activeProjectId];
    const result=Object.values(snap.outputs).find(o=>o.title==='周末集市参观指南');
    const artifact=snap.collaboration.artifacts.find(a=>a.outputId===result.id);
    for (const saved of [result,artifact]) saved.attachments[0].projectRelativePath='deliverables/参观顺序.png';
    localStorage.setItem(key, JSON.stringify(library));
  });
  await page.reload();
  await projects.click();
  await openProjectTools(page);
  await tabs.getByRole('button',{name:'成果',exact:true}).click();
  await page.locator('.qd-map-task-directory > summary').click();
  await page.locator('.qd-map-task-directory').getByRole('button',{name:'周末集市参观指南',exact:true}).click();
  const doc = page.locator('.qd-delivery-document');
  const bars = doc.locator('.qd-discussion-chart');
  await bars.getByRole('img',{name:chart.title}).waitFor();
  assert.equal(await bars.locator('svg rect').count(),2);
  await bars.getByText('查看数据表').click();
  assert.deepEqual(await bars.locator('tbody td').allTextContents(),['8','3']);
  await bars.getByText('查看数据表').click();
  await bars.screenshot({path:path.join(output,'result-chart.png')});
  const picture = doc.getByRole('button',{name:'放大图片：参观顺序'});
  await picture.scrollIntoViewIfNeeded();
  await picture.click();
  await page.getByRole('dialog').getByRole('img',{name:'参观顺序'}).waitFor();
  await page.keyboard.press('Escape');
  const nested = doc.getByRole('button',{name:'放大图片：子目录的图'});
  await nested.scrollIntoViewIfNeeded(); await nested.click();
  await page.getByRole('dialog').getByRole('img',{name:'子目录的图'}).waitFor();
  await page.keyboard.press('Escape');
  await doc.getByText('已失效的图片（请从来源会话查看）').waitFor();
  assert.equal(externalReads,0,'external photos require user interaction');
  await doc.getByRole('button',{name:'加载图片',exact:true}).click();
  await doc.getByRole('img',{name:'来源图片',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('img[alt="来源图片"]')?.naturalWidth > 100);
  assert.equal(externalReads,1,'external photo was loaded exactly once');
  await doc.getByText('图表暂时无法显示 · 查看原数据').click();
  await doc.locator('code').filter({hasText:'缺少数据'}).waitFor();
  const bindings = await page.evaluate(async () => {
    const {outputPicture}=await import('/src/components/outputs/ArtifactThumbnail.tsx');
    const file={id:'one',name:'同名.png',type:'image/png',size:45};
    const scope={projectId:'p',outputId:'o',files:[file,{...file,id:'two',projectRelativePath:'deliverables/同名.png'}]};
    return [outputPicture(scope,'同名.png')?.id,outputPicture(scope,'attachment:two')?.id,outputPicture(scope,'../同名.png')?.id,outputPicture(scope,'attachment:other')?.id,outputPicture(scope,'deliverables/同名.png')?.id,outputPicture(scope,'unrelated/同名.png')?.id,outputPicture(scope,'https://example.test/同名.png')?.id,outputPicture(scope,'deliverables/%2e%2e/同名.png')?.id];
  });
  assert.deepEqual(bindings,[undefined,'two',undefined,undefined,'two',undefined,undefined,undefined]);
  await page.setViewportSize({width:320,height:850});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  const checks={actualConversationFlow:true,pptxSourceCoverAndPageOrder:true,codeDiff:true,outputChart:true,registeredInlineImage:true,zoom:true,scopedAttachmentIds:true,verifiedNestedPicture:true,remoteReadsBeforeClick:0,remoteReadsAfterClick:1,invalidChartRecoverable:true,narrowScreen:320,pageErrors:errors};
  await writeFile(path.join(output,'visual-results-checks.json'),JSON.stringify(checks,null,2)); console.log(JSON.stringify(checks));
} catch(error) {
  console.error((await page.locator('body').innerText()).slice(-3700));
  await page.screenshot({path:path.join(output,'visual-results-failure.png')});
  throw error;
} finally { await browser.close(); }
