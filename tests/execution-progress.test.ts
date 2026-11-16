import assert from 'node:assert/strict';
import { executionProgress, executionStage, sessionProgress } from '../src/data/executionProgress';
import { deriveProjectActivity } from '../src/data/projectActivity';
import { createEmptySnapshot } from '../src/data/projectStorage';
import type { Session } from '../src/data/types';

const run: Session = { id: 'run', agentId: 'codex', title: '生成攻略', taskId: null, origin: 'dispatch', status: 'running', startedAt: '2026-11-16T12:00:00Z', lastActivity: '2026-11-16T12:00:00Z', step: null, tokens: 999999, rounds: [], subAgents: [] };
const unknown = sessionProgress(run)!;
assert.equal(unknown.state, 'flowing');
assert.equal(unknown.mode, 'unknown');
assert.equal(unknown.value, undefined, 'elapsed activity/token usage never invents a percentage');
assert.equal(executionProgress('submitting')!.label, '正在发送任务');
assert.equal(executionProgress('queued')!.state, 'queued');
assert.equal(executionProgress('waiting_reply')!.state, 'paused', 'waiting without source steps still has visible progress');
assert.equal(executionProgress('waiting_reply')!.value, undefined);
assert.equal(executionProgress('waiting_permission')!.label, '等待你的授权');
assert.equal(executionProgress('failed')!.state, 'stopped');
assert.equal(executionProgress('paused')!.state, 'paused');
assert.equal(executionProgress('archived'), null);
assert.equal(executionProgress('cancelled'), null);

run.step = { total: 8, completed: 3, label: '整理住宿信息' };
let progress = sessionProgress(run)!;
assert.equal(progress.mode, 'steps'); assert.equal(progress.value, 3); assert.equal(progress.total, 8);
assert.equal(progress.amount, '本轮已完成 3/8 步');
assert.equal(progress.stage, '整理住宿信息');
assert.equal(executionProgress('waiting_reply', { total: 8, completed: 8, label: '已完成' })!.label, '等待你的回复', 'a completed round never accepts the task');
for (const step of [{total: 8, label: 'incomplete'}, {total: NaN, completed: 1, label: 'bad'}, {total: 3, completed: 4, label: 'overflow'}, {total: 3.5, completed: 1, label: 'fraction'}, {total: 4, completed: -1, label: 'negative'}]) {
  assert.equal(executionProgress('running', step)!.mode, 'unknown', 'invalid or absent completion evidence is never treated as a number');
}
for (const percent of [NaN, Infinity, -1, 101]) assert.equal(executionProgress('running', null, percent)!.mode, 'unknown');
assert.equal(executionProgress('running', null, 0)!.value, 0, 'zero is real source progress');
assert.equal(executionProgress('running', null, 68.5)!.value, 68.5);
assert.equal(executionStage("/bin/zsh -lc 'python3 /tmp/verify_thailand_guide.py'"), '正在运行任务工具');
assert.equal(executionStage('npm test'), '正在运行任务工具');
assert.equal(executionStage('正在核对酒店照片'), '正在核对酒店照片');
run.step = { label: '/bin/zsh -lc command' };
assert.equal(sessionProgress(run)!.stage, '正在运行任务工具');
run.status = 'waiting_reply';
assert.equal(sessionProgress(run)!.stage, '', 'stale last command is not shown as current waiting work');

const snapshot = createEmptySnapshot();
snapshot.sessions[run.id] = { ...run, status: 'running', step: { total: 5, completed: 2, label: '核对地图' } };
const entry = deriveProjectActivity(snapshot).entries[0];
assert.equal(entry.step?.completed, 2); assert.equal(entry.step?.total, 5);
assert.deepEqual(executionProgress(entry.state, entry.step, entry.percent), sessionProgress(snapshot.sessions[run.id]), 'task and activity progress use identical source facts');
const before = JSON.stringify(snapshot);
executionProgress(entry.state, entry.step, entry.percent);
assert.equal(JSON.stringify(snapshot), before, 'progress presentation never modifies source or task completion');
console.log('Execution progress: real counts, unknown totals, dispatch/wait/failure states, command privacy and cross-view consistency passed');
