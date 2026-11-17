import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkdeckProvider, useWorkdeck } from '../src/state/WorkdeckContext';
import { SampleWorkdeckDataSource } from '../src/data/repository';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration } from '../src/data/collaboration';
import { createTaskFromHandoffIn, type CreateTaskFromHandoffInput } from '../src/data/taskHandoffTransfer';
import { TaskHandoffPanel } from '../src/components/work/TaskHandoffPanel';
import { TaskMemoryLookup } from '../src/components/results/TaskMemoryLookup';
import '../src/index.css';
import '../src/quiet.css';
import '../src/components/results/results-gallery.css';
import '../src/components/results/integration.css';

// In-memory fixture. No desktop host, real projects, runtime controller or model.
const params = new URLSearchParams(location.search);
const snapshot = createEmptySnapshot({ id: 'handoff-ui-project', name: '交接闭环' });
let sequence = 0;
const command = (type: Parameters<typeof applyCollaboration>[1]['type'], payload: Record<string, unknown>, taskId?: string) => {
  const result = applyCollaboration(snapshot, { projectId: snapshot.project.id, type, taskId,
    idempotencyKey: `handoff-ui-${++sequence}`, expectedVersion: taskId ? snapshot.collaboration?.tasks[taskId]?.version : undefined, payload }, { kind: 'human' });
  if (!result.ok) throw new Error(result.message);
  return result;
};
const taskId = command('create_task', { title: '21E：界面规范与交互边界', goal: '确定可复用的界面规范', criteria: ['已核对'], owner: 'me' }).resourceId!;
command('create_task', { title: '14D：已有的开发任务', goal: '原有目标：完成设置页', criteria: ['可核对'], owner: 'agent' });
const submission = command('submit', { title: '规范交付', body: '项目标记：深蓝 17。每个页面都展示来源。', handoff: {
  summary: '已核对交互边界与规范。下一步可以按本次确认的规则开发页面，项目标记为深蓝 17。',
  completed: ['核对窄屏和桌面布局'], decisions: ['页面必须保留来源'], remaining: [], nextSteps: ['使用深蓝 17 标记完成页面并验证功能'] } }, taskId).resourceId!;
if (params.get('state') !== 'candidate') command('review', { submissionId: submission, verdict: 'accepted', checks: [true], note: '已核对' }, taskId);
let targetId: string | undefined;
if (params.get('state') !== 'candidate') {
  const target = createTaskFromHandoffIn(snapshot, snapshot.project.id, { sourceTaskKey: taskId, title: '14D：按规范开发页面', idempotencyKey: 'initial-transfer' });
  if (!target.ok) throw new Error(target.message);
  targetId = target.taskId;
}
if (params.get('state') === 'stale') command('mark_stale', { artifactId: snapshot.collaboration!.tasks[taskId].acceptedArtifactId, reason: '规范来源待核对' }, taskId);
const source = new SampleWorkdeckDataSource({ snapshot, onPersist: () => {} });
const calls: CreateTaskFromHandoffInput[] = [];
const original = source.createTaskFromHandoff.bind(source);
source.createTaskFromHandoff = async (projectId, input) => {
  calls.push(structuredClone(input));
  await new Promise(resolve => setTimeout(resolve, 150));
  if (params.get('fault') === 'retry' && calls.length === 1) throw new Error('连接暂时中断，输入已保留');
  const result = await original(projectId, { ...input, execute: false });
  return params.get('fault') === 'dispatch' && result.taskId ? { ...result, ok: false, message: '任务已创建，Agent 暂未受理' } : result;
};
(window as unknown as { handoffCalls: typeof calls }).handoffCalls = calls;
function Preview() {
  const { workspace } = useWorkdeck();
  return <main className="qd-app" style={{ display: 'block', maxWidth: 760, margin: 'auto', padding: 16, minWidth: 0, overflow: 'visible' }}>
    <h1 style={{ fontSize: 24, marginBottom: 24 }}>任务记忆与交接</h1>
    <article data-case="source"><h2>21E：界面规范与交互边界</h2><TaskHandoffPanel taskId={taskId} /></article>
    {targetId && <article data-case="target" style={{ marginTop: 24 }}><h2>14D：按规范开发页面</h2><TaskHandoffPanel taskId={targetId} /></article>}
    <section style={{ marginTop: 24 }}><h2>查找历史</h2><TaskMemoryLookup /></section>
    <output data-open-task={workspace?.taskId ?? ''}>{workspace && `已打开：${workspace.taskId}`}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<WorkdeckProvider source={source} fallback={<p>读取隔离记录…</p>}><Preview /></WorkdeckProvider>);
