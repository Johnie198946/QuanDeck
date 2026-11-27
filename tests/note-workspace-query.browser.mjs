import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {relayNoteQuestion} from '../desktop/app/knowledge-source.mjs';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4319';
const output=process.env.QUANDECK_UI_OUTPUT||'output/note-agent';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1240,height:880}});
const errors=[],requests=[],prompts=[];page.on('pageerror',e=>errors.push(e.message));
const ask='我还有多少任务没有画删除线？',other='下一场在哪里碰头？',translation='翻译成英语';
const at='2026-11-27T00:00:00Z';
const note=(id,title,body)=>({id,title,body,createdAt:at,updatedAt:at,revision:1,attachments:[],history:[],expansions:[]});
const db={schema:1,decisions:[],notes:[note('inbox','工作随记',[ask,other,translation].join('\n')),
  note('fixes','帮你记问题记录','1. 统一分享按钮\n2. ~~调大标题~~\n3. ~~更新工具栏~~ 修正图片复制\n4. 调整表格行高\n\n集合安排在东门。'),
  note('plan','出发准备','- 对照路线图\n- ~~确认入住时间~~\n\n无关的私密背景不该传递。')],
  inspirationCanvas:{nodes:[{noteId:'card',x:0,y:0,idea:{title:'集合顺序',detail:'先到东门集合。',origin:'manual'}}],links:[]}};
const select=async text=>{
 const editor=page.getByRole('textbox',{name:'笔记正文'});
 await editor.evaluate((el,s)=>{el.focus();const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
 while(w.nextNode()){const n=w.currentNode,i=n.textContent.indexOf(s);if(i===-1) continue;const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+s.length);const box=r.getBoundingClientRect();if(box.bottom>innerHeight-20 || box.top<220)window.scrollBy(0,box.top-innerHeight*.52);
 const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);return;}
 throw Error('missing selection');},text);
 await page.getByRole('button',{name:'就这段提问'}).click();
 if(text !== ask) await page.getByRole('textbox',{name:'补充问题'}).fill(text);
 await page.getByRole('button',{name:'问 AI 并追加'}).click();
};
try{
 await page.exposeFunction('testWorkspaceAgent',async(input,library)=>{
   requests.push(input);
   return relayNoteQuestion(input,{projectId:'personal-knowledge',connection:{connectionId:'test-1',tool:'codex'},readLibrary:()=>library,
     assist:async req=>{
       prompts.push(req.prompt);
       const data=input.workspaceEvidence;
       const answer=input.question===ask?'共有四项。':input.question===translation?'Translate into English.':data?.canLookup?
         JSON.stringify({quandeck_lookup:[{area:'search',search:'集合'},{area:'ideas',search:'集合'}]}):'在东门集合。';
       return {...req,sourceSessionId:'qa-run',contextPolicy:'new-isolated-session',toolPolicy:'read-only-isolated',noteConversation:'new',output:{answer}};
     }});
 });
 await page.goto(origin);const nav=page.getByRole('navigation',{name:'主导航'});await nav.waitFor();
 await page.evaluate(db=>{
   const k='quandeck.personal-knowledge.v1';localStorage.setItem(k,JSON.stringify(db));
   window.quandeckDesktop={platform:'darwin',readKnowledge:async()=>localStorage.getItem(k),compareKnowledge:async(old,data)=>{if(localStorage.getItem(k)!==old)return false;localStorage.setItem(k,data);return true;},
     expandKnowledge:input=>window.testWorkspaceAgent(input,JSON.parse(localStorage.getItem(k)))};
   window.dispatchEvent(new Event('quandeck:personal-knowledge'));
 },db);
 await nav.getByRole('button',{name:'帮你记',exact:true}).click();
 const pick=async name=>{await page.getByRole('complementary',{name:'笔记列表'}).getByRole('button',{name:new RegExp(name)}).click()};
 await pick('工作随记');await select(ask);
 const card=page.getByRole('region',{name:'工作台查询结果'});await card.getByText('4 条任务还没画删除线',{exact:true}).waitFor();
 assert.equal(await card.locator('li').count(),4);assert.equal(await card.getByRole('heading',{level:4}).count(),2);
 await page.locator('[data-answer-id][data-anchored=true]').waitFor();
 const editorBox=page.getByRole('textbox',{name:'笔记正文'});
 const nextLineY=await editorBox.evaluate((el,word)=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const text=walker.currentNode;const pos=text.data.indexOf(word);if(pos>=0){const range=document.createRange();range.setStart(text,pos);range.setEnd(text,pos+1);return range.getBoundingClientRect().top;}}},other);
 const resultBox=await card.boundingBox();
 assert.ok(resultBox.y + resultBox.height <= nextLineY+2,'answer appears before the next logical line even in one paragraph');
 await page.screenshot({path:path.join(output,'workspace-query.png')});
 await card.getByRole('button',{name:/调整表格行高/u}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="笔记标题"]')?.value==='帮你记问题记录' && !!CSS.highlights.get('qd-recalled-passage')?.size);
 assert.match(await page.evaluate(()=>[...CSS.highlights.get('qd-recalled-passage')][0].toString()),/调整表格行高/);
 assert.match(prompts[0],/"全部条目数":6,"未完全划线项数":4/u);assert.doesNotMatch(prompts[0],/无关的私密背景/);assert.match(prompts[0],/确认入住时间/);
 await pick('工作随记');await select(other);
 const second=page.locator('[data-answer-id]').filter({has:page.locator('strong').filter({hasText:other})});
 await second.getByText('在东门集合。',{exact:true}).waitFor();
 assert.equal(requests[1].workspaceEvidence.reads.length,0);
 assert.deepEqual(requests[2].workspaceEvidence.reads.map(r=>r.area),['search','ideas']);
 assert.equal(await second.getByRole('region',{name:'工作台查询结果'}).count(),2);
 await second.getByRole('button',{name:'集合顺序'}).click();
 await page.getByRole('heading',{name:'卡片详情'}).waitFor();
 await nav.getByRole('button',{name:'帮你记',exact:true}).click();await pick('工作随记');
 await select(translation);await page.getByText('Translate into English.',{exact:true}).waitFor();
 assert.equal(requests.at(-1).workspaceEvidence,undefined);assert.deepEqual(errors,[]);
 console.log('PASS 全笔记精确计数、行内分组、点原句高亮、未知问法按需补查两个模块、灵感卡定位、翻译零工作台数据。真实中转与浏览器，模型回执使用固定样例。');
} finally{await browser.close();}
