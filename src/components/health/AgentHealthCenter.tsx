import { discussionSummary } from '../../data/discussionSnippets';
import { useEffect, useId, useRef, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost, type RuntimeRunView } from '../../integration/desktop';
import { gateway } from '../../integration/gateway';
import { Icon } from '../ui/Icon';
import { TaskIcon } from '../ui/TaskIcon';
import { AgentConnectionSetup } from '../deck/AgentConnectionSetup';
import { getConfiguredAgents, useConfiguredAgents, testForConfig } from '../../integration/configuredAgents';
import { canAttemptAgentDispatch } from '../../integration/agentProfiles';
import { incidentCopy, lastSeenLabel } from './incidentPresentation';
import { useAgentIncidents } from './useAgentIncidents';
import './agent-health.css';

const normalizedPath = (value = '') => { const path = value.replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(path) ? path.toLowerCase() : path; };

export function AgentHealthCenter() {
  const state = useAgentIncidents();
  const [muted, setMuted] = useState<string[]>([]);
  const pending = state.incidents.filter(run => run.health?.incident?.status === 'open');
  const latest = state.incidents.find(run => (run.health?.incident?.status === 'open' || run.health?.incident?.code === 'fallback') && !muted.includes(run.health!.incident!.id));
  return <>
    <button type="button" className={`qd-health-trigger ${pending.length || state.offline ? 'has-attention' : ''}`} aria-label={`任务提醒${pending.length ? `，${pending.length} 项待处理` : ''}`} title="任务提醒" aria-haspopup="dialog" aria-expanded={state.open} onClick={() => state.setOpen(true)}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0v4l2 4H4l2-4Z"/><path d="M10 21h4"/></svg>
      {!!pending.length && <span>{pending.length}</span>}
      {!pending.length && state.offline && <i />}
    </button>
    {latest && !state.open && <aside className="qd-health-nudge" role="status"><span className="qd-health-nudge-signal"><Icon name="alert" size={18}/></span><button onClick={() => { state.setSelectedRun(latest.runId); state.setOpen(true); }}><strong>{incidentCopy(latest.health!.incident!).title}</strong><span>查看任务与下一步 <Icon name="arrow-right" size={13}/></span></button><button className="qd-health-dismiss" aria-label="收起提醒" onClick={() => setMuted(value => [...value, latest.health!.incident!.id])}><Icon name="close" size={16}/></button></aside>}
    {state.open && <HealthDialog {...state} onClose={() => { setMuted(value => [...new Set([...value, ...state.incidents.map(run => run.health!.incident!.id)])]); state.setOpen(false); }}/>} 
  </>;
}

