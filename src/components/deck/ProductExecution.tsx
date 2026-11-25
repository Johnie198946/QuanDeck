import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { businessTasks } from '../../data/businessTasks';
import { taskKey } from '../../data/collaboration';
import { executionProgress, executionStage } from '../../data/executionProgress';
import { planningTask } from '../../data/projectPlanning';
import { deriveProjectActivity, type ProjectActivityEntry } from '../../data/projectActivity';
import { PRODUCT_REMINDERS_CHANGED, productReminderHidden, readProductReminderActions, selectProductAttention, updateProductReminder } from '../../data/productAttention';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { resultExcerpt } from '../../data/resultExcerpt';
import { canAttemptAgentDispatch } from '../../integration/agentProfiles';
import { testForConfig, useConfiguredAgents } from '../../integration/configuredAgents';
import { desktopHost } from '../../integration/desktop';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { ProgressIndicator } from '../journal/RunProgress';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { AgentLogo } from '../ui/AgentLogo';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon, type IconName } from '../ui/Icon';
import { ActivityReply } from './ActivityReply';
import { AgentRoster } from './AgentRoster';
import { TaskAgentComparison } from './TaskAgentComparison';
import './product-execution.css';

export interface ProductTaskTarget { taskId: string; itemId?: string | null; agentId?: string; projectId?: string }
export const PRODUCT_TASK_DRAG = 'application/x-quandeck-task';
const dispatchEvent = 'quandeck:request-task-dispatch';
const dragEvent = 'quandeck:drag-task';
export function requestProductDispatch(target: ProductTaskTarget) {
  window.dispatchEvent(new CustomEvent(dispatchEvent, {detail:target}));
}
export function startProductTaskDrag(event: DragEvent, target: ProductTaskTarget) {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(PRODUCT_TASK_DRAG, JSON.stringify(target));
  window.dispatchEvent(new CustomEvent(dragEvent, {detail:target}));
}

export function useProductAttention(projects: Parameters<typeof selectProductAttention>[0]) {
  const [state, setState] = useState(readProductReminderActions);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => { setState(readProductReminderActions()); setNow(Date.now()); };
    const timer = window.setInterval(update, 60000);
    window.addEventListener(PRODUCT_REMINDERS_CHANGED, update);
    window.addEventListener('storage', update);
    return () => { window.clearInterval(timer); window.removeEventListener(PRODUCT_REMINDERS_CHANGED, update); window.removeEventListener('storage', update); };
  }, []);
  return useMemo(() => {
    const all = selectProductAttention(projects, now);
    return { visible: all.filter(row => !productReminderHidden(row, state, now)), hidden: all.filter(row => productReminderHidden(row, state, now)), state };
  },[projects, now, state]);
}

const self = 'qd:self';

