import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraphGenerator, reviewPeriod, scheduleKnowledgeReviews } from './app/knowledge-graph-agent.mjs';
import { candidateGroups } from './app/knowledge-reasoning.mjs';
import { retrieveCandidates } from './app/knowledge-candidates-worker.mjs';
import { isApplicationPathAllowed } from '../scripts/clean-release.mjs';

const date='2026-10-01T00:00:00.000Z';
const note=(id,body,extra={})=>({id,title:id,body,revision:1,updatedAt:date,...extra});
const fixtures=[
  note('router','按队列拥塞程度选择推理端点。'),
  note('travel','景点排队时间超过二十分钟，就改去备用景点。'),
  note('weather','只有室内景点可在雨天候补。'),
];
function atom(part,quote,extra={}) {
  return {part:part.part,quote,kind:'方法',summary:part.title+'的方法',domain:part.title,
    entities:[],mechanism:'动态选择',goal:'减少等待',constraint:'',features:[0,3,2,0,0,0,0,0,0,0,0,0],...extra};
}
const readAtoms = materials=>materials.filter(m=>m.source!=='title').map(m=>atom(m,m.text));
const proposal = (list,extra={})=>({evidence:list.map(m=>m.id),category:'复用',mode:'类比',
  label:'按等待时间动态改道',explanation:'将端点队列对应到景点排队，当拥挤超过阈值时切换到备选去处。',
  consequence:'旅行者在排长队前能换一个仍开放的景点。',check:'用过去一周的等待时间回放，比较切换前后的总等待时间。',
  limitation:'没有可靠排队数据或备选点闭园时不能应用。',...extra});
function setup({notes=structuredClone(fixtures), extract=readAtoms, reason=list=>[proposal(list)], alter, configured=true, signal}={}) {
  const library={schema:1,notes,decisions:[]};
  const calls=[],progress=[];
  const profile={tool:'codex',connectionId:'fixture'};
  let time=Date.parse(date);
  const generate=createKnowledgeGraphGenerator({
    signal,
    now:()=>time,readLibrary:()=>library,readConfigured:()=>[profile],connections:()=>configured ? [profile]:[],
    saveGraph:(latest,graph)=>Object.assign(library,latest,{agentGraph:graph}),onProgress:p=>progress.push(p),
    assist:async request=>{
      const stage=request.outputSchema.properties.atoms ? 'atoms':'findings';
      const materials=JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n')+1));
      calls.push({stage,materials,request});
      const result=stage==='atoms'?await extract(materials):await reason(materials);
      const receipt={...request,contextPolicy:'new-isolated-session',toolPolicy:'read-only-isolated',
        sourceSessionId:'fixture-session',output:{[stage]:result}};
      await alter?.({request,receipt,library,profile,stage});
      return receipt;
    },
  });
  return {library,calls,progress,profile,generate,advance:amount=>{time+=amount;}};
}
const stages=(calls,type)=>calls.filter(c=>c.stage===type);
const flattened=(calls,stage)=>stages(calls,stage).flatMap(c=>c.materials);

test('all notes, archived records and anchored AI/citation sources enter analysis; concurrent requests join; caches invalidate by provider',async()=>{
  const f=setup();
  f.library.notes[0].history=[{body:'obsolete secret'}];
  f.library.notes[1].archivedAt=date;
  f.library.notes[0].expansions=[{id:'reply',answer:'阈值变动可以触发重新选择。',sources:[{excerpt:'公开等待数据每小时刷新。'}]}];
  const [a,b]=await Promise.all([f.generate(),f.generate()]);
  assert.deepEqual(a,b);
  assert.equal(stages(f.calls,'atoms').length,1);
  assert.ok(stages(f.calls,'findings').length>0);
  const materials=flattened(f.calls,'atoms');
  assert.ok(materials.some(m=>m.title==='travel'));
  assert.ok(materials.every(m=>!JSON.stringify(m).includes('obsolete secret')));
  const {atoms}=f.library.agentGraph.reasoning;
  assert.equal(atoms.find(a=>a.source==='expansion:reply').origin,'AI推断');
  assert.equal(atoms.find(a=>a.source==='citation:reply:0').origin,'引用资料');
  assert.ok(atoms.every(a=>!Object.hasOwn(a,'quote') && !Object.hasOwn(a,'body')));
  assert.equal(f.progress.at(-1),null);
  const count=f.calls.length;
  assert.equal((await f.generate()).reused,true);assert.equal(f.calls.length,count);
  f.profile.model='another-model';
  await f.generate();
  assert.equal(stages(f.calls,'atoms').length,2);
});

