import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,channel:'chrome'});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const url = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4394';
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const notes = page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你记',exact:true});
const home = page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'首页',exact:true});
const editor = page.getByRole('textbox',{name:'笔记正文'});
const key = 'quandeck.personal-knowledge.v1';
async function ask(quote, question, readPublic=false) {
  await editor.evaluate((el,text) => {
    el.focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode(); node; node=walker.nextNode()){
      const index=node.data.indexOf(text);
      if(index<0) continue;
      const range=document.createRange();
      range.setStart(node,index);range.setEnd(node,index+text.length);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return;
    }
    throw Error('Missing synthetic excerpt');
  },quote);
  await page.getByRole('button',{name:'就这段提问'}).click();
  await page.getByRole('textbox',{name:'补充问题'}).fill(question);
  if (readPublic) await page.getByRole('checkbox',{name:/公开网页/}).check();
  await page.getByRole('button',{name:'问 AI 并追加'}).click();
  await page.getByText('等待 Agent 回复，可继续写',{exact:true}).waitFor();
}
try {
  await page.goto(url); await notes.waitFor();
  await page.evaluate(key=>{
    const at='2026-11-26T02:00:00Z';
    const note={id:'agent-test',title:'排练笔记',body:'开场前核对灯光。',createdAt:at,updatedAt:at,revision:1,attachments:[],expansions:[],history:[]};
    localStorage.setItem(key,JSON.stringify({schema:1,decisions:[],notes:[note]}));
    const times=window.measurements={};
    document.addEventListener('click',e=>{
      if(e.target.closest('button')?.getAttribute('aria-label')==='问 AI 并追加') times.click=performance.now();
    },true);
    window.calls=0;window.inputs=[];window.writes=0;
    window.quandeckDesktop={platform:'darwin',
      onNoteAnswerProgress:callback=>{window.emitAnswerProgress=event=>callback({requestId:window.inputs.at(-1)?.requestId,...event});return ()=>{delete window.emitAnswerProgress;};},readKnowledge:async()=>localStorage.getItem(key),
      compareKnowledge:async(old,next)=>{
        window.writes++;
        if(window.pauseWrites) await new Promise(resolve=>{window.resumeWrite=resolve;});
        if(window.failNextWrite){window.failNextWrite=false;throw new Error('写盘暂不可用');}
        if(old!==localStorage.getItem(key))return false;
        localStorage.setItem(key,next); return true;
      },expandKnowledge:async input=>{
        times.dispatch=performance.now();window.calls++;window.inputs.push(input);
        return new Promise((resolve,reject)=>{
          window.answer=text=>{times.delivered=performance.now();resolve({answer:text,sourceIds:input.revision?[input.noteId+'@'+input.revision]:[]});};
          window.failQuestion=()=>reject(new Error('连接中断'));
        });
      }};
    window.dispatchEvent(new Event('quandeck:personal-knowledge'));
  },key);
  await notes.click(); await editor.getByText('开场前核对灯光。').waitFor();
  await ask('核对灯光','  灯光什么时候检查？  ');
  const firstInput=await page.evaluate(()=>window.inputs[0]);
  assert.deepEqual(Object.keys(firstInput).sort(),['noteId','question','requestId','revision','selection']);
  assert.equal(firstInput.question,'  灯光什么时候检查？  ');
  assert.deepEqual(firstInput.selection,{quote:'核对灯光',offset:3});
  assert.match(firstInput.requestId,/^[0-9a-f-]{36}$/);
  await page.evaluate(()=>window.emitAnswerProgress({requestId:'other-request',noteId:'agent-test',stage:'responding',text:'上一轮回复'}));
  assert.equal(await page.getByText('上一轮回复',{exact:true}).count(),0);
  await page.evaluate(()=>window.emitAnswerProgress({noteId:'another-note',stage:'responding',text:'另一篇笔记的回复'}));
  assert.equal(await page.getByText('另一篇笔记的回复',{exact:true}).count(),0);
  await page.evaluate(()=>window.emitAnswerProgress({noteId:'agent-test',stage:'accepted'}));
  await page.getByText('Agent 已接收，可继续写',{exact:true}).waitFor();
  await page.evaluate(()=>window.emitAnswerProgress({noteId:'agent-test',stage:'reconnecting'}));
  await page.getByText('Agent 正在重新连接',{exact:true}).waitFor();
  await page.evaluate(()=>window.emitAnswerProgress({noteId:'agent-test',stage:'responding',text:'已收到开头…'}));
  await page.getByText('已收到开头…',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-answer-id]').count(),0);
  const dispatchMs=await page.evaluate(()=>window.measurements.dispatch-window.measurements.click);
  assert(await editor.isEditable());
  await editor.fill('已把灯光检查改为提前一天。');
  await home.click(); await notes.click();
  await editor.getByText('已把灯光检查改为提前一天。').waitFor();
  await page.getByText('已收到开头…',{exact:true}).waitFor();
  await page.evaluate(()=>{
    const observer=new MutationObserver(()=>{
      if(document.querySelector('.qd-answer-content')?.textContent.includes('彩排前完成')){
        window.measurements.visible=performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    window.answer('彩排前完成');
  });
  await page.getByText('彩排前完成',{exact:true}).waitFor();
  const renderMs=await page.evaluate(()=>window.measurements.visible-window.measurements.delivered);
  await page.getByText('原文位置已变化',{exact:true}).waitFor();
  await page.getByRole('button',{name:'查看回答'}).click();
  assert.equal(await page.evaluate(()=>window.calls),1);
  await ask('提前一天','这是什么意思？');
  await page.evaluate(()=>window.failQuestion());
  await page.getByRole('button',{name:'重试提问'}).click();
  await page.getByText('等待 Agent 回复，可继续写',{exact:true}).waitFor();
  await home.click();
  await page.evaluate(()=>window.answer('提前到前一个工作日'));
  await notes.click();
  await page.getByText('提前到前一个工作日',{exact:true}).waitFor();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).notes[0],key);
  assert.equal(saved.body,'已把灯光检查改为提前一天。');
  assert.equal(saved.expansions.length,2);
  assert.equal(saved.expansions[0].selection.quote,'核对灯光');
  assert.equal(await page.evaluate(()=>window.calls),3);
  await page.getByRole('button',{name:'新建',exact:true}).click();
  await editor.fill('Original: Winter market opens at six. End. https://example.org/query?key=skip https://127.0.0.1/private https://www.example.org/a#one https://www.example.org/a#two https://www.example.com/b https://example.org/c');
  await page.evaluate(()=>{window.pauseWrites=true;window.priorWrites=window.writes;});
  await ask(' Winter market opens at six. ','请翻译');
  const draftRequest=await page.evaluate(()=>window.inputs.at(-1));
  assert.equal(draftRequest.selection.quote,' Winter market opens at six. ');
  assert.equal('revision' in draftRequest,false);
  assert.equal(await page.evaluate(()=>window.writes-window.priorWrites),0,'draft dispatch precedes any storage write');
  const translation='  "六点开门"\n\n{"answer":"保留这个字段"}\n*原样*  ';
  await page.evaluate(text=>window.answer(text),translation);
  await page.getByText('{"answer":"保留这个字段"}',{exact:false}).first().waitFor();
  await page.waitForFunction(()=>!!window.resumeWrite);
  assert.equal(await page.getByRole('button',{name:'查看回答'}).count(),1,'reply is available while storage is stalled');
  await page.evaluate(()=>{window.pauseWrites=false;window.resumeWrite();});
  await page.waitForFunction(({key,id,text})=>JSON.parse(localStorage.getItem(key)).notes.find(n=>n.id===id)?.expansions[0]?.answer===text,{key,id:draftRequest.noteId,text:translation});
  await ask('Winter market','再翻译一遍',true);
  assert.deepEqual(await page.evaluate(()=>window.inputs.at(-1).publicLinks),['https://www.example.org/a','https://www.example.com/b']);
  await page.evaluate(()=>{window.failNextWrite=true;window.answer('集市六点开门。');});
  await page.getByText('集市六点开门。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'重试保存'}).click();
  await page.waitForFunction(({key,id})=>JSON.parse(localStorage.getItem(key)).notes.find(n=>n.id===id)?.expansions.length===2,{key,id:draftRequest.noteId});
  assert.equal(await page.evaluate(()=>window.calls),5,'saving a completed answer never calls the Agent again');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({transport:'synthetic controllable provider',dispatchMs,renderMs,editableDuringWait:true,changedQuoteRetained:true,navigationAndRetry:true}));
} finally {await browser.close();}
