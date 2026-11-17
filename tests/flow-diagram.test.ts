import assert from 'node:assert/strict';
import { readFlowDiagram, flowLines } from '../src/data/flowDiagram';
import { readAgentConclusion } from '../src/data/discussionConclusion';
import { readDiscussionVisualBlocks } from '../src/data/discussionVisual';
import { buildDirectionFlow, directionFlowInput } from '../src/data/directionFlow';
import type { Snapshot, IdeaPlan } from '../src/data/types';

const raw = { version: 1, nodes: [{ id: 'a', label: '接收五条规则与一个例子', kind: 'start' }, { id: 'b', label: '是否完整覆盖要求', kind: 'decision' }, { id: 'c', label: '修订候选规范' }, { id: 'd', label: '提交验收', kind: 'end' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: '不满足' }, { from: 'c', to: 'b', label: '再次核对' }, { from: 'b', to: 'd', label: '满足' }] };
const graph = readFlowDiagram(raw);
assert.deepEqual(graph, readFlowDiagram(raw), 'layout is deterministic');
assert.equal(graph.layout.edges.filter(e => e.returnEdge).length, 1, 'cycle is rendered safely instead of looping');
assert.equal(readFlowDiagram({ version: 1, nodes: [{ id: 'a', label: '自循环' }], edges: [{ from: 'a', to: 'a' }] }).layout.edges[0].returnEdge, true);
assert.ok(graph.layout.nodes.every(n => n.x >= 0 && n.y >= 0 && n.x+n.width <= graph.layout.width && n.y+n.height <= graph.layout.height));
const branch = graph.layout.nodes.find(n => n.id === 'c')!;
assert.ok(graph.layout.edges.find(e => e.returnEdge)!.path.startsWith(`M ${branch.x+branch.width/2} ${branch.y+branch.height} V `), 'return path exits below its row instead of crossing a sibling');
const skip = readFlowDiagram({ version: 1, nodes: ['a','b','c'].map(id => ({ id, label: id })), edges: [{from:'a',to:'b'}, {from:'b',to:'c'}, {from:'a',to:'c'}] });
assert.equal(skip.layout.edges[2].returnEdge, false, 'long forward links are not mislabeled as returns');
assert.equal(skip.layout.edges[2].path.split(' H ').length, 3, 'long forward links bypass intermediate rows');
const self = readFlowDiagram({ version: 1, nodes: [{ id: 'a', label: '重试' }], edges: [{ from: 'a', to: 'a', label: '重试'.repeat(16) }] });
assert.ok(self.layout.edges[0].y + 24 <= self.layout.height, 'self-loop labels fit the canvas');
assert.ok(flowLines('中文标题很长时程序自动换行支持窄窗口').length > 1);
const long = readFlowDiagram({ version: 1, nodes: [{ id: 'long', label: '字'.repeat(96) }], edges: [] });
assert.equal(long.layout.nodes[0].lines.join(''), '字'.repeat(96), 'full bounded label retained');
for (const bad of [
  { ...raw, version: 2 }, { ...raw, nodes: [] }, { ...raw, nodes: Array.from({ length: 41 }, (_, i) => ({ id: `n${i}`, label: '节点' })) },
  { ...raw, edges: [{ from: 'a', to: 'missing' }] }, { ...raw, nodes: [raw.nodes[0], raw.nodes[0]] },
  { ...raw, edges: [raw.edges[0], raw.edges[0]] }, { ...raw, nodes: [{ id: 'bad id', label: '节点' }] },
  { ...raw, nodes: [{ id: 'bad', label: '字'.repeat(97) }] }, { ...raw, nodes: [{ id: 'bad', label: '标题', kind: 'execute' }] },
  { ...raw, nodes: [{ id: 'bad', label: '标题', onClick: 'executeTask()' }] }, { ...raw, edges: [{ from: 'a', to: 'b', url: 'https://example.org' }] },
  { ...raw, approval: true }, { ...raw, layout: { width: 999999 } }, { ...raw, nodes: [{ id: 'a', label: 'bad\u0000title' }] },
]) assert.throws(() => readFlowDiagram(bad));
const conclusion = readAgentConclusion(`<quandeck-conclusion>${JSON.stringify({ summary: '方法示意', confirmed: [], open: [], visualBlocks: [{ id: 'method', title: '执行方法', kind: 'flow', flow: raw }] })}</quandeck-conclusion>`);
assert.deepEqual(conclusion.visualBlocks?.[0].flow, graph, 'backend conclusion parser persists canonical data and layout');
assert.equal(conclusion.tasks, undefined, 'a flow never creates execution tasks');
assert.deepEqual(conclusion.confirmed, [], 'a flow never approves direction');
const rejected = readDiscussionVisualBlocks([{ id: 'invalid', kind: 'flow', title: '坏图', flow: { ...raw, script: 'alert(1)' } }])[0];
assert.equal(rejected.flow, undefined);
assert.match(rejected.flowError!, /不接受/);
assert.equal(JSON.stringify(rejected).includes('alert(1)'), false);
// SVG-like characters remain text data; React renders them as text, never innerHTML.
assert.equal(readFlowDiagram({ version: 1, nodes: [{ id: 'text', label: '<script>not executable</script>' }], edges: [] }).nodes[0].label, '<script>not executable</script>');