test('concurrent manual canvas changes and user decisions are merged on write',async()=>{
  const f=setup({alter:({library})=>{
    library.decisions=[{evidence:'manually-saved',result:'accepted'}];
    library.inspirationCanvas={nodes:[{noteId:'manual',x:0,y:0}],links:[]};
  }});
  await f.generate();
  assert.equal(f.library.decisions[0].evidence,'manually-saved');
  assert.equal(f.library.inspirationCanvas.nodes[0].noteId,'manual');
});

test('stale notes, changed model, wrong provider or policy, ambiguous and invented quotations and ungrounded evidence preserve previous graph',async()=>{
  for (const invalid of ['stale','model','part','quote','ambiguous','policy','provider','reason','failure']) {
    const f=setup({alter:({library,profile,receipt,stage})=>{
      if(invalid==='stale') library.notes[0].revision++;
      if(invalid==='model') profile.model='new';
      if(invalid==='policy') receipt.toolPolicy='unverified';
      if(invalid==='provider') receipt.tool='dsh';
      if(invalid==='failure') throw Object.assign(Error(),{code:'SYSTEM_TIMEOUT'});
      if(stage==='atoms') {
        if(invalid==='part') receipt.output.atoms[0].part='not-in-this-batch';
        if(invalid==='quote') receipt.output.atoms[0].quote='invented';
        if(invalid==='ambiguous') receipt.output.atoms[0].quote='重复';
      }
      if(stage==='findings' && invalid==='reason') receipt.output.findings[0].evidence=['1','999999'];
    }});
    if(invalid==='ambiguous') f.library.notes[0].body='重复，重复';
    f.library.agentGraph={old:true};
    await assert.rejects(f.generate(),/更新|来源|配置|引文|依据|核对|超时/,invalid);
    assert.deepEqual(f.library.agentGraph,{old:true},invalid);
  }
});

test('empty library and missing configured connection skip provider; a single note can hold multiple viewpoints',async()=>{
  const absent=setup({configured:false});
  await assert.rejects(absent.generate(),/连接/);assert.equal(absent.calls.length,0);
  const empty=setup({notes:[]});
  await assert.rejects(empty.generate(),/一篇笔记/);assert.equal(empty.calls.length,0);
  const f=setup({notes:[note('same','室内每天限流十人。雨天不限流。')],
    extract:materials=>materials.filter(m=>m.source==='body').flatMap(m=>[
      atom(m,'室内每天限流十人。',{kind:'事实'}),atom(m,'雨天不限流。',{kind:'观点'})]),
    reason:list=>[proposal(list,{category:'矛盾',mode:'矛盾',label:'雨天限流是否例外'})]});
  await f.generate();
  const [edge]=f.library.agentGraph.edges;
  assert.equal(edge.from,'same');assert.equal(edge.to,'same');
  assert.deepEqual(new Set(edge.anchors.map(a=>a.origin)),new Set(['用户观点','原文事实陈述']));
  assert.equal(f.library.decisions.length,0,'Agent cannot confirm a conflict on the user’s behalf');
});

test('incremental revisions re-extract changed chunks only, retaining superseded findings and their original anchors',async()=>{
  const f=setup({reason:list=>list.some(m=>m.note==='router') && list.some(m=>m.note==='travel')
    ? [proposal([list.find(m=>m.note==='router'),list.find(m=>m.note==='travel')])]:[]});
  await f.generate();
  const prior=f.library.agentGraph.edges[0].evidenceKey;
  f.library.decisions.push({evidence:prior,result:'dismissed'});
  f.calls.length=0;
  f.library.notes[1].updatedAt='2026-10-02T00:00:00Z';
  f.library.notes[1].revision++;
  f.library.notes[1].body='景点排队超过四十分钟才改走备用路线。';
  await f.generate();
  assert.deepEqual(flattened(f.calls,'atoms').map(m=>m.text),[f.library.notes[1].body]);
  const [history]=f.library.agentGraph.reasoning.history;
  assert.equal(history.finding.key,prior);assert.equal(history.decision,'dismissed');
  assert.equal(history.anchors.find(a=>a.noteId==='travel').revision,1);
  assert.notEqual(f.library.agentGraph.edges[0].evidenceKey,prior);
  assert.deepEqual(f.library.agentGraph.edges[0].anchors.map(a=>a.revision),[1,2]);
});

