import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskCompare } from './app/task-compare.mjs';

const request = { projectId: 'project-test', taskId: 'task-1', itemId: 'child-1', specId: 'spec-2', expectedSpecRevision: 2, agentIds: ['codex','writer'] };
const taskKey = 'task-1::child-1';
const agents = [{id:'codex'},{id:'writer'},{id:'hermes'}];
const configured = [
  {tool:'codex',connectionId:'retired-same-project'}, {tool:'codex',connectionId:'codex-current',scope:'application'},
  {tool:'claude',agentId:'writer',connectionId:'unrelated-project'}, {tool:'claude',agentId:'writer',connectionId:'writer-project'},
  {tool:'hermes',connectionId:'hermes-current',scope:'application'},
];
function fixture() {
  return { project: {id:request.projectId,name:'项目示例',workspacePath:'private-path',attachments:[{file:'do-not-send'}]},
    tasks:{'task-1':{id:'task-1',title:'do-not-include-parent'},'other-task':{id:'other-task',title:'do-not-include-other-task'}},
    orchestrations:{'task-1':{items:{'child-1':{id:'child-1',rootTaskId:'task-1',title:'制作汇报提纲'}}}}, agents,
    runtimeConnections:{codex:{connectionId:'retired-same-project'},writer:{connectionId:'writer-project'}},
    collaboration:{tasks:{[taskKey]:{key:taskKey,taskId:'task-1',workItemId:'child-1',specRevision:2,status:'ready'}},
      specs:[{id:'spec-1',key:taskKey,revision:1,goal:'do-not-send-old-goal',criteria:[]},
        {id:'spec-2',key:taskKey,revision:2,goal:'让客户听懂成本变化',criteria:['用通俗语言']}]},
    projectPlanning:{tasks:{[taskKey]:{information:'本月成本比上月少 5%',deliverable:'一张图表提纲'},'task-1':{information:'do-not-send-parent-info'}}},
    sessions:{old:{id:'old',text:'do-not-send-session'}},
  };
}
const receipt = (input, extra = {}) => ({ requestId:input.requestId, projectId:input.projectId, tool:input.tool,
  connectionId:input.connectionId, contextPolicy:'new-isolated-session', toolPolicy:input.tool === 'claude' ? 'sdk-tools-disabled' : 'read-only-isolated',
  sourceSessionId: `receipt-${input.connectionId}`, output:{title:'先解释节省了多少',summary:'用一张图展示成本下降。',body:'先核对本月和上月的口径。'}, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => {resolve=done;}); return {promise,resolve}; };
const setup = (readProject, assist, preference = configured, connections = configured) => createTaskCompare({
  readProject, readConfigured:() => preference, connections:() => connections, assist,
});

test('starts two separate saved connections together and only sends the exact current task text', async () => {
  const snap = fixture(), first = deferred(), second = deferred(), bothStarted = deferred(), calls = [];
  const compare = setup(async () => structuredClone(snap), input => {
    calls.push(input);
    if (calls.length === 2) bothStarted.resolve();
    return (calls.length === 1 ? first : second).promise;
  });
  const compareOnce = compare(request), repeated = compare(request);
  await bothStarted.promise;
  assert.equal(calls.length,2,'a double click does not invoke providers twice');
  assert.notEqual(calls[0].requestId,calls[1].requestId);
  assert.deepEqual(calls.map(row => row.connectionId), ['codex-current','writer-project']);
  assert.ok(calls.every(row => row.projectId === request.projectId && row.kind === 'integration'));
  assert.equal(calls[0].prompt,calls[1].prompt);
  assert.match(calls[0].prompt,/制作汇报提纲.*让客户听懂成本变化.*用通俗语言.*本月成本比上月少 5%.+一张图表提纲/s);
  assert.doesNotMatch(calls[0].prompt,/do-not-send|do-not-include|private-path/);
  second.resolve(receipt(calls[1],{output:{title:'先介绍结果',summary:'把节省额放第一句。',body:'先核对两个期间。'}}));
  first.resolve(receipt(calls[0]));
  const result = await compareOnce;
  assert.deepEqual(await repeated, result);
  assert.deepEqual(result.alternatives.map(row => [row.agentId,row.title,row.sourceSessionId]),[
    ['codex','先解释节省了多少','receipt-codex-current'], ['writer','先介绍结果','receipt-writer-project'],
  ]);
  assert.deepEqual(snap,fixture(),'compare neither saves business changes nor alters the read snapshot');
});

test('invalid or outdated task specifications stop before any provider call', async () => {
  const compare = setup(async () => fixture(), () => assert.fail('should not invoke provider'));
  await assert.rejects(compare({...request,expectedSpecRevision:1}),/任务或要求已变化/);
  await assert.rejects(compare({...request,specId:'spec-1'}),/任务或要求已变化/);
  await assert.rejects(compare({...request,projectId:'another-project'}),/任务或要求已变化/);
  await assert.rejects(compare({...request,itemId:'other-child'}),/任务或要求已变化/);
  await assert.rejects(compare({...request,agentIds:['codex','codex']}),/不同 Agent/);
  await assert.rejects(compare({...request,agentIds:['codex']}),/不同 Agent/);
});

test('refuses stale results after same-scope material or requirements change during comparison', async () => {
  for (const change of [snap => {snap.projectPlanning.tasks[taskKey].information='已核实：少 10%';},
      snap => {snap.collaboration.tasks[taskKey].specRevision=3;}, snap => {snap.orchestrations['task-1'].items={};}]) {
    const snap = fixture();
    const compare = setup(async () => structuredClone(snap), async input => { change(snap); return receipt(input); });
    await assert.rejects(compare(request),/任务或要求已变化/);
  }
});

test('unsupported, stale, or unsafe provider replies stay distinct from genuine responses', async () => {
  const compare = setup(async () => fixture(), async input => {
    if (input.tool==='claude') return receipt(input, {toolPolicy:'unrestricted'});
    assert.equal(input.tool,'codex','must not call unsupported Hermes');
    return receipt(input);
  });
  let result = await compare({...request,agentIds:['codex','writer','hermes','absent']});
  assert.equal(result.alternatives[0].agentId,'codex');
  assert.equal(result.alternatives[0].title,'先解释节省了多少');
  assert.match(result.alternatives[1].error,/来源/);
  assert.match(result.alternatives[2].error,/已保存连接/);
  assert.match(result.alternatives[3].error,/已保存连接/);
  const lost = setup(async () => fixture(), async input => { if (input.tool==='codex') throw Object.assign(new Error('undefined secret detail'),{code:'SYSTEM_TOOL_POLICY'}); return receipt(input,{output:{title:'',summary:'x',body:'x'}}); });
  result = await lost(request);
  assert.deepEqual(result.alternatives,[{agentId:'codex',error:'该 Agent 尝试调用工具，本次建议已停止'},{agentId:'writer',error:'没有收到完整建议，请重试'}]);
  const misbound = setup(async () => fixture(), async input => { assert.equal(input.tool,'codex'); return receipt(input); },configured,configured.map(row => row.connectionId === 'writer-project' ? {...row,agentId:'unknown'} : row));
  result = await misbound(request);
  assert.match(result.alternatives[1].error,/已保存连接/);
});
