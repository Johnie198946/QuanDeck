import { discussionPlan, type ProjectReminder } from '../../data/projectReminders';
import { redactRuntimeText } from '../../data/runtimePresentation';
import { useEffect, useId, useRef, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost } from '../../integration/desktop';
import { gateway } from '../../integration/gateway';
import { Icon } from '../ui/Icon';
import { TaskIcon } from '../ui/TaskIcon';
import { AgentConnectionSetup } from '../deck/AgentConnectionSetup';
import { getConfiguredAgents, useConfiguredAgents, testForConfig } from '../../integration/configuredAgents';
import { canAttemptAgentDispatch } from '../../integration/agentProfiles';
import { incidentCopy } from './incidentPresentation';
import { useAgentIncidents } from './useAgentIncidents';
import './agent-health.css';

const normalizedPath = (value = '') => { const path = value.replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(path) ? path.toLowerCase() : path; };

function reminderTitle(reminder: ProjectReminder) {
  switch (reminder.kind) {
    case 'direction': return '方案已更新';
    case 'submission': return '交付需要修正';
    case 'permission': return '需要授权';
    case 'question': return '等待你的回复';
    case 'connection': return incidentCopy(reminder.run.health!.incident!).title;
  }
}
export function AgentHealthCenter({ allProjects }: { allProjects: boolean }) {
  const state = useAgentIncidents(allProjects);
  const count = state.incidents.length;
  return <>
    <button type="button" className={`qd-health-trigger ${count || state.offline ? 'has-attention' : ''}`} aria-label={`任务提醒，${allProjects ? '全部项目' : '当前项目'}，${count} 项待处理`} title="任务提醒" aria-haspopup="dialog" aria-expanded={state.open} onClick={() => { state.setSelectedRun(null); state.setOpen(true); }}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0v4l2 4H4l2-4Z"/><path d="M10 21h4"/></svg>
      {!!count && <span>{count}</span>}
      {!count && state.offline && <i />}
    </button>
    {state.open && <HealthDialog {...state} allProjects={allProjects} onClose={() => state.setOpen(false)}/>}
  </>;
}