test('historical review revisits prior notes without re-extraction; reworded or reversed suggestions retain the user feedback key',async()=>{
  let reverse=false;
  const f=setup({reason:list=>{
    const evidence=['router','travel'].map(id=>list.find(m=>m.note===id));
    return evidence.every(Boolean)?[proposal(reverse?evidence.reverse():evidence,{label:reverse?'新的措辞':'按等待时间动态改道'})]:[];
  }});
  await f.generate();
  const key=f.library.agentGraph.edges[0].evidenceKey;
  f.library.decisions.push({evidence:key,result:'dismissed'});
  f.advance(reviewPeriod+1);reverse=true;f.calls.length=0;
  await f.generate();
  assert.equal(stages(f.calls,'atoms').length,0);
  assert.ok(stages(f.calls,'findings').length>0);
  assert.equal(f.library.agentGraph.reasoning.round,1);
  assert.equal(f.library.agentGraph.edges[0].evidenceKey,key);
  assert.equal(f.library.decisions.find(d=>d.evidence===key).result,'dismissed');
});

test('across many batches a rare pair and the end of a long note reach analysis',async()=>{
  const notes=Array.from({length:1000},(_,i)=>note('Note'+i,i===0?'RareAstrometry 深空测量甲。':i===999?'RareAstrometry 深空测量乙。':'只是占位'));
  notes[10].body='X'.repeat(10800)+'最后一段有观测误差。';
  let distantPair=false;
  const f=setup({notes,extract:materials=>materials.filter(m=>m.source==='body' && /RareAstrometry|最后一段/.test(m.text))
    .map(m=>atom(m,m.text.includes('最后一段')?'最后一段有观测误差。':m.text)),
    reason:list=>{if(list.some(m=>m.note==='Note0') && list.some(m=>m.note==='Note999')) distantPair=true;return [];}});
  await f.generate();
  assert.equal(new Set(flattened(f.calls,'atoms').map(m=>m.title)).size,1000);
  assert.ok(stages(f.calls,'atoms').length<200,'chunk extraction is batched');
  assert.ok(distantPair);
  assert.equal(f.library.agentGraph.reasoning.atoms.find(a=>a.noteId==='Note10').start,10800);
  assert.equal(f.library.agentGraph.edges.length,0);
  assert.equal(f.progress.at(-1),null);
});

test('separate retrieval channels reserve distant cross-domain and indirect neighbours beyond rotating partners',()=>{
  const atoms=Array.from({length:80},(_,i)=>({id:String(i).padStart(2,'0'),summary:'topic'+i,entities:[],mechanism:'',goal:'',constraint:'',
    features:Array(12).fill(0),domain:i===0?'routing':'domain'+i}));
  const quotes=new Map(atoms.map(a=>[a.id,a.summary]));
  atoms[0].mechanism=atoms[48].mechanism='dynamic routing';
  atoms[0].features[1]=atoms[53].features[1]=3;
  quotes.set('00','uncommonphrase');quotes.set('61','uncommonphrase');
  const prior=[{evidence:['00','69']},{evidence:['69','72']}];
  const [group]=candidateGroups(atoms,quotes,prior,new Set(['00']));
  for (const id of ['48','53','61','72']) assert.ok(group.includes(id),'channel missed '+id);
  const first=candidateGroups(atoms,quotes,[],new Set(['08']),0);
  const next=candidateGroups(atoms,quotes,[],new Set(['08']),1);
  assert.notDeepEqual(first,next,'successive reviews rotate historical, unrelated partners');
});

test('combination and multihop require three distinct grounded atoms; empty or circular low-value suggestions yield no graph clutter',async()=>{
  const f=setup({reason:list=>[
    proposal(list.slice(0,2),{mode:'多跳'}),proposal(list.slice(0,2),{mode:'组合'}),proposal([list[0],list[0]]),
    proposal(list,{mode:'组合',category:'创新',label:'拥挤与天气联合选路'}),
  ]});
  await f.generate();
  assert.equal(f.library.agentGraph.edges.length,1);
  assert.equal(f.library.agentGraph.edges[0].anchors.length,3);
  assert.equal(f.library.agentGraph.edges[0].mode,'组合');
  const trivial=setup({reason:list=>[proposal(list.slice(0,2),{
    label:'有关联',explanation:'有关联',consequence:'有关联',check:'有关联',limitation:'有关联',
  })]});
  await trivial.generate();
  assert.equal(trivial.library.agentGraph.edges.length,0);
});

