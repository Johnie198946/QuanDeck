import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace } from '../src/components/workspace/Workspace';
import { WorkdeckProvider, useWorkdeck } from '../src/state/WorkdeckContext';
import { SampleWorkdeckDataSource } from '../src/data/repository';
import { createSampleSnapshot } from '../src/data/fixtures';
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
const source = new SampleWorkdeckDataSource({ snapshot, onPersist: () => {} });
const params = new URLSearchParams(location.search);
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
