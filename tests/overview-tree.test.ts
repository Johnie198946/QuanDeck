import { createOverviewForestSelector } from '../src/data/overviewTree';
import assert from 'node:assert/strict';
import { overviewForest, overviewProject, overviewNodeKey, filterOverview, flattenOverview } from '../src/data/overviewTree';
import { createOverviewFixtures } from './overview-tree.fixture';

const snapshots = createOverviewFixtures();
const before = structuredClone(snapshots);
const forest = overviewForest(snapshots);
assert.equal(forest.length, 3);
assert.equal(forest[0].progress?.total, 2, 'project totals count roots, never descendants');
assert.equal(forest[2].progress, undefined, 'empty projects do not invent a denominator');
assert.equal(forest[2].bucket, 'pending');
const task = forest[0].children[0];
assert.equal(task.progress?.total, 4);
assert.equal(task.progress?.done, 1);
assert.equal(task.bucket, 'attention');
assert.equal(task.children[0].children[1].execution?.mode, 'steps');
assert.equal(task.children[0].children[1].execution?.value, 2);
assert.equal(task.children[0].execution?.mode, 'unknown', 'unknown progress never becomes a percentage');
const selected = filterOverview(forest, 'bangkok transfer', 'all');
assert.equal(selected.length, 1);
assert.deepEqual(flattenOverview(selected).map(node => node.title), ['我要去泰国玩', '曼谷与芭提雅图文攻略', '路线与交通', '曼谷 → 芭提雅交通 Bangkok transfer']);
assert.equal(selected[0].children[0].progress?.total, 4, 'filtering does not change the reported progress scope');
assert.equal(filterOverview(forest, 'does-not-exist', 'all').length, 0);
assert.equal(filterOverview(forest, 'QuanDeck', 'all')[0].children.length, 1, 'project search preserves its contents');
const attention = filterOverview(forest, '', 'attention');
assert.equal(attention.length, 1);
assert.deepEqual(attention[0].children[0].children.map(node => node.itemId), ['hotels']);
assert.notEqual(forest[0].children[0].key, forest[1].children[0].key, 'equal task IDs stay project scoped');
assert.equal(overviewNodeKey('a:b', 'c'), JSON.stringify(['a:b', 'c', null]));
assert.equal(overviewForest([...snapshots, snapshots[0]]).length, 3);
assert.deepEqual(snapshots, before, 'tree and filtering leave snapshot, blackboard and ledger untouched');

const completed = structuredClone(snapshots[0]);
Object.values(completed.orchestrations!['shared-root'].items).forEach(item => { item.status = 'done'; });
assert.equal(overviewProject(completed).children[0].bucket, 'attention', 'finished subtasks still await parent acceptance');
completed.tasks['shared-root'].completion = { reason: 'manual', at: '11:00' };
assert.equal(overviewProject(completed).children[0].execution, null, 'completed tasks do not display stale running progress');

const imported = structuredClone(snapshots[0]);
const orchestration = imported.orchestrations!['shared-root'];
orchestration.items.routes.parentTaskId = 'transfer';
orchestration.items.transfer.parentTaskId = 'routes';
const orphan = { ...orchestration.items.airport, id: 'orphan', parentTaskId: 'missing-parent', title: '待核对历史任务' };
orchestration.items.orphan = orphan;
const recovered = flattenOverview([overviewProject(imported)]).filter(node => node.kind === 'work');
assert.equal(recovered.length, 7, 'cycle and missing-order history remain reachable once, without recursion loops');
assert.equal(new Set(recovered.map(node => node.key)).size, recovered.length);
assert(recovered.some(node => node.detached), 'unknown parent relations are identified instead of fabricated');

const large = structuredClone(snapshots[0]);
for (let i = 0; i < 100; i++) large.tasks[`extra-${i}`] = { ...large.tasks.packing, id: `extra-${i}`, title: `任务 ${i}` };
let parent = 'transfer';
for (let i = 0; i < 5; i++) { const id = `deep-${i}`; large.orchestrations!['shared-root'].items[id] = { ...orphan, id, parentTaskId: parent, title: i === 4 ? '深层检索目标' : `深层 ${i}` }; parent = id; }
const largeTree = overviewProject(large);
assert.equal(largeTree.children.length, 102);
const deep = flattenOverview(filterOverview([largeTree], '深层检索目标', 'all'));
assert.equal(deep.at(-1)?.title, '深层检索目标');
assert.equal(deep.length, 9, 'search retains every ancestor across five nested levels');
console.log('overview tree: project scopes, ancestor filtering, exact counts, unknown progress, acceptance, cycles, 100 tasks and deep nesting passed');

// A renderer update to one project must not rebuild every other project model.
const rendererSelect = createOverviewForestSelector();
const [rendererA, rendererB] = createOverviewFixtures();
rendererB.project = {...rendererB.project, id: 'other-project'};
const rendererInitial = rendererSelect([rendererA, rendererB]);
const rendererChanged = structuredClone(rendererA);
rendererChanged.project.name = 'changed';
const rendererNext = rendererSelect([rendererChanged, rendererB]);
assert.notEqual(rendererNext[0], rendererInitial[0]);
assert.equal(rendererNext[1], rendererInitial[1]);
assert.equal(rendererNext[0].title, 'changed');
assert.deepEqual(rendererSelect([rendererB]).map(node => node.projectId), ['other-project']);
