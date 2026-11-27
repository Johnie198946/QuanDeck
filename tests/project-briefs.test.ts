import assert from 'node:assert/strict';
import { briefHandoff, buildProjectBriefs, PERSONAL_BRIEF_ID, searchBriefEvidence } from '../src/components/homepage/projectBriefs';
import { homeBoardCards, type BoardCard } from '../src/components/homepage/homeBoardData';
import { applyCollaboration, ensureCollaboration } from '../src/data/collaboration';
import { emptyKnowledge, KNOWLEDGE_STORAGE_KEY, type KnowledgeNote } from '../src/data/knowledgeNotes';
import { fileNoteQuote, mutateKnowledge, readKnowledge, unfileNoteQuote } from '../src/data/knowledgeStore';
import { createEmptySnapshot } from '../src/data/projectStorage';

const today = '2026-11-26T04:00:00.000Z', before = '2026-11-25T03:00:00.000Z', now = Date.parse(today);
const note = (id: string, title: string, body: string): KnowledgeNote => ({
  id, title, body, createdAt: before, updatedAt: before, revision: 1, attachments: [], expansions: [], history: [],
});
const travel = createEmptySnapshot({ id: 'travel', name: '日本行程', description: '定下来年春天的路线', timeZone: 'Asia/Shanghai' });
const talk = createEmptySnapshot({ id: 'talk', name: '产品演讲' });
const empty = createEmptySnapshot({ id: 'empty', name: '空项目' });
const deleted = createEmptySnapshot({ id: 'deleted', name: '旧项目', deletedAt: today });
const notes = [note('mixed', '随手记', '保留京都的半天\n大阪的旧书店也值得看\n超市买牛奶'), note('other', '京都想法', '相同标题或词语不会自动归入项目')];
notes[0].todos = [
  { id: 'travel-todo', text: '保留京都的半天', lineIndex: 0, createdAt: before, dueAt: today, progress: [{ id: 'pg', text: '已经问过旅馆', at: today }] },
  { id: 'personal', text: '超市买牛奶', lineIndex: 2, createdAt: before, dueAt: today },
];
travel.tasks.t1 = { id: 't1', title: '订旅馆', owner: 'me', createdAt: before, completion: null, sessionIds: [], manualLock: false,
  inputs: [{ id: 'transfer', at: before, text: '来自笔记《随手记》\n保留京都的半天', noteSource: { noteId: 'mixed', lineIndex: 0 } }] };
const c = ensureCollaboration(travel);
c.decisions.push({ id: 'confirmed', decisionId: 'd', revision: 1, at: before, kind: 'preference', authority: 'confirmed', text: '先订温泉', source: 'human' },
  { id: 'withdrawn', decisionId: 'd', revision: 2, at: today, kind: 'preference', authority: 'withdrawn', text: '取消温泉偏好', source: 'human' },
  { id: 'keep', decisionId: 'k', revision: 1, at: today, taskKey: 't1', kind: 'constraint', authority: 'confirmed', text: '避开周末人群', source: 'human' });
const projects = [empty, travel, talk, deleted];
const cards = homeBoardCards(projects, notes, new Map(), now);
const target = cards.find(card => card.taskId === 't1')!;
assert.ok(target);
assert.equal(cards.filter(card => card.todoId === 'travel-todo').length, 0, 'a todo added to an exactly transferred line is counted once');
const waiting: BoardCard = { key: 'waiting', project: '产品演讲', projectId: 'talk', taskId: 't2', title: '做封面', state: 'attention', owners: ['agent'], ownerName: 'Codex',
  at: before, progress: [], sources: [], steps: [{ id: 'page', title: '制作封面插画', state: '待验收' }],
  attention: { id: 'a', kind: 'review', title: '制作封面插画', action: '去验收', label: '待验收', detail: '封面已交回，等你确认。', taskId: 't2', itemId: 'page', projectId: 'talk' },
  results: [{ id: 'r', title: '新版封面', text: '使用靛蓝色背景', at: today, status: '待核对', ai: true, itemId: 'page' }] };
