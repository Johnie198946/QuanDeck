/** Isolated browser regression: visual blocks and feedback receipts use a fixture ledger. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/discussion-canvas';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QUANDECK_BROWSER_EXECUTABLE ? { executablePath: process.env.QUANDECK_BROWSER_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const blocks = [
 { id: 'area-options', hash: 'options-v1', kind: 'comparison', title: '先选更喜欢的旅行节奏', body: '两种方向都保留曼谷与芭提雅。选一种更符合你的感觉，具体酒店和交通再分任务核对。', sources: [], options: [
  { id: 'old-town', title: '老城慢游', body: '住在老城附近，把时间留给街巷、河边和本地生活。', image: {url:'https://images.example.org/old-town.jpg',alt:'老城方向测试图片',caption:'浏览器测试素材，不是实际景点照片'},facts:[{label:'节奏',value:'步行与短途打车'},{label:'取舍',value:'街区氛围优先，需核对夜间安静程度'}],sources:[{label:'测试图片来源',url:'https://example.org/old-town'}]},
  { id: 'river', title: '河畔放松', body: '用河边散步和艺术空间串起曼谷，减少每天换地方的次数。', image: {url:'https://images.example.org/river.jpg',alt:'河畔方向测试图片',caption:'浏览器测试素材，不是实际酒店照片'},facts:[{label:'节奏',value:'散步与室内休息交替'},{label:'取舍',value:'舒适度优先，后续比较交通与房价'}],sources:[{label:'测试图片来源',url:'https://example.org/river'}]}
 ]},
 { id:'route',hash:'route-v1',kind:'map',title:'机场到老城的路线方向',body:'当前只核对起终点；实际车程、酒店入口和费用留给路线任务。',sources:[{label:'Google Maps',url:'https://www.google.com/maps/dir/Suvarnabhumi/Khao+San+Road'}],map:{url:'https://www.google.com/maps/dir/Suvarnabhumi/Khao+San+Road',embedUrl:'https://www.google.com/maps?output=embed&q=Khao+San+Road',label:'素万那普机场 → 考山路区域'}},
 { id:'local-photo',hash:'local-v1',kind:'photo',title:'已保存的参考图片',image:{attachmentId:'registered-photo',alt:'本地注册测试图片',caption:'通过已登记附件 ID 读取'},sources:[]},
 { id:'unsafe-map',hash:'unsafe-v1',kind:'map',title:'异常嵌入不可执行',map:{url:'https://example.org/reference',embedUrl:'https://www.google.com/maps/embed-evil',label:'测试恶意嵌入'},sources:[]}
];
const initial = {runId:'canvas-fixture',sessionId:'source-fixture',tool:'codex',connectionId:'fixture',title:'曼谷与芭提雅 · 先选旅行方向',purpose:'discussion',status:'waiting_reply',controls:{canReply:true,canResume:true},workflow:{projectId:'project-fixture',taskId:'task-fixture',planId:'plan-fixture',conclusionId:'conclusion-fixture',draftVersion:3,approved:false,taskCount:0,conclusions:[{id:'conclusion-fixture',sourceMessageId:'answer-fixture',summary:'先比较两种方向，选中后再拆成执行任务。',visualBlocks:blocks,feedback:[]}]},events:[{id:'answer-event',at:'2026-11-17T03:00:00Z',reply:{id:'answer-fixture',text:'<quandeck-conclusion>'+JSON.stringify({summary:'先比较两种方向，选中后再拆成执行任务。',confirmed:[],open:[]})+'</quandeck-conclusion>'}}]};
await page.addInitScript(initial => {
 window.__controls=[];window.__failNext=false;window.__hold=false;window.__preview=[];
 window.__run=JSON.parse(localStorage.getItem('canvas-fixture-ledger') || 'null') || initial;
 const persist=()=>localStorage.setItem('canvas-fixture-ledger',JSON.stringify(window.__run));
 window.quandeckDesktop={platform:'darwin',bootstrap:async()=>({}),getConnection:async()=>({baseUrl:'http://127.0.0.1:4175',token:'fixture'}),onStorageError:()=>()=>{},onRunEvent:fn=>{window.__notify=fn;return()=>{}},getRun:async()=>structuredClone(window.__run),openRun:async()=>{},controlRun:async(runId,action,payload)=>{
  window.__controls.push({runId,action,payload});
  if(action!=='discussion_feedback')return{ok:true};
  if(window.__hold)await new Promise(resolve=>window.__release=resolve);
  const feedback={...payload,recordedAt:new Date().toISOString(),delivery:window.__failNext?'failed':'sent',...(window.__failNext?{error:'测试网络中断，反馈已保存'}:{})};window.__failNext=false;
  const list=window.__run.workflow.conclusions[0].feedback; const index=list.findIndex(item=>item.feedbackId===feedback.feedbackId);if(index<0)list.push(feedback);else list[index]=feedback;
  persist();window.__notify?.({runId});return{ok:feedback.delivery!=='failed',message:feedback.error,data:{feedback}};
 },previewDiscussionAttachment:async(...args)=>{window.__preview.push(args);return{kind:'image',name:'reference.png',path:'registered-photo',mime:'image/png',bytes:Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))}}};
}, initial);
await page.route('https://images.example.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="${route.request().url().includes('river')?'#adccc3':'#d4bc9f'}"/><path d="M0 330 L200 180 400 320 600 160 800 300V450H0Z" fill="#6b8274"/><text x="36" y="70" font-size="28" fill="#263c35">Visual fixture · Source labelled</text></svg>`}));
await page.route('https://www.google.com/maps?**',route=>route.fulfill({contentType:'text/html',body:'<p>Isolated Google embed fixture</p>'}));
try {
 await page.goto((process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4203')+'/?run=canvas-fixture');
 const canvas=page.getByRole('generic',{name:'图文讨论方案'});
 await page.getByRole('heading',{name:'先选更喜欢的旅行节奏'}).waitFor();
 assert.equal(await page.locator('.qd-visual-option').count(),2);
 assert.equal(await page.locator('.qd-confirm-panel').count(),0,'no redundant decision sidebar');
 await page.waitForFunction(()=>window.__preview.length>=1);
 assert.deepEqual(await page.evaluate(()=>window.__preview[0]),['project-fixture','plan-fixture','conclusion-fixture','local-photo',undefined]);
 await page.getByRole('button',{name:'放大图片：河畔方向测试图片'}).click();await page.getByRole('dialog').waitFor();
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal(await page.getByRole('button',{name:'放大图片：河畔方向测试图片'}).evaluate(el=>el===document.activeElement),true,'lightbox restores focus');
 await page.getByRole('button',{name:'在这里看地图'}).click();assert.equal(await page.locator('iframe[title^="地图："]').count(),1);
 assert.doesNotMatch(await page.locator('iframe[title^="地图："]').getAttribute('src'),/embed-evil/);
 await page.getByRole('button',{name:'收起地图'}).click();
 const oldTown=page.locator('[data-visual-option="old-town"]');
 await page.evaluate(()=>window.__hold=true);await oldTown.getByRole('button',{name:'偏好这个',exact:true}).click();
 await oldTown.getByText('正在保存反馈…').waitFor();assert.equal(await oldTown.getByRole('button',{name:'偏好这个',exact:true}).isDisabled(),true);
 await page.evaluate(()=>{window.__hold=false;window.__release()});await oldTown.getByText('已保存并发送给 Agent。').waitFor();
 const choice=await page.evaluate(()=>window.__controls[0]);assert.equal(choice.action,'discussion_feedback');assert.equal(choice.payload.optionId,'old-town');assert.equal(choice.payload.blockHash,'options-v1');assert.equal(choice.payload.binding.draftVersion,3);
 assert.equal(await page.evaluate(()=>window.__run.workflow.approved),false,'card preference is not plan approval');
 const river=page.locator('[data-visual-option="river"]');await river.getByRole('button',{name:'调整',exact:true}).click();
 await river.getByRole('textbox',{name:'你希望怎么调整？'}).fill('保留河边，但希望晚上更安静。');
 await page.evaluate(()=>window.__failNext=true);await river.getByRole('button',{name:'发送这条反馈'}).click();
 await river.getByRole('alert').waitFor();assert.match(await river.getByRole('textbox').inputValue(),/晚上更安静/);
 const failedId=await page.evaluate(()=>window.__controls.at(-1).payload.feedbackId);
 await page.reload();await river.getByRole('alert').waitFor();
 await river.getByRole('button',{name:'重试发送'}).click();await river.getByText('已保存并发送给 Agent。').waitFor();
 assert.equal(await page.evaluate(()=>window.__controls.at(-1).payload.feedbackId),failedId,'retry is idempotent');
 assert.equal(await page.evaluate(()=>window.__run.workflow.conclusions[0].feedback.length),2,'retry does not duplicate feedback');
 await page.reload();await oldTown.getByRole('button',{name:'已记录偏好'}).waitFor();await river.getByText('已保存并发送给 Agent。').waitFor();
 for(const width of [1920,1440,1024,768,320]) { await page.setViewportSize({width,height:1080});await page.screenshot({path:path.join(output,`canvas-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`); }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,widths:[1920,1440,1024,768,320],photos:true,registeredPhoto:true,safeMap:true,focusRecovery:true,ledgerBinding:true,partialPreferenceNotPlanApproval:true,pending:true,failedRetrySameId:true,reloadPreserved:true,pageErrors:errors},null,2));
} finally {await browser.close();}
