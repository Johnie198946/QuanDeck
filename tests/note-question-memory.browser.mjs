import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {relayNoteQuestion} from '../desktop/app/knowledge-source.mjs';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/latency';
await mkdir(output, {recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const first='现场如何候车？', at='2026-11-27T00:01:00Z';
const note=(id,title,body)=>({id,title,body,createdAt:at,updatedAt:at,revision:1,attachments:[],history:[],expansions:[]});
const library={schema:1,decisions:[],notes:[note('home','排练安排','集合点是西门。\n'+first+'\n排练只有五分钟。'),note('whole','入场安排','蓝色通道已开。'),note('memo','预算提醒','隐私。预算150元。无需分享。')],
  inspirationCanvas:{nodes:[{noteId:'choice',x:1,y:1,idea:{origin:'manual',title:'先排除超预算项',detail:'再比较时间'}}],links:[]}};
const sent=[],prompts=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*', route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
try {
  await page.exposeFunction('askTestAgent',async(input,db)=>{
    sent.push(input);
    return relayNoteQuestion(input,{projectId:'personal-knowledge',connection:{connectionId:'synthetic',tool:'codex'},readLibrary:()=>db,
      assist:async request=>{prompts.push(request);return {...request,sourceSessionId:'verified-stub',contextPolicy:'new-isolated-session',toolPolicy:'read-only-isolated',noteConversation:input.parentAnswerId?'replayed':'new',output:{answer:input.parentAnswerId?'先集合，再确认时间。':'先按预算筛选，再核对时间。'}}}});
  });
  await page.goto(origin);
  await page.getByRole('navigation',{name:'主导航'}).waitFor();
  await page.evaluate(data=>{
    const k='quandeck.personal-knowledge.v1';localStorage.setItem(k,JSON.stringify(data));
    window.quandeckDesktop={platform:'darwin',readKnowledge:async()=>localStorage.getItem(k),
      compareKnowledge:async(old,v)=>{if(localStorage.getItem(k)!==old)return false;localStorage.setItem(k,v);return true},
      expandKnowledge:input=>window.askTestAgent(input,JSON.parse(localStorage.getItem(k)))};
    window.dispatchEvent(new Event('quandeck:personal-knowledge'));
  },library);
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你记',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'笔记正文'});await editor.filter({hasText:first}).waitFor();
  await editor.evaluate((el,text)=>{el.focus();const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    while(w.nextNode()){const n=w.currentNode,k=n.textContent.indexOf(text);if(k<0)continue;const r=document.createRange();r.setStart(n,k);r.setEnd(n,k+text.length);
    const s=window.getSelection();s.removeAllRanges();s.addRange(r);return;}throw Error('synthetic selection missing');
  },first);
  await page.locator('.qd-passage-trigger').first().click();
  await page.getByRole('textbox',{name:'补充问题'}).fill('按资料选一种走法');
  await page.getByText('补充背景与参考',{exact:true}).click();
  await page.getByRole('textbox',{name:'补充背景',exact:true}).fill('同行两人');
  const source=page.getByRole('combobox',{name:'引用',exact:true});
  await page.getByRole('checkbox',{name:'附上原文前后文'}).check();
  await source.selectOption('n:whole');
  await page.getByRole('button',{name:'引用整篇笔记'}).click();
  await source.selectOption('n:memo');
  const field=page.getByRole('textbox',{name:'划选要引用的文字'});
  await field.focus();await field.press('Home');
  for(let i=0;i<3;i++)await field.press('ArrowRight');
  for(let i=0;i<6;i++)await field.press('Shift+ArrowRight');
  await page.getByRole('button',{name:'加入这段参考'}).click();
  await source.selectOption('i:choice');await page.getByRole('button',{name:'加入这段参考'}).click();
  await page.screenshot({path:path.join(output,'question-materials.png')});
  await page.getByRole('button',{name:'问 AI 并追加'}).click();
  const firstCard=page.locator('[data-answer-id]').filter({hasText:'先按预算筛选'});
  await firstCard.getByRole('button',{name:'追问'}).click();
  await page.getByRole('dialog',{name:'追问这个回答'}).getByRole('textbox',{name:'追问',exact:true}).fill('下一步呢？');
  await page.getByRole('button',{name:'发送追问'}).click();
  await page.getByText('先集合，再确认时间。',{exact:true}).first().waitFor();
  assert.equal(sent.length,2);assert.equal(sent[0].selection.quote,first);assert.deepEqual(sent[0].memoryRefs.map(r=>r.kind),['passage','passage','idea']);assert.equal(sent[0].background,'同行两人');
  assert.match(prompts[0].prompt,/蓝色通道已开/);assert.match(prompts[0].prompt,/集合点是西门/);assert.match(prompts[0].prompt,/五分钟/);assert.match(prompts[0].prompt,/预算150元/);assert.match(prompts[0].prompt,/先排除超预算项/);assert.match(prompts[0].prompt,/同行两人/);assert.doesNotMatch(prompts[0].prompt,/隐私|无需分享/);
  assert.equal(prompts[1].noteThread.parentRequestId,sent[0].requestId);assert.match(prompts[1].noteThread.history,/先按预算筛选/);
  assert.deepEqual(errors,[]);console.log('PASS selection → explicit preceding/following lines + whole selected note + exact excerpt + idea card + own background → real relay prompt → answered card → follow-up linked to first request. Other note text absent. Agent inference stubbed.');
} finally {await browser.close()}
