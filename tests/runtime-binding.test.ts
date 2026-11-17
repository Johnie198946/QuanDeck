import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { ensureIntelligence } from '../src/data/intelligence';
import { ensureIntegration } from '../src/data/resultIntegration';
import type { RuntimeConnectionBinding, RuntimeDriver } from '../src/data/runtimeContracts';
import type { CommandResult, SessionStatus } from '../src/data/types';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key),
} });
const caps = { observe: true, dispatch: true, resume: true, usage: true, subAgents: true, sourceOpen: true, permissions: true };
const binding = (connectionId: string, projectPath = '/original-project'): RuntimeConnectionBinding => ({ connectionId, projectPath, tool: 'dsh', capabilities: caps });
async function denied(operation: () => Promise<CommandResult>, pattern: RegExp) {
  const result = await operation().catch(error => ({ ok: false, message: String(error) }));
  assert.equal(result.ok, false); assert.match(result.message ?? '', pattern);
}

async function main() {
  let launches = 0;
  const driver: RuntimeDriver = {
    subscribe: () => () => {}, scan: async () => [], control: async () => ({}),
    run: async input => ({ connectionId: input.connectionId, runId: `run-${++launches}`, sessionId: `source-${launches}`, acceptedAt: new Date().toISOString() }),
  };
  const base = new LocalWorkdeckDataSource(), source = createRuntimeDataSource(base, driver);
  try {
    const original = (await source.createProject({ name: 'Original project' })).projectId!;
    await source.registerAgent({ id: 'dsh', name: 'My DSH', short: 'DSH', color: '#526dc5' });
    assert((await source.bindRuntimeConnection('dsh', binding('old-connection'))).ok);
    const taskId = (await source.createIdea('Task bound to the original project')).taskId!;
    const visible = (await source.createProject({ name: 'Visible project' })).projectId!;
    assert((await source.bindRuntimeConnection('dsh', binding('visible-connection', '/visible-project'))).ok);
    const visibleBefore = await source.load();
    assert((await source.bindRuntimeConnection('dsh', binding('new-connection'), { projectId: original, expectedConnectionId: 'old-connection' })).ok);
    const owner = (await source.listProjects()).find(project => project.project.id === original)!;
    assert.equal(owner.runtimeConnections!.dsh.connectionId, 'new-connection');
    assert.equal(owner.agents.filter(agent => agent.id === 'dsh').length, 1);
    assert.equal(owner.agents.find(agent => agent.id === 'dsh')!.name, 'My DSH');
    assert.deepEqual((await source.load()).runtimeConnections, visibleBefore.runtimeConnections);
    assert.equal((await source.load()).project.id, visible, 'guarded replacement never switches the visible project');
    await denied(() => source.bindRuntimeConnection('dsh', binding('stale-write'), { projectId: original, expectedConnectionId: 'old-connection' }), /其他操作更新/);
    await denied(() => source.bindRuntimeConnection('dsh', binding('missing-write'), { projectId: 'removed-project', expectedConnectionId: 'new-connection' }), /项目已不存在/);

    await source.switchProject(original);
    assert((await source.dispatch(taskId, 'dsh')).ok);
    const sessionId = (await source.load()).tasks[taskId].sessionIds[0];
    assert.equal(launches, 1);
    await source.switchProject(visible);
    for (const status of ['pending', 'queued', 'running', 'paused', 'waiting_reply', 'waiting_permission'] as SessionStatus[]) {
      base.mutateRuntimeProject(original, snapshot => { snapshot.sessions[sessionId].status = status; });
      await denied(() => source.bindRuntimeConnection('dsh', binding('blocked-write'), { projectId: original, expectedConnectionId: 'new-connection' }), /关联会话/);
      assert.equal((await source.listProjects()).find(project => project.project.id === original)!.runtimeConnections!.dsh.connectionId, 'new-connection');
    }
    base.mutateRuntimeProject(original, snapshot => { snapshot.sessions[sessionId].status = 'archived'; });
    assert((await source.bindRuntimeConnection('dsh', binding('after-archive'), { projectId: original, expectedConnectionId: 'new-connection' })).ok);

    for (const status of ['queued', 'running'] as const) {
      base.mutateRuntimeProject(original, snapshot => {
        ensureIntelligence(snapshot).jobs['title-job'] = { id: 'title-job', kind: 'title', status, createdAt: new Date().toISOString(), agentId: 'dsh', input: { projectId: original, taskId, title: 'A task', titleRevision: 0, taskVersion: 1, goal: 'A task' } };
      });
      await denied(() => source.bindRuntimeConnection('dsh', binding('blocked-analysis'), { projectId: original, expectedConnectionId: 'after-archive' }), /后台分析/);
    }
    base.mutateRuntimeProject(original, snapshot => { snapshot.intelligence!.jobs['title-job'].status = 'succeeded'; });
    base.mutateRuntimeProject(original, snapshot => {
      (ensureIntegration(snapshot).reviewJobs ??= {})['review-job'] = { id: 'review-job', draftId: 'draft', revisionId: 'revision', fingerprint: 'input', status: 'running', createdAt: new Date().toISOString(), reservedTokens: 256, actualTokens: null, usageFinal: false };
    });
    await denied(() => source.bindRuntimeConnection('dsh', binding('blocked-review'), { projectId: original, expectedConnectionId: 'after-archive' }), /后台分析/);
    base.mutateRuntimeProject(original, snapshot => { snapshot.integration!.reviewJobs!['review-job'].status = 'succeeded'; });
    assert((await source.bindRuntimeConnection('dsh', binding('after-analysis'), { projectId: original, expectedConnectionId: 'after-archive' })).ok);
    assert.equal(launches, 1, 'binding and replacement never replay the previous task');

    // A runtime event can arrive after listProjects captured its snapshot but before the guarded write.
    // Validate the current state again in the atomic project mutation, not just the earlier read.
    const listProjects = base.listProjects.bind(base);
    base.listProjects = async () => {
      const projects = await listProjects();
      base.mutateRuntimeProject(original, snapshot => {
        snapshot.sessions[sessionId].runtime!.connection = binding('after-analysis');
        snapshot.sessions[sessionId].status = 'running';
      });
      return projects;
    };
    await denied(() => source.bindRuntimeConnection('dsh', binding('racing-write'), { projectId: original, expectedConnectionId: 'after-analysis' }), /关联会话/);
    base.listProjects = listProjects;
    assert.equal((await source.listProjects()).find(project => project.project.id === original)!.runtimeConnections!.dsh.connectionId, 'after-analysis');
    base.mutateRuntimeProject(original, snapshot => { snapshot.sessions[sessionId].status = 'archived'; });
    base.listProjects = async () => {
      const projects = await listProjects();
      base.mutateRuntimeProject(original, snapshot => { snapshot.intelligence!.jobs['title-job'].status = 'queued'; });
      return projects;
    };
    await denied(() => source.bindRuntimeConnection('dsh', binding('racing-analysis'), { projectId: original, expectedConnectionId: 'after-analysis' }), /后台分析/);
    base.listProjects = listProjects;
    assert.equal((await source.listProjects()).find(project => project.project.id === original)!.runtimeConnections!.dsh.connectionId, 'after-analysis');
    assert.equal((await source.load()).project.id, visible);
    console.log('runtime-binding: original project targeting, stable Agent identity, stale and live-session guards, background jobs, and atomic revalidation');
  } finally { source.dispose(); }
}
async function receiptOwnership() {
  let launches = 0, corruptOwner = false;
  const records: import('../src/data/runtimeContracts').RuntimeRunRecord[] = [];
  const driver: RuntimeDriver = {
    subscribe: () => () => {}, scan: async () => [], control: async () => ({}), listRuns: () => records,
    run: async input => {
      assert.equal(input.sourceSessionId, undefined, 'fresh tasks never receive the predecessor source ID');
      const receipt = { ...input, ...(corruptOwner ? { taskId: 'another-task' } : {}), runId: `ownership-run-${++launches}`, sessionId: 'same-provider-source', acceptedAt: new Date().toISOString(), acceptance: 'acknowledged' as const };
      records.push(receipt); return receipt;
    },
  };
  const base = new LocalWorkdeckDataSource(), source = createRuntimeDataSource(base, driver);
  try {
    await source.createProject({ name: 'Source ownership' });
    await source.registerAgent({ id: 'dsh', name: 'Owner', short: 'Owner', color: '#526dc5' });
    const connected = await source.bindRuntimeConnection('dsh', binding('ownership-connection', '/ownership-project')); assert(connected.ok, connected.message);
    const first = (await source.createIdea('First task')).taskId!;
    const accepted = await source.dispatch(first, 'dsh'); assert(accepted.ok, accepted.message);
    const original = (await source.load()).tasks[first].sessionIds[0];
    const second = (await source.createIdea('Second task')).taskId!;
    await denied(() => source.dispatch(second, 'dsh'), /SOURCE_SESSION_OWNED/);
    let snapshot = await source.load();
    const rejected = snapshot.tasks[second].sessionIds[0];
    assert.equal(snapshot.sessions[rejected].source, undefined);
    assert.equal(snapshot.sessions[rejected].dispatchPhase, 'unknown', 'a forged acknowledgement is not proof that the provider did not run');
    assert.equal(snapshot.sessions[original].source!.sessionId, 'same-provider-source');
    await denied(() => source.retryDispatch(rejected), /只有明确未受理/);
    await denied(() => source.reconcile(rejected), /SOURCE_SESSION_OWNED/);
    assert.equal(launches, 2, 'unknown source receipt cannot trigger another dispatch');
    await source.createProject({ name: 'Other project' });
    await source.registerAgent({ id: 'dsh', name: 'Owner', short: 'Owner', color: '#526dc5' });
    const otherConnected = await source.bindRuntimeConnection('dsh', binding('other-ownership-connection', '/other-ownership-project')); assert(otherConnected.ok, otherConnected.message);
    const other = (await source.createIdea('Cross-project task')).taskId!;
    const otherResult = await source.dispatch(other, 'dsh'); assert(otherResult.ok, otherResult.message);
    const otherSnapshot = await source.load();
    assert.equal(otherSnapshot.sessions[otherSnapshot.tasks[other].sessionIds[0]].source!.sessionId, 'same-provider-source', 'different connections may use the same opaque source ID');
    corruptOwner = true;
    const mismatched = (await source.createIdea('Wrong-owner receipt')).taskId!;
    await denied(() => source.dispatch(mismatched, 'dsh'), /RUNTIME_OWNER_MISMATCH/);
    snapshot = await source.load();
    assert.equal(snapshot.sessions[snapshot.tasks[mismatched].sessionIds[0]].source, undefined);
  } finally { source.dispose(); }
}
main().then(receiptOwnership).catch(error => { console.error(error); process.exitCode = 1; });
