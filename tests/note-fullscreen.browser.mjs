import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4394';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/note-reading';
const title = '沿河走一段，记下城市的声音';
const paragraphs = [
  '清晨六点，沿河的小路上已经有人出摊。桥下听得最清楚的是水声，再往前走，能听见自行车铃和店铺卷帘门的响动。',
  '## 第一站 · 石桥',
  '桥中央适合停留三分钟。先闭上眼睛，再记下从远到近听见的三种声音。',
  '> 先听一会儿，再决定要记录什么。',
  '## 第二站 · 早市',
  '从南岸下桥，沿着街角的面包店向东。**路过鲜花摊时放慢脚步**，把变化写进笔记。',
];
const article = [...paragraphs, '[路线图](<https://example.test/map> "预览卡片")',
  '[现场记录.txt](attachment:field-reading)',
  ...Array.from({length: 35}, (_, i) => '沿途记录 ' + (i+1) + '。' + paragraphs[0]), '走到河岸尽头。'].join('\n\n');
const browser = await chromium.launch({channel:'chrome',headless:true});
await mkdir(output,{recursive:true});
try {
  for (const native of [true,false]) {
    const viewport = native ? {width:1440,height:900} : {width:390,height:844};
    const page = await browser.newPage({viewport});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*', route=>new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.addInitScript(({title,article,native})=>{
      if (!native) Object.defineProperty(document,'fullscreenEnabled',{value:false});
      const at='2026-11-25T07:00:00Z';
      localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,decisions:[],notes:[{
        id:'reader',title,body:article,createdAt:at,updatedAt:at,revision:1,attachments:[{id:'field-reading',name:'现场记录.txt',size:10,type:'text/plain',inline:true}],expansions:[],history:[],
      }]}));
    },{title,article,native});
    await page.goto(origin);
    await page.evaluate(async()=>{
      const req = indexedDB.open('quandeck-output-files',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('files');
      const db = await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
      const tx = db.transaction('files','readwrite');
      tx.objectStore('files').put(new Blob(['Field note'],{type:'text/plain'}),'personal-knowledge:field-reading');
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      db.close();
    });
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你记'}).click();
    const editor=page.getByRole('textbox',{name:'笔记正文'});
    const open=page.getByRole('button',{name:'全屏阅读',exact:true});
    await editor.waitFor();
    const initialFont=await editor.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    await editor.evaluate(el=>{
      el.focus();
      const s=window.getSelection(); s.selectAllChildren(el);s.collapseToEnd();
      document.execCommand('insertText',false,'这句刚刚补上。');
    });
    await page.evaluate(()=>scrollTo(0,540));
    const before=await page.evaluate(()=>scrollY);
    const buttonRect = await open.boundingBox();
    await page.mouse.click(buttonRect.x + buttonRect.width/2,buttonRect.y + buttonRect.height/2);
    const reader=page.getByRole('dialog',{name:'笔记全屏阅读'});
    await reader.getByRole('heading',{name:title}).waitFor();
    const area=reader.locator('.qn-reader-page');
    if (native) await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('qn-reader-page'));
    const bounds=await area.evaluate(el=>({x:el.getBoundingClientRect().left,y:el.getBoundingClientRect().top,w:el.clientWidth,h:el.clientHeight,
      pageW:innerWidth,pageH:innerHeight,font:parseFloat(getComputedStyle(el.querySelector('article')).fontSize)}));
    assert(bounds.x===0 && bounds.y===0 && bounds.w>=bounds.pageW-20 && bounds.h>=bounds.pageH-2);
    assert(bounds.font>=initialFont*1.45);
    await reader.getByRole('link',{name:/路线图/}).waitFor();
    assert.equal(await reader.locator('strong').first().textContent(),'路过鲜花摊时放慢脚步');
    await page.screenshot({path:path.join(output,native?'note-fullscreen.png':'note-fullscreen-mobile.png'),animations:'disabled'});
    const file = reader.getByRole('group',{name:'附件预览 · 现场记录.txt'});
    await file.scrollIntoViewIfNeeded();
    await file.getByText('Field note').waitFor();
    await file.getByRole('button',{name:'展开预览 现场记录.txt'}).click();
    const preview=page.getByRole('dialog',{name:'现场记录.txt 预览'});
    await preview.getByText('Field note').waitFor();
    await preview.getByRole('button',{name:'关闭预览'}).click();
    await reader.waitFor();
    await area.evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'instant'}));
    await reader.getByText(/走到河岸尽头。.*这句刚刚补上/).waitFor();
    assert(await area.evaluate(el=>el.scrollTop>0 && el.scrollTop+el.clientHeight>=el.scrollHeight-2));
    if (native) await reader.getByRole('button',{name:'退出全屏阅读'}).click();
    else await page.keyboard.press('Escape');
    await page.locator('dialog.qn-reader-dialog').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>document.fullscreenElement),null);
    assert.equal(await page.evaluate(()=>scrollY),before);
    assert(await editor.evaluate(el=>document.activeElement===el && el.contains(getSelection()?.anchorNode)));
    await open.focus();await page.keyboard.press('Enter');
    await reader.waitFor();
    if (native) {
      await page.waitForFunction(()=>!!document.fullscreenElement);
      await page.evaluate(()=>document.exitFullscreen());
    }
    else await reader.getByRole('button',{name:'退出全屏阅读'}).click();
    await page.locator('dialog.qn-reader-dialog').waitFor({state:'detached'});
    assert(await open.evaluate(el=>document.activeElement===el));
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'首页'}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].body.includes('这句刚刚补上。'));
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Passed native fullscreen, modal fallback, large scrolling text, Markdown and links, unsaved draft, editor focus and scroll restoration, keyboard entry and exit.');
} finally { await browser.close(); }
