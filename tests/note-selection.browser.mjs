import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/notes-selection';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
const page = await browser.newPage({viewport:{width:1460,height:900}});
const editor = page.getByRole('textbox',{name:'笔记正文'});
const trigger = page.getByRole('button',{name:'就这段提问',exact:true});
const input = page.getByRole('textbox',{name:'补充问题'});
const note = '行程分三天。重复词在这里。\n\n![参考图](attachment:demo-pic)\n\n第一天看 __清晨列车__，再走 *雪景小路*。重复词在这里。\n\n第二天去阿仁欣赏树冰。\n\n' +
  Array.from({length:16},(_,i)=>'第 '+(i+1)+' 段现场笔记。').join('\n\n');
const actualErrors=[];
page.on('pageerror',e=>actualErrors.push(e.message));
async function select(from,to=from,last=false) {
  await editor.focus();
  return editor.evaluate((root,{from,to,last})=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[]; for(let text=walker.nextNode();text;text=walker.nextNode()) nodes.push(text);
    const start=nodes.filter(n=>n.data.includes(from)).at(last?-1:0);
    const end=nodes.filter(n=>n.data.includes(to)).at(last?-1:0);
    const range=document.createRange();
    range.setStart(start,start.data.indexOf(from)); range.setEnd(end,end.data.indexOf(to)+to.length);
    start.parentElement.scrollIntoView({block:'center'}); const selection=getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    const rect=Array.from(range.getClientRects()).filter(rect=>rect.width && rect.height).at(-1);
    return {x:rect.right,y:rect.top,height:rect.height};
  },{from,to,last});
}
try {
  await page.addInitScript(body=>{
    const at='2026-11-25T01:00:00.000Z';
    const image={id:'demo-pic',name:'摄影日程.png',type:'image/png',size:2048};
    const canvas=document.createElement('canvas'); canvas.width=490; canvas.height=82;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#f1f6ff';ctx.fillRect(0,0,490,82);ctx.strokeStyle='#87a4d2';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(35,26);ctx.lineTo(441,26);ctx.stroke();
    ['日出 · 列车','上午 · 雪径','傍晚 · 温泉'].forEach((label,i)=>{
      const x=35+168*i;ctx.beginPath();ctx.arc(x,26,5,0,2*Math.PI);ctx.fillStyle='#285c9f';ctx.fill();
      ctx.font='15px sans-serif';ctx.fillStyle='#233d61';ctx.fillText(label,x-12,59);
    });
    const imgData=Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),ch=>ch.charCodeAt(0));
    window.testNotePicture=imgData;
    const note={id:'passage',title:'冬季摄影手记',body,createdAt:at,updatedAt:at,revision:1,attachments:[image],expansions:[],history:[]};
    if(!localStorage.getItem('quandeck.personal-knowledge.v1')) localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,decisions:[],notes:[note]}));
  },note);
  await page.goto(url);
  await page.getByRole('button',{name:'帮你记',exact:true}).waitFor();
  await page.evaluate(()=>{
    window.quandeckDesktop={...window.quandeckDesktop,platform:'darwin',readKnowledge:async()=>localStorage.getItem('quandeck.personal-knowledge.v1'),
      readKnowledgeImage:async()=>window.testNotePicture,
      compareKnowledge:async(old,next)=>{if(old!==localStorage.getItem('quandeck.personal-knowledge.v1'))return false;localStorage.setItem('quandeck.personal-knowledge.v1',next);return true;},
      expandKnowledge:async request=>{window.lastPassage=request;return {answer:'预留等待列车的时间。',sourceIds:[]};}};
  });
  await page.getByRole('button',{name:'帮你记',exact:true}).click();
  await editor.getByText('清晨列车',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.qd-writer-content img')?.naturalWidth===490);
  const end=await select('清晨列车','雪景小路');
  await trigger.waitFor();
  const buttonBox=await trigger.boundingBox();
  assert.ok(Math.abs(buttonBox.y-end.y)<50 && Math.abs(buttonBox.x-end.x)<130,'action at last selected text');
  await trigger.click();
  await input.waitFor();
  assert.equal(await input.evaluate(element=>document.activeElement===element),true);
  const promptBox=await page.getByRole('dialog',{name:'就这段提问'}).boundingBox();
  assert.ok(Math.abs(promptBox.y-end.y)<125 && promptBox.width<=325,'small prompt anchored to passage');
  await page.screenshot({path:path.join(output,'selection-question.png'),animations:'disabled'});
  const initialY=promptBox.y;
  await page.mouse.move(end.x-24,end.y+4);
  await page.mouse.wheel(0,96);
  await page.waitForFunction(y=>Math.abs(document.querySelector('[data-note-prompt]').getBoundingClientRect().y-y)>20,initialY);
  const newPrompt=await page.getByRole('dialog',{name:'就这段提问'}).boundingBox();
  const newAnchor=await editor.getByText('雪景小路',{exact:true}).boundingBox();
  assert.ok(Math.abs(newPrompt.y-newAnchor.y)<125,'input follows the selected line during scrolling');
  await input.fill('哪一段适合上午拍摄？');
  await input.press('Enter');
  await page.waitForFunction(()=>window.lastPassage && !document.querySelector('[data-note-prompt]'));
  const first=await page.evaluate(()=>window.lastPassage.selection);
  assert.equal(first.quote,'清晨列车，再走 雪景小路','sends the selected visible text across Markdown emphasis');
  const anchor=await page.evaluate(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].expansions[0].selection);
  assert.equal(note.slice(anchor.offset,anchor.offset+anchor.quote.length),anchor.quote);
  assert.equal(anchor.quote,'清晨列车__，再走 *雪景小路','retains the exact Markdown source locally');
  await page.getByRole('button',{name:'查看所选原文'}).last().click();
  assert.equal(await page.evaluate(()=>getSelection().toString()),'清晨列车，再走 雪景小路');
  await page.keyboard.press('Escape');
  await select('重复词','重复词',true);
  await trigger.focus(); await trigger.press('Enter');
  await input.fill('为什么？'); await input.press('Enter');
  await page.waitForFunction(()=>window.lastPassage?.question==='为什么？' && !document.querySelector('[data-note-prompt]'));
  const repeated=await page.evaluate(()=>window.lastPassage.selection);
  assert.equal(repeated.offset,note.lastIndexOf('重复词'));
  await select('雪景小路','第二天去阿仁');
  const visibleLines=await page.evaluate(()=>getSelection().toString());
  assert.ok(visibleLines.includes('\n'));
  await trigger.click(); await input.fill('翻译这两段'); await input.press('Enter');
  await page.waitForFunction(()=>window.lastPassage?.question==='翻译这两段');
  assert.equal(await page.evaluate(()=>window.lastPassage.selection.quote),visibleLines,'sends real paragraph breaks');
  await page.getByRole('button',{name:'查看所选原文'}).nth(2).waitFor();
  await page.setViewportSize({width:390,height:800});
  await select('清晨列车','第二天去阿仁');
  await trigger.click(); await input.waitFor();
  const smallBox=await page.getByRole('dialog',{name:'就这段提问'}).boundingBox();
  assert.ok(smallBox.x>=0 && smallBox.x+smallBox.width<=390);
  await input.fill('暂不提问'); await input.press('Escape'); await input.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'笔记正文');
  assert.equal(await trigger.count(),0);
  await select('清晨列车');
  await trigger.click(); await input.fill('草稿');
  await page.getByRole('textbox',{name:'笔记标题'}).click(); await input.waitFor({state:'hidden'});
  assert.equal(await editor.locator('[data-note-prompt], [data-source-start]').count(),0);
  assert.deepEqual(actualErrors,[]);
  console.log('Selection actions use the last selected line and exact original source, support duplicate phrases, jumps across formatted text, inline images, keyboard and narrow-screen dismissal. Native expansion mocked.');
} finally { await browser.close(); }
