import assert from 'node:assert/strict';
import { createSampleSnapshot } from '../src/data/fixtures';
import { portfolioOverview, matchesProjectFilter } from '../src/data/portfolio';
import type { Snapshot } from '../src/data/types';

function clean(id: string, name: string): Snapshot {
  const snapshot = createSampleSnapshot();
  snapshot.project = { ...snapshot.project, id, name };
  snapshot.tasks = {}; snapshot.sessions = {}; snapshot.orchestrations = {}; snapshot.outputs = {};
  snapshot.journal.blocks = [];
  return snapshot;
}
const none = portfolioOverview([clean('', '')]);
assert.equal(none.projects.length, 0, 'the startup placeholder is not a real project');
assert.equal(none.totalTasks, 0);
assert.equal(none.reports.length, 0);
assert.equal(none.completedProjects, 0);

const first = clean('project-one', '旅行准备');
first.tasks['task-shared'] = { id: 'task-shared', title: '制定路线', owner: 'me', sessionIds: [], completion: null, manualLock: false, createdAt: '10:00' };
first.tasks['task-next'] = { ...first.tasks['task-shared'], id: 'task-next', title: '订车票' };
first.outputs!['first-output'] = { id: 'first-output', taskId: 'task-shared', title: '路线说明', body: '海边慢行路线', links: [], status: 'published', origin: 'human', createdAt: '2026-11-15T08:00:00Z', updatedAt: '2026-11-15T09:00:00Z' };
first.outputs!['draft'] = { ...first.outputs!['first-output'], id: 'draft', status: 'draft', title: '未提交草稿' };
const second = clean('project-two', '产品开发');
second.tasks['task-shared'] = { ...first.tasks['task-shared'], completion: { reason: 'manual', at: '11:00' } };
second.outputs!['second-output'] = { ...first.outputs!['first-output'], id: 'second-output', title: '设计稿', origin: 'agent', updatedAt: '2026-11-16T08:00:00Z' };
const empty = clean('project-empty', '新项目');
const before = structuredClone([first, second, empty]);
const all = portfolioOverview([first, second, empty]);
assert.deepEqual([first, second, empty], before, 'derivation does not mutate data');
assert.equal(all.projects.length, 3);
assert.equal(all.totalTasks, 3, 'tasks in different project scopes remain independent even with equal task ids');
assert.equal(all.counts.done, 1);
assert.equal(all.counts.pending, 2);
assert.equal(all.completedProjects, 1, 'an empty project is never marked complete');
assert.equal(all.projects[2].completion, null, 'empty projects do not invent a completion percentage');
assert.equal(all.reports.length, 2, 'published outputs are included while drafts remain private');
assert.equal(all.humanReports, 1); assert.equal(all.agentReports, 1); assert.equal(all.unknownReports, 0);
assert.deepEqual(all.reports.map(report => report.projectId), ['project-two', 'project-one'], 'recent reports use exact source chronology across projects');
assert(matchesProjectFilter(all.projects[1], 'done'));
assert(matchesProjectFilter(all.projects[2], 'active'));
assert(!matchesProjectFilter(all.projects[1], 'attention'));

const changed = structuredClone(first);
changed.tasks['task-shared'].completion = { reason: 'manual', at: '12:00' };
const deduplicated = portfolioOverview([first, second, empty, changed]);
assert.equal(deduplicated.projects.length, 3);
assert.equal(deduplicated.projects[0].done, 1, 'current snapshot replaces a stale project without changing project order');
assert.equal(deduplicated.projects[0].id, 'project-one');
assert.equal(deduplicated.reports.length, 2, 'duplicate snapshots never multiply outputs');
const withAgent = createSampleSnapshot();
withAgent.project.id = 'project-agent';
const mixed = portfolioOverview([first, second, withAgent]);
assert.equal(mixed.projects[2].counts.attention, 2);
assert.equal(mixed.attentionProjects, 1);
assert(mixed.agentReports > all.agentReports, 'completed real Agent reports join human deliverables');
assert.equal(mixed.totalTasks, 3 + Object.keys(withAgent.tasks).length, 'nested subtasks never inflate project main-task totals');
console.log('portfolio: clean startup, project isolation, root-only totals, published provenance, duplicate snapshots and source chronology passed');
