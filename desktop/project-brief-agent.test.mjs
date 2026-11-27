import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectBriefDistiller } from './app/project-brief-agent.mjs';

const revision = '0'.repeat(64);
const update = '1'.repeat(64);
const sourceId = 'task-internal';
const material = { evidenceKey: revision, availableCount: 1,
  rows: [{ id: sourceId, kind: 'progress', title: '收到内容', text: '初稿包含三张图。', at: '2026-01-10' }] };
const point = { text: '初稿现在包含三张图。', citations: [{ source: 's1', quote: '三张图' }] };
function fixture() {
  const states = { project: { project: { id: 'project' }, private: 'another private passage' } };
  const refs = { input: material, calls: 0, writes: 0, output: { points: [point] },
    profile: { tool: 'codex', connectionId: 'connection' }, model: 'chosen', toolPolicy: 'read-only-isolated' };
  const deps = {
    readProject: async key => structuredClone(states[key]),
    materials: () => refs.input,
    mutate: (id, callback) => { callback(states[id]); refs.writes++; },
    readConfigured: () => refs.profile ? [refs.profile] : [],
    connections: () => [{ connectionId: 'connection', tool: 'codex', model: refs.model }],
    assist: async request => {
      refs.calls++;
      assert.equal(request.projectId, 'project');
      assert.equal(request.connectionId, 'connection');
      assert.equal(request.kind, 'integration');
      assert.ok(request.prompt.includes('初稿包含三张图。'));
      assert.ok(!request.prompt.includes(sourceId));
      assert.ok(!request.prompt.includes('another private passage'));
      await refs.wait;
      if (refs.fail) throw new Error('private adapter error');
      return { ...request, output: refs.output, sourceSessionId: 'session', contextPolicy: 'new-isolated-session',
        toolPolicy: refs.toolPolicy };
    },
  };
  return { states, refs, run: createProjectBriefDistiller(deps), deps };
}

test('projects use their configured read-only agent, resolve citations, share in-flight requests and persist cached summaries', async () => {
  const { run, states, refs, deps } = fixture();
  const [a, b] = await Promise.all([run('project', revision), run('project', revision)]);
  assert.deepEqual(a, b);
  assert.equal(refs.calls, 1);
  assert.equal(refs.writes, 1);
  assert.equal(a.provider, 'codex');
  assert.equal(a.sourceCount, 1);
  assert.deepEqual(a.points[0].citations, [{ sourceId, quote: '三张图' }]);
  const restarted = createProjectBriefDistiller(deps);
  assert.deepEqual(await restarted('project', revision), a);
  refs.model = 'different';
  await restarted('project', revision);
  assert.equal(refs.calls, 2);
  refs.input = { ...material, evidenceKey: update };
  await restarted('project', update);
  assert.equal(refs.calls, 3);
  assert.equal(states.project.homeBriefInsight.evidenceKey, update);
  assert.deepEqual(Object.keys(states.project).sort(), ['homeBriefInsight', 'private', 'project']);
});

test('unbound projects, missing profiles, stale renderer evidence and provider errors cannot mutate; retries work', async () => {
  const { run, refs } = fixture();
  await assert.rejects(run('other-project', revision), /项目已不存在/);
  await assert.rejects(run('project', update), /已变化/);
  const profile = refs.profile;
  refs.profile = null;
  await assert.rejects(run('project', revision), /连接/);
  refs.profile = profile;
  assert.equal(refs.calls, 0);
  refs.fail = true;
  await assert.rejects(run('project', revision), /暂未返回/);
  assert.equal(refs.writes, 0);
  refs.fail = false;
  refs.output = { points: [] };
  assert.deepEqual((await run('project', revision)).points, []);
  assert.equal(refs.writes, 1);
});

test('invented quotes, foreign citations and mismatched tool receipts never become conclusions', async () => {
  const { refs, run } = fixture();
  for (const citations of [[{ source: 's2', quote: '三张图' }], [{ source: 's1', quote: '全部验收' }], []]) {
    refs.output = { points: [{ ...point, citations }] };
    await assert.rejects(run('project', revision), /核对/);
  }
  refs.output = { points: [point] };
  refs.toolPolicy = 'unverified';
  await assert.rejects(run('project', revision), /核对/);
  assert.equal(refs.writes, 0);
});

test('an older asynchronous result cannot overwrite an updated dossier', async () => {
  const { refs, run, states } = fixture();
  let release;
  refs.wait = new Promise(resolve => { release = resolve; });
  const first = run('project', revision);
  await new Promise(resolve => setImmediate(resolve));
  refs.input = { ...material, evidenceKey: update };
  refs.wait = undefined;
  await run('project', update);
  release();
  await assert.rejects(first, /已变化/);
  assert.equal(states.project.homeBriefInsight.evidenceKey, update);
  assert.equal(refs.writes, 1);
});

test('an invalid quotation restored in a cached brief is rebuilt from project evidence', async () => {
  const { states, refs, run } = fixture();
  await run('project', revision);
  states.project.homeBriefInsight.insight.points[0].citations[0].sourceId = 'foreign';
  const fresh = await run('project', revision);
  assert.equal(refs.calls, 2);
  assert.equal(fresh.points[0].citations[0].sourceId, sourceId);
});