function HealthDialog({ incidents, offline, selectedRun, setSelectedRun, refresh, onClose }: {
  incidents: RuntimeRunView[]; offline: boolean; selectedRun: string | null; setSelectedRun: (id: string | null) => void; refresh: () => Promise<void>; onClose: () => void;
}) {
  const { snap, projectSnapshots, api, switchProject, openWorkspace } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [busy, setBusy] = useState(''), [feedback, setFeedback] = useState(''), [target, setTarget] = useState(''), [confirmHandoff, setConfirmHandoff] = useState(false);
  const [configure, setConfigure] = useState(false);
  const run = incidents.find(item => item.runId === selectedRun) || incidents[0];
  const project = run?.projectId === snap.project.id ? snap : projectSnapshots.find(item => item.project.id === run?.projectId);
  const session = project && Object.values(project.sessions).find(item => item.runtime && (item.runtime.runId === run?.runId || run?.dispatchId && item.runtime.dispatchId === run.dispatchId));
  const task = run?.taskId && project?.tasks[run.taskId];
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
  const copy = incident?.resolvedReason === 'handed_off' ? { title: '已交给备用 Agent', next: '原执行已经停止，已收到的记录保留在任务中。接手后的进展在新的会话里更新。' } : incident ? incidentCopy(incident) : null;
  const lastStep = [...(run?.events || [])].reverse().find(event => event.step?.label)?.step?.label;
  const lastReply = [...(run?.events || [])].reverse().find(event => event.reply)?.reply?.text;
  const config = getConfiguredAgents().find(item => item.connectionId === run?.connectionId);
  const connectionName = (id: string) => project?.agents.find(agent => project.runtimeConnections?.[agent.id]?.connectionId === id)?.name || getConfiguredAgents().find(item => item.connectionId === id)?.displayName || 'Agent';
  const successor = session?.runtime?.handedOffTo && project?.sessions[session.runtime.handedOffTo];
  const handoffAllowed = !!session && session.origin === 'dispatch' && session.status !== 'archived' && !['submitting', 'unknown'].includes(session.dispatchPhase ?? '') && (!successor || successor.dispatchPhase === 'rejected') && !!api.handoffSession && !!candidates.length && run?.acceptance !== 'unknown' && incident?.status === 'open';
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  useEffect(() => { setTarget(''); setFeedback(''); setConfirmHandoff(false); }, [run?.runId]);
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
      const result = await api.handoffSession(session.id, target);
      if (!result.ok) { setFeedback(result.message || '暂时不能转交，请查看原会话。'); return; }
      setConfirmHandoff(false); setFeedback(result.message || '已新建接管执行，原来的记录仍保留。'); await refresh();
    } catch (error) { setFeedback(error instanceof Error ? error.message : '本次转交未完成，请查看原任务。'); }
    finally { setBusy(''); }
  }
  return <dialog ref={dialog} className="qd-health-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="qd-health-header"><div><span className="qd-health-eyebrow">QUANDECK / 提醒</span><h2 id={titleId}>{incidents.some(item => item.health?.incident?.status === 'open') ? '让任务继续向前' : '任务提醒'}</h2></div><button className="qd-icon-btn" aria-label="关闭任务提醒" disabled={!!busy} onClick={onClose}><Icon name="close" size={20}/></button></header>
    {offline && <div className="qd-health-offline" role="status">进度暂时无法更新，下面是最后收到的记录。<button className="qd-link" onClick={() => void refresh()}>重新连接</button></div>}
    {!run ? <div className="qd-health-empty"><Icon name="check-circle" size={36}/><h3>暂时没有需要处理的异常</h3><p>连接异常或进度长时间没更新时，会在这里提醒。</p></div> : <>
      {incidents.length > 1 && <nav className="qd-health-switcher" aria-label="选择任务提醒">{incidents.map(item => <button key={item.runId} aria-pressed={item.runId === run.runId} disabled={!!busy} onClick={() => setSelectedRun(item.runId)}>{item.health?.incident?.status === 'resolved' ? '✓ ' : '· '}{item.title || projectSnapshots.find(p => p.project.id === item.projectId)?.tasks[item.taskId || '']?.title || '任务提醒'}</button>)}</nav>}
      <div className="qd-health-body">
        <div className="qd-health-task">{project && run.taskId && <TaskIcon snapshot={project} taskId={run.taskId} size={28}/>}<div><small>{project?.project.name || '任务项目'}</small><h3>{task ? task.title : run.title || 'Agent 执行'}</h3></div></div>
        <div className={`qd-health-headline ${incident?.status === 'resolved' ? 'is-resolved' : ''}`}><span><Icon name={incident?.status === 'resolved' ? 'check-circle' : incident?.code === 'suspected_stall' ? 'clock' : 'alert'} size={22}/></span><div><h3>{copy?.title}</h3><p>{copy?.next}</p></div></div>
        {run.fallback && run.acceptance === 'acknowledged' && <section className="qd-health-transfer" aria-label="备用切换记录"><strong>{connectionName(run.fallback.fromConnectionId)} <Icon name="arrow-right" size={16}/> {connectionName(run.fallback.toConnectionId)}</strong><p>{run.fallback.reason}。切换发生在任务发送前，实际执行由右侧 Agent 承担。</p></section>}
        <ol className="qd-health-route" aria-label="任务当前位置"><li className="is-kept"><Icon name="check" size={14}/><span>任务已记录</span></li><li className={lastStep || lastReply ? 'is-kept' : ''}><Icon name={lastStep || lastReply ? 'check' : 'clock'} size={14}/><span>{lastStep || lastReply ? '已收到进展' : '等待进展'}</span></li><li className={incident?.status === 'resolved' ? 'is-kept' : 'is-here'}><Icon name={incident?.status === 'resolved' ? 'check' : 'dot'} size={14}/><span>{incident?.status === 'resolved' ? '已解除提醒' : '当前待处理'}</span></li></ol>
        <section className="qd-health-checkpoint" aria-label="已保留的记录"><div><strong>{currentAgent?.name || config?.displayName || run.tool || 'Agent'}</strong><time>{lastSeenLabel(run.health?.lastActivityAt)}</time></div><p>{lastStep || (lastReply ? discussionSummary(lastReply).slice(0,160) : '还没有收到可展示的执行进展。任务原文仍在。')}</p>{run.tokens != null && <small>已收到用量 {run.tokens.toLocaleString()} token</small>}</section>
        {handoffAllowed && <section className="qd-health-handoff"><label htmlFor={`${titleId}-agent`}>换一位 Agent 接着做</label><div><select id={`${titleId}-agent`} value={target} disabled={!!busy} onChange={e => { setTarget(e.target.value); setConfirmHandoff(false); }}><option value="">选择同项目的备用 Agent</option>{candidates.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="qd-btn ghost" disabled={!target || !!busy} onClick={() => setConfirmHandoff(true)}>预览转交 <Icon name="arrow-right" size={15}/></button></div></section>}
        {confirmHandoff && <section className="qd-health-transfer" aria-label="转交确认"><strong>{currentAgent?.name || '当前 Agent'} <Icon name="arrow-right" size={16}/> {candidates.find(item => item.id === target)?.name}</strong><p>带上任务要求、当前方法、最近三轮公开回复、任务树和已发布成果的文字，创建新的执行记录。先确认原执行已停止，再交给对方。</p><p>任务输入附件会重新检查并交给目标 Agent；成果附件只列名称。登录信息、隐藏对话和原来的权限批准不会迁移。</p><div><button className="qd-btn ghost" disabled={!!busy} onClick={() => setConfirmHandoff(false)}>取消</button><button className="qd-btn primary" disabled={!!busy || !target} onClick={() => void handoff()}>{busy === 'handoff' ? '正在确认并转交…' : '确认转交'}</button></div></section>}
        {incident?.resolvedReason === 'handed_off' && incident.successorRunId && <button className="qd-link" onClick={() => void desktopHost()?.openRun(incident.successorRunId!)}>查看接手后的会话 <Icon name="external" size={14}/></button>}
        {feedback && <p className="qd-health-feedback" role="status">{feedback}</p>}
      </div>
      <footer className="qd-health-footer"><button className="qd-link" disabled={!!busy} onClick={async () => { if (run.taskId && run.projectId && await switchProject(run.projectId)) { openWorkspace(run.taskId, {view:'tasks',selected:run.workItemId || null}); onClose(); } }}>查看任务</button><div><button className="qd-btn ghost" disabled={!!busy} onClick={() => { void desktopHost()?.openRun(run.runId); }}>查看会话 <Icon name="external" size={14}/></button><button className="qd-btn ghost" disabled={!!busy} onClick={() => setConfigure(true)}>连接设置</button><button className="qd-btn primary" disabled={!!busy || !run.connectionId} onClick={() => void check()}>{busy === 'check' ? '正在检查…' : '再检查一次'}</button></div></footer>
    </>}
    {configure && <AgentConnectionSetup initialConfig={config} onClose={() => { setConfigure(false); void refresh(); }}/>} 
  </dialog>;
}
