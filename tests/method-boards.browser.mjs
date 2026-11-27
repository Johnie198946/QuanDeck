import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
const { chromium }=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4684';
const dir=process.env.QUANDECK_UI_OUTPUT||'output/methods';
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1350,height:888}});
page.setDefaultTimeout(6000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const b=name=>page.getByRole('button',{name,exact:true});
const key='quandeck.personal-knowledge.v1';
const library=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
async function enter(){
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你想'}).click();
 await b('灵感逻辑').click();
}
async function add(title){
 await b('新建灵感').click();
 await page.getByRole('textbox',{name:'灵感',exact:true}).fill(title);
 await b('加入画布').click();
 await b('画布灵感「'+title+'」').waitFor();
}
async function removeBoard(){
 await b('画布设置').click();await b('删除画布').click();await b('确认删除').click();
}
try {
 await page.goto(url);
 await page.evaluate(k=>localStorage.setItem(k,JSON.stringify({schema:1,notes:[],decisions:[],inspirationCanvas:{nodes:[{noteId:'guide',x:58,y:136,idea:{origin:'manual',title:'查目的地攻略',detail:'记录景点和开门时间。'}}],links:[]}})),key);
 await enter();await b('画布灵感「查目的地攻略」').waitFor();
 await b('画布设置').click();await b('重命名画布').click();
 await page.getByLabel('画布名称').fill('日本出行');await b('保存').click();
 await b('展开工具栏').click();await b('折叠工具栏').waitFor();
 await b('画布说明').click();await page.locator('aside.qd-logic-inspector').waitFor();
 await page.locator('.qd-logic-stage').click({position:{x:220,y:325}});
 assert.equal(await page.locator('aside.qd-logic-inspector').count(),0);
 await b('折叠工具栏').click();
 await add('核对换乘路线');
 await b('关闭说明').click();
 await b('从「查目的地攻略」连出').focus();await page.keyboard.press('Enter');
 await b('连入「核对换乘路线」').click();await page.getByLabel('连线名称').fill('确定游览顺序后');
 await page.getByLabel('补充说明').fill('按第一站与末站查当天车次。');
 await page.getByLabel('补充说明').press('Tab');
 await page.screenshot({path:path.join(dir,'method-canvas.png')});
 await b('关闭说明').click();await b('存为模板').click();
 await page.getByLabel('模板名称').fill('出行规划');
 // Exercise the real summary request and editable return at the UI boundary.
 await page.evaluate(()=>{window.quandeckDesktop={summarizeMethod:async spec=>{
   window.methodSummaryRequest=spec;delete window.quandeckDesktop;
   return '先查目的地攻略，再按游览顺序核对换乘路线。';
 }};});
 await b('让 AI 写总结').click();await page.getByRole('textbox',{name:/方法总结/}).fill('先查攻略，再核对换乘。');
 assert.equal(await page.evaluate(()=>window.methodSummaryRequest.links.length),1);
 await b('保存').click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await b('方法模板库').click();
 await page.getByText('先查攻略，再核对换乘。',{exact:true}).waitFor();
 await page.screenshot({path:path.join(dir,'method-templates.png')});
 await b('用模板新建').click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await b('画布灵感「核对换乘路线」').click();await b('编辑卡片').click();
 await page.getByLabel('卡片说明').fill('使用出发日期对应的时刻表。');
 await b('保存卡片').click();await page.getByText('使用出发日期对应的时刻表。',{exact:true}).waitFor();
 await b('关闭说明').click();
 const copied=await library();assert.equal(copied.inspirationBoards.active.title,'出行规划');
 assert.equal(copied.inspirationCanvas.links.length,1);
 assert.equal(copied.inspirationCanvas.nodes[1].idea.detail,'使用出发日期对应的时刻表。');
 assert.equal(copied.methodTemplates[0].board.nodes[1].idea.detail,'');

 await b('画布灵感「查目的地攻略」').click();await b('从画布移除').click();
 await b('画布灵感「查目的地攻略」').waitFor({state:'hidden'});
 const edited=await library();assert.equal(edited.inspirationCanvas.links.length,0);assert.equal(edited.methodTemplates[0].board.nodes.length,2);
 await page.getByLabel('切换画布').selectOption('default');await b('画布灵感「查目的地攻略」').waitFor();
 await b('新建画布').click();await page.getByLabel('画布名称').fill('临时画布');await b('创建').click();
 await b('从笔记提炼').waitFor();await page.reload();await enter();
 assert.equal((await library()).inspirationBoards.active.title,'临时画布');
 await removeBoard();await b('画布灵感「查目的地攻略」').waitFor();
 await b('方法模板库').click();await b('删除模板「出行规划」').click();await b('确认删除').click();
 await page.getByText(/还没有方法模板/).waitFor();await b('关闭窗口').click();
 await removeBoard();await b('画布灵感「核对换乘路线」').waitFor();
 await removeBoard();await b('创建画布').waitFor();
 await page.reload();await enter();await b('创建画布').waitFor();
 assert.equal((await library()).inspirationBoards.active,null);assert.deepEqual((await library()).methodTemplates,[]);
 // A shared file survives deletion of its original board; final template deletion frees the blob.
 await b('创建画布').click();await page.getByLabel('画布名称').fill('路线参考');await b('创建').click();
 await page.locator('.qd-inspiration input[type=file]').setInputFiles({name:'攻略.txt',mimeType:'text/plain',buffer:Buffer.from('先确定日期，再订票。')});
 await b('画布灵感「攻略.txt」').waitFor();await b('存为模板').click();await b('保存').click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 const fileId=(await library()).methodTemplates[0].board.nodes[0].idea.reference.file.id;
 const fileCount=async()=>page.evaluate(async id=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('quandeck-output-files',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const keys=await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').getAllKeys();r.onsuccess=()=>resolve(r.result);});db.close();
   return keys.filter(k=>String(k).endsWith(':'+id)).length;
 },fileId);
 await removeBoard();await b('创建画布').waitFor();assert.equal(await fileCount(),1);
 await b('方法模板库').click();await b('删除模板「路线参考」').click();await b('确认删除').click();
 await page.getByText(/还没有方法模板/).waitFor();await b('关闭窗口').click();
 for(let i=0;i<20&&await fileCount();i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(await fileCount(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS legacy board, create/rename/switch/delete including last, blank drawer dismissal, rail, directed links, save AI-summary request, independent template instance, card editing, reload, template deletion and shared file lifetime.');
}finally{await browser.close();}
