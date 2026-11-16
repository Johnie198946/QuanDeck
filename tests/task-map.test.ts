import assert from 'node:assert/strict';
import { createSearchOrchestration, SEARCH_TASK_ID } from '../src/data/orchestrationFixture';
import { taskMapChildren, taskMapGroups, taskMapItems, taskMapPath } from '../src/data/taskMap';

const orchestration = createSearchOrchestration();
const roots = taskMapChildren(orchestration, SEARCH_TASK_ID);
assert.equal(roots.length, 8, 'main map shows only direct children');
assert(!roots.some(item => item.id === 'w-seed'), 'grandchildren stay in their actual branch');
assert.deepEqual(taskMapChildren(orchestration, 'w-index').map(item => item.id), ['w-seed', 'w-edge']);
assert.deepEqual(taskMapPath(orchestration, 'w-edge').map(item => item.id), ['w-index', 'w-edge']);
assert.deepEqual(taskMapGroups(orchestration, roots).map(group => group.phase), ['理解', '实现', '交付']);
assert.deepEqual(taskMapGroups(orchestration, roots).map(group => group.items.length), [3, 3, 2]);

orchestration.itemOrder = ['missing-record', ...orchestration.itemOrder, 'w-index'];
assert.equal(taskMapItems(orchestration).length, 10, 'stale and duplicate order entries cannot duplicate map nodes');
orchestration.itemOrder = orchestration.itemOrder.filter(id => id !== 'w-seed');
assert.equal(taskMapChildren(orchestration, 'w-index').length, 2, 'a child remains accessible before itemOrder catches up');

orchestration.items['w-seed'].phase = '复核';
assert.deepEqual(taskMapGroups(orchestration, taskMapChildren(orchestration, 'w-index')).map(group => group.phase), ['实现', '复核'], 'new phases follow configured phases');
orchestration.items['w-index'].parentTaskId = 'w-edge';
assert.equal(taskMapPath(orchestration, 'w-edge').length, 2, 'malformed cyclic ancestry cannot hang rendering');
orchestration.items['w-index'].parentTaskId = 'w-index';
assert(!taskMapChildren(orchestration, 'w-index').some(item => item.id === 'w-index'), 'self edges are excluded');
assert.deepEqual(taskMapPath(orchestration, 'missing-record'), []);
const stale = createSearchOrchestration();
stale.phases = ['准备', '整理', '成稿'];
Object.values(stale.items).forEach(item => { item.phase = '执行'; });
const before = JSON.stringify(stale);
const actual = taskMapGroups(stale, taskMapItems(stale));
assert.deepEqual(actual.map(group => group.phase), ['执行'], 'real imported phase labels remain visible when the declaration is stale');
assert.equal(actual[0].items.length, Object.keys(stale.items).length, 'scope grouping cannot hide imported tasks behind an empty phase');
assert.equal(JSON.stringify(stale), before, 'phase grouping never rewrites the ledger');
console.log('task-map: actual parent links, complete node access, phase order and cycle safety passed');
