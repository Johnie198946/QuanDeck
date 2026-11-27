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
  assert.deepEqual(result, { answer: raw, sourceIds: ['new-note'] });
});

test('only explicitly attached public sources enter the forwarded question', async () => {
  const url = 'https://example.org/a';
  const text = '公共资料';
  const result = await relayNoteQuestion({ ...request, revision: 3, usePublicSources: true,
    publicLinks: [url, 'https://localhost/', 'https://example.org/third'] }, {
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
