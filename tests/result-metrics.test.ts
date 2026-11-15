import assert from 'node:assert/strict';
import { createSampleSnapshot } from '../src/data/fixtures';
import { deriveResultMetrics, resultBucket } from '../src/data/resultMetrics';
import { latestAttempt } from '../src/data/orchestration';
import { ensureTimeline } from '../src/data/timeline';
import type { ExecutionInterval } from '../src/data/timeline';

// Progress is measured at one hierarchy level. Nested descendants never inflate the root denominator.
const snap = createSampleSnapshot();
const o = snap.orchestrations!['task-a'];
const before = structuredClone(snap);
const root = deriveResultMetrics(snap, 'task-a', null);
assert.deepEqual(snap, before, 'chart derivation must not seed or mutate source data');
assert.equal(root.total, 8);
assert.equal(root.completed, 3);
assert.equal(root.ratio, 3 / 8);
assert.deepEqual(root.counts, { done: 3, running: 2, attention: 1, pending: 2, cancelled: 0 });
assert.equal(root.tokenValue, 186_000, 'exclusive attempts plus coordination must not repeat the inclusive 186k main session');
assert.equal(root.tokens.find(row => row.id === 'w-index')?.tokens, 52_000);
assert.equal(root.tokens.find(row => row.id === 'w-read')?.tokens, 24_000, 'real usage from interrupted and resumed attempts both counts');
assert.equal(root.partialTokens, false);
assert.equal(root.activeMinutes, null, 'a start/end span alone is not evidence of active running intervals');
assert.equal(root.reports.length, 4);
assert(!root.reports.some(report => report.itemId === 'w-index' || report.itemId === 'w-ui'));
assert(root.reports.every((report, index) => index === 0 || report.timestamp >= root.reports[index - 1].timestamp));
assert.equal(root.reports.find(report => report.itemId === 'w-read')?.attemptId, 'at-read-2');
assert.equal(root.reports.find(report => report.itemId === 'w-read')?.sessionId, 'ses-claude-sub-explore');

const index = deriveResultMetrics(snap, 'task-a', 'w-index');
assert.equal(index.total, 2);
assert.equal(index.completed, 1);
assert.equal(index.tokenValue, 52_000);
assert.equal(index.tokens.find(row => row.id === 'self:w-index')?.tokens, 40_000);
assert.deepEqual(index.reports.map(report => report.itemId), ['w-seed']);
const leaf = deriveResultMetrics(snap, 'task-a', 'w-ui');
assert.equal(leaf.total, 3);
assert.equal(leaf.completed, 1);
assert.equal(leaf.tokenValue, 31_000);
assert.equal(leaf.reports.length, 0);
const unknownSteps = deriveResultMetrics(snap, 'task-a', 'w-edge');
assert.equal(unknownSteps.total, null);
assert.equal(unknownSteps.completed, null);
assert.equal(unknownSteps.ratio, null, 'unknown progress must not be painted as 0%');
assert.equal(deriveResultMetrics(snap, 'task-a', 'missing').tokenValue, null);
assert.equal(deriveResultMetrics(snap, 'missing', null).reports.length, 0);
assert.equal(resultBucket('queued'), 'pending');
assert.equal(resultBucket('waiting_permission'), 'attention');
assert.equal(resultBucket('cancelled'), 'cancelled');

// Repeated transport entries cannot multiply recorded usage or finished work.
const duplicate = structuredClone(snap);
const duplicateO = duplicate.orchestrations!['task-a'];
duplicateO.itemOrder.push('w-index');
duplicateO.attempts['transport-alias'] = { ...duplicateO.attempts['at-index-1'] };
duplicate.tasks['task-a'].sessionIds.push(o.mainSessionId!, o.mainSessionId!);
const childSessionId = o.attempts['at-seed-1'].sessionId;
duplicate.sessions[childSessionId] = { ...structuredClone(duplicate.sessions[o.mainSessionId!]), id: childSessionId, tokens: 12_000 };
duplicate.tasks['task-a'].sessionIds.push(childSessionId, childSessionId);
assert.equal(deriveResultMetrics(duplicate, 'task-a', null).tokenValue, 186_000);
assert.equal(deriveResultMetrics(duplicate, 'task-a', null).total, 8);

