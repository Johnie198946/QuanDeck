import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createMethodImporter } from '../desktop/app/method-import.mjs';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4684';
const out=process.env.QUANDECK_UI_OUTPUT || 'output/methods';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1350,height:888}});
const b=name=>page.getByRole('button',{name,exact:true});
const profile={tool:'codex',connectionId:'synthetic'};
const text='用日期查车票，列出车次。比较车次，输出行程表。每项票价不超过预算。';
const note={id:'walk',title:'京都灵感',body:'清晨去鸭川散步。',revision:1,attachments:[],expansions:[],history:[],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
const fullStep=(id,title,quote)=>({id,title,detail:title,quote,component:'资料检索',input:'',output:'',standard:'',url:''});
const analysis=createMethodImporter({
  readLibrary:()=>({notes:[note]}),readConfigured:()=>[profile],connections:()=>[profile],
  readWeb:async()=>{throw Error('网页没有可读取正文');},
  assist:async r=>{
    const m=JSON.parse(r.prompt.split('\n').at(-1));const complete=m.text===text;
    return {...r,sourceSessionId:'fixture',toolPolicy:'read-only-isolated',contextPolicy:'new-isolated-session',output:{
      classification:complete?'workflow':'reference',reason:complete?'有输入、步骤、产物和票价标准。':'只有散步地点和时间。',steps:complete?[
        {...fullStep('a','查车票','用日期查车票'),input:'日期',output:'车次'},
        {...fullStep('b','比较车次','比较车次'),component:'比较筛选',input:'车次',output:'行程表',standard:'每项票价不超过预算'},
      ]:[{...fullStep('r','清晨散步','清晨去鸭川散步'),component:'参考灵感'}],links:complete?[{from:'a',to:'b',label:'车次'}]:[],
    }};
  },
});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
const enter=async()=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你想'}).click();await b('灵感逻辑').click();};
const key='quandeck.personal-knowledge.v1';
try {
  await page.goto(origin);
  await page.evaluate(({key,note})=>localStorage.setItem(key,JSON.stringify({schema:1,notes:[note],decisions:[],inspirationCanvas:{nodes:[],links:[]}})),{key,note});
  await enter();await b('导入方法').click();await page.getByRole('checkbox',{name:'京都灵感'}).check();
  await b('文件').click();await page.getByLabel('选择方法文件').setInputFiles({name:'出行办法.md',mimeType:'text/markdown',buffer:Buffer.from(text)});
  await b('链接').click();await page.getByRole('textbox',{name:'公开网页'}).fill('https://example.org/unread');
  await page.exposeFunction('qaReadMethod',async spec=>{
    if(spec.kind==='file')spec.bytes=Uint8Array.from(spec.data).buffer;
    return analysis.analyze(spec);
  });
  await page.evaluate(()=>{window.quandeckDesktop={analyzeMethod:async input=>{
    const {bytes,...rest}=input;return window.qaReadMethod({...rest,...(bytes&&{data:Array.from(new Uint8Array(bytes))})});
  }};});
  await b('AI 识别').click();await page.getByRole('heading',{name:'导入预览'}).waitFor();
  await page.getByText('网页没有可读取正文').waitFor();
  assert.equal(await page.getByRole('checkbox',{checked:true}).count(),2);
  const firstChoice=page.locator('.qd-method-preview label').first();
  const checkboxBox=await firstChoice.getByRole('checkbox').boundingBox();
  const nameBox=await firstChoice.locator('b').boundingBox();
  assert.ok(checkboxBox.width<30 && Math.abs((checkboxBox.y+checkboxBox.height/2)-(nameBox.y+nameBox.height/2))<3,'preview selection beside the source name');
  await page.screenshot({path:path.join(out,'method-import-preview.png')});
  await page.evaluate(()=>{delete window.quandeckDesktop;});
  await b('加入画布').click();await b('画布灵感「比较车次」').click();await page.getByText('每项票价不超过预算',{exact:true}).waitFor();
  const snapshot=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
  assert.equal(snapshot.inspirationCanvas.nodes.length,3);assert.equal(snapshot.inspirationCanvas.links.length,1);
  assert.equal(snapshot.inspirationCanvas.nodes.filter(n=>n.idea.reference?.file).length,2);
  const ids=snapshot.inspirationCanvas.nodes.map(n=>n.idea.reference?.file?.id).filter(Boolean);assert.equal(ids[0],ids[1]);
  await page.reload();await enter();await b('画布灵感「清晨散步」').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS 方法文件、碎片笔记与无法读取的网页逐项预览；两个有向步骤和一张独立灵感可重开、共享原文件；检查标准可打开。');
} finally{await browser.close();}
