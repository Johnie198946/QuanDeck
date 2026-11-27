import assert from 'node:assert/strict';
import { noteDispatchPictureChoices } from '../src/data/noteDispatchPictures';
import { projectKnowledgeCandidates } from '../src/data/projectKnowledgeCandidates';
import { buildKnowledgeIndex, buildNoteGraph, buildPersonalNoteGraph, knowledgeRelations, recommendKnowledge, searchKnowledge } from '../src/data/knowledgeIndex';
import { makeSelection, locateSelection, noteLinks, emptyKnowledge, parseKnowledge, updateNote, type KnowledgeNote } from '../src/data/knowledgeNotes';
import { exploreNoteLayers } from '../src/data/personalNoteGraph';
import { saveNoteGraphLinks } from '../src/data/knowledgeStore';
import { eraseKnowledgeNote } from '../src/data/deleteKnowledgeNote';
import { createEmptySnapshot } from '../src/data/projectStorage';

const at = '2025-11-24T12:00:00Z';
function note(id: string, title: string, body: string): KnowledgeNote {
  return { id, title, body, createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [] };
}
const first = note('a', '京都红叶路线', '12 月出行，安排京都红叶路线。\n预算：3000 元\n链接 https://example.test/kyoto');
const other = note('b', '京都红叶路线备选', '京都红叶路线。\n预算：5000 元\n链接 https://example.test/kyoto');
const actual = createEmptySnapshot({ id: 'water', name: '地下水治理', description: '在地下水治理方案核对预算' });
actual.project.createdAt = at;
const ignore = createEmptySnapshot({ id: 'later', name: '地下水治理方案 · 新版', description: '新资料' });
ignore.project.createdAt = '2026-03-12T10:00:00Z';
const library = emptyKnowledge();
library.notes = [first, other, { ...note('old', '海边潮汐', '海鸥和潮汐'), archivedAt: at }, note('title', '标题即笔记', '')];
const index = buildKnowledgeIndex(library, [actual, ignore]);
assert.deepEqual(searchKnowledge(index, '帮我找去年做过的地下水治理方案', 20, 2026).map(item => item.projectId), ['water']);
assert.deepEqual(searchKnowledge(index, '京都红叶路线').map(item => item.noteId).sort(), ['a', 'b']);
assert.equal(searchKnowledge(index, '海边潮汐')[0].noteId, 'old');
assert.ok(recommendKnowledge(index, '想研究京都红叶路线').some(source => source.noteId === 'a'));
assert.equal(recommendKnowledge(index, '安排一项完全不同的说明').length, 0);
const relation = knowledgeRelations(first, index, library)[0];
assert.equal(relation.kind, '冲突');
assert.deepEqual(relation.evidence.slice(0, 2), ['预算：3000 元', '预算：5000 元']);
assert.equal(knowledgeRelations(other, index, library)[0].evidenceKey, relation.evidenceKey);
const graph = buildNoteGraph(library);
assert.deepEqual(graph.notes.map(item => item.id), ['a', 'b', 'old', 'title']);
assert.equal(graph.edges.length, 1, 'one edge per pair and isolated nodes remain present');
assert.equal(graph.edges[0].relation.evidenceKey, relation.evidenceKey);
library.decisions.push({ evidence: relation.evidenceKey, result: 'dismissed', at });
assert.equal(knowledgeRelations(first, index, library).length, 0);
assert.equal(knowledgeRelations(other, index, library).length, 0);
assert.equal(buildNoteGraph(library).edges.length, 0);
assert.equal(buildNoteGraph(library, true).edges.length, 1);
const busy = { ...emptyKnowledge(), notes: Array.from({ length: 12 }, (_, i) => note('related-' + i, '地点 ' + i, '共享线索 https://example.test/one')) };
assert.equal(buildNoteGraph(busy).edges.length, 66, 'all pairs with evidence, including beyond old 8-edge cutoff');
const unrelated = { ...emptyKnowledge(), notes: [
  note('woods', '森林栖息地', '链接 https://example.test/wood\n预算：3000 元'),
  note('chem', '化学课程', '链接 https://example.test/chem\n预算：7000 元'),
] };
assert.equal(buildNoteGraph(unrelated).edges.length, 0, 'a host name and generic budget terms are not evidence of a conflict');
const screenshotNotes = { ...emptyKnowledge(), notes: [
  note('home', '首页问题', '如图，奇怪。![image.png](attachment:one)'),
  note('editor', '编辑器问题记录', '截图很奇怪。![image.png](attachment:two)'),
] };
assert.equal(buildNoteGraph(screenshotNotes).edges.length, 0, 'image placeholders and generic feedback do not establish a relationship');
const revision = updateNote(first, { title: first.title, body: first.body.replace('3000', '4500') }, '2026-11-24T12:00:00Z');
assert.equal(revision.revision, 2);
assert.deepEqual(revision.history, first.history);
assert.deepEqual(revision.changes, [{ at: '2026-11-24T12:00:00Z', field: '正文', before: '30', after: '45' }]);
const multiple = updateNote({ ...first, body: '首行\n删除这一行\n锚点甲\n预算200元\n锚点乙' },
  { title: first.title, body: '首行\n锚点甲\n预算300元\n锚点乙\n新加一行' }, '2026-11-24T12:00:00Z');
