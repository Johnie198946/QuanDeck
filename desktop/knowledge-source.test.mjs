import test from 'node:test';
import assert from 'node:assert/strict';
import { relayNoteQuestion, isPublicAddress, publicKnowledgeUrl, readableKnowledgeText, readPublicKnowledgeSource } from './app/knowledge-source.mjs';

test('personal source reader accepts only public HTTPS addresses and discards query tokens', () => {
  for (const candidate of [
    'http://example.com/article', 'https://localhost/doc', 'https://server.internal/article',
    'https://127.9.0.1/', 'https://2130706433/', 'https://[::ffff:127.0.0.1]/', 'https://example.com:8443/',
    'https://username:password@example.com/', 'https://example.com/?token=secret'
  ]) assert.throws(() => publicKnowledgeUrl(candidate), candidate);
  assert.equal(publicKnowledgeUrl('https://example.com/article#heading').href, 'https://example.com/article');
  for (const address of ['127.1.1.1','169.254.169.254','10.0.0.4','100.127.255.254','172.30.0.5','192.168.1.1','224.0.0.1','203.0.113.2','::1','::ffff:127.0.0.1','fc00::90','fe80::1','2002:7f00:1::','2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700::1111'), true);
});

test('personal source excerpts retain readable citations and strip active markup', () => {
  const payload = '<html><head><title>山野 &amp; 温泉</title><script>malicious words</script></head>' +
    '<body><nav>menu hidden</nav><article><h1>公开旅行指南</h1><p>这篇正文讲述可核对的温泉交通与出行路线。</p>' +
    '<svg><text>evil</text></svg><iframe src="https://example.com"></iframe></article></body></html>';
  const source = readableKnowledgeText('text/html;charset=utf-8', payload);
  assert.equal(source.title, '山野 & 温泉');
  assert.match(source.text, /公开旅行指南\n这篇正文/);
  assert.doesNotMatch(source.text, /malicious words|menu|svg|iframe|evil|example\.com/);
});