function HealthDialog({ incidents, allProjects, offline, selectedRun, setSelectedRun, refresh, onClose }: {
  incidents: ProjectReminder[]; allProjects: boolean; offline: boolean; selectedRun: string | null; setSelectedRun: (id: string | null) => void; refresh: () => Promise<void>; onClose: () => void;
}) {
  const { snap, api, switchProject, openWorkspace, openSourceSession } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [busy, setBusy] = useState(''), [feedback, setFeedback] = useState(''), [target, setTarget] = useState(''), [confirmHandoff, setConfirmHandoff] = useState(false);
  const [configure, setConfigure] = useState(false);
  const reminder = selectedRun ? incidents.find(item => item.run.runId === selectedRun) : incidents[0];
  const {run,project,session} = reminder ?? {};
  const plan = project && discussionPlan(project,session);
  const task = project?.tasks[plan?.taskId || run?.taskId || ''];
  const currentAgent = project?.agents.find(item => item.id === session?.agentId);
  const currentConnection = session?.runtime?.connection;
  const {configured,tested}=useConfiguredAgents(project?.agents ?? snap.agents);
  const candidates = project?.agents.filter(agent => {
    const binding = project.runtimeConnections?.[agent.id];
    if(agent.id===session?.agentId)return false;
    const profile=configured.find(value=>(value.agentId || value.tool)===agent.id);
    if(profile)return canAttemptAgentDispatch(profile,binding,testForConfig(profile,tested));
    return !desktopHost() && binding && binding.connectionId !== (run?.connectionId || currentConnection?.connectionId) && binding.capabilities?.dispatch === true && normalizedPath(binding.projectPath) === normalizedPath(run?.projectPath || currentConnection?.projectPath);
  }) || [];
  const incident = run?.health?.incident;
  const config = getConfiguredAgents().find(item => item.connectionId === run?.connectionId);
  const successor = session?.runtime?.handedOffTo && project?.sessions[session.runtime.handedOffTo];
  const connection = reminder?.kind === 'connection';
  const checkable = connection && incident && ['network','installation','login','model','protocol','connection_timeout','project','rate_limit','quota','process'].includes(incident.code);
  const handoffAllowed = connection && !!session && session.origin === 'dispatch' && session.status !== 'archived' && !['submitting', 'unknown'].includes(session.dispatchPhase ?? '') && (!successor || successor.dispatchPhase === 'rejected') && !!api.handoffSession && !!candidates.length && run?.acceptance !== 'unknown' && incident?.status === 'open';
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  useEffect(() => { setTarget(''); setFeedback(''); setConfirmHandoff(false); setConfigure(false); }, [run?.runId,reminder?.id]);
  async function activateProject() {
    return !!project && (snap.project.id === project.project.id || await switchProject(project.project.id));
  }
  async function openTask() {
    if (!project || !await activateProject()) return;
    if (plan) openWorkspace(plan.scope === 'project' ? '' : plan.taskId, {projectId:project.project.id,planId:plan.id,itemId:plan.itemId ?? null,view:'plan',focus:true});
    else if (task) openWorkspace(task.id,{projectId:project.project.id,selected:run?.workItemId ?? null,view:'tasks',focus:true});
    onClose();
  }
  async function openConversation() {
    if (!session || !await activateProject()) return;
    const host = desktopHost();
    if (run && host) await host.openRun(run.runId,reminder?.targetSessionId).then(onClose).catch(() => setFeedback('无法打开这条会话，请稍后重试。'));
    else { openSourceSession(session.id); onClose(); }
  }
  async function check() {
    if (!run?.connectionId) return;
    setBusy('check'); setFeedback('');
    try { const result = await gateway.checkHealth(run.connectionId); setFeedback(result.canStart ? '程序连接已通过；模型与额度以实际调用为准。本次检查不会重跑任务。' : result.issue?.message || '当前连接还不可用，请检查设置。'); await refresh(); }
    catch { setFeedback('暂时检查不了连接，请确认 QuanDeck 本地服务仍在运行。'); }
    finally { setBusy(''); }
  }
  async function handoff() {
    if (!session || !target || !project || !api.handoffSession) return;
    setBusy('handoff'); setFeedback('');
    try {
      if (!await activateProject()) return;
      const result = await api.handoffSession(session.id, target);
      if (!result.ok) { setFeedback(result.message || '暂时不能转交，请查看原会话。'); return; }
      setConfirmHandoff(false); setFeedback(result.message || '已新建接管执行，原来的记录仍保留。'); await refresh();
    } catch (error) { setFeedback(error instanceof Error ? error.message : '本次转交未完成，请查看原任务。'); }
    finally { setBusy(''); }
  }
  return <dialog ref={dialog} className="qd-health-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="qd-health-header"><div><span className="qd-health-eyebrow">{allProjects ? '全部项目' : snap.project.name}</span><h2 id={titleId}>待处理提醒{incidents.length > 0 && ` · ${incidents.length}`}</h2></div><button className="qd-icon-btn" aria-label="关闭任务提醒" disabled={!!busy} onClick={onClose}><Icon name="close" size={20}/></button></header>
    {offline && <div className="qd-health-offline" role="status">连接状态暂时无法更新。<button className="qd-link" onClick={() => void refresh()}>重新连接</button></div>}
    {!reminder || !run ? <div className="qd-health-empty"><Icon name="check-circle" size={30}/><h3>{selectedRun ? '这条提醒已不在待处理列表' : '暂无待处理提醒'}</h3>{selectedRun && incidents.length > 0 && <button className="qd-link" onClick={() => setSelectedRun(null)}>查看当前提醒</button>}</div> : <>
      {incidents.length > 1 && <nav className="qd-health-switcher" aria-label="选择任务提醒">{incidents.map(item => <button key={item.run.runId} aria-pressed={item.run.runId === run.runId} disabled={!!busy} onClick={() => setSelectedRun(item.run.runId)}>{allProjects ? item.project.project.name + ' · ' : ''}{discussionPlan(item.project,item.session)?.title || item.session.title}</button>)}</nav>}
      <div className="qd-health-body">
        <div className="qd-health-task">{project && <TaskIcon snapshot={project} taskId={task?.id} sessionId={session?.id} size={24}/>}<div>{allProjects && <small>{project?.project.name}</small>}<h3>{plan?.title || task?.title || session?.title}</h3></div></div>
        <div className="qd-health-headline"><span><Icon name="alert" size={20}/></span><div><h3>{reminderTitle(reminder)}</h3><p>{connection && incident?.code !== 'unknown' ? incidentCopy(incident!).next : redactRuntimeText(reminder.reason)}</p></div></div>
        {handoffAllowed && <section className="qd-health-handoff"><label htmlFor={`${titleId}-agent`}>换一位 Agent 接着做</label><div><select id={`${titleId}-agent`} value={target} disabled={!!busy} onChange={e => { setTarget(e.target.value); setConfirmHandoff(false); }}><option value="">选择同项目的备用 Agent</option>{candidates.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="qd-btn ghost" disabled={!target || !!busy} onClick={() => setConfirmHandoff(true)}>预览转交 <Icon name="arrow-right" size={15}/></button></div></section>}
        {confirmHandoff && <section className="qd-health-transfer" aria-label="转交确认"><strong>{currentAgent?.name || '当前 Agent'} <Icon name="arrow-right" size={16}/> {candidates.find(item => item.id === target)?.name}</strong><p>带上任务要求、当前方法、最近三轮公开回复、任务树和已发布成果的文字，创建新的执行记录。先确认原执行已停止，再交给对方。</p><p>任务输入附件会重新检查并交给目标 Agent；成果附件只列名称。登录信息、隐藏对话和原来的权限批准不会迁移。</p><div><button className="qd-btn ghost" disabled={!!busy} onClick={() => setConfirmHandoff(false)}>取消</button><button className="qd-btn primary" disabled={!!busy || !target} onClick={() => void handoff()}>{busy === 'handoff' ? '正在确认并转交…' : '确认转交'}</button></div></section>}
        {feedback && <p className="qd-health-feedback" role="status">{feedback}</p>}
      </div>
      <footer className="qd-health-footer">
        {(task || plan) && reminder.kind !== 'direction' && <button className="qd-link" disabled={!!busy} onClick={() => void openTask()}>{plan ? '查看方案' : '查看任务'}</button>}
        <div>{reminder.kind !== 'direction' && <button className={`qd-btn ${checkable ? 'ghost' : 'primary'}`} disabled={!!busy} onClick={() => void openConversation()}>{reminder.kind === 'permission' ? '查看授权请求' : reminder.kind === 'question' ? '回复问题' : '查看原会话'} <Icon name="external" size={14}/></button>}
        {checkable && <><button className="qd-btn ghost" disabled={!!busy} onClick={() => setConfigure(true)}>连接设置</button><button className="qd-btn primary" disabled={!!busy || !run.connectionId} onClick={() => void check()}>{busy === 'check' ? '正在检查…' : '检查连接'}</button></>}
        {reminder.kind === 'direction' && <button className="qd-btn primary" disabled={!!busy} onClick={() => void openTask()}>查看最新方案 <Icon name="arrow-right" size={15}/></button>}</div>
      </footer>
    </>}
    {configure && <AgentConnectionSetup initialConfig={config} onClose={() => { setConfigure(false); void refresh(); }}/>} 
  </dialog>;
}