cards.push(waiting);
const build = (library: KnowledgeNote[]) => buildProjectBriefs(projects, cards, library, now);
const { briefs, evidence } = build(notes);
assert.equal(briefs[0].id, 'talk');
assert.equal(briefs[0].focusTarget?.itemId, 'page');
assert.equal(briefs[0].actionLabel, '去验收');
assert.equal(briefs[0].summary, 'AI 已交回 · 使用靛蓝色背景');
assert.equal(briefs[0].counts.done, 0, 'an AI delivery alone is not task completion');
assert.equal(briefs.at(-1)?.id, 'empty');
assert.ok(!briefs.some(brief => brief.id === 'deleted'));
assert.equal(briefs.find(row => row.id === 'travel')?.goal, '定下来年春天的路线');
assert.equal(searchBriefEvidence(evidence, '大阪')[0].lineIndex, 1);
assert.equal(searchBriefEvidence(evidence, '帮我找大阪旧书店')[0].lineIndex, 1, 'search recalls a compressed phrase');
const links = build([note('ref', '读书', '[书单](https://example.test/reading-list)')]).evidence;
assert.equal(searchBriefEvidence(links, 'reading-list')[0].noteId, 'ref');
assert.equal(searchBriefEvidence(evidence, '大阪', 'travel').length, 0);
assert.equal(searchBriefEvidence(evidence, '京都想法', 'travel').length, 0, 'no project assignment from a matching word');
assert.equal(searchBriefEvidence(evidence, '超市', PERSONAL_BRIEF_ID)[0].todoId, 'personal');
assert.equal(searchBriefEvidence(evidence, '大阪', PERSONAL_BRIEF_ID).length, 0);
assert.equal(searchBriefEvidence(evidence, '旅馆', 'travel').some(row => row.kind === 'progress'), true);
assert.equal(searchBriefEvidence(evidence, '产品演讲 靛蓝色')[0].resultId, 'r');
assert.equal(searchBriefEvidence(evidence, '插画')[0].itemId, 'page');
assert.equal(searchBriefEvidence(evidence, '温泉').length, 0, 'withdrawn memory stays out of the current project brief');
assert.equal(searchBriefEvidence(evidence, '避开周末')[0].taskId, 't1');
assert.equal(searchBriefEvidence(evidence, '保留京都').length, 1, 'the same linked paragraph is found once');
assert.equal(new Set(evidence.map(entry => entry.id)).size, evidence.length);
assert.deepEqual(buildProjectBriefs([], [], [notes[1]], now).evidence.map(row => row.noteId), ['other'], 'notes remain retrievable before a project is created');
const closed = buildProjectBriefs([travel], [{ ...target, state: 'done', attention: undefined, reason: undefined }], [], now).briefs[0];
assert.match(closed.nextAction, /已完成/);
const overdue = { ...target, state: 'pending' as const, attention: undefined, reason: undefined, due: '2026-11-25' };
assert.match(buildProjectBriefs([travel], [overdue], [], now).briefs[0].nextAction, /跟进/);
assert.match(buildProjectBriefs([travel], [{ ...overdue, due: '2026-11-26' }], [], now).briefs[0].nextAction, /待开始/);

// The owner of this particular handoff matters on a parent shared by a human and an agent.
for (const kind of ['blocked', 'stalled', 'overdue'] as const) {
  const returned: BoardCard = { ...waiting, owners: ['me', 'agent'], attentionOwner: 'agent', attention: {
    ...waiting.attention!, kind, label: kind === 'blocked' ? '待修改' : '跟进', detail: '执行者收到改动要求' } };
  const mine: BoardCard = { ...target, attention: undefined, state: 'pending' };
  const withSignal = buildProjectBriefs([travel,talk], [returned,mine], [], now).briefs;
  assert.equal(withSignal[0].focus?.key, mine.key);
  assert.equal(withSignal[1].waitingOnMe, 0, 'agent conditions never get counted as a user request');
  assert.equal(briefHandoff(returned).kind, 'agent');
  assert.ok(!withSignal[1].nextAction.startsWith('处理'));
}
assert.equal(briefHandoff(waiting).needsMe, true, 'an agent asking for a review really is waiting for me');