assert.deepEqual(multiple.changes?.map(change => [change.before, change.after]), [['删除这一行', ''], ['2','3'], ['', '新加一行']]);
assert.equal(knowledgeRelations(revision, index, library)[0].kind, '冲突', 'changed evidence can reappear');
const selected = makeSelection(first.body, 8, 14);
assert.equal(locateSelection('新增：' + first.body, selected), selected.offset + 3);
assert.equal(locateSelection('已经重写', selected), undefined);
assert.deepEqual(noteLinks('来源 https://example.test/path。https://user:pass@example.test'), ['https://example.test/path']);
console.log('Knowledge: cross-project search, full note graph, prior archive visibility, isolated notes, evidence-scoped decisions and revision anchors passed');

const agentLibrary = emptyKnowledge();
agentLibrary.notes = [first, other];
const suggestion = {
  from: first.id, to: other.id, fromRevision: 1, toRevision: 1, provider: 'codex', label: '列出备选预算',
  explanation: '第二篇给出了更高的备选预算。', fromQuote: '预算：3000 元', toQuote: '预算：5000 元',
};
agentLibrary.agentGraph = { provider:'codex', at, notes:agentLibrary.notes.map(({id,revision})=>({id,revision})), edges:[suggestion] };
const generated = buildNoteGraph(agentLibrary).edges[0];
assert.equal(generated.relation.agent?.explanation,suggestion.explanation);
assert.equal(generated.relation.kind,'冲突','local fact conflict should stay visible on a model-enriched edge');
agentLibrary.decisions = [{ evidence:relation.evidenceKey, result:'dismissed', at }];
assert.equal(buildNoteGraph(agentLibrary).edges.length,0,'AI does not reintroduce an ignored local evidence pair');
assert.equal(buildNoteGraph(agentLibrary,true).edges[0].relation.evidenceKey,relation.evidenceKey,'restoring uses the original decision identity');
agentLibrary.decisions[0].result='accepted';
assert.equal(buildNoteGraph(agentLibrary).edges.length,1);
agentLibrary.decisions=[];
agentLibrary.notes[0]={...first,revision:2};
assert.equal(buildNoteGraph(agentLibrary).edges[0].relation.agent,undefined,'edited note invalidates the semantic suggestion while retaining independent local evidence');

