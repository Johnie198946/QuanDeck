import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from './app/node_modules/fflate/esm/index.mjs';
import { createProjectUnderstanding } from './app/project-understanding.mjs';

const connection = {connectionId:'test-connection',tool:'codex'};
const goal = '请按附件的要求准备验收';
const notes = [
  {id:'idea:stock', kind:'灵感', title:'库存盘点', excerpt:'交接前用双色标签区分已验与待验样品。'},
  {id:'note:travel', kind:'笔记', title:'旅行清单', excerpt:'出发前预订返程的座位。'},
];
const chosen = {source:'s1',quote:'用双色标签区分已验与待验样品',reason:'适合仓库交接',use:'把标签检查加入交接表'};
const answer = {summary:'交接仓库前按标签逐件验收',questions:[],tasks:[],recommendations:[chosen]};
const fixture = (overrides={}) => createProjectUnderstanding({
  readConfigured: () => [connection], connections: () => [connection],
  knowledgeCandidates: () => notes,
  analysisCore: () => ({projectAnalysisSchema:{required:['summary','questions','tasks'],properties:{}},
    readProjectAnalysis: (data, sourceId) => ({summary:data.summary, questions:data.questions,tasks:data.tasks,sourceId})}),
  assist: async request => receipt(request),
  ...overrides,
});
const receipt = (request, output = answer) => ({
  requestId: request.requestId, projectId:request.projectId, tool:request.tool, connectionId:request.connectionId,
  contextPolicy:'new-isolated-session', toolPolicy:'read-only-isolated',sourceSessionId:'synthetic-session',output,
});
const upload = (name, bytes) => ({name, type:'application/octet-stream', bytes: Uint8Array.from(bytes).buffer});

test('project understanding uses the contents of uploaded files for retrieval and asks the configured agent to decide what to reuse', async () => {
  const xml = '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>库存样品需要双色标签</w:t></w:r></w:p></w:body></w:document>';
  const files = [
    upload('验收.docx',zipSync({'word/document.xml':strToU8(xml)})),
    upload('交接.txt',Buffer.from('需要两人会签')),
    upload('交接.txt',Buffer.from('截止前完成')),
    upload('原始图纸.xyz', [1]),
    upload('空白.txt',[]),
    upload('损坏.docx',[1]),
  ];
  let calls = 0;
  const run = fixture({
    knowledgeCandidates: query => {
      assert.match(query,/库存样品需要双色标签/);
      return notes;
    },
    assist: async request => {
      calls++;
      assert.equal(request.kind,'project-understanding');
      assert.equal(request.connectionId, connection.connectionId);
      const body = JSON.parse(request.prompt.split('\n').at(-1));
      assert.equal(body.deadline,'2030-01-01');
      assert.equal(body.background,'现场交付');
      assert.deepEqual(body.previousQuestions,['需要现场交接吗？']);
      assert.deepEqual(body.attachments.map(f=>f.status), ['partial','read','read','unsupported','empty','failed']);
      assert.equal(body.attachments[0].content,'库存样品需要双色标签');
      assert.equal(body.attachments[1].content,'需要两人会签');
      assert.equal(body.attachments[2].content,'截止前完成');
      assert.deepEqual(body.candidates.map(c=>c.source),['s1','s2']);
      assert(!JSON.stringify(body).includes('idea:stock'));
      assert(request.outputSchema.required.includes('recommendations'));
      return receipt(request);
    },
  });
  const result = await run({name:'仓库验收',goal,information:'现场交付',deadline:'2030-01-01',previousQuestions:['需要现场交接吗？'],files});
  assert.equal(calls,1);
  assert.deepEqual(result.recommendations.map(it=>it.id),['idea:stock']);
  assert.equal(result.recommendations[0].quote,chosen.quote);
  assert.equal(result.attachments.length,6);
  assert(!JSON.stringify(result.attachments).includes('库存样品需要双色标签'));
});

test('allows an empty selection but rejects invented or stale source, evidence and session', async () => {
  const input = {goal, information:''};
  const run = rows => fixture({assist: async req => receipt(req,{...answer,recommendations:rows})})(input);
  assert.deepEqual((await run([])).recommendations,[]);
  await assert.rejects(run([{...chosen, source:'s5'}]), /原文/);
  await assert.rejects(run([{...chosen, quote:'完全没有提到的指标'}]), /原文/);
  await assert.rejects(run([chosen, chosen]), /原文/);
  await assert.rejects(fixture({assist: async req => ({...receipt(req),connectionId:'other'})})(input), /来源/);
  let reads = 0;
  await assert.rejects(fixture({knowledgeCandidates: () => ++reads === 1 ? notes : []})(input), /变化/);
});

test('unconnected agent or invalid input cannot produce a successful analysis; clipped text is reported as partial', async () => {
  await assert.rejects(fixture({readConfigured:()=>[]})({goal,information:''}), /连接/);
  const unavailable = {connectionId:'offline-first',tool:'codex'};
  await assert.rejects(fixture({readConfigured:()=>[unavailable,connection], assist:()=>assert.fail('unexpected fallback')})({goal,information:''}), /第一个连接/);
  await assert.rejects(fixture()({goal,information:'', files:[{name:'a.txt',bytes:'raw'}]}), /附件无效/);
  let attempts=0;
  const analyze = fixture({assist: async req => {
    if (++attempts === 1) throw Error('Agent 连接断开');
    return receipt(req,{...answer,recommendations:[]});
  }});
  const input = {goal,information:'',files:[upload('长说明.txt',Buffer.from('目标'.repeat(11000)))]};
  await assert.rejects(analyze(input), /连接断开/);
  assert.equal((await analyze(input)).attachments[0].status,'partial');
});