test('save bursts coalesce, edits during a run retry once, periodic checks revisit aged history, and shutdown cancels timers',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  let generateCount=0,release;
  const lib={notes:[note('n','已保存')],agentGraph:{reasoning:{reviewAt:date}}};
  let now=Date.parse(date), enabled=true;
  const scheduler=scheduleKnowledgeReviews({readLibrary:()=>lib,canRun:()=>enabled,now:()=>now,delay:20,interval:100,
    generate:async()=>{generateCount++; if(generateCount===1) await new Promise(resolve=>{release=resolve;}); lib.agentGraph.reasoning.reviewAt=new Date(now).toISOString();}});
  try {
    scheduler.changed();scheduler.changed();
    t.mock.timers.tick(19);assert.equal(generateCount,0);
    t.mock.timers.tick(1);assert.equal(generateCount,1);
    scheduler.changed();scheduler.changed();t.mock.timers.tick(20);assert.equal(generateCount,1);
    release();await new Promise(resolve=>setImmediate(resolve));
    t.mock.timers.tick(20);assert.equal(generateCount,2);
    await new Promise(resolve=>setImmediate(resolve));
    t.mock.timers.tick(100);assert.equal(generateCount,2);
    now+=reviewPeriod;enabled=false;t.mock.timers.tick(100);assert.equal(generateCount,2);
    enabled=true;t.mock.timers.tick(100);assert.equal(generateCount,3);
    scheduler.stop();await new Promise(resolve=>setImmediate(resolve));
    scheduler.changed();t.mock.timers.tick(500);assert.equal(generateCount,3);
  } finally {scheduler.stop();}
});


test('large dense retrieval yields to UI events; actual worker preserves the pure rankings',async()=>{
  const atoms=Array.from({length:900},(_,i)=>({
    ...atom({part:'0',title:'共享'},'共用资料'),
    id:'id-'+i,domain:'领域'+(i%3),
  }));
  const ids=new Set(atoms.map(a=>a.id));
  const quotes=new Map(atoms.map(a=>[a.id,'优先减少等待，按条件动态规划']));
  let ticks=0;
  const timer=setInterval(()=>ticks++,5);
  let groups;
  try { groups=await retrieveCandidates(atoms,quotes,[],ids,0); }
  finally { clearInterval(timer); }
  assert.ok(ticks>=2,'main loop must run while cold indexing');
  assert.ok(groups.length>100);
  const focus=new Set([atoms[0].id]);
  assert.deepEqual(await retrieveCandidates(atoms,quotes,[],focus,0),candidateGroups(atoms,quotes,[],focus));
  assert.equal(isApplicationPathAllowed('knowledge-candidates-worker.mjs'),true);
});

test('worker failure and quit cannot commit a partial graph or leave a pending retrieval',async()=>{
  const atoms=[{id:'bad'}, {id:'also-bad'}], focus=new Set(['bad']);
  await assert.rejects(retrieveCandidates(atoms,new Map(),[],focus,0),TypeError);
  const controller=new AbortController();
  const work=retrieveCandidates(atoms,new Map(),[],focus,0,controller.signal);
  controller.abort();
  await assert.rejects(work,{name:'AbortError'});
  const stopping=new AbortController(), f=setup({signal:stopping.signal,alter:({stage})=>{if(stage==='atoms')stopping.abort();}});
  f.library.agentGraph={already:'saved'};
  await assert.rejects(f.generate(),{name:'AbortError'});
  assert.deepEqual(f.library.agentGraph,{already:'saved'});
  assert.equal(stages(f.calls,'findings').length,0);
  assert.equal(f.progress.at(-1),null);
  await assert.rejects(f.generate(),{name:'AbortError'});
});

test('historical reviews keep the last version and protect the interpretation the reader confirmed',async()=>{
  let label='初次发现';
  const f=setup({reason:list=>[proposal(list.slice(0,2),{label})]});
  await f.generate();
  const key=f.library.agentGraph.edges[0].evidenceKey;
  label='复核后的解释'; f.advance(reviewPeriod+1); await f.generate();
  assert.equal(f.library.agentGraph.reasoning.history.find(h=>h.finding.key===key).finding.label,'初次发现');
  f.library.decisions.push({evidence:key,result:'accepted',at:date});
  label='第三次改写'; f.advance(reviewPeriod+1); await f.generate();
  assert.equal(f.library.agentGraph.edges.find(e=>e.evidenceKey===key).label,'复核后的解释');
});