const groupLibrary = emptyKnowledge();
groupLibrary.notes = [note('route','运营经验','按排队长度切换'), note('travel','旅行草稿','在拥堵时改道'), note('weather','天气限制','雨天只去室内'), note('inside','笔记内部','周一开放。周一闭馆。')];
const groupAnchor = (noteId: string, start = 0, end = 3) => ({noteId, revision:1, source:'body', start, end, origin:'用户记录'});
groupLibrary.agentGraph = {provider:'codex', at, notes:groupLibrary.notes.map(({id,revision})=>({id,revision})), reasoning:{version:2}, edges:[
  {...suggestion, from:'route', to:'route', evidenceKey:'combined', category:'创新', anchors:[
    groupAnchor('route',0,2), groupAnchor('route',2,4), groupAnchor('travel'), groupAnchor('weather'),
  ]},
  {...suggestion, from:'inside', to:'inside', evidenceKey:'internal', category:'矛盾', anchors:[
    groupAnchor('inside',0,4), groupAnchor('inside',5,9),
  ]},
]};
const multi = buildNoteGraph(groupLibrary);
assert.equal(multi.edges.length, 2, 'one logical finding for each evidence key');
assert.deepEqual(multi.edges[0].members, ['route','travel','weather'], 'additional notes participate even when the first two atoms are from one note');
assert.deepEqual(multi.edges[1].members, ['inside']);
assert.equal(multi.edges[0].relation.evidence.length, 4);
for (const id of ['route','travel','weather']) assert.deepEqual(multi.adjacency.get(id), [multi.edges[0]]);
assert.deepEqual(multi.adjacency.get('inside'), [multi.edges[1]]);
groupLibrary.decisions = [{evidence:'combined', result:'dismissed', at}];
assert.deepEqual([...buildNoteGraph(groupLibrary).adjacency.keys()], ['inside']);
assert.deepEqual([...buildNoteGraph(groupLibrary,true).adjacency.keys()], ['route','travel','weather','inside']);
groupLibrary.notes[2].revision++;
assert.equal(buildNoteGraph(groupLibrary,true).edges.length, 1, 'stale third source suppresses the whole finding');

const draftLibrary = emptyKnowledge();
draftLibrary.notes = [first, other, {...first,id:'archived',archivedAt:at}];
draftLibrary.inspirationCanvas = {links:[],nodes:[{noteId:'route-card',x:0,y:0,
  idea:{title:'红叶客流安排',detail:'京都清晨先走人多的步道。',origin:'manual'}}]};
const candidates = projectKnowledgeCandidates(draftLibrary, [], '按附件准备\n京都红叶步道摄影');
assert.ok(candidates.find(row=>row.id==='idea:route-card')?.excerpt.includes('清晨'));
assert.ok(candidates.find(row=>row.id==='note:a')?.excerpt.includes('京都'));
assert.ok(!candidates.some(row=>row.id==='note:archived'));
assert.deepEqual(projectKnowledgeCandidates(draftLibrary, [], '  '),[]);
assert.deepEqual(new Set(projectKnowledgeCandidates(draftLibrary, [], '项目目标 参考材料').map(row=>row.id)),
  new Set(['note:a','note:b','idea:route-card']), 'a small personal library reaches the Agent even with no useful search terms');

const festival = emptyKnowledge();
festival.notes = [note('gate','分散观众入场','根据各入口排队人数安排观众入场。'),
  note('router','备用节点切换','服务拥塞时将后续请求送至空闲实例。'),
  note('music','钢琴指法','拇指按住白键。'),
  ...Array.from({length:20},(_,i)=>note('album'+i,'图册 '+i,'森林深处')),];
festival.agentGraph = {provider:'codex',at,reasoning:{version:2},notes:festival.notes.map(({id,revision})=>({id,revision})),edges:[
  {...suggestion,from:'gate',to:'router',evidenceKey:'approved-application'},
  {...suggestion,from:'gate',to:'music',evidenceKey:'rejected-analogy'},
]};
festival.decisions = [{evidence:'approved-application',result:'accepted',at},{evidence:'rejected-analogy',result:'dismissed',at}];
const deliveries = createEmptySnapshot({id:'ops',name:'归档工作'});
deliveries.outputs = Object.fromEntries(Array.from({length:24},(_,i)=>['v'+i,{id:'v'+i,taskId:'gate',title:'入场交付 '+i,body:'分散观众入场',
  links:[],createdAt:at,updatedAt:at,origin:'agent' as const,status:'published' as const}]));