// Unrelated archived sessions merged into the task are counted once and retain their source identity.
const merged = structuredClone(snap);
const external = merged.sessions['ses-codex-terms'];
external.taskId = 'task-a';
merged.tasks['task-a'].sessionIds.push(external.id, external.id);
const mergedMetrics = deriveResultMetrics(merged, 'task-a', null);
assert.equal(mergedMetrics.tokenValue, 186_000 + external.tokens!);
assert.equal(mergedMetrics.reports.filter(report => report.sessionId === external.id).length, 1);
assert.equal(deriveResultMetrics(merged, 'task-a', 'w-index').tokenValue, 52_000);
assert(!deriveResultMetrics(merged, 'task-a', 'w-index').reports.some(report => report.sessionId === external.id));

const partial = structuredClone(snap);
const partialO = partial.orchestrations!['task-a'];
partialO.attempts['at-index-1'].tokens = null;
assert.equal(deriveResultMetrics(partial, 'task-a', null).tokenValue, 146_000);
assert.equal(deriveResultMetrics(partial, 'task-a', null).partialTokens, true);
Object.values(partialO.attempts).forEach(attempt => { attempt.tokens = null; });
partialO.coordinationTokens = null;
assert.equal(deriveResultMetrics(partial, 'task-a', null).tokenValue, null);
assert.equal(deriveResultMetrics(partial, 'task-a', null).partialTokens, true);
assert.equal(deriveResultMetrics(partial, 'task-a', 'w-ui').tokenValue, null);

// A stale completion or empty retry never promotes the previous attempt's reply to a new result.
const retry = structuredClone(snap);
const retryO = retry.orchestrations!['task-a'];
const doneItem = retryO.items['w-read'];
const original = latestAttempt(retryO, doneItem)!;
retryO.attempts['retry-empty'] = { ...original, id: 'retry-empty', rounds: [] };
doneItem.attemptIds.push('retry-empty');
assert.equal(deriveResultMetrics(retry, 'task-a', 'w-read').reports.length, 0);
retryO.attempts['retry-empty'].rounds = [{ id: 'retry-progress', at: '20:15', reply: '正在重新验证' }];
retryO.attempts['retry-empty'].status = 'running';
assert.equal(deriveResultMetrics(retry, 'task-a', 'w-read').reports.length, 0);

// Missing timestamps preserve the original report without inventing a chronology point.
const untimed = structuredClone(snap);
untimed.orchestrations!['task-a'].attempts['at-seed-1'].rounds[0].at = '';
const untimedReport = deriveResultMetrics(untimed, 'task-a', null).reports.find(report => report.itemId === 'w-seed')!;
assert(Number.isNaN(untimedReport.timestamp));
assert.equal(untimedReport.at, '');

// Run time is the union of actual running intervals, scoped to the chosen branch and local day.
const timed = structuredClone(snap);
ensureTimeline(timed);
const interval = (id: string, workItemId: string | undefined, start: string, end: string, taskId = 'task-a'): ExecutionInterval => ({
  id, executionId: id, taskId, workItemId, sessionId: `session-${id}`, agentId: 'claude', start, end, provenance: 'event',
});
timed.timeline!.intervals = [
  interval('index-1', 'w-index', '2026-11-15T20:00:00+08:00', '2026-11-15T20:10:00+08:00'),
  interval('nested-overlap', 'w-seed', '2026-11-15T20:05:00+08:00', '2026-11-15T20:15:00+08:00'),
  interval('sibling', 'w-ui', '2026-11-15T20:12:00+08:00', '2026-11-15T20:20:00+08:00'),
  interval('resume-after-wait', 'w-index', '2026-11-15T20:25:00+08:00', '2026-11-15T20:30:00+08:00'),
  interval('other-task', undefined, '2026-11-15T19:00:00+08:00', '2026-11-15T20:00:00+08:00', 'task-b'),
];
assert.equal(deriveResultMetrics(timed, 'task-a', null).activeMinutes, 25);
assert.equal(deriveResultMetrics(timed, 'task-a', 'w-index').activeMinutes, 20);
assert.equal(deriveResultMetrics(timed, 'task-a', 'w-seed').activeMinutes, 10);
timed.timeline!.intervals.push(interval('cross-midnight', 'w-index', '2026-11-14T23:50:00+08:00', '2026-11-15T00:10:00+08:00'));
assert.equal(deriveResultMetrics(timed, 'task-a', 'w-index').activeMinutes, 30);

console.log('result-metrics: direct hierarchy progress, exclusive token allocation, retry/session deduplication, unknown evidence, completed source provenance, scoped parallel run-time union');
