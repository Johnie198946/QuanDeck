/** Isolated local ledger + Chrome profile. No source Agent request is made. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/direction-ui';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'}), page = await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('https://direction-fixture.example/photo.jpg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#d4bc9f"/><path d="M0 330L220 180 440 300 620 160 800 330V450H0Z" fill="#6b8274"/><text x="32" y="64" font-size="28" fill="#263c35">Isolated direction fixture</text></svg>'}));
const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('quandeck.projects.v1')).projects['overview-travel']);
const openDirection=async()=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'总览',exact:true}).click();await page.getByRole('complementary',{name:'选中事项详情'}).getByRole('button',{name:'方向方案',exact:true}).click();await page.locator('[data-plan-id="project-plan-overview-travel"]').waitFor()};
try {
 await page.goto(process.env.QUANDECK_UI_URL||'http://127.0.0.1:4204');
 await page.evaluate(async()=>{
  const {createDirectionFixtures}=await import('/tests/direction-ui.fixture.ts');const {persistProjectLibrary}=await import('/src/data/projectStorage.ts');const snapshots=createDirectionFixtures();
  persistProjectLibrary({schema:1,activeProjectId:snapshots[0].project.id,projects:Object.fromEntries(snapshots.map(snapshot=>[snapshot.project.id,snapshot])),agents:snapshots[0].agents,defaultAgent:'codex'});
  localStorage.setItem('quandeck.configured-agents.v1',JSON.stringify([{id:'fixture',tool:'codex',agentId:'codex',projectPath:'/isolated-direction-fixture',connectionId:'direction-ui-fixture',configuredAt:'2026-11-17T08:00:00Z'}]));
 });
 await page.reload();await page.getByRole('heading',{name:'项目总览',exact:true}).waitFor();
 const before=await stored(), count=Object.keys(before.tasks).length;
 assert.equal(await page.getByText('最近成果',{exact:true}).count(),0,'overview contains no result excerpt');
 await page.getByRole('complementary',{name:'选中事项详情'}).getByRole('button',{name:'方向方案',exact:true}).click();
 await page.locator('[data-plan-id="project-plan-overview-travel"]').waitFor();
 assert.equal(Object.keys((await stored()).tasks).length,count,'opening project direction creates no business task');
 await page.getByRole('heading',{name:'两条研究线，一份图文攻略',exact:true}).waitFor();
 await page.getByRole('img',{name:'方向页面测试图片'}).waitFor();
 await page.getByRole('region',{name:'方向交付清单'}).getByText('路线地图',{exact:true}).waitFor();
 const outline=page.getByRole('navigation',{name:'方向方案大纲'});
 await outline.getByRole('button',{name:/执行思路/}).focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('[data-plan-section="approach"]').evaluate(node=>node===document.activeElement),true,'outline keyboard entry focuses readable body');
 await page.getByRole('button',{name:'编辑大纲与正文',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'编辑方向大纲与正文'});
 await editor.getByRole('textbox',{name:'执行思路正文',exact:true}).fill('先分任务核对地图与照片。\n\n这是用户手动补充的方向正文，必须在版本中保留。');
 await editor.getByRole('button',{name:'保存方向正文',exact:true}).click();await editor.waitFor({state:'hidden'});
 await page.locator('.qd-direction-body').getByText('这是用户手动补充的方向正文，必须在版本中保留。',{exact:true}).waitFor();
 let snapshot=await stored();assert.equal(snapshot.ideaPlans['project-plan-overview-travel'].draftVersion,2);assert.equal(Object.keys(snapshot.tasks).length,count);assert.equal(Object.keys(snapshot.sessions).length,0,'edit does not start a discussion');
 await page.getByRole('button',{name:'只确认方向',exact:true}).click();await page.getByRole('button',{name:'开始自动执行',exact:true}).waitFor();
 snapshot=await stored();assert.equal(snapshot.collaboration.goalAutomation?.['project-plan-overview-travel']?.enabled??false,false,'only confirm never authorizes execution');
 assert.ok(Object.keys(snapshot.tasks).length>count,'approval materializes the proposed task graph');assert.equal(Object.keys(snapshot.sessions).length,0,'approval does not call a model');
 await page.getByRole('button',{name:'开始自动执行',exact:true}).click();await page.getByRole('button',{name:'暂停自动推进',exact:true}).waitFor();
 assert.equal((await stored()).collaboration.goalAutomation['project-plan-overview-travel'].enabled,true,'explicit execution stores authorization');
 assert.equal(await page.getByRole('button',{name:'确认方向并自动执行',exact:true}).count(),0,'approved direction does not repeat confirmation');
 await page.getByRole('button',{name:'暂停自动推进',exact:true}).click();await page.getByRole('button',{name:'开始自动执行',exact:true}).waitFor();
 for(const width of [1920,1440,1024,768,320]){
  await page.setViewportSize({width,height:1080});
  await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))});
  await page.screenshot({path:path.join(output,`direction-${width}.png`)});
  const overflow=await page.evaluate(()=>({viewport:innerWidth,total:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(el=>el.right>innerWidth+1).slice(0,12)}));
  assert.equal(overflow.total>overflow.viewport,false,`window overflow at ${width}: ${JSON.stringify(overflow)}`);
  assert.equal(await page.locator('.qd-direction-doc').evaluate(node=>node.scrollWidth>node.clientWidth+1),false,`direction overflow at ${width}`);
  await page.screenshot({path:path.join(output,`direction-${width}.png`)});
 }
 await page.setViewportSize({width:1440,height:1080});await page.reload();await openDirection();
 await page.locator('.qd-direction-body').getByText('这是用户手动补充的方向正文，必须在版本中保留。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'编辑大纲与正文',exact:true}).click();await editor.getByRole('textbox',{name:'执行思路正文',exact:true}).fill('尚未保存的输入');await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.activeElement?.textContent?.includes('编辑大纲与正文'));
 assert.equal(await page.getByRole('button',{name:'编辑大纲与正文',exact:true}).evaluate(node=>node===document.activeElement),true,'editor restores focus');
 assert.equal((await stored()).ideaPlans['project-plan-overview-travel'].draftVersion,snapshot.ideaPlans['project-plan-overview-travel'].draftVersion,'cancel does not mutate direction');
 await page.getByRole('button',{name:'编辑大纲与正文',exact:true}).click();await editor.getByRole('textbox',{name:'执行思路正文',exact:true}).fill('新一版执行逻辑：先核对每个分支，再合并图文交付。');await editor.getByRole('button',{name:'保存方向正文',exact:true}).click();await editor.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'确认方向并自动执行',exact:true}).click();await page.getByRole('button',{name:'暂停自动推进',exact:true}).waitFor();
 const combined=await stored();assert.equal(combined.collaboration.goalAutomation['project-plan-overview-travel'].draftVersion,combined.ideaPlans['project-plan-overview-travel'].adopted.draftVersion,'combined action uses exact approval receipt version');
 assert.deepEqual(errors,[]);
 const checks={projectDirectionNoTaskMutation:true,visibleOutlineAndBody:true,visualDiscussionRetained:true,manualOutlinePersists:true,versionedConfirmation:true,onlyConfirmDoesNotExecute:true,explicitAutomation:true,combinedApprovalVersion:true,noRepeatedConfirmation:true,editorEscapeFocus:true,responsive:[1920,1440,1024,768,320],errors};
 await writeFile(path.join(output,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}catch(error){console.error((await page.locator('body').innerText()).slice(-6000));await page.screenshot({path:path.join(output,'failure.png')});throw error}finally{await browser.close()}
