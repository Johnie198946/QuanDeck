import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4479';
const out=process.env.QUANDECK_UI_OUTPUT||'output/note-answers';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1320,height:840}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await mkdir(out,{recursive:true});await page.goto(base);
 const phrase='雷雨预报出来时怎么调整？';
 await page.evaluate(phrase=>{
   const now=new Date().toISOString();
   localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,decisions:[],notes:[{id:'rain',title:'周末行程研讨',body:'1. 周六上午去公园。\n2. '+phrase+'\n3. 傍晚按原计划集合。',revision:1,updatedAt:now,createdAt:now,attachments:[],history:[],expansions:[]}]}));
 },phrase);
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你记',exact:true}).click();
 const editor=page.getByRole('textbox',{name:'笔记正文'});
 await editor.waitFor(); await page.waitForFunction(()=>document.querySelector('.qd-note-title')?.value==='周末行程研讨');
 const answer='**先换室内活动，接驳车前十分钟再确认。 **\n\n## 备选安排\n\n| 情况 | 去哪里 | 怎么走 | 最晚出发 |\n| --- | --- | --- | --- |\n| 下小雨 | 植物温室 | 东门步行 | 10:30 |\n| 有雷雨 | 市立博物馆 | 免费接驳 | 11:00 |\n\n1. 出发前看一次天气。\n2. 在接驳车站确认等候人数。';
 await page.evaluate(({phrase,answer})=>{
   let progress;
   window.quandeckDesktop={platform:'darwin',readKnowledge:async()=>localStorage.getItem('quandeck.personal-knowledge.v1'),
     compareKnowledge:async(expected,v)=>{if(expected!==localStorage.getItem('quandeck.personal-knowledge.v1'))return false;localStorage.setItem('quandeck.personal-knowledge.v1',v);return true;},
     onNoteAnswerProgress:cb=>{progress=cb;return ()=>{};},
     expandKnowledge:async input=>{progress({requestId:input.requestId,noteId:input.noteId,stage:'responding',text:answer});
       await new Promise(done=>window.finishSyntheticAnswer=done); return {answer,sourceIds:[input.noteId]};}};
   const element=document.querySelector('[aria-label="笔记正文"]');element.focus();
   const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){const n=walker.currentNode,at=n.textContent.indexOf(phrase);if(at<0)continue;
     const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+phrase.length);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);break;}
 },{phrase,answer});
 await page.getByRole('button',{name:'询问 AI',exact:true}).click({timeout:4500}).catch(async()=>{
   await page.locator('.qd-passage-trigger').first().click();
 });
 await page.getByRole('textbox',{name:'补充问题'}).fill('给我两种走法');
 await page.getByRole('button',{name:'问 AI 并追加'}).click();
 const card=page.locator('[data-answer-id]').first();await card.locator('table').waitFor();
 await page.waitForFunction(()=>!!document.querySelector('[data-answer-id][data-anchored]'));
 assert.ok(!(await page.locator('.qd-note-edit-head').innerText()).includes('室内活动'));
 assert.equal(await card.locator('strong').filter({hasText:'先换室内活动'}).count(),1);
 await page.evaluate(()=>window.finishSyntheticAnswer());await card.getByRole('button',{name:'追问'}).waitFor();
 for(const width of [1320,390]){
   await page.setViewportSize({width,height:840});await card.scrollIntoViewIfNeeded();
   const start=await editor.locator('li').nth(1).boundingBox(), after=await editor.locator('li').nth(2).boundingBox();
   const box=await card.boundingBox(),table=await card.getByRole('region',{name:'回答表格'}).boundingBox();
   assert.ok(start.y+start.height<=box.y+1 && box.y+box.height<=after.y+1,'answer must sit between selected and following list items');
   assert.ok(table.x>=box.x && table.x+table.width<=box.x+box.width+1);
   assert.ok(box.x>=0 && box.x+box.width<=width+1);
   await page.screenshot({path:path.join(out,'answer-'+width+'.png')});
 }
 assert.deepEqual(errors,[]);console.log('Passed: streaming and final answers stay with the quote, formatted Markdown and table containment on wide and narrow screens.');
}finally{await browser.close();}
