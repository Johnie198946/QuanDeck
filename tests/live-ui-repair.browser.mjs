/** Regression for reported default task entry and wide non-focus workspace. Isolated browser storage. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.QUANDECK_UI_OUTPUT || 'output/live-ui-repair'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1920,height:1080}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const raw='我开发了一个多任务多 Agent 管理工作台，现在需要优化。需要检查黑板与台帐的唯一真源、任务工作流、失败重试、并发调度，并完成界面体验优化和项目体检。原始资料：https://example.com/product/specification';
const snapshot=()=>page.evaluate(()=>{const lib=JSON.parse(localStorage.getItem('quandeck.projects.v1'));return lib.projects[lib.activeProjectId]});
try {
 await page.goto(process.env.QUANDECK_UI_URL||'http://127.0.0.1:4251');
 await page.evaluate(async()=>{const {createDirectionFixtures}=await import('/tests/direction-ui.fixture.ts');const {persistProjectLibrary}=await import('/src/data/projectStorage.ts');const all=createDirectionFixtures();persistProjectLibrary({schema:1,activeProjectId:all[0].project.id,projects:Object.fromEntries(all.map(s=>[s.project.id,s])),agents:all[0].agents,defaultAgent:'codex'});});
 await page.reload();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'任务',exact:true}).click();
 const newTask=page.getByRole('button',{name:'新任务',exact:true});
 await newTask.click();
 const field=page.getByRole('textbox',{name:'记录想法或输入任务'});await field.fill(raw);
 await field.evaluate(el=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j32cAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'pasted-screenshot.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await page.getByLabel('待上传附件').getByText('pasted-screenshot.png',{exact:true}).waitFor();
 await page.getByRole('img',{name:'pasted-screenshot.png 缩略图'}).waitFor();
 await page.getByRole('button',{name:'创建任务',exact:true}).click();
 await page.waitForFunction(raw=>{const l=JSON.parse(localStorage.getItem('quandeck.projects.v1'));return Object.values(l.projects[l.activeProjectId].tasks).some(t=>t.title===raw&&t.attachments?.length===1)},raw);
 const created=Object.values((await snapshot()).tasks).find(t=>t.title===raw);assert.equal(created.attachments[0].name,'pasted-screenshot.png');
 assert.equal(await page.locator('.qd-composer textarea').inputValue(),'','failed AI title service never blocks saving');
 const row=page.locator('[data-task="'+created.id+'"]');
 await row.getByText('任务详情',{exact:true}).click();
 await row.getByRole('button',{name:'编辑标题',exact:true}).click();
 await page.getByRole('textbox',{name:'编辑任务',exact:true}).fill('优化任务工作流与界面');await page.getByRole('textbox',{name:'编辑任务',exact:true}).press('Enter');
 let saved=await snapshot();assert.equal(saved.tasks[created.id].originalTitle,raw);assert.equal(saved.tasks[created.id].title,'优化任务工作流与界面');
 await newTask.click();await field.fill(raw);await page.getByRole('button',{name:'创建任务',exact:true}).click();await page.locator('[data-task]').filter({has:page.getByRole('button',{name:`查看任务详情：${raw}`,exact:true})}).getByRole('button',{name:'讨论方案',exact:true}).click();
 await page.locator('.qd-direction-original').getByText('查看完整需求',{exact:true}).click();await page.locator('.qd-direction-original p').getByText(raw,{exact:true}).waitFor();
 // Explicitly test non-focus, the mode missed by the earlier direction regression.
 const toggle=page.getByRole('button',{name:'显示时间线',exact:true});if(await toggle.count())await toggle.click();
 for(const width of [2560,1920,1440,1024,768,320]){
  await page.setViewportSize({width,height:1080});await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const box=await page.locator('.qd-col-ws').boundingBox();assert.ok(box.width>width*.9,`workspace occupies available width at ${width}, got ${box.width}`);
  const overflow=await page.evaluate(()=>({w:innerWidth,sw:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll("body *")].map(e=>({c:e.className,w:e.getBoundingClientRect().width,x:e.getBoundingClientRect().x,r:e.getBoundingClientRect().right})).filter(e=>e.r>innerWidth+1).slice(0,12)}));assert.ok(overflow.sw<=overflow.w+1,`no horizontal overflow at ${width}: ${JSON.stringify(overflow)}`);
  if(width>=1024) {const main=await page.locator('.qd-ws-main').boundingBox();assert.ok(main.width>500,`readable main column ${width}: ${main.width}`);}
  await page.screenshot({path:path.join(out,`direction-normal-${width}.png`)});
 }
 await page.setViewportSize({width:1920,height:1080});await page.getByRole('button',{name:'收起时间线，专注思考',exact:true}).click();
 assert.ok((await page.locator('.qd-ws-main').boundingBox()).width>900,'focus mode also preserves readable main width');
 // The global schedule button must open the drawer even when focus mode hides
 // the default timeline column. A visible scrim without its drawer traps users.
 await page.getByRole('button',{name:'日程',exact:true}).click();
 const drawer=page.locator('.qd-col-schedule.is-drawer-open');await drawer.waitFor({state:'visible'});
 await drawer.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
 const drawerBox=await drawer.boundingBox();assert.ok(drawerBox&&drawerBox.width>250&&drawerBox.x>=-1,'focus schedule drawer is visible above its scrim');
 await page.getByRole('button',{name:'关闭日程',exact:true}).click();await drawer.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'返回上一页',exact:true}).click();
 await newTask.click();
 // Image-only requests and file drops must use the same path as pasted screenshots.
 await field.evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['report'],'report.pdf',{type:'application/pdf'}));el.closest('form').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));});
 await page.getByLabel('待上传附件').getByText('report.pdf',{exact:true}).waitFor();await page.getByRole('button',{name:'创建任务',exact:true}).click();
 await page.waitForFunction(()=>{const l=JSON.parse(localStorage.getItem('quandeck.projects.v1'));return Object.values(l.projects[l.activeProjectId].tasks).some(t=>t.attachments?.some(f=>f.name==='report.pdf'))});
 assert.deepEqual(errors,[]);const checks={clipboardScreenshot:true,thumbnail:true,manualTaskSavedWithoutAgent:true,manualRenamePreservesRaw:true,fileDropAndFileOnly:true,normalAndFocusWideLayout:true,responsive:[2560,1920,1440,1024,768,320],errors};await writeFile(path.join(out,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser.close()}
