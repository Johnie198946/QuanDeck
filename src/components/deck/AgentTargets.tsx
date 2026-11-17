import { RunProgress, ProgressIndicator } from '../journal/RunProgress';
import { executionProgress } from '../../data/executionProgress';
import { useRef, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { AgentLogo } from '../ui/AgentLogo';
import { Icon } from '../ui/Icon';
import { useConfiguredAgents, testForConfig } from '../../integration/configuredAgents';
import { canAttemptAgentDispatch } from '../../integration/agentProfiles';
import { desktopHost } from '../../integration/desktop';
import { businessTasks } from '../../data/businessTasks';

/** Persistent targets. Drop and keyboard selection share the real dispatch command. */
export function AgentTargets() {
  const { snap, drag, setDrag, toast, setRailPanel, api } = useWorkdeck();
  const { agents: configuredAgents, configured, tested } = useConfiguredAgents(snap.agents);
  const agents = [...configuredAgents, ...snap.agents.filter(agent => snap.runtimeConnections?.[agent.id] && !configuredAgents.some(current => current.id === agent.id))];
  const [over, setOver] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [taskId, setTaskId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const dispatching = useRef(false);
  const tasks = businessTasks(snap).filter(task => !task.completion);
  const dragged = drag?.type === 'task' ? tasks.find(task => task.id === drag.taskId) : undefined;
  async function dispatch(id: string, agentId: string) {
    if (dispatching.current) return;
    if (!tasks.some(task => task.id === id)) { toast('请先选择一项未完成的任务', 'error'); return; }
    dispatching.current = true; setBusy(agentId);
    try {
      const result = await api.dispatch(id, agentId);
      if (!result.ok) { toast(result.message || '任务未能发送，请检查连接', 'error'); return; }
      toast(result.message || '任务已交给 Agent'); setChoosing(null); setTaskId('');
    } catch (error) { toast(error instanceof Error ? error.message : '任务未能发送，请重试', 'error'); }
    finally { dispatching.current = false; setBusy(null); }
  }
  return <div className={`qd-agent-targets ${dragged ? 'is-dragging-task' : ''}`}>
    <p className="qd-agent-targets-hint" aria-live="polite">{dragged ? <>将「{dragged.title}」放到下方 Agent</> : '拖入任务，或选择任务后执行'}</p>
    {!agents.length && <p className="qd-agent-targets-empty">连接本机 Agent 后，可把任务交给它。</p>}
    <ul>{agents.map(agent => {
      const configs = configured.filter(config => (config.agentId || config.tool) === agent.id);
      const binding = snap.runtimeConnections?.[agent.id];
      const canDispatch = api.mode === 'live' && (!desktopHost() || !!configs[0]) && canAttemptAgentDispatch(configs[0],binding,configs[0] && testForConfig(configs[0],tested));
      const discussionOnly = configs.some(config => config.tool==='workbuddy' || testForConfig(config, tested)?.discussionOpen);
      const active = Object.values(snap.sessions).filter(session => session.agentId === agent.id && ['pending', 'queued', 'running', 'waiting_reply', 'waiting_permission', 'paused'].includes(session.status));
      const current = [...active].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.lastActivity.localeCompare(a.lastActivity))[0];
      const status = active.some(session => session.status === 'running') ? '正在执行' : active.length ? '等待处理' : canDispatch ? '已配置 · 启动时检查' : discussionOnly ? '可在客户端讨论' : '请配置应用 Agent';
      return <li key={agent.id} className={`qd-agent-target ${canDispatch ? 'can-dispatch' : 'is-unavailable'} ${over === agent.id && dragged ? 'is-over' : ''}`} data-agent-target={agent.id}
        onDragOver={event => { if (!dragged) return; event.preventDefault(); event.dataTransfer.dropEffect = canDispatch && !busy ? 'copy' : 'none'; setOver(agent.id); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }}
        onDrop={event => { if (!dragged) return; event.preventDefault(); event.stopPropagation(); const id = dragged.id; setOver(null); setDrag(null); if (!canDispatch) { toast(`${agent.name} 请配置应用 Agent，未发送`, 'error'); return; } void dispatch(id, agent.id); }}>
        <div className="qd-agent-target-main"><AgentLogo agent={agent} size={28}/><div><strong>{agent.name}{agent.id === snap.defaultAgent && <small>默认</small>}</strong><span>{busy === agent.id ? '正在提交…' : over === agent.id && dragged && canDispatch ? '松手开始执行' : status}</span></div>
          {canDispatch ? <button type="button" className="qd-agent-pick" aria-label={`选择任务交给 ${agent.name}`} aria-expanded={choosing === agent.id} disabled={!!busy} onClick={() => { setChoosing(choosing === agent.id ? null : agent.id); setTaskId(''); }}><Icon name="plus" size={15}/><span>选择任务</span></button> : <button className="qd-link qd-agent-connect" type="button" onClick={() => setRailPanel('agents')}>设置</button>}
        </div>
        {busy === agent.id ? <ProgressIndicator progress={executionProgress('submitting')} agentName={agent.name} color={agent.color} compact /> : current && <RunProgress session={current} compact />}
        {choosing === agent.id && <form className="qd-agent-task-picker" onSubmit={event => { event.preventDefault(); if (taskId) void dispatch(taskId, agent.id); }}>
          <label><span>交给 {agent.name} 的任务</span><select aria-label={`交给 ${agent.name} 的任务`} value={taskId} disabled={!!busy} onChange={event => setTaskId(event.target.value)}><option value="">选择未完成的任务</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
          {!tasks.length && <small>先在左侧创建任务。</small>}
          <div><button type="button" className="qd-link" disabled={!!busy} onClick={() => setChoosing(null)}>取消</button><button type="submit" className="qd-btn primary" disabled={!taskId || !!busy}>开始执行<Icon name="arrow-right" size={14}/></button></div>
        </form>}
      </li>;
    })}</ul>
  </div>;
}
