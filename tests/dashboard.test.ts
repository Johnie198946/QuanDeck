import assert from 'node:assert/strict';
import { createSampleSnapshot } from '../src/data/fixtures';
import { dashboardLanes, dashboardOverview } from '../src/data/dashboard';

const snap = createSampleSnapshot();
const overview = dashboardOverview(snap);
const root = overview.rows.find(row => row.task.id === 'task-a')!;
assert(root.running && root.waiting, 'fixture covers a task with parallel running and waiting branches');
assert.equal(root.bucket, 'attention', 'waiting is a display priority, never an extra task');
assert.equal(Object.values(overview.counts).reduce((a, b) => a + b, 0), Object.keys(snap.tasks).length);
assert.equal(root.total, 8, 'progress counts first-level children without double counting descendants');
assert.equal(root.completed, 3);
assert(root.pendingItem?.waiting?.question);

snap.tasks['task-a'].completion = { reason: 'manual', at: '20:45' };
const done = dashboardOverview(snap);
assert.equal(done.rows.find(row => row.task.id === 'task-a')!.bucket, 'done', 'manual completion wins over stale child activity');
assert.equal(done.counts.done, 1);

const failure = createSampleSnapshot();
failure.sessions[failure.tasks['task-b'].sessionIds[0]].status = 'failed';
const failed = dashboardOverview(failure).rows.find(row => row.task.id === 'task-b');
assert.equal(failed?.bucket, 'attention', 'failed executions remain visible for follow-up');

const empty = createSampleSnapshot();
empty.tasks = {};
assert.equal(dashboardOverview(empty).rows.length, 0);
assert.equal(Object.values(dashboardOverview(empty).counts).reduce((a, b) => a + b, 0), 0);
const parallel = dashboardLanes([{from: 10, to: 30}, {from: 15, to: 25}, {from: 30, to: 45}]);
assert.deepEqual(parallel.lanes.map(value => value.lane), [0, 1, 0], 'simultaneous work stays independently visible, non-overlapping work reuses a lane');
assert.equal(parallel.count, 2);
console.log('dashboard: exclusive status, nested progress, completion, failure, empty-state checks passed');
