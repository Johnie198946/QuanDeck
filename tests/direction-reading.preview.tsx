import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace } from '../src/components/workspace/Workspace';
import { WorkdeckProvider, useWorkdeck } from '../src/state/WorkdeckContext';
import { SampleWorkdeckDataSource } from '../src/data/repository';
import { createSampleSnapshot } from '../src/data/fixtures';
import { ensureCollaboration } from '../src/data/collaboration';
import type { DirectionMessage } from '../src/data/runtimeContracts';
import { gateway } from '../src/integration/gateway';
import '../src/index.css';
import '../src/quiet.css';
import '../src/components/layout/workbench-display.css';
import '../src/components/layout/workspace-refresh.css';

// In-memory business source only. No runtime controller, desktop host, model or real database.
const snapshot = createSampleSnapshot();
const plan = snapshot.ideaPlans!['plan-task-a'];
snapshot.agents.forEach(agent => { agent.custom = true; });
snapshot.tasks[plan.taskId].title = '重新设计方向页面：先阅读方案，再按章节讨论，保留每一次确认的版本';
plan.adopted!.doc.sections[0].lines[0].text = '确认快照：只支持标题检索，保留原验收范围。';
plan.draft.sections[0].lines[0].text = '当前草稿：增加正文与书摘检索，等待新的方向确认。';
plan.draftVersion = 2;
plan.discussion!.conclusions.push({ ...plan.discussion!.conclusions[0], id: 'reading-new-conclusion', recordedAt: '20:10', adopted: false, adoptedAt: undefined, adoptedDraftVersion: undefined,
  summary: '新增检索范围后，需要分别验证索引与界面。\n\n正文和书摘检索会继续沿用已有查询接口，讨论这一节时保留上下文。' });