// Real storage commands, including a newer-looking unrelated output, must lead to the exact review target.
const reviewing = createEmptySnapshot({ id: 'reviews', name: '评审' });
let serial = 0;
function command(type: Parameters<typeof applyCollaboration>[1]['type'], payload: Record<string, unknown>, taskId?: string) {
  const response = applyCollaboration(reviewing, { type, taskId, projectId: 'reviews', payload,
    expectedVersion: taskId ? reviewing.collaboration?.tasks[taskId].version : undefined, idempotencyKey: 'brief-' + (++serial) }, { kind: 'human' });
  assert.ok(response.ok, response.message);
  return response.resourceId!;
}
const reviewTask = command('create_task', { title: '做演示', owner: 'me', goal: '准备演讲', criteria: ['清晰'] });
command('submit', { title: '应核对的版本', body: '正式交回的内容' }, reviewTask);
const saved = Object.values(reviewing.outputs!)[0];
reviewing.outputs!.unrelated = { ...saved, id: 'unrelated', title: '其他输出', body: '临时试验', updatedAt: '2099-11-26T02:00:00Z' };
const real = buildProjectBriefs([reviewing], homeBoardCards([reviewing], [], new Map(), now), [], now).briefs[0];
assert.equal(real.focusTarget?.resultId, 'output:' + saved.id);
assert.equal(real.focusTarget?.text, '正式交回的内容');
assert.equal(real.nextAction, '核对「应核对的版本」');
assert.equal(real.actionLabel, '看成果');

async function testFiling() {
  const items = new Map<string,string>();
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) }, configurable: true });
  items.set(KNOWLEDGE_STORAGE_KEY, JSON.stringify({ ...emptyKnowledge(), notes }));
  const quote = '大阪的旧书店也值得看';
  await Promise.all([fileNoteQuote('travel', 'mixed', 1, quote), fileNoteQuote('travel', 'mixed', 1, quote)]);
  await fileNoteQuote('talk', 'mixed', 1, quote);
  const linked = (await readKnowledge()).notes;
  assert.equal(linked[0].projectQuotes!.length, 2, 'safe on double click, and a source may support two projects');
  for (const id of ['talk', 'travel']) assert.equal(searchBriefEvidence(build(linked).evidence, quote, id).length, 1);
  assert.equal(searchBriefEvidence(build(linked).evidence, '超市', 'travel').length, 0);
  await assert.rejects(fileNoteQuote('travel', 'mixed', 2, quote), /原文/);
  await mutateKnowledge(library => { library.notes[0].body = '新想法\n保留京都的半天\n大阪的旧书店也值得看\n超市买牛奶'; });
  assert.equal(searchBriefEvidence(build((await readKnowledge()).notes).evidence, quote, 'travel')[0].lineIndex, 2, 'an intact quote follows a moved line');
  await mutateKnowledge(library => { library.notes[0].body = '新想法\n保留京都的半天\n旧书店改天去\n超市买牛奶'; });
  const afterEdit = build((await readKnowledge()).notes).evidence;
  assert.equal(searchBriefEvidence(afterEdit, quote, 'travel')[0].lineIndex, undefined, 'a changed original retains only the dated quote');
  assert.equal(searchBriefEvidence(afterEdit, '旧书店改天去', 'travel').length, 0);
  await unfileNoteQuote('mixed', linked[0].projectQuotes![0].id);
  const afterUndo = build((await readKnowledge()).notes).evidence;
  assert.equal(searchBriefEvidence(afterUndo, quote, 'travel').length, 0);
  assert.equal(searchBriefEvidence(afterUndo, quote, 'talk').length, 1);
}
void testFiling().then(() => console.log('project-briefs: task focus, traced evidence, scoped recollection, and reversible filing passed'));
