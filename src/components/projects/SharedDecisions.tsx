import { useId, useMemo, useRef, useState } from 'react';
import { applicableSharedDecisions, listSharedDecisions, sharedDecisionTasks, suggestSharedDecisions } from '../../data/sharedDecisions';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import './shared-decisions.css';

type Decision = ReturnType<typeof listSharedDecisions>[number];
type Suggestion = ReturnType<typeof suggestSharedDecisions>[number];
type Tasks = ReturnType<typeof sharedDecisionTasks>;
type Save = (payload: Record<string, unknown>) => Promise<boolean>;

function TaskPicker({tasks, selected, fixed = [], change}: {
  tasks: Tasks; selected: string[]; fixed?: string[]; change: (keys: string[]) => void;
}) {
  return <fieldset className="qs-task-picker"><legend>关联任务</legend><div>
    {tasks.map(task => <label key={task.key}><input type="checkbox" checked={selected.includes(task.key)}
      disabled={fixed.includes(task.key) || (!selected.includes(task.key) && selected.length >= 32)}
      onChange={event => change(event.target.checked ? [...selected, task.key] : selected.filter(key => key !== task.key))}/>
      {task.title}</label>)}
  </div></fieldset>;
}

function CreateDecision({tasks, initial, taskKey, busy, save, close}: {
  tasks: Tasks; initial?: Suggestion; taskKey?: string; busy: boolean; save: Save; close: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [scope, setScope] = useState(initial?.scope ?? '');
  const [keys, setKeys] = useState<string[]>(initial?.taskKeys ?? (taskKey ? [taskKey] : []));
  return <form className="qs-form" onSubmit={async event => {
    event.preventDefault();
    if (await save({action:'link', title:title.trim(), scope:scope.trim(), taskKeys:keys,
      ...(initial && {suggestionId:initial.id})})) close();
  }}>
    <label>要共同决定什么<input autoFocus required maxLength={160} value={title} onChange={e => setTitle(e.target.value)}/></label>
    <label>适用范围<input required maxLength={500} value={scope} onChange={e => setScope(e.target.value)}
      placeholder="例如，同一组旅客 12 月 8 日晚的住宿"/></label>
    <TaskPicker tasks={tasks} selected={keys} fixed={initial?.taskKeys ?? (taskKey ? [taskKey] : [])} change={setKeys}/>
    <div className="qs-actions"><button type="submit" className="qp-btn primary" disabled={busy || keys.length < 2 || !scope.trim() || !title.trim()}>建立共同决定</button>
    <button type="button" className="qp-btn" disabled={busy} onClick={close}>取消</button></div>
  </form>;
}

type Editor = {kind: 'propose' | 'confirm' | 'link' | 'unlink'; revision: number; optionId?: string};

function DecisionEditor({editor, decision, tasks, busy, save, close}: {
  editor: Editor; decision: Decision; tasks: Tasks; busy: boolean; save: Save; close: () => void;
}) {
  const [text, setText] = useState('');
  const [keys, setKeys] = useState<string[]>(decision.taskKeys);
  const chosen = decision.options.find(option => option.id === editor.optionId);
  const stale = decision.revision !== editor.revision;
  const additions = keys.filter(key => !decision.taskKeys.includes(key));
  const removals = decision.taskKeys.filter(key => !keys.includes(key));
  const changeLinks = editor.kind === 'link' || editor.kind === 'unlink';
  const unlinkAll = editor.kind === 'unlink' && keys.length < 2;
  const label = editor.kind === 'propose' ? '保存备选方案' : editor.kind === 'confirm'
    ? decision.selectedOptionId ? '确认更换方案' : '确认采用方案'
    : editor.kind === 'link' ? '保存关联' : unlinkAll ? '解除这项共同决定' : '确认解除关联';
  return <form className="qs-form" onSubmit={async event => {
    event.preventDefault();
    const fields = changeLinks ? {taskKeys:editor.kind === 'link' ? additions : removals}
      : editor.kind === 'propose' ? {text:text.trim()} : {optionId:chosen?.id, reason:text.trim()};
    if (await save({action:editor.kind, decisionId:decision.id, expectedRevision:editor.revision, ...fields})) close();
  }}>
    {changeLinks ? <>
      <TaskPicker tasks={editor.kind === 'link' ? tasks : tasks.filter(task => decision.taskKeys.includes(task.key))}
        selected={keys} fixed={editor.kind === 'link' ? decision.taskKeys : []} change={setKeys}/>
      {editor.kind === 'unlink' && <p>{unlinkAll ? '剩余任务不足两项，确认后将解除整项共同决定。' : '取消勾选要解除关联的任务。'}</p>}
    </> : <>
      {chosen && <p>将共同采用「{chosen.text}」。请相关任务按此方案核对已有工作。</p>}
      <label>{editor.kind === 'propose' ? '备选方案' : '选择理由'}<textarea autoFocus required rows={2}
        maxLength={editor.kind === 'propose' ? 2000 : 1000} value={text} onChange={e => setText(e.target.value)}/></label>
    </>}
    {stale && <p role="alert">共同决定已经更新，请查看最新内容后重新操作。</p>}
    <div className="qs-actions"><button type="submit" className="qp-btn primary" disabled={busy || stale ||
      (changeLinks ? !(editor.kind === 'link' ? additions : removals).length : !text.trim())}>{label}</button>
      <button type="button" className="qp-btn" disabled={busy} onClick={close}>{stale ? '查看最新内容' : '取消'}</button></div>
  </form>;
}

function DecisionCard({decision, tasks, busy, save, openTask, inherited}: {
  decision: Decision; tasks: Tasks; busy: boolean; save: Save; openTask: (key: string) => void; inherited: boolean;
}) {
  const {snap} = useWorkdeck();
  const [editor, setEditor] = useState<Editor>();
  const start = (kind: Editor['kind'], optionId?: string) => setEditor({kind, optionId, revision:decision.revision});
  const selected = decision.options.find(option => option.id === decision.selectedOptionId);
  const taskTitle = (key: string) => tasks.find(task => task.key === key)?.title;
  return <article className="qs-decision">
    <header><h4>{decision.title}</h4><span className={'qs-state'+(selected ? ' is-confirmed' : '')}>{selected ? '已确认' : '待决定'}</span></header>
    <p className="qs-scope">{decision.scope}{inherited && " · 来自前置或上级任务"}</p>
    {!selected && <p>各任务可以继续调查，备选方案在这里汇总。</p>}
    <div className="qs-links" aria-label="受影响的任务">{decision.taskKeys.map(key => {
      const title = taskTitle(key);
      return title ? <button type="button" key={key} onClick={() => openTask(key)}><Icon name="link" size={13}/>{title}
        {snap.collaboration?.tasks[key]?.requiresRevalidation && <small>已有成果待复核</small>}</button>
        : <span key={key}>已归档的任务</span>;
    })}</div>
    {selected && <p className="qs-selected"><Icon name="check-circle" size={16}/><span><strong>共同采用</strong> {selected.text}</span></p>}
    {decision.options.length > 0 && <ul className="qs-options" aria-label="备选方案">{decision.options.map(option =>
      <li key={option.id}><div><span>{option.text}</span><small>{option.origin === 'task' ? '任务提交' : option.origin === 'requirement' ? '任务要求' : '人工建议'}{option.taskKey && ' · ' + (taskTitle(option.taskKey) ?? '原任务')}</small></div>
        {selected?.id !== option.id && <button type="button" className="qp-btn" disabled={busy || !!editor}
          onClick={() => start('confirm',option.id)}>{selected ? '改用此方案' : '选择此方案'}</button>}</li>
    )}</ul>}
    {editor ? <DecisionEditor key={editor.kind} editor={editor} decision={decision} tasks={tasks} save={save} busy={busy} close={() => setEditor(undefined)}/> :
      <div className="qs-actions">
        <button type="button" className="qp-btn" onClick={() => start('propose')} disabled={busy || decision.options.length >= 100}>添加备选方案</button>
        {tasks.some(task => !decision.taskKeys.includes(task.key)) && <button type="button" className="qp-quiet" disabled={busy} onClick={() => start('link')}>关联更多任务</button>}
        <button type="button" className="qp-quiet" disabled={busy} onClick={() => start('unlink')}>解除关联</button>
      </div>}
    {decision.history.length > 0 && <details className="qs-history"><summary>决定记录</summary><ol>
      {[...decision.history].reverse().map(row => <li key={row.revision}><strong>{decision.options.find(option => option.id === row.optionId)?.text}</strong>
        <p>{row.reason}</p><time dateTime={row.at}>{new Date(row.at).toLocaleString('zh-CN')}</time></li>)}</ol></details>}
  </article>;
}

export function SharedDecisions({taskKey, openTask}: {taskKey?: string; openTask: (key: string) => void}) {
  const {snap, api, toast} = useWorkdeck();
  const titleId = useId();
  const tasks = useMemo(() => sharedDecisionTasks(snap), [snap]);
  const decisions = useMemo(() => taskKey ? applicableSharedDecisions(snap,taskKey) : listSharedDecisions(snap), [snap,taskKey]);
  const suggestions = useMemo(() => suggestSharedDecisions(snap, taskKey), [snap,taskKey]);
  const [create, setCreate] = useState<Suggestion | 'manual'>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const save: Save = async payload => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await api.collaborate({projectId:snap.project.id, idempotencyKey:crypto.randomUUID(), type:'shared_decision', payload});
      if (!result.ok) throw Error(result.message || '操作未保存，请重试');
      toast(payload.action === 'dismiss' ? '已忽略这条提示' : '共同决定已更新');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作未保存，请重试');
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  if ((!decisions.length && !suggestions.length && tasks.length < 2) || (taskKey && !decisions.length && !tasks.some(task => task.key === taskKey))) return null;
  return <section className="qp-panel qs-panel" aria-labelledby={titleId}>
    <header><h3 id={titleId}><Icon name="link" size={17}/>共同决定</h3>
      {!create && tasks.length >= 2 && <button type="button" className="qp-btn" disabled={busy} onClick={() => setCreate('manual')}><Icon name="plus" size={14}/>关联任务</button>}
    </header>
    {create && <CreateDecision tasks={tasks} taskKey={taskKey} initial={create === 'manual' ? undefined : create} busy={busy} save={save} close={() => setCreate(undefined)}/>}
    {!create && suggestions.map(s => <div key={s.id} className="qs-suggestion"><div><strong>{s.title}</strong><p>{s.reason}</p>
      <small>{s.taskKeys.map(key => tasks.find(task => task.key === key)?.title).filter(Boolean).join(' · ')}</small></div>
      <div className="qs-actions"><button type="button" className="qp-btn" disabled={busy} onClick={() => setCreate(s)}>核对范围</button>
      <button type="button" className="qp-quiet" disabled={busy} onClick={() => void save({action:'dismiss', suggestionId:s.id, taskKeys:s.taskKeys})}>忽略</button></div>
    </div>)}
    {decisions.map(decision => <DecisionCard key={decision.id} decision={decision} tasks={tasks} busy={busy} save={save} openTask={openTask} inherited={!!taskKey && !decision.taskKeys.includes(taskKey)}/>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