const task = (key: string, taskId: string, title: string, dependencies: string[] = [], workItemId?: string) => ({ key, taskId, title, dependencies, workItemId, status: 'ready', specRevision: 1, version: 1, claimEpoch: 0, owner: 'agent' });
const snap = { tasks: { A: { id: 'A' }, B: { id: 'B' } }, orchestrations: { A: { items: { c: { id: 'c', parentTaskId: 'A' } } } }, collaboration: { tasks: { A: task('A', 'A', '规则设计'), 'A::c': task('A::c', 'A', '整理规则', [], 'c'), B: task('B', 'B', '页面制作', ['A']), planning: task('planning:p:root:1', 'A', '讨论方向') } } } as unknown as Snapshot;
// taskKey is root id or root id + '::' + child id.
const before = JSON.stringify(snap);
const project = buildDirectionFlow(directionFlowInput(snap, { scope: 'project' } as IdeaPlan));
assert.equal(project.graph?.nodes.length, 3, 'planning bookkeeping is not a task node');
assert.equal(project.graph?.edges.length, 2, 'real dependency plus child merge');
assert.equal(Object.values(project.targets).every(t => t.state === '可开始'), true);
const local = buildDirectionFlow(directionFlowInput(snap, { scope: 'task', taskId: 'A', itemId: null } as IdeaPlan));
assert.equal(local.graph?.nodes.length, 2, 'task view excludes unrelated downstream');
assert.equal(JSON.stringify(snap), before, 'projection never mutates task dependencies or approval');
const oversized = structuredClone(snap);
for (let i=0; i<100; i++) { oversized.tasks[`x${i}`] = { id: `x${i}` } as Snapshot['tasks'][string]; oversized.collaboration!.tasks[`x${i}`] = task(`x${i}`, `x${i}`, '实际任务') as Snapshot['collaboration']['tasks'][string]; }
const oversizedInput = directionFlowInput(oversized, { scope: 'project' } as IdeaPlan);
assert.equal(oversizedInput.tasks.length, 0, 'oversized ledgers do not get serialized into a graph');
assert.equal(oversizedInput.total, 103);
assert.match(buildDirectionFlow(oversizedInput).notice!, /103/);
assert.equal(buildDirectionFlow({tasks:[{key:'bad-title',taskId:'bad-title',title:'\u0000  ',state:'可开始',dependencies:[],itemId:undefined,parentId:undefined}],missing:false}).graph?.nodes[0].label, '未命名任务', 'legacy title control characters do not crash the view');
assert.equal(buildDirectionFlow({ tasks: [], missing: false }).graph, undefined);
assert.match(buildDirectionFlow({ tasks: Array.from({ length: 41 }, (_, i) => ({ key: `t${i}`, taskId: `t${i}`, title: '任务', state: '可开始', dependencies: [], itemId: undefined, parentId: undefined })), missing: false }).notice!, /41/);
console.log('flow diagram validation, bounded layout and ledger projection tests passed');
