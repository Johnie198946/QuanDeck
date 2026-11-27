import test from 'node:test';
import assert from 'node:assert/strict';
import { createMethodImporter,verifyMethod } from './app/method-import.mjs';
const text='用日期和预算搜索车票，列出车次。比较车次，输出行程表。每项票价不超过预算。';
const step=(id,quote)=>({id,title:quote,detail:quote,quote,component:'资料检索',input:'',output:'',standard:'',url:''});
const derivation=()=>({classification:'workflow',reason:'用明确的输入和标准选出车次。',steps:[
  {...step('one','用日期和预算搜索车票'),input:'日期和预算',output:'车次'},
  {...step('two','比较车次'),component:'比较筛选',input:'车次',output:'行程表',standard:'每项票价不超过预算'},
],links:[{from:'one',to:'two',label:'车次'}]});
const source={title:'做法',kind:'note',text};
function fixture({web,adjust}={}) {
  const profile={connectionId:'fixture',tool:'codex'},note={id:'a',revision:1,title:'方法',body:text,attachments:[]};
  const calls=[];
  return {note,calls,service:createMethodImporter({readLibrary:()=>({notes:[note]}),readConfigured:()=>[profile],connections:()=>[profile],
    readAttachment:()=>Buffer.from(text),readWeb:web,assist:async req=>{
      calls.push(req);const response={...req,sourceSessionId:'isolated-session',contextPolicy:'new-isolated-session',toolPolicy:'read-only-isolated',output:derivation()};
      return adjust?adjust(response,note):response;
    }})};
}
test('recognized workflow has real source offsets, component mapping, dependencies and acceptance standard',async()=>{
  const {service,calls}=fixture(); const result=await service.analyze({kind:'note',id:'a'});
  assert.equal(result.classification,'workflow');assert.equal(result.links[0].label,'车次');
  assert.equal(text.slice(result.steps[1].start,result.steps[1].start+result.steps[1].quote.length),'比较车次');
  assert.equal(result.steps[1].standard,'每项票价不超过预算');assert.equal(result.steps[1].component,'比较筛选');assert.equal(result.source.noteId,'a');
  assert.equal(calls.length,1);
});
test('missing input, output, evidence-backed standard or connected acyclic dependencies yield reference cards',()=>{
  for (const alter of [
    o=>o.steps[0].input='', o=>o.steps[1].output='未提到的产物',o=>o.steps[1].standard='编造出来的标准',
    o=>o.links=[],o=>o.links.push({from:'two',to:'one',label:'回去'}),
    o=>o.steps.push({...step('three','行程表'),component:'整理输出'}),
  ]) {
    const o=derivation();alter(o);const v=verifyMethod(o,source);
    assert.equal(v.classification,'reference');assert.equal(v.links.length,0);assert.ok(v.steps.every(s=>s.component==='参考灵感'));
  }
});
test('a fragment stays a reference even if it mentions a famous destination; no automated itinerary',()=>{
  const data={classification:'reference',reason:'只有景点想法。',steps:[{...step('a','清晨去鸭川'),component:'参考灵感'}],links:[]};
  const result=verifyMethod(data,{kind:'file',title:'京都.md',text:'清晨去鸭川。'});
  assert.equal(result.classification,'reference');assert.deepEqual(result.links,[]);
});
test('quoted text and endpoints verified, arbitrary model URLs removed',()=>{
  let o=derivation();o.steps[0].quote='买一张车票';assert.throws(()=>verifyMethod(o,source),/引文/);
  o=derivation();o.links[0].to='elsewhere';assert.throws(()=>verifyMethod(o,source),/终点/);
  o=derivation();o.steps[0].url='https://example.com/unseen';assert.equal(verifyMethod(o,source).steps[0].url,'');
});
test('uploaded file and selected note attachment decoded from bytes, website read before Agent gets it', async()=>{
  const {service,note,calls}=fixture({web:async url=>({text,url,title:'公开攻略'})});
  const bytes=new TextEncoder().encode(text);
  assert.equal((await service.analyze({kind:'file',name:'方法.md',bytes:bytes.buffer})).source.title,'方法.md');
  note.attachments=[{id:'f',name:'方法.txt',size:bytes.byteLength}];
  assert.equal((await service.analyze({kind:'note',id:'a',fileId:'f'})).source.kind,'noteFile');
  const result=await service.analyze({kind:'url',url:'https://example.com/synthetic'});
  assert.equal(result.source.url,'https://example.com/synthetic');assert.ok(calls.every(r=>r.prompt.includes(text)));
});
test('unsupported file, inaccessible URL, bad receipt or stale note cannot create workflow',async()=>{
  const {service,calls}=fixture({web:async()=>{throw Error('网页需要登录');}});
  await assert.rejects(service.analyze({kind:'file',name:'test.bin',bytes:new ArrayBuffer(3)}),/正文/);
  await assert.rejects(service.analyze({kind:'url',url:'https://example.com'}),/登录/);
  assert.equal(calls.length,0);
  await assert.rejects(fixture({adjust:reply=>({...reply,requestId:'wrong'})}).service.analyze({kind:'note',id:'a'}),/来源/);
  await assert.rejects(fixture({adjust:(reply,note)=>{note.revision++;return reply;}}).service.analyze({kind:'note',id:'a'}),/变化/);
});
test('template summary travels via a verified selected Agent and retains directed steps',async()=>{
  const {service,calls}=fixture({adjust:reply=>({...reply,output:{summary:'依据预算筛选列车，输出行程表。'}})});
  const d=derivation();assert.equal(await service.summarize({title:'出行',steps:d.steps,links:d.links}),'依据预算筛选列车，输出行程表。');
  assert.ok(calls[0].prompt.includes('"from":"one","to":"two"'));
});

test('method page keeps its visible booking tool URL and ignores menu links',async()=>{
  const {readPublicKnowledgeSource}=await import('./app/knowledge-source.mjs');
  const text='从车站旁出发，先查询火车时刻，再对照每一步的检查标准筛选路线，最后在给出的网站购买车票，并核对车次和出发日期。';
  const opts={includeLinks:true,addressesFor:async()=>[{address:'93.184.216.34',family:4}],readPage:async()=>({
    type:'text/html',text:'<nav><a href="/not-a-step">首页</a></nav><main><p>'+text+'</p><a href="/tickets">预订车票</a></main>'
  })};
  const page=await readPublicKnowledgeSource('https://example.org/guide',opts);
  assert.match(page.text,/预订车票 \(https:\/\/example.org\/tickets\)/);
  assert.doesNotMatch(page.text,/not-a-step/);
});
