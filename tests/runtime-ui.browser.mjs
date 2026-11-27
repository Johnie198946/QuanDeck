/** Isolated renderer interaction test. No source Agent or user workspace is touched. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/discussion-ui';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,...(process.env.QUANDECK_BROWSER_EXECUTABLE ? {executablePath:process.env.QUANDECK_BROWSER_EXECUTABLE}: {})});
const page = await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const conclusion={summary:'**先确定出行条件，再整理路线。** 这次以曼谷和芭提雅的小众体验为主。',confirmed:['目的地：曼谷、芭提雅','行程节奏：轻松，优先小众体验'],open:['哪天出发，计划玩几天？','预算按两人合计还是每人计算？'],cards:[{title:'下一步',body:'补充日期和预算后，比较两地交通与住宿区域。'}],charts:[{title:'示例数据 · 偏好比较',type:'bar',labels:['文化','海岛','美食'],series:[{label:'示例权重',values:[3,2,4]}]}],attachments:[{name:'行程草稿.docx',path:'行程草稿.docx'},{name:'行程预算.xlsx',path:'行程预算.xlsx'}]};
const initial={runId:'ui-fixture',sessionId:'019a7d11-6213-7110-9279-000000000003',title:'泰国游玩攻略',purpose:'discussion',workflow:{planId:'plan1',conclusionId:'conclusion1',approved:false,taskCount:0,draftVersion:1,taskId:'task1',projectId:'project1'},tool:'codex',connectionId:'local-codex',projectPath:'/project/旅行',prompt:'内部任务协议，不应在默认界面展开 Authorization: Bearer test-secret-should-be-masked',tokens:22500,status:'waiting_reply',controls:{canReply:true,canResume:true},events:[{id:'initial',at:'2026-11-16T12:09:00Z',message:{id:'user0',role:'user',text:'内部任务协议，不应在默认界面展开 Authorization: Bearer test-secret-should-be-masked'}},{id:'network',at:'2026-11-16T12:09:01Z',notice:'模型连接已恢复'},{id:'reply',at:'2026-11-16T12:10:00Z',message:{id:'reply1',text:'<quandeck-conclusion>'+JSON.stringify(conclusion)+'</quandeck-conclusion>'}},{id:'duplicate',at:'2026-11-16T12:10:01Z',reply:{id:'reply1',text:'<quandeck-conclusion>'+JSON.stringify(conclusion)+'</quandeck-conclusion>'}}]};
await page.addInitScript(({initial})=>{
 window.__run=initial;window.__controls=[];window.__failNext=false;
 let listener=()=>{};
 window.quandeckDesktop={platform:'darwin',bootstrap:async()=>({}),getConnection:async()=>({baseUrl:'http://127.0.0.1:4175',token:'fixture'}),onStorageError:()=>()=>{},onRunEvent:fn=>{listener=fn;window.__notify=fn;return()=>{}},getRun:async()=>structuredClone(window.__run),openRun:async()=>{},controlRun:async(runId,action,payload)=>{if(window.__failNext){window.__failNext=false;return{ok:false,message:'测试发送失败，内容保留'}}window.__controls.push({action,payload});if(action==='approve_and_execute'){window.__run.workflow.approved=true;window.__run.workflow.automationEnabled=true;window.__run.workflow.taskCount=4;}if(payload?.prompt)window.__run.events.push({id:'sent'+Date.now(),at:new Date().toISOString(),message:{id:'sent'+Date.now(),role:'user',text:payload.prompt}});listener({runId});return{ok:true}},chooseRunAttachments:async()=>[{name:'补充资料.pdf',path:'/project/旅行/补充资料.pdf'}],previewRunAttachment:async(_run,path)=>path.endsWith('xlsx')?{kind:'spreadsheet',name:'行程预算.xlsx',size:800,sheets:[{name:'预算',rows:[{number:1,cells:[{text:'交通'},{text:'住宿'}]},{number:2,cells:[{text:'1500'},{text:'3200'}]}]}]}:{kind:'document',name:'行程草稿.docx',size:500,blocks:[{kind:'heading',level:1,text:'行程安排'},{kind:'paragraph',text:'第 1 天：抵达曼谷。'}]},revealRunAttachment:async()=>{}};
},{initial});
let sourceBody;
await page.route('http://127.0.0.1:4175/v1/source/open',async route=>{sourceBody=route.request().postDataJSON();await route.fulfill({json:{status:'opened',destination:'desktop',message:'已请求 Codex 客户端打开对应会话'}})});
try{
 await page.goto((process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4186')+'/?run=ui-fixture');
 await page.getByRole('heading',{name:'补充信息',exact:true}).waitFor();
 assert.equal(await page.locator('.qd-runtime-message.is-agent').count(),1,'reply events must not duplicate messages');
 assert.doesNotMatch(await page.locator('body').innerText(),/quandeck-conclusion|内部任务协议/);
 await page.getByText('查看任务背景与原始指令').click();assert.doesNotMatch(await page.locator('body').innerText(),/test-secret-should-be-masked/);await page.getByText('查看任务背景与原始指令').click();
 assert.equal(await page.getByRole('checkbox').count(),2);assert.equal(await page.getByRole('checkbox').first().isChecked(),false);
 assert.equal(await page.getByRole('button',{name:'保存信息并继续讨论',exact:true}).isDisabled(),true);
 for(const width of [1440,1024,768,320]){await page.setViewportSize({width,height:1050});await page.screenshot({path:path.join(output,`discussion-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`)}
 await page.setViewportSize({width:1440,height:1050});
 await page.getByRole('button',{name:'在 Codex 中查看'}).click();await page.getByText('已请求 Codex 客户端打开对应会话').waitFor();assert.equal(sourceBody.destination,'native');assert.equal(sourceBody.sessionId,initial.sessionId);
 const panel=page.getByRole('complementary',{name:'补充信息'});
 await panel.getByRole('checkbox').first().check();await panel.getByText('修改这条信息',{exact:true}).first().click();await panel.getByRole('textbox',{name:'修改建议 1'}).fill('目的地：只去曼谷');assert.equal(await panel.getByRole('checkbox',{name:'目的地：只去曼谷'}).isChecked(),true);
 await panel.getByRole('textbox',{name:'哪天出发，计划玩几天？'}).fill('周三出发，周日返回');
 await panel.getByRole('textbox',{name:'我还想补充'}).fill('希望安排小众餐厅');
 await page.reload();await page.getByRole('heading',{name:'补充信息',exact:true}).waitFor();assert.equal(await panel.getByRole('checkbox').first().isChecked(),true);assert.equal(await panel.getByRole('textbox',{name:'我还想补充'}).inputValue(),'希望安排小众餐厅');
 await page.evaluate(()=>window.__failNext=true);await panel.getByRole('button',{name:/保存信息并继续讨论/}).click();await page.getByText('测试发送失败，内容保留').waitFor();assert.equal(await panel.getByRole('textbox',{name:'我还想补充'}).inputValue(),'希望安排小众餐厅');
 await panel.getByRole('button',{name:/保存信息并继续讨论/}).click();await page.getByText('信息已保存',{exact:true}).waitFor();const payload=await page.evaluate(()=>window.__controls[0].payload.prompt);assert.match(payload,/只去曼谷/);assert.doesNotMatch(payload,/优先小众体验/);assert.match(payload,/周三出发/);assert.deepEqual(await page.evaluate(()=>window.__controls[0].payload.confirmedInformation),['目的地：只去曼谷','哪天出发，计划玩几天？：周三出发，周日返回','希望安排小众餐厅']);
 await page.getByRole('textbox',{name:'补充信息或继续讨论'}).fill('请补充每天的交通建议');await page.evaluate(()=>window.__failNext=true);await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('测试发送失败，内容保留').waitFor();assert.equal(await page.getByRole('textbox',{name:'补充信息或继续讨论'}).inputValue(),'请补充每天的交通建议');
 await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__controls.length===2);assert.equal(await page.getByRole('textbox',{name:'补充信息或继续讨论'}).inputValue(),'');
 const word=page.getByRole('region',{name:'附件：行程草稿.docx'});await word.getByRole('button',{name:'预览',exact:true}).click();await word.getByText('第 1 天：抵达曼谷。').waitFor();
 const excel=page.getByRole('region',{name:'附件：行程预算.xlsx'});await excel.getByRole('button',{name:'预览',exact:true}).click();await excel.getByRole('cell',{name:'3200',exact:true}).waitFor();
 await page.getByRole('button',{name:'添加资料'}).click();await page.getByRole('button',{name:'移除附件 补充资料.pdf'}).waitFor();
 await page.screenshot({path:path.join(output,'discussion-confirmed.png'),fullPage:true});
 await page.reload();await page.getByRole('button',{name:'移除附件 补充资料.pdf'}).waitFor();
 await page.evaluate(()=>{window.__run.events.push({id:'xss',at:new Date().toISOString(),message:{id:'xss',text:'新的重点：**内容安全**\n\n<script>window.__xss=1</script>\n[危险链接](javascript:alert(1))'}},{id:'quota',at:new Date().toISOString(),error:'BUDGET_EXCEEDED: source provider credit exhausted'});window.__notify({runId:'ui-fixture'})});
 await page.getByText('内容安全',{exact:true}).waitFor();
 assert.equal(await page.locator('.qd-runtime-history').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.__xss),undefined);
 assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
 assert.match(await page.locator('body').innerText(),/source provider credit exhausted/);
 assert.doesNotMatch(await page.locator('body').innerText(),/新版已取消此限制/);
 await page.evaluate(()=>{window.__run.status='running';window.__run.events.push({id:'progress',at:new Date().toISOString(),step:{label:'核对 Google 路线'}});window.__notify({runId:'ui-fixture'})});
 await page.getByRole('progressbar').waitFor();assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),null,'unknown totals must not invent percent');
 await page.evaluate(()=>{window.__run.events.push({id:'step-count',at:new Date().toISOString(),step:{label:'核对地点',completed:2,total:5}});window.__notify({runId:'ui-fixture'})});
 await page.waitForFunction(()=>document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='2');
 await page.evaluate(()=>{window.__run.status='waiting_reply';window.__run.events.push({id:'empty',at:new Date().toISOString(),message:{id:'empty',text:'<quandeck-conclusion>'+JSON.stringify({summary:'方向已经明确',confirmed:[],open:[]})+'</quandeck-conclusion>'}});window.__notify({runId:'ui-fixture'})});
 await page.getByText('方向已经明确',{exact:true}).waitFor();assert.equal(await page.getByRole('complementary',{name:'补充信息'}).count(),0,'no empty confirmation form');
 const next=page.getByRole('region',{name:'讨论下一步'});
 assert.equal(await page.locator('.qd-runtime-transcript').evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('[aria-label="讨论下一步"]')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
 await next.getByRole('button',{name:'直接执行任务',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__controls.at(-1)?.action),'execute_task');
 await next.getByRole('button',{name:'确认方向并自动执行',exact:true}).click();
 await next.getByRole('button',{name:'查看执行进度'}).waitFor();assert.equal(await next.getByRole('button',{name:'确认方向并自动执行'}).count(),0);
 const approval=await page.evaluate(()=>window.__controls.find(c=>c.action==='approve_and_execute'));assert.equal(approval.payload.expectedVersion,1);assert.equal(approval.payload.conclusionId,'conclusion1');
 await page.getByRole('textbox',{name:'补充信息或继续讨论'}).fill('执行');
 await page.evaluate(()=>{window.__run.workflow.outdated=true;window.__run.workflow.draftVersion=2;window.__notify({runId:'ui-fixture'})});
 await next.getByText('当前方案 v2 已开启自动执行，可查看 4 项任务的进度。').waitFor();
 await next.getByRole('button',{name:'查看最新方案'}).click();
 assert.equal(await page.evaluate(()=>window.__controls.at(-1)?.action),'open_direction');
 assert.equal(await next.getByRole('button').count(),1);
 assert.equal(await page.getByRole('button',{name:'发送',exact:true}).count(),0);
 await page.getByText('查看未发送的草稿',{exact:true}).click();await page.getByText('执行',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'discussion-approved.png'),fullPage:true});
 const blockerReason = '任务文件夹是空的。请补充包含源码的文件夹或相关资料。';
 await page.evaluate(reason => {
   const collaboration = {projectId:'project1',taskId:'task1',runId:'managed1',contextPackageId:'context1',taskVersion:2,specRevision:1,claimEpoch:1};
   const text = '<quandeck-submission>' + JSON.stringify({schemaVersion:'quandeck.runtime.v1',idempotencyKey:'workspace-missing',binding:collaboration,kind:'blocker',payload:{reason}});
   Object.assign(window.__run, {purpose:'execution',title:'排查笔记的保存问题',projectPath:'/任务资料/项目工作文件夹',workflow:undefined,collaboration,
     submissionIssue:{messageId:'missing-workspace',code:'SCHEMA_INVALID',message:'SCHEMA_INVALID：需要一个完整的独立提交消息'},
     events:[{id:'agent-reply',at:new Date().toISOString(),reply:{id:'missing-workspace',text}}]});
   window.__notify({runId:'ui-fixture'});
 },blockerReason);
 const blocker = page.getByRole('region',{name:'Agent 暂时无法继续'});
 await blocker.getByText(blockerReason,{exact:true}).waitFor();
 await page.getByText('等你补充信息',{exact:true}).waitFor();
 assert.doesNotMatch(await page.locator('body').innerText(),/SCHEMA_INVALID|这条回复的格式不完整/);
 await blocker.getByRole('button',{name:'补充信息或资料'}).click();
 const supplement = page.getByRole('textbox',{name:'补充 Agent 需要的信息'});
 assert.equal(await supplement.evaluate(el => el === document.activeElement),true);
 await supplement.fill('');
 await page.getByRole('button',{name:'移除附件 补充资料.pdf'}).click();
 for (const width of [1440,1024,768,320]) {
   await page.setViewportSize({width,height:820});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`blocker overflow at ${width}`);
   await page.screenshot({path:path.join(output,`blocker-${width}.png`),fullPage:true});
 }
 await page.evaluate(() => {
   window.__run.status = 'paused';
   window.__run.events.push({id:'paused',at:new Date().toISOString(),notice:'会话已暂停'});
   window.__notify({runId:'ui-fixture'});
 });
 await page.locator('.qd-runtime-status').filter({hasText:'已暂停'}).waitFor();
 await blocker.getByText(blockerReason,{exact:true}).waitFor();
 await blocker.getByRole('button',{name:'补充信息或资料'}).click();
 assert.equal(await supplement.evaluate(el => el === document.activeElement),true);
 await page.evaluate(() => {
   window.__run.events.push({id:'update',at:new Date().toISOString(),message:{id:'new-info',role:'user',text:'已补充项目资料'}});
   window.__notify({runId:'ui-fixture'});
 });
 await blocker.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,responsive:[1440,1024,768,320],structuredReply:true,noDuplicateMessages:true,explicitConfirmation:true,editedValues:true,draftRecovery:true,failedSendPreservesInput:true,sourceJump:true,documentPreview:true,sheetPreview:true,attachmentSelection:true,pausedBlocker:true,supersededBlockerHidden:true,consoleErrors:errors},null,2));
}finally{await browser.close()}
