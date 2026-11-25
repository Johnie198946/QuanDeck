import assert from 'node:assert/strict';
import { buildKnowledgeIndex, buildNoteGraph, knowledgeRelations, recommendKnowledge, searchKnowledge } from '../src/data/knowledgeIndex';
import { makeSelection, locateSelection, noteLinks, emptyKnowledge, updateNote, type KnowledgeNote } from '../src/data/knowledgeNotes';
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
