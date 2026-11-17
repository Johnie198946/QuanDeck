import { createDeliveryFixture } from './delivery-map.fixture';
import { ensureCollaboration } from '../src/data/collaboration';

/** Browser-only fixtures. No connected Agent, runtime, live database or network. */
export async function createProgressFixture() {
  const { snapshot, binding, planId } = await createDeliveryFixture();
  const target = binding('hotels');
  const c = ensureCollaboration(snapshot), record = c.tasks[target.key];
  const at = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
  snapshot.tasks[target.taskId].owner = 'agent';
  record.owner = 'agent'; record.status = 'running'; record.activeRunId = 'progress-fixture-run';
  c.runs[record.activeRunId] = { id: record.activeRunId, key: target.key, purpose: 'execution', executor: 'codex', status: 'running', specRevision: record.specRevision, claimEpoch: record.claimEpoch, startedAt: at(12), lastHeartbeatAt: at(3), leaseExpiresAt: at(-5), actualTokens: null, reservedTokens: 0 };
  c.checkpoints.push({ id: 'progress-fixture-checkpoint', key: target.key, runId: record.activeRunId, at: at(3), completed: ['已比较两处住宿区域', '已整理需要向酒店核实的夜间接待信息'], remaining: ['核对酒店入口与地图位置', '将来源链接放入住宿交付'], note: '正在核对酒店入口与夜间接待信息' });
  snapshot.tasks[target.taskId].sessionIds.push('progress-fixture-session');
  snapshot.sessions['progress-fixture-session'] = { id: 'progress-fixture-session', taskId: target.taskId, agentId: 'codex', title: '核对酒店入口与夜间接待信息', origin: 'dispatch', status: 'running', startedAt: at(12), lastActivity: at(3), step: { label: '正在核对酒店入口与夜间接待信息' }, tokens: 0, rounds: [], subAgents: [], runtime: { runId: record.activeRunId, dispatchId: 'progress-fixture-dispatch', projectId: snapshot.project.id, taskId: target.taskId, workItemId: target.workItemId, purpose: 'execution', connection: { tool: 'codex', connectionId: 'isolated-progress-fixture', projectPath: '/isolated-progress-fixture' }, context: { taskTitle: record.title, prompt: '隔离界面测试', capturedAt: at(12) }, sequence: 1, eventIds: [] } };
  return { snapshot, scope: { taskId: target.taskId, workItemId: target.workItemId }, planId };
}
