import assert from 'node:assert/strict';
import type { KnowledgeNote } from '../src/data/knowledgeNotes';
import { savedProjectBriefInput } from '../src/data/projectBriefAgentInput';
import { briefInsightInput } from '../src/data/projectBriefInsight';
import { createEmptySnapshot } from '../src/data/projectStorage';

const projectId = 'gallery';
const snapshot = createEmptySnapshot({ id: projectId, name: '展览' });
const at = '2026-01-01T09:00:00Z';
const note: KnowledgeNote = { id: 'routes', title: '随手记', body: '缩短展签\n未归入项目的私事', createdAt: at,
  updatedAt: at, revision: 1, attachments: [], expansions: [], history: [], projectQuotes: [
    { id: 'filed', at, projectId, lineIndex: 0, text: '缩短展签' },
    { id: 'elsewhere', at, projectId: 'other', lineIndex: 1, text: '未归入项目的私事' },
  ] };
const unrelated = { ...note, id: 'unrelated', title: '不相关', projectQuotes: [] };
const input = savedProjectBriefInput(snapshot, [note, unrelated]);
assert.deepEqual(input.rows.map(row => row.text), ['缩短展签']);
assert.doesNotMatch(JSON.stringify(input.rows), /未归入项目的私事|不相关/);
assert.equal(savedProjectBriefInput(snapshot, [note]).evidenceKey, input.evidenceKey);
const removed = savedProjectBriefInput(snapshot, [{ ...note, projectQuotes: [] }]);
assert.notEqual(removed.evidenceKey, input.evidenceKey);
assert.equal(removed.availableCount, 0);

const tasks = Array.from({ length: 200 }, (_, i) => ({ id: 'task-' + i, kind: 'task', at, projectId, title: '任务', text: '进度'.repeat(5000) }));
const rare = { ...tasks[0], id: 'decision', kind: 'decision', at: '2025-01-01', text: '保留展签的原话' };
const bounded = briefInsightInput(projectId, [...tasks, rare]);
assert.equal(bounded.availableCount, 201);
assert.equal(bounded.rows.length, 24);
assert.ok(bounded.rows.some(row => row.id === rare.id));
assert.ok(bounded.rows.every(row => row.text.length <= 550));
assert.equal(briefInsightInput(projectId, [rare, ...tasks.reverse()]).evidenceKey, bounded.evidenceKey);

import { savedTaskBriefInput } from '../src/data/taskBrief';
const personal: KnowledgeNote = {...note, todos:[
  {id:'original',lineIndex:0,text:'追台卡',createdAt:at,dueAt:at,progress:[{id:'contact',at,text:'已收到样稿，再确认字号。'}]},
  {id:'follow',lineIndex:0,text:'确认字号',createdAt:at,dueAt:at,follows:{parentId:'original',progressId:'contact'}},
  {id:'unrelated',lineIndex:1,text:'不会发给这个任务的其他记录',createdAt:at,dueAt:at},
]};
const followKey = JSON.stringify([personal.id,'follow']);
const follow = savedTaskBriefInput(followKey,undefined,[personal]);
assert.ok(follow);
assert.match(JSON.stringify(follow.rows),/已收到样稿，再确认字号/);
assert.doesNotMatch(JSON.stringify(follow.rows),/未归入项目的私事|不会发给这个任务的其他记录/);
assert.equal(savedTaskBriefInput('missing',undefined,[personal]),undefined);
personal.todos![1].progress=[{id:'change',at,text:'字号已改大，准备交付。'}];
assert.notEqual(savedTaskBriefInput(followKey,undefined,[personal])?.revision,follow.revision);