export function ProductDispatchDock({ onManage }: { onManage?: () => void } = {}) {
  const { snap, api, toast, drag, setDrag, setRailPanel } = useWorkdeck();
  const [dragTarget, setDragTarget] = useState<ProductTaskTarget>();
  const [target, setTarget] = useState<ProductTaskTarget>();
  const [comparison, setComparison] = useState<ProductTaskTarget>();
  const [selected, setSelected] = useState<string[]>([]);
  const [over, setOver] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [manage, setManage] = useState(false);
  const sending = useRef(false);
  const { agents: configuredAgents, configured, tested } = useConfiguredAgents(snap.agents);
  const agents = [...configuredAgents, ...snap.agents.filter(agent => !configuredAgents.some(current => current.id === agent.id) && (!!snap.runtimeConnections?.[agent.id] || agent.id.startsWith('custom-')))];
  const rows = useMemo(() => deriveProjectActivity(snap).entries, [snap]);
  const canSend = (agentId: string) => {
    const profile = configured.find(config => (config.agentId || config.tool) === agentId);
    return api.mode === 'sample' || (api.mode === 'live' && canAttemptAgentDispatch(profile,snap.runtimeConnections?.[agentId],profile && testForConfig(profile,tested)));
  };
  const prepare = (next: ProductTaskTarget) => {
    if (sending.current) return;
    setComparison(undefined);
    setSelected(next.agentId ? [next.agentId] : []);
    setTarget(next); setDragTarget(undefined); setDrag(null); setOver(undefined); setError('');
  };
  useEffect(() => {
    const started = (event: Event) => { setDragTarget((event as CustomEvent<ProductTaskTarget>).detail); setOver(undefined); };
    const request = (event: Event) => prepare((event as CustomEvent<ProductTaskTarget>).detail);
    const end = () => { setDragTarget(undefined); setOver(undefined); };
    window.addEventListener(dispatchEvent, request);
    window.addEventListener(dragEvent, started);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => { window.removeEventListener(dispatchEvent, request); window.removeEventListener(dragEvent, started); window.removeEventListener('dragend', end); window.removeEventListener('drop', end); };
  }, [setDrag]);
  const dragged = dragTarget ?? (drag?.type === 'task' && {taskId:drag.taskId});
  const task = target && snap.tasks[target.taskId];
  const item = target?.itemId && snap.orchestrations?.[target.taskId]?.items[target.itemId] || undefined;
  const key = task && taskKey(task.id, item?.id);
  const ledger = key ? snap.collaboration?.tasks[key] : undefined;
  const spec = ledger && snap.collaboration?.specs.find(record => record.key === key && record.revision === ledger.specRevision);
  const planning = task ? planningTask(snap, task.id, item?.id) : {};
  const available = Boolean(task && (!target?.itemId || item) && (!target?.projectId || target.projectId === snap.project.id) && !task.completion && !['done','cancelled','in_review'].includes(item?.status ?? ledger?.status ?? ''));
  const running = rows.some(row => row.taskId === task?.id && row.itemId === item?.id && row.state !== 'failed');
  const files = [...new Map([...(snap.project.attachments ?? []), ...(task?.attachments ?? []), ...(item?.attachments ?? [])].map(file => [file.id, file])).values()];
  const materials = [
    ['任务目标', spec?.goal || item?.expected || task?.originalTitle || task?.title],
    ['研究信息', planning.information], ['研究结论', planning.conclusion],
    ['验收标准', spec?.criteria.join('\n')], ['交付要求', planning.deliverable], ['附件', files.map(f => f.name).join('、')],
  ].filter((entry): entry is [string, string] => !!entry[1]);
  const toggle = (id: string) => { setError(''); setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [id]); };
  const close = () => { if (!sending.current) {setTarget(undefined);setError('');} };
  const openManage = () => { if (onManage) onManage(); else { setRailPanel('agents'); setManage(true); } };
  const submit = async () => {
    if (!available || running || sending.current || !task || selected.length !== 1) return;
    const id = selected[0];
    if (id !== self && !canSend(id)) { setError('请先连接可执行任务的 Agent。'); return; }
    sending.current = true; setPending(true); setError('');
    try {
      if (id === self) {
        if (item) await api.setWorkOwner(task.id, item.id, 'me');
        else await api.setTaskOwner(task.id, 'me');
        toast('已分派给你');
      } else {
        const runtime = api as typeof api & Partial<RuntimeCommands>;
        const result = api.mode === 'live' && 'dispatchProjectTask' in runtime && typeof runtime.dispatchProjectTask === 'function'
          ? await runtime.dispatchProjectTask(snap.project.id,task.id,id,item?.id)
          : item ? await api.dispatchWork(task.id,item.id,id) : await api.dispatch(task.id,id);
        if (!result.ok) { setError(result.message || '未能发送，请检查连接后重试。'); return; }
        toast(result.message || '任务已发送');
      }
      setTarget(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '未能发送，请重试。'); }
    finally { sending.current = false; setPending(false); }
  };
  const choices = [{id:self, title:'我', logo:<Icon name="user" size={25}/>, available:true, detail:'自己处理'}, ...agents.map(agent => {
    const current = rows.filter(row => row.agentId === agent.id);
    const active = current.some(row => row.state === 'running'), waiting = current.filter(row => row.state === 'queued').length;
    return {id:agent.id,title:agent.name,logo:<AgentLogo agent={agent} size={28}/>,available:canSend(agent.id),detail:active ? '正在执行' + (waiting ? ` · ${waiting} 项排队` : '') : waiting ? `${waiting} 项排队` : canSend(agent.id) ? '可以接收任务' : '待连接'};
  })];
  const compareChoices = choices.filter(choice => {
    const binding = snap.runtimeConnections?.[choice.id];
    const profile = configured.find(config => (config.agentId || config.tool) === choice.id);
    const tool = binding?.tool ?? profile?.tool;
    return choice.available && !!tool && ['codex','claude','dsh'].includes(tool);
  });
  return <>
    {dragged && !target && (dragged.projectId == null || dragged.projectId === snap.project.id) && <aside className="qd-product-dock" aria-label="分派任务" data-product-dock>
      <header><strong>分派任务</strong><p>拖到执行者上，松手后再确认。</p></header>
      <div>{choices.map(choice => <button type="button" key={choice.id} className={over === choice.id ? 'is-over' : ''} disabled={!choice.available} onClick={() => prepare({...dragged,agentId:choice.id})}
        onDragOver={event => { if (!choice.available) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setOver(choice.id); }}
        onDragLeave={() => setOver(undefined)} onDrop={event => { if (!choice.available) return; event.preventDefault(); prepare({...dragged,agentId:choice.id}); }}>
        {choice.logo}<strong>{choice.title}</strong><small>{over === choice.id ? '松手查看分派' : choice.detail}</small></button>)}
        <button type="button" onClick={openManage}><Icon name="plus" size={25}/><strong>添加 Agent</strong></button>
      </div>
    </aside>}
    {target && <ConfirmDialog title="分派任务" text={available ? '核对执行者和资料，确认后才会发送。' : '这项任务目前不能分派。'} confirmLabel={pending ? '正在发送…' : selected[0] === self ? '确认由我处理' : '确认分派'} onClose={close} onConfirm={() => void submit()} busy={pending}
      confirmDisabled={!available || running || !selected.length || selected.some(id => id !== self && !canSend(id))} error={error || (running ? '已有执行在进行。请先处理当前执行。' : undefined)}>
      {task && <div className="qd-product-dispatch-task"><Icon name="check-square" size={20}/><div><strong>{item?.title ?? task.title}</strong><small>{snap.project.name}{item ? ` · ${task.title}` : ''}</small></div></div>}
      <fieldset className="qd-product-dispatch-choices" disabled={pending}><legend>执行者</legend>{choices.map(choice => <label className={selected.includes(choice.id) ? 'is-selected' : ''} key={choice.id}><input type="radio" name="product-executor" checked={selected.includes(choice.id)} disabled={!choice.available} onChange={() => toggle(choice.id)}/>{choice.logo}<span><strong>{choice.title}</strong><small>{choice.detail}</small></span></label>)}</fieldset>
      <button type="button" className="qd-link" disabled={pending} onClick={() => { close(); openManage(); }}>管理 Agent</button>
      {available && spec && desktopHost()?.compareTaskAgents && <button type="button" className="qd-btn ghost qd-compare-open"
        disabled={pending || running || compareChoices.length < 2} title={compareChoices.length < 2 ? '先连接两位支持只读分析的 Agent' : undefined}
        onClick={() => { setComparison(target); close(); }}>请多个 Agent 出方案</button>}
      <details className="qd-product-dispatch-material"><summary>查看随任务发送的资料（{materials.length} 项）</summary><dl>{materials.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    </ConfirmDialog>}
    {comparison && <TaskAgentComparison target={comparison} choices={compareChoices} onClose={() => setComparison(undefined)} />}
    {manage && <ConfirmDialog title="Agent 连接" text="连接好后，再回到任务分派。" confirmLabel="完成" onConfirm={() => setManage(false)} onClose={() => setManage(false)}><AgentRoster entries={rows} /></ConfirmDialog>}
  </>;
}