test('each redirect checks the resolved destination before connecting', async () => {
  const hosts = [];
  const reads = [];
  const addressesFor = async hostname => {
    hosts.push(hostname);
    return hostname === 'target.example.com'
      ? [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.8', family: 4 }]
      : [{ address: '8.8.8.8', family: 4 }];
  };
  const readPage = async (url, addresses) => {
    reads.push(url.hostname);
    assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    return { redirect: 'https://target.example.com/article' };
  };
  await assert.rejects(readPublicKnowledgeSource('https://first.example.com/', { addressesFor, readPage }), /不是公开地址/);
  assert.deepEqual(hosts, ['first.example.com', 'target.example.com']);
  assert.deepEqual(reads, ['first.example.com']);
  await assert.rejects(readPublicKnowledgeSource('https://first.example.com/', {
    addressesFor, readPage: async () => ({ redirect: 'http://address.example.com/' }),
  }), /公开 HTTPS/);
});

const request = { requestId: '00000000-1111-4222-a333-444444444444', noteId: 'new-note',
  question: '只给我译文。', selection: { offset: 6, quote: '  Good morning!\nSee you soon.' } };
const connection = { connectionId: 'my-codex', tool: 'codex' };
const projectId = 'personal-knowledge';
const raw = '  {"answer":"早上好！"}\n';
const receipt = { requestId: request.requestId, projectId, connectionId: connection.connectionId,
  tool:'codex', sourceSessionId:'real-thread', contextPolicy: 'new-isolated-session', toolPolicy: 'read-only-isolated', output: { answer: raw } };

test('new and unsaved notes relay only the exact question and selected text; raw answers stay intact', async () => {
  let calls = 0;
  const result = await relayNoteQuestion({ ...request, publicLinks: ['https://example.org/reference'] }, {
    projectId, connection,
    readSource: () => assert.fail('ordinary questions never read URLs'),
    assist: input => {
      calls++;
      assert.deepEqual(input, { projectId, connectionId: connection.connectionId, tool: 'codex',
        kind: 'note-question', noteThread:{noteId:request.noteId}, requestId: request.requestId, prompt: request.question + '\n\n' + request.selection.quote, timeoutMs: 120000 });
      return receipt;
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { answer: raw, agentConnectionId:connection.connectionId, sourceIds: ['new-note'] });
});

test('only explicitly attached public sources enter the forwarded question', async () => {
  const url = 'https://example.org/a';
  const text = '公共资料';
  const result = await relayNoteQuestion({ ...request, revision: 3, usePublicSources: true,
    publicLinks: [url, 'https://localhost/'] }, {
    projectId, connection,
    readSource: link => { assert.equal(link, url); return { url, title: '资料', text, checkedAt: 'now' }; },
    assist: input => { assert(input.prompt.includes(text)); return receipt; },
  });
  assert.deepEqual(result.sourceIds, ['new-note@3', url]);
  assert.equal(result.sources[0].excerpt, text);
});

test('a reply from another call cannot become the answer to this question', async () => {
  await assert.rejects(relayNoteQuestion(request, { projectId, connection,
    assist: () => ({ ...receipt, requestId: 'other' }) }), /没有收到这次提问/);
});


test('only the selected passage and idea, supplied background and requested parent chain are sent', async () => {
  const note = {id:'other',revision:4,body:'PRIVATE chosen PRIVATE',expansions:[]};
  const parent = {id:'parent',questionRequestId:'earlier',question:'old Q',answer:'old A',selection:{quote:'old quote'}};
  const library = {notes:[note,{id:request.noteId,expansions:[parent,{...parent,id:'unrelated',answer:'UNRELATED'}]}],
    inspirationCanvas:{nodes:[{noteId:'card',idea:{title:'Early trains',detail:'Check transfers',source:{noteId:'idea-source'}}}]}};
  const deps = {projectId,connection,readLibrary:()=>library,assist: input=>{
    assert.match(input.prompt,/chosen/);assert.match(input.prompt,/Check transfers/);assert.match(input.prompt,/my constraint/);
    assert.doesNotMatch(input.prompt,/PRIVATE|old A|UNRELATED/);
    assert.deepEqual(input.noteThread.sourceNoteIds,['other','idea-source']);assert.equal(input.noteThread.parentRequestId,'earlier');assert.match(input.noteThread.history,/old A/);
    assert.doesNotMatch(input.noteThread.history,/UNRELATED/);return {...receipt,contextPolicy:'resumed-isolated-session',noteConversation:'resumed'};
  }};
  const q={...request,parentAnswerId:'parent',background:'my constraint',
    memoryRefs:[{kind:'passage',noteId:'other',revision:4,start:8,end:14},{kind:'idea',nodeId:'card',title:'Early trains',detail:'Check transfers'}]};
  const result=await relayNoteQuestion(q,deps);assert.equal(result.conversationMode,'resumed');assert(result.sourceIds.includes('other@4#8-14'));
  note.revision++;await assert.rejects(relayNoteQuestion(q,deps),/重新选择/);
});


test('the selected provider, its own tool policy, its source session and the question mode must all match',async()=>{
  for(const invalid of [{tool:'claude'},{toolPolicy:'sdk-tools-disabled'},{sourceSessionId:''},{sourceSessionId:42},{sourceSessionId:'   '},{noteConversation:'resumed'},{contextPolicy:'resumed-isolated-session'}]){
    await assert.rejects(relayNoteQuestion(request,{projectId,connection,assist:()=>({...receipt,...invalid})}),/没有收到这次提问/);
  }
});


test('a note can choose its Agent and share surrounding lines; follow-ups stay with that Agent after reordering',async()=>{
  const author={tool:'codex',connectionId:'first-answerer'};
  const neighbor={title:'对比读数',before:'变更前为 18，',after:'，从本周起生效。'};
  const last={id:'accepted',questionRequestId:'author-old',agentConnectionId:author.connectionId,
    question:'新数据是什么？',answer:'32',selection:{quote:'32'},surrounding:neighbor};
  const deps={projectId,connection,findConnection:id=>id===author.connectionId?author:undefined,
    readLibrary:()=>({notes:[{id:request.noteId,expansions:[last]}]}),
    assist:input=>{
      assert.equal(input.connectionId,author.connectionId);
      if (input.noteThread.parentRequestId) {
        assert.deepEqual(JSON.parse(input.noteThread.history)[0].surrounding,neighbor);
        return {...receipt,connectionId:author.connectionId,contextPolicy:'resumed-isolated-session',noteConversation:'resumed'};
      }
      assert.match(input.prompt,/变更前为 18/);
      return {...receipt,connectionId:author.connectionId};
    }};
  const result=await relayNoteQuestion({...request,agentConnectionId:author.connectionId,surrounding:neighbor},deps);
  assert.equal(result.agentConnectionId,author.connectionId);
  const reply=await relayNoteQuestion({...request,parentAnswerId:last.id},deps);
  assert.equal(reply.agentConnectionId,author.connectionId);
  await assert.rejects(relayNoteQuestion({...request,parentAnswerId:last.id},{...deps,findConnection:()=>undefined,assist:()=>assert.fail()}),/原回答的 Agent 已断开/);
});

test('links inside selected notes, linked ideas and background are read once before answering; unselected paragraphs stay private', async () => {
  const forecast = 'https://example.org/outlook?year=2026';
  const map = 'https://maps.app.goo.gl/Example';
  const body = 'old https://example.org/unselected\n预报：['+forecast+'](<'+forecast+'> "预览卡片")';
  const start = body.indexOf('预报');
  const library = {notes:[{id:'forecast',title:'季节预测',revision:3,body}],
    inspirationCanvas:{nodes:[{noteId:'map-card',idea:{title:'住宿分布',detail:'城南',reference:{url:map}}}]}};
  const fetched=[];
  const result = await relayNoteQuestion({...request,question:'城南适合哪天出行？',
    memoryRefs:[{kind:'passage',noteId:'forecast',start,end:body.length,revision:3},{kind:'idea',nodeId:'map-card',title:'住宿分布',detail:'城南'}],
    background:'同行两人；参考 '+forecast},{
    connection,projectId,readLibrary:()=>library,
    readSource:async url=>{
      fetched.push(url);
      if (url===map) throw new Error('网页暂时无法连接');
      return {url,title:'秋季预测',checkedAt:'2026-11-02',text:'城南枫叶预计十一月二十三日进入观赏期。'};
    },
    assist:input=>{
      assert.match(input.prompt,/城南枫叶预计十一月二十三日/);
      assert.match(input.prompt,/未取得依据的来源/); assert.match(input.prompt,/住宿分布/);
      assert.doesNotMatch(input.prompt,/unselected/);
      assert.equal(input.noteThread.sourceNoteIds[0],'forecast');return receipt;
    }
  });
  assert.deepEqual(fetched,[forecast,map]);
  assert.equal(result.sources[0].label,'季节预测');assert.equal(result.sources.length,1);
  assert.equal(result.unreadSources[0].url,map);assert.match(result.unreadSources[0].reason,/尚未核实/);
  assert(!result.sourceIds.includes(map));
});

test('public forecast tables preserve cell boundaries; a map app shell is not evidence about lodging', async ()=>{
  const html='<article><table><tr><th>城市</th><th>预测日期</th><th>平年差</th></tr><tr><th>城南</th><td>11/23</td><td>7日</td></tr></table></article>';
  assert.match(readableKnowledgeText('text/html',html).text,/城南 \| 11\/23 \| 7日/);
  const addressesFor=async()=>[{address:'8.8.8.8',family:4}];
  await assert.rejects(readPublicKnowledgeSource('https://maps.app.goo.gl/Example',{
    addressesFor,readPage:async url=>url.hostname==='maps.app.goo.gl'
      ? {redirect:'https://www.google.com/maps/search/hotels?entry=ttu'}
      : {type:'text/html',text:'<p>'+('Use the interface for details. '.repeat(10))+'</p>'}
  }),/互动地图/);
});

test('unavailable references remain visible and never enter source ids, even when every link fails',async()=>{
  const result=await relayNoteQuestion({...request,background:'只读这两个链接 https://example.org/a https://example.org/b?token=private'},{
    projectId,connection,readSource:url=>{assert.equal(url,'https://example.org/a');throw Error('connection refused');},
    assist:input=>{assert.match(input.prompt,/未取得依据/);assert.doesNotMatch(input.prompt,/已读取的公开正文/);return receipt;}
  });
  assert.equal(result.sources,undefined);assert.deepEqual(result.sourceIds,[request.noteId]);
  assert.equal(result.unreadSources.length,2);assert(!result.unreadSources[1].url);
});

test('use actual lodging names from public map metadata without inferring rates or availability',async()=>{
  const source=await readPublicKnowledgeSource('https://www.google.com/maps/search/lodging',{
    addressesFor:async()=>[{address:'8.8.8.8',family:4}],
    readPage: async()=>({type:'text/html',text:'<html><title>地图</title><script type="application/ld+json">'+JSON.stringify({
      '@type':'ItemList',itemListElement:[{item:{'@type':'Hotel',name:'城南示例旅馆',address:{addressLocality:'城南',streetAddress:'A 路'}}}]
    })+'</script><p>Application loader</p></html>'})
  });
  assert.match(source.text,/城南示例旅馆 · 城南 A 路/);
  assert.match(source.text,/未核实价格与空房/);
});

test('saved citation preview extracts all table rows for the named place across multiple tables',async()=>{
  const text='基本说明。'.repeat(90)+'\n城北 | 11/28 | 甲叶\n城南 | 12/08 | 甲叶\n城北 | 11/13 | 乙叶\n城南 | 11/18 | 乙叶';
  const url='https://example.org/brief';
  const result=await relayNoteQuestion({...request,question:'城南预报呢？',usePublicSources:true,publicLinks:[url]},{
    projectId,connection,readSource:()=>({url,title:'预报',text,checkedAt:'now'}),assist:()=>receipt
  });
  assert.equal(result.sources[0].excerpt,'城南 | 12/08 | 甲叶\n城南 | 11/18 | 乙叶');
});

test('image questions bind actual bytes to the selected record, preserve ownership and leave unrelated files unread', async () => {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOVz+xkAAAAASUVORK5CYII=','base64');
  const meta=id=>({id,name:id+'.png',type:'image/png',size:png.length});
  const title='图片测试', body='1. 第一条\n![资料](attachment:first)\n\n2. 第二条\n\n![截图](attachment:second)\n\n3. 其他\n![图](attachment:private)';
  const note={id:request.noteId,title,revision:3,body,attachments:['first','second','private'].map(meta)};
  const refNote={id:'reference',title:'补充资料',revision:2,body:'![资料](attachment:ref)',attachments:[meta('ref')]};
  const library={notes:[note,refNote]};
  const visual={...request,question:'请看第2条截图里面的内容。',revision:3,selection:{offset:body.indexOf('第二条'),quote:'第二条'}};
  const files=[];
  let sent;
  const deps={projectId,connection,readLibrary:()=>library,readAttachment:async id=>{files.push(id);return png;},assist:async input=>{sent=input;return receipt;}};
  const result=await relayNoteQuestion(visual,deps);
  assert.deepEqual(files,['second']);
  assert.deepEqual(sent.noteImages,['data:image/png;base64,'+png.toString('base64')]);
  assert.match(sent.prompt,/attachment:second/u);assert.doesNotMatch(sent.prompt,/first\.png|private\.png/u);
  assert(result.sourceIds.includes('attachment:second'));
  files.length=0;
  await relayNoteQuestion({...visual,question:'请看选中的图片内容。',memoryRefs:[{kind:'passage',noteId:'reference',revision:2,start:0,end:refNote.body.length}]},deps);
  assert.deepEqual(files,['second','ref']);assert.deepEqual(sent.noteThread.sourceNoteIds,[note.id,refNote.id]);
  files.length=0;
  await relayNoteQuestion({...visual,question:'有几条没有划线？每条有哪些图片附件？'},deps);
  assert.deepEqual(files,[]);assert.equal(sent.noteImages,undefined);
  await assert.rejects(relayNoteQuestion({...visual,revision:2},deps),/版本已变化/);
  await assert.rejects(relayNoteQuestion(visual,{...deps,connection:{...connection,tool:'claude'}}),/暂未支持/);
  await assert.rejects(relayNoteQuestion(visual,{...deps,readAttachment:async()=>Buffer.alloc(1)}),/不一致/);
  note.attachments[1].size=9*1024*1024;
  await assert.rejects(relayNoteQuestion(visual,deps),/8 MB/);assert.deepEqual(files,[]);
});

test('complete note lists keep original numbers, body, partial strike ranges and media after item 32', async () => {
  const {formatWorkspaceEvidence}=await import('./app/workspace-evidence.mjs');
  const items=Array.from({length:45},(_,i)=>({noteId:'synthetic',noteTitle:'清单',number:String(i+1),revision:2,lineIndex:i,start:100*i,end:100*i+20,
    status:i===44?'partial':i===0?'struck':'open',remaining:'继续核对',raw:i===44?'45. ~~已看过~~ 尚待核对完整尾段':'普通事项',images:i===44?[{id:'diagram',name:'合成图.png'}]:[],details:i===44?['随后一行的说明']:[],strikeRanges:i===44?[{start:4404,end:4411}]:[]}));
  const read={area:'notes',total:44,summary:'还有44项',records:[],noteList:{items,counts:{open:43,partial:1,struck:1}}};
  const evidence=formatWorkspaceEvidence({reads:[read],noteIds:['synthetic']});
  assert.match(evidence,/尚待核对完整尾段/u);assert.match(evidence,/随后一行的说明/u);assert.match(evidence,/attachment:diagram/u);
  assert.throws(()=>formatWorkspaceEvidence({reads:[{...read,total:43}],noteIds:[]}),/数量与记录不一致/u);
});

test('note list evidence labels the full population and the partially-or-fully-open subset independently', async () => {
  const {formatWorkspaceEvidence}=await import('./app/workspace-evidence.mjs');
  const items=['open','struck','partial','open'].map((status,index)=>({
    noteId:'sample',noteTitle:'四项清单',number:String(index+1),lineIndex:index,raw:'第'+(index+1)+'项',
    status,images:[],details:[],strikeRanges:[],
  }));
  const counts={open:2,partial:1,struck:1};
  const evidence=formatWorkspaceEvidence({reads:[{area:'notes',summary:'3 条任务还没画删除线',total:3,records:[],noteList:{items,counts}}],noteIds:['sample']});
  const [receipt]=JSON.parse(evidence.split('\n').at(-1));
  assert.equal(receipt.全部条目数,4);
  assert.equal(receipt.未完全划线项数,3);
  assert.deepEqual(receipt.分类,counts);
  assert.equal(receipt.完整清单.length,4);
  assert.equal(receipt.总数,undefined);
  assert.doesNotMatch(evidence,/3 条任务还没画删除线/u);
  assert.match(evidence,/客户端会按这三类的实际条数当场生成分类图/u);
});