const festivalPool = projectKnowledgeCandidates(festival,[deliveries],'分散观众入场');
assert.ok(festivalPool.some(row=>row.id==='note:router'),'approved link admits a method with different vocabulary');
assert.ok(!festivalPool.some(row=>row.id==='note:music'),'do not seed a dismissed relationship through fallback');
assert.ok(festivalPool.some(row=>row.id.startsWith('note:album')),'reserve room to discover new associations');
assert.ok(festivalPool.some(row=>row.id.startsWith('ops:output:')));
assert.ok(festivalPool.filter(row=>row.id.startsWith('ops:output:')).length<=4);
assert.ok(festivalPool.length<=18);

// A plain caption can refer to a neighboring picture, but must not silently send another section.
{
  const top = '![成果](attachment:screen-a)', bottom = '![示例](attachment:screen-b)';
  const caption = '如图对应帮你管的成果，我想继续开发';
  const choices = (body:string, quote:string) => {
    const source = note('caption','成果继续开发',body);
    source.attachments = ['screen-a','screen-b','unreferenced'].map(id => ({id,name:'image.png',size:123,type:'image/png'}));
    const offset = body.indexOf(quote);
    return noteDispatchPictureChoices(source,makeSelection(body,offset,offset+quote.length));
  };
  const selected = (body:string,quote:string) => choices(body,quote).suggested.map(file=>file.id);
  assert.deepEqual(selected([top,'',caption].join('\n'),caption),['screen-a']);
  assert.deepEqual(selected(['',top,'',caption].join('\n'),caption),['screen-a']);
  assert.deepEqual(selected([caption,'',bottom].join('\n'),caption),['screen-b']);
  assert.deepEqual(selected([top,'',caption].join('\n'),'继续开发'),['screen-a']);
  assert.deepEqual(selected([top,'',caption,'',bottom].join('\n'),caption),[]);
  const ambiguous = choices([top,'',caption,'',bottom].join('\n'),caption);
  assert.ok(ambiguous.needsChoice);
  assert.deepEqual(ambiguous.options.map(file=>file.id),['screen-a','screen-b']);
  assert.deepEqual(selected([top,'请参考下方截图','',bottom].join('\n'),'请参考下方截图'),['screen-b']);
  assert.deepEqual(selected([top,'', '根据上图改动',bottom].join('\n'),'根据上图改动'),['screen-a']);
  const distant = choices([top,'另一段说明','',caption].join('\n'),caption);
  assert.ok(distant.needsChoice && !distant.suggested.length);
  assert.deepEqual(distant.options.map(file=>file.id),['screen-a']);
  assert.deepEqual(selected(['1. 另一个任务',top,'','2. '+caption].join('\n'),caption),[]);
  assert.deepEqual(selected([top,'帮你记需要支持原图复制'].join('\n'),'帮你记需要支持原图复制'),[]);
  assert.deepEqual(selected([top,'继续做'+bottom].join('\n'),bottom),['screen-b']);
  assert.ok(choices(caption,caption).needsChoice);
}

