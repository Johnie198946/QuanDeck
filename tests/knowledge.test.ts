import assert from 'node:assert/strict';
import { buildKnowledgeIndex, knowledgeRelations, recommendKnowledge, searchKnowledge } from '../src/data/knowledgeIndex';
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
library.notes = [first, other, { ...note('hidden', '秘密归档', '此前的京都红叶路线'), archivedAt: at }];
const index = buildKnowledgeIndex(library, [actual, ignore]);
assert.deepEqual(searchKnowledge(index, '帮我找去年做过的地下水治理方案', 20, 2026).map(item => item.projectId), ['water']);
assert.deepEqual(searchKnowledge(index, '京都红叶路线').map(item => item.noteId).sort(), ['a', 'b']);
assert.equal(searchKnowledge(index, '秘密归档').length, 0);
assert.ok(recommendKnowledge(index, '想研究京都红叶路线').some(source => source.noteId === 'a'));
assert.equal(recommendKnowledge(index, '安排一项完全不同的说明').length, 0);
const relation = knowledgeRelations(first, index, library)[0];
assert.equal(relation.kind, '冲突');
assert.deepEqual(relation.evidence.slice(0, 2), ['预算：3000 元', '预算：5000 元']);
assert.equal(knowledgeRelations(other, index, library)[0].evidenceKey, relation.evidenceKey);
library.decisions.push({ evidence: relation.evidenceKey, result: 'dismissed', at });
assert.equal(knowledgeRelations(first, index, library).length, 0);
assert.equal(knowledgeRelations(other, index, library).length, 0);
const revision = updateNote(first, { title: first.title, body: first.body.replace('3000', '4500') }, '2026-11-24T12:00:00Z');
assert.equal(revision.revision, 2);
assert.equal(revision.history[0].body, first.body);
assert.equal(knowledgeRelations(revision, index, library)[0].kind, '冲突', 'changed evidence can reappear');
const selected = makeSelection(first.body, 8, 14);
assert.equal(locateSelection('新增：' + first.body, selected), selected.offset + 3);
assert.equal(locateSelection('已经重写', selected), undefined);
assert.deepEqual(noteLinks('来源 https://example.test/path。https://user:pass@example.test'), ['https://example.test/path']);
console.log('Knowledge: 2 projects, personal notes, source-date search, archived exclusion, scoped anchors, history and evidence-scoped decisions passed');