snapshot.tasks[plan.taskId].attachments = [{ id: 'missing-file', name: '验收说明.pdf', size: 1200, type: 'application/pdf' }];
const params = new URLSearchParams(location.search);
if (params.has('firstOpinion')) {
  plan.round = 0;
  plan.discussion!.conclusions = [];
}
const sectionThread = params.has('sectionThread');
const sectionThreadId = 'reading-section-session';
const sectionAgent = plan.discussion!.agentId!;
const sectionId = plan.draft.sections[0].id;
if (sectionThread) {
  if (params.has('unavailable')) snapshot.agents.find(item => item.id === sectionAgent)!.custom = false;
  const source = {connectionId: 'fixture-section', sessionId: 'fixture-section-thread', tool: 'codex' as const};
  plan.discussion!.sessionId = sectionThreadId;
  plan.discussion!.conclusions = [{ id: 'section-one', scopeId: sectionId, agentId: sectionAgent,
    recordedAt: snapshot.now, summary: '先核对三项前置任务的交付，再决定是否验收。', confirmed: [], open: [], source: 'agent', sourceRef: source }];
  snapshot.sessions[sectionThreadId] = { id:sectionThreadId, agentId:sectionAgent, title:'单节讨论', origin:'dispatch',
    taskId:plan.taskId, dispatchPhase:'acknowledged', status:'waiting_reply', startedAt:snapshot.now, lastActivity:snapshot.now,
    tokens:null, rounds:[], subAgents:[], step:null, source, runtime:{ dispatchId:'section-dispatch', purpose:'discussion',
      projectId:snapshot.project.id, taskId:plan.taskId, planId:plan.id, scope:sectionId,
      connection:{connectionId:source.connectionId, tool:'codex', projectPath:'/fixture'}, sequence:1, eventIds:[],
      context:{taskTitle:'单节讨论',prompt:'',capturedAt:snapshot.now,planVersion:plan.draftVersion} } };
}
if (params.has('planRequest') && sectionThread) {
  const rt = snapshot.sessions[sectionThreadId].runtime!;
  rt.runId = 'section-run';
  rt.requests = { route: { id:'route', token:'route-v1', kind:'question', prompt:'选择路线',
    questions: [{id:'road', question:'哪个入口？', options:[{label:'东门'},{label:'西门'}]}] } };
}
if (params.get('history') === 'done' || params.get('history') === 'in_review') {
  ensureCollaboration(snapshot).tasks[plan.taskId].status = params.get('history') as 'done' | 'in_review';
  plan.draft.sections.push({ id: 's-test-empty', title: '空章节占位', kind: 'body', lines: [] });
}
const automation = params.get('automation');
const commandLog: { kind: string; input: unknown }[] = [];
if (automation) {
  plan.adopted = { ...plan.adopted!, draftVersion: 2, doc: structuredClone(plan.draft) };
  const c = ensureCollaboration(snapshot);
  const sessionId = Object.keys(snapshot.sessions)[0];
  const bindRecoverySource = (session: (typeof snapshot.sessions)[string]) => {
    session.source = { sessionId: `source-${session.id}`, connectionId: 'fixture-automation-agent', tool: 'codex' };
    Object.assign(window, { expectedRecoverySource: session.source });
  };
  if (automation === 'paused') snapshot.sessions[sessionId].status = 'paused';
  if (automation === 'blocked') snapshot.sessions[sessionId].status = 'archived';
  if (automation === 'paused' || automation === 'blocked') bindRecoverySource(snapshot.sessions[sessionId]);
  c.goalAutomation = { [plan.id]: { planId: plan.id, planVersion: 0, draftVersion: automation === 'outdated' ? 1 : 2, enabled: automation !== 'off', agentId: 'claude', version: 1, at: snapshot.now, attempts: {},
    ...(['paused', 'blocked'].includes(automation) ? { decomposition: { state: 'sent' as const, at: snapshot.now, sessionId } } : {}) } };
  if (automation === 'paused-tasks') {
    const tasks = Object.values(c.tasks).slice(0, 2), sessions = Object.values(snapshot.sessions).slice(0, 2);
    tasks.forEach((task, i) => {
      task.status = i ? 'waiting_permission' : 'blocked'; task.activeRunId = undefined;
      sessions[i].status = i ? 'waiting_permission' : 'archived'; sessions[i].source = undefined;
      c.goalAutomation![plan.id].attempts[task.key] = { state: 'sent', at: snapshot.now, sessionId: sessions[i].id };
    });
    c.goalPlans = { [plan.id]: [{ id: plan.id, title: plan.title, scope: 'task', taskId: plan.taskId, version: 1, draftVersion: 2, at: snapshot.now, slots: [], tasks: tasks.map(task => ({ key: task.key, taskId: task.taskId, workItemId: task.workItemId, draftKey: task.key, specRevision: task.specRevision })) }] };
    c.goalAutomation[plan.id].planVersion = 1;
    bindRecoverySource(sessions[1]);
  }
  (window as unknown as { directionCommands: typeof commandLog }).directionCommands = commandLog;
  gateway.openSource = async input => { commandLog.push({ kind: 'open-source', input }); return { status: 'opened', message: '隔离会话入口已记录' }; };
}
const source = new SampleWorkdeckDataSource({ snapshot, onPersist: () => {} });
if (params.has('planRequest') && sectionThread) Object.assign(source, {
  controlSession: async (sessionId: string, action: string, payload: unknown) => {
    Object.assign(window, { planRequestReceipt: { sessionId, action, payload } });
    source.mutateRuntime(s => { s.sessions[sessionId].runtime!.requests = {}; });
    return { ok:true };
  }
});
if (automation) source.configureGoalAutomation = async (_planId, input) => { commandLog.push({ kind: 'configure', input }); return { ok: true, message: '隔离执行设置已记录' }; };
if (params.get('reply') === '1') {
  const calls: unknown[] = [];
  Object.assign(window, { directionReplyCalls:calls });
  Object.assign(source, { sendDirectionMessage: async (input: unknown) => {
    calls.push(input);
    await new Promise(resolve=>setTimeout(resolve,160));
    return calls.length === 1 ? {ok:false,message:'隔离发送失败',sessionId:'rejected',recovery:'retry'} : {ok:true};
  } });
}
if (sectionThread) {
  gateway.openSource = async (input) => {
    Object.assign(window, { openedSectionSource: input });
    return { status:'opened', message:'已打开测试原会话' };
  };
  const calls: DirectionMessage[] = [];
  Object.assign(window, { directionReplyCalls:calls, receiveSectionReply: () => source.mutateRuntime(d => {
    d.sessions[sectionThreadId].status = 'waiting_reply';
    const target = d.ideaPlans![plan.id].discussion!;
    target.conclusions.push({ ...target.conclusions[0], id:'section-two', recordedAt:d.now, summary:'先请负责人逐项核对三份交付，再确认验收。' });
  }) });
  Object.assign(source, { sendDirectionMessage: async (input: DirectionMessage) => {
    calls.push(input);
    source.mutateRuntime(d => { d.sessions[sectionThreadId].status = 'running'; });
    return {ok:true, sessionId:sectionThreadId};
  } });
}
const fault = params.get('fault');
const delay = () => new Promise(resolve => setTimeout(resolve, 250));
if (fault === 'agent') source.setDiscussionAgent = async () => { await delay(); throw new Error('讨论目标保存失败（隔离故障）'); };
if (fault === 'split') source.generateDrafts = async () => { await delay(); throw new Error('拆分草稿读取失败（隔离故障）'); };
if (fault === 'attachment') source.setTaskAttachments = async () => { await delay(); throw new Error('附件关联失败（隔离故障）'); };
function Preview() {
  const { openWorkspace } = useWorkdeck();
  useEffect(() => { openWorkspace(plan.taskId, { view: 'plan', planId: plan.id, pane: 'main', focus: true }); }, []);
  return <div className="qd-app qd-focused-workbench" style={params.has('container') ? { width: Number(params.get('container')), maxWidth: '100%', margin: 'auto' } : undefined}>
    <header style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', paddingInline: 24, borderBottom: '1px solid var(--qd-line)' }}>QuanDeck · 隔离方向验收</header>
    <main className="qd-grid has-ws is-focus"><div className="qd-col qd-col-ws"><Workspace /></div></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<WorkdeckProvider source={source} fallback={<p>读取隔离资料…</p>}><Preview /></WorkdeckProvider>);