test('upgrading the old graph preserves a rejection backed by the same two original quotations',async()=>{
  const f=setup({notes:fixtures.slice(0,2)});
  const [a,b]=f.library.notes;
  f.library.agentGraph={notes:[],edges:[{from:a.id,to:b.id,fromRevision:1,toRevision:1,fromQuote:a.body,toQuote:b.body,label:'旧名称'}]};
  f.library.decisions=[{evidence:JSON.stringify(['agent',[[a.id,1],[b.id,1]].sort()]),result:'dismissed',at:date}];
  await f.generate();
  assert.equal(f.library.decisions.find(d=>d.evidence===f.library.agentGraph.edges[0].evidenceKey).result,'dismissed');
});

test('editing during a cold multi-batch extraction reuses completed unchanged chunks; a deleted note cannot reappear',async()=>{
  const notes=Array.from({length:25},(_,i)=>note('长库'+i,'当日记录'+i+'。'));
  let batches=0;
  const f=setup({notes,reason:()=>[],alter:({library,stage})=>{
    if(stage!=='atoms' || ++batches!==2) return;
    library.notes[0].body='当天更新后的判断。';library.notes[0].revision++;
    f.generate.forgetNote('长库10');library.notes=library.notes.filter(n=>n.id!=='长库10');
  }});
  await assert.rejects(f.generate(),/笔记有更新/);
  assert.equal(f.library.agentGraph,undefined);
  const first=flattened(f.calls,'atoms').map(m=>m.text);
  assert.ok(first.includes('当日记录15。'));
  f.calls.length=0;
  await f.generate();
  const retried=flattened(f.calls,'atoms');
  assert.ok(retried.some(m=>m.text==='当天更新后的判断。'));
  assert.ok(retried.every(m=>!first.includes(m.text)),'no unchanged title or body can be charged twice');
  assert.ok(retried.every(m=>m.title!=='长库10'));
  assert.equal(f.library.agentGraph.reasoning.atoms.length,24);
  assert.ok(!JSON.stringify(f.library.agentGraph).includes('长库10'));
  assert.ok(!JSON.stringify(f.library.agentGraph).includes('当天更新后的判断。'));
});

test('validated decisions and empty candidate batches resume without extra model requests after an unrelated edit',async()=>{
  const notes=Array.from({length:47},(_,i)=>note('关联'+i,'各地有独立的观测数据 '+i+'。'));
  notes.push(note('占位','暂缺'));
  let comparisons=0;
  const f=setup({notes,extract:rows=>readAtoms(rows.filter(m=>m.title!=='占位')),
    reason:rows=>comparisons===0?[proposal(rows.slice(0,2))]:[],
    alter:({stage,library})=>{
      if(stage!=='findings' || ++comparisons!==2) return;
      library.notes.at(-1).body='仍缺数据';library.notes.at(-1).revision++;
    }});
  await assert.rejects(f.generate(),/笔记有更新/);
  const completed=stages(f.calls,'findings').map(c=>JSON.stringify(c.materials));
  assert.equal(completed.length,2);
  f.calls.length=0;
  await f.generate();
  assert.deepEqual(flattened(f.calls,'atoms').map(m=>m.text),['仍缺数据']);
  assert.ok(stages(f.calls,'findings').every(c=>!completed.includes(JSON.stringify(c.materials))));
  assert.ok(f.library.agentGraph.edges.some(edge=>edge.label==='按等待时间动态改道'),'the previously validated finding was replayed');
});

test('changing the connection profile invalidates interrupted checkpoints',async()=>{
  let first=true;
  const notes=Array.from({length:10},(_,i)=>note('记录'+i,'段落'+i+'。'));
  const f=setup({notes,reason:()=>[],alter:({stage,profile})=>{
    if(first && stage==='atoms'){first=false;profile.model='different-profile';}
  }});
  await assert.rejects(f.generate(),/配置已变化/);
  f.calls.length=0;
  await f.generate();
  assert.equal(flattened(f.calls,'atoms').length,20);
});