async function personalGraphs() {
  const library = emptyKnowledge();
  library.notes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => note(id, '同名笔记', '同一资料 https://example.test/shared'));
  assert.ok(buildNoteGraph(library).edges.length > 0);
  assert.equal(buildPersonalNoteGraph(parseKnowledge(JSON.stringify(library))).edges.length, 0,
    'existing automatic relations remain global until linked explicitly');
  library.manualGraphLinks = [['c','a'], ['a','b'], ['a','c'], ['c','d'], ['b','d'], ['d','e'], ['e','f']];
  const graph = buildPersonalNoteGraph(library);
  assert.equal(graph.edges.length, 6, 'one undirected edge for duplicate and reverse pairs');
  assert.ok(graph.edges.every(edge => edge.relation.manual && !edge.relation.agent));
  const firstLayer = exploreNoteLayers(graph, 'a', 1);
  assert.deepEqual(firstLayer.layerCounts, [2, 1, 1]);
  assert.deepEqual([...firstLayer.ids], ['a', 'b', 'c']);
  assert.equal(firstLayer.nextCount, 1);
  assert.deepEqual(exploreNoteLayers(graph, 'a', 2).paths.get('d'), ['a', 'b', 'd']);
  assert.deepEqual(exploreNoteLayers(graph, 'a', 3).paths.get('e'), ['a', 'b', 'd', 'e']);
  assert.ok(!exploreNoteLayers(graph, 'a', 3).paths.has('f'), 'fourth hop stays outside the scope');
  assert.equal(exploreNoteLayers(graph, 'a', 3).nextCount, 0);
  assert.deepEqual(exploreNoteLayers(graph, 'g', 1).paths.get('g'), ['g']);
  assert.equal(exploreNoteLayers(graph, 'gone', 2).ids.size, 0);
  const b = library.notes.find(n => n.id === 'b')!;
  b.archivedAt = at;
  assert.deepEqual(exploreNoteLayers(buildPersonalNoteGraph(library), 'a', 2).paths.get('d'), ['a', 'c', 'd']);
  assert.equal(exploreNoteLayers(buildPersonalNoteGraph(library), 'b', 3).ids.size, 0);
  delete b.archivedAt;
  assert.deepEqual(buildPersonalNoteGraph(library).adjacency.get('b')?.length, 2, 'unarchiving restores existing links');
  eraseKnowledgeNote(library, 'd');
  assert.ok(!library.manualGraphLinks.some(pair => pair.includes('d')), 'deleting a note clears all incident links');
  assert.throws(() => parseKnowledge(JSON.stringify({...library, manualGraphLinks: [['a','a']]})), /手动关联/);

  library.manualGraphLinks = [['a','b'], ['e','f']];
  const persistedNotes = JSON.stringify(library.notes);
  let raw = JSON.stringify(library);
  let writes = 0;
  const host = {
    readKnowledge: async () => raw,
    compareKnowledge: async (expected: string, value: string, reason?: string) => {
      assert.equal(reason, 'manual-graph-links', 'manual changes opt out of background Agent review');
      if (writes++ === 0) {
        const concurrent = parseKnowledge(raw);
        concurrent.manualGraphLinks!.push(['a', 'g']);
        raw = JSON.stringify(concurrent);
        return false;
      }
      assert.equal(expected, raw);
      raw = value;
      return true;
    },
  };
  Object.defineProperty(globalThis, 'window', {configurable:true, value:Object.assign(new EventTarget(), {quandeckDesktop:host})});
  const edited = await saveNoteGraphLinks('a', ['b'], ['c', 'c']);
  assert.deepEqual(edited.manualGraphLinks, [['e','f'], ['a','g'], ['a','c']], 'batch keeps a concurrent link and another graph');
  assert.equal(JSON.stringify(edited.notes), persistedNotes, 'manual edits preserve note contents, timestamps and revisions');
  assert.equal(writes, 2, 'the picker retried the whole change atomically');
  const retained = raw;
  await saveNoteGraphLinks('c', [], ['a']);
  assert.equal(raw, retained, 'saving the reciprocal relation is idempotent');
  await assert.rejects(saveNoteGraphLinks('a', ['c'], ['d', 'g']), /删除或归档/);
  await assert.rejects(saveNoteGraphLinks('d', [], ['a']), /删除或归档/);
  await assert.rejects(saveNoteGraphLinks('a', [], ['a']), /其他笔记/);
  assert.equal(raw, retained, 'a stale picker with a deleted target changes no links');
}
void personalGraphs().then(() => console.log('Personal graphs: three layers, stable paths, deletion and concurrent manual updates passed'));