const attentionIcons: Record<string,IconName> = {permission:'lock',question:'message',review:'check-circle',decision:'bulb',blocked:'alert',overdue:'calendar',stalled:'clock'};

export function ProductMonitor({ selectedAttentionId }: { selectedAttentionId?: string } = {}) {
  const { snap, projectSnapshots, switchProject, agentOf, openWorkspace, openSourceSession, api, toast } = useWorkdeck();
  const [expanded, setExpanded] = useState<string>();
  const selectedCard = useRef<HTMLElement>(null);
  useEffect(() => {
    selectedCard.current?.focus({preventScroll:true});
    selectedCard.current?.scrollIntoView({block:'nearest'});
  }, [selectedAttentionId]);
  const [queueFilter, setQueueFilter] = useState<string>();
  const [sourceDetails, setSourceDetails] = useState<string>();
  const projects = useMemo(() => [snap, ...projectSnapshots.filter(project => project.project.id !== snap.project.id)].filter(project => project.project.id && !project.project.deletedAt), [snap,projectSnapshots]);
  const {visible,hidden,state} = useProductAttention(projects);
  const allRuns = useMemo(() => projects.flatMap(project => {
    const base = deriveProjectActivity(project).entries.filter(entry => entry.state === 'running' || entry.state === 'queued');
    const human: ProjectActivityEntry[] = [];
    for (const task of businessTasks(project)) {
      const root = project.collaboration?.tasks[task.id];
      if (root?.owner === 'me' && root.status === 'running') human.push({id:`me:${task.id}`,title:task.title,state:'running',taskId:task.id});
      for (const item of Object.values(project.orchestrations?.[task.id]?.items ?? {})) {
        if (item.owner === 'me' && item.status === 'running') human.push({id:`me:${task.id}:${item.id}`,title:item.title,state:'running',taskId:task.id,itemId:item.id});
      }
    }
    const order = new Map((project.nowQueue?.order ?? []).map((id,i) => [id,i]));
    return [...base,...human].sort((a,b) => (order.get(a.id) ?? Infinity)-(order.get(b.id) ?? Infinity)).map(entry => ({project,entry,id:`${project.project.id}:${entry.id}`}));
  }), [projects]);
  const running = allRuns.filter(row => row.entry.state === 'running');
  const allQueued = allRuns.filter(row => row.entry.state === 'queued');
  const queued = allQueued.filter(row => !queueFilter || row.entry.agentId === queueFilter);
  const inProject = async (projectId: string, command: () => void | Promise<void>) => {
    if (projectId === snap.project.id || await switchProject(projectId)) await command();
  };
  return <main className="qd-product-monitor">
    <header className="qd-product-monitor-heading"><h1>帮你盯</h1></header>
    <section className={`qd-product-monitor-attention ${visible.length ? 'has-attention' : ''}`} aria-labelledby="qd-attention-heading">
      <h2 id="qd-attention-heading"><Icon name="alert" size={22}/>需要你处理 <small>{visible.length}</small></h2>
      {visible.length ? <div className="qd-product-monitor-cards">{visible.map(row => {
        const project = projects.find(candidate => candidate.project.id === row.projectId)!;
        const session = row.entry?.sessionId ? project.sessions[row.entry.sessionId] : undefined;
        const requiresResponse = row.kind === 'question' || row.kind === 'permission';
        const inline = Boolean(session?.runtime?.runId && requiresResponse);
        const open = () => void inProject(row.projectId, () => {
          if (row.planId) openWorkspace(row.taskId || '', {view:'plan',planId:row.planId,projectId:row.projectId,itemId:row.itemId ?? null});
          else if ((requiresResponse || row.kind === 'stalled' || row.kind === 'blocked') && session) openSourceSession(session.id);
          else if (row.taskId) openWorkspace(row.taskId,{projectId:row.projectId,view:row.kind === 'review' ? 'results' : 'tasks',selected:row.itemId ?? null,itemId:row.itemId ?? null});
          else if (session) openSourceSession(session.id);
        });
        return <article key={row.id} ref={row.id === selectedAttentionId ? selectedCard : undefined} tabIndex={-1} className={`qd-product-monitor-card ${row.id === selectedAttentionId ? 'is-selected' : ''}`}>
          <div className="qd-product-monitor-card-head"><span className="qd-product-monitor-mark"><Icon name={attentionIcons[row.kind]} size={20}/></span><div><strong>{row.title}</strong><p>{project.project.name}{row.urgent ? ' · 领导交办' : ''}</p></div><button className="qd-btn primary" type="button" aria-expanded={inline ? expanded === row.id : undefined} onClick={() => inline ? void inProject(row.projectId, () => setExpanded(value => value === row.id ? undefined : row.id)) : open()}>{inline && expanded === row.id ? '收起' : row.action}</button></div>
          <p>{row.detail}</p>
          {expanded === row.id && session && <ActivityReply session={session} onOpen={open}/>}
          {row.kind === 'blocked' && row.entry?.detail && executionStage(row.entry.detail) !== '正在运行任务工具' && <details><summary>查看原因</summary><p>{resultExcerpt(row.entry.detail, 220)}</p></details>}
          {!requiresResponse && <details className="qd-monitor-reminder-options"><summary>提醒选项</summary><div>{([['later','明天提醒'],['handled','标记提醒已处理'],['declined','不再提醒此事项']] as const).map(([value,label])=><button type="button" className="qd-link" key={value} onClick={() => updateProductReminder(row.id,value)}>{label}</button>)}</div></details>}
        </article>;
      })}</div> : <p className="qd-product-monitor-empty">现在没有需要你处理的事。</p>}
      {hidden.length > 0 && <details className="qd-monitor-reminder-options"><summary>已处理的提醒（{hidden.length} 项）</summary><ul>{hidden.map(row => <li key={row.id}><span>{row.title} · {state[row.id]?.action === 'later' ? '明天提醒' : state[row.id]?.action === 'declined' ? '不再提醒' : '已处理'}</span><button type="button" className="qd-link" onClick={() => updateProductReminder(row.id,'restore')}>恢复</button></li>)}</ul></details>}
    </section>
    <div className="qd-product-monitor-grid"><section aria-labelledby="qd-running-heading">
      <h2 id="qd-running-heading"><Icon name="play" size={22}/>正在执行 <small>{running.length}</small></h2>
      {running.length ? <ul className="qd-product-monitor-list">{running.map(({project,entry,id}) => {
        const agent = entry.agentId ? project.agents.find(item => item.id === entry.agentId) ?? agentOf(entry.agentId) : undefined;
        const progress = executionProgress('running',entry.step,entry.percent);
        return <li key={id}><div className="qd-product-run-line"><div><strong>{entry.title}</strong><small>{project.project.name}</small></div>
          {agent ? <button className="qd-product-agent-tag" type="button" aria-pressed={queueFilter === agent.id} onClick={() => setQueueFilter(value => value === agent.id ? undefined : agent.id)}><AgentLogo agent={agent} size={19}/>{agent.name}</button> : <span className="qd-product-agent-tag"><Icon name="user" size={18}/>我</span>}
          <button type="button" className="qd-product-run-progress" aria-expanded={sourceDetails === id} aria-label={`查看进度依据：${entry.title}`} onClick={() => setSourceDetails(value => value === id ? undefined : id)}><ProgressIndicator progress={progress} agentName={agent?.name ?? '我'} color={agent?.color ?? '#1e5bdb'} compact/></button>
        </div>{sourceDetails === id && <div className="qd-product-run-evidence"><span>{progress?.mode === 'percent' ? '执行者报告的进度' : progress?.mode === 'steps' ? '执行者报告的步骤' : '已开始，暂无可核对的完成量'}{progress?.amount ? ` · ${progress.amount}` : ''}</span>{entry.taskId && <button type="button" className="qd-link" onClick={() => void inProject(project.project.id,() => openWorkspace(entry.taskId!,{view:'tasks',itemId:entry.itemId ?? null,selected:entry.itemId ?? null}))}>查看任务</button>}{entry.sessionId && <button type="button" className="qd-link" onClick={() => void inProject(project.project.id,()=>openSourceSession(entry.sessionId!))}>打开执行记录</button>}{!entry.agentId && entry.taskId && snap.project.id === project.project.id && <TaskOutputButton taskId={entry.taskId} itemId={entry.itemId}/>}</div>}</li>;
      })}</ul> : <p className="qd-product-monitor-empty">暂无正在执行的任务。</p>}
    </section><section aria-labelledby="qd-queue-heading">
      <h2 id="qd-queue-heading"><Icon name="clock" size={22}/>等待执行 <small>{queued.length}</small></h2>
      {queueFilter && <button type="button" className="qd-link" onClick={() => setQueueFilter(undefined)}>查看全部执行者</button>}
      {queued.length ? <ul className="qd-product-monitor-list">{queued.map(({project,entry,id},index) => <li key={id} className="qd-product-run-line"><div><strong>{entry.title}</strong><small>{project.agents.find(agent => agent.id === entry.agentId)?.name || project.project.name}</small></div>{index > 0 && queued[index-1].project.project.id === project.project.id && <button type="button" className="qd-link" aria-label={`将「${entry.title}」在列表上移`} onClick={() => void inProject(project.project.id,async () => { try { await api.manageNow({type:'move',id:entry.id,beforeId:queued[index-1].entry.id,view:'all'}); } catch { toast('暂时无法调整显示顺序','error'); } })}>上移</button>}</li>)}</ul> : <p className="qd-product-monitor-empty">暂无排队任务。</p>}
    </section></div>
  </main>;
}
