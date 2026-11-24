import { createContext, useContext, useEffect, useId, useMemo, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { annotationHistory, filterAnnotationHistory } from '../../data/annotationHistory';
import { AnnotationEvolution } from './AnnotationEvolution';
import { TaskAnnotationEditor } from './TaskAnnotationEditor';
import { Icon } from '../ui/Icon';
import { LOCAL_PRINCIPAL } from '../../data/governance';
import type { AnnotationHistoryEntry, TaskAnnotationRevision } from '../../data/annotationHistory';
import { taskKey } from '../../data/collaboration';
import type { Snapshot } from '../../data/types';
import './annotation-history.css';

const kinds = { note: '任务批注', condition: '用户条件', review: '验收反馈', discussion: '讨论批注' };
const states = { current: '已记录', revised: '已有修改', withdrawn: '已撤回' };
function groupAnnotations(snap: Snapshot) {
  const groups = new Map<string, AnnotationHistoryEntry[]>();
  for (const row of annotationHistory(snap)) {
    const scoped = row.taskId && snap.tasks[row.taskId] ? taskKey(row.taskId, row.itemId) : '';
    const list = groups.get(scoped);
    if (list) list.push(row); else groups.set(scoped, [row]);
  }
  return groups;
}
const HistoryContext = createContext<ReturnType<typeof groupAnnotations> | null>(null);
export function AnnotationProvider({children}: {children: React.ReactNode}) {
  const {snap} = useWorkdeck();
  const grouped = useMemo(()=>groupAnnotations(snap),[snap]);
  return <HistoryContext.Provider value={grouped}>{children}</HistoryContext.Provider>;
}
export function AnnotationHistory({taskId, itemId}: {taskId?: string; itemId?: string}) {
  const {snap}=useWorkdeck();
  const shared = useContext(HistoryContext);
  const groups = useMemo(()=>shared ?? groupAnnotations(snap), [shared, snap]);
  const key = taskId ? taskKey(taskId, itemId) : '';
  const entries = groups.get(key) ?? [];
  const personal = snap.collaboration?.taskAnnotations?.filter(note=>note.key===key && note.author===LOCAL_PRINCIPAL).at(-1);
  const editable = !!snap.collaboration?.tasks[key] && !snap.collaboration.tasks[key].archived;
  const [open,setOpen] = useState(false);
  if (!taskId && !entries.length) return null;
  return <details className="qd-annotation-history" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary><Icon name="message" size={14}/>{taskId ? personal ? '我的批注' : editable ? '写批注' : '相关记录' : '项目记录'}</summary>
    {open && <HistoryContents entries={entries} taskId={taskId} itemId={itemId} personal={personal}/>}
  </details>;
}
function HistoryContents({entries, taskId, itemId, personal}: {entries: AnnotationHistoryEntry[]; taskId?: string; itemId?: string; personal?: TaskAnnotationRevision}) {
  const anchor = useId();

  const { snap, openWorkspace, openTaskDirection, openProjectDirection, locateTask } = useWorkdeck();
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [state, setState] = useState('all');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');

  const filtered = filterAnnotationHistory(entries, query, kind, state, from, to);
  const [limit, setLimit] = useState(20);
  const [jumpId, setJumpId] = useState<string>();
  useEffect(() => {
    if (!jumpId) return;
    const node = document.getElementById(`${anchor}-${jumpId}`);
    node?.focus();
    node?.scrollIntoView({ block: 'center' });
    setJumpId(undefined);
  }, [jumpId]);
  const reset = () => { setQuery(''); setKind('all'); setState('all'); setFrom(''); setTo(''); setLimit(20); };
  const relation = (id?: string) => {
    if (!id) return;
    reset(); setLimit(entries.length);
    setJumpId(id);
  };
  return <div className="qd-annotation-body">
    {taskId && <TaskAnnotationEditor taskId={taskId} itemId={itemId} previous={personal}/>}
    {entries.length > 0 && <details className="qd-annotation-records" open={taskId ? undefined : true}>
    <summary>相关记录 · {entries.length} 条</summary>
    <AnnotationEvolution entries={entries} jump={relation} />
    {entries.length > 1 && <details className="qd-annotation-search"><summary>筛选记录</summary>
    <div className="qd-annotation-filters">
      <label>搜索<input value={query} onChange={e => setQuery(e.target.value)} placeholder="原文、对象或版本" /></label>
      <label>类型<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">全部类型</option>{Object.entries(kinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>记录状态<select value={state} onChange={e => setState(e.target.value)}><option value="all">全部状态</option>{Object.entries(states).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>起始日期（UTC）<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>结束日期（UTC）<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button type="button" className="qd-link" onClick={reset}>清除筛选</button>
    </div>
    </details>}
    {entries.length > 1 && <p role="status">{filtered.length} 条记录{from && to && from > to ? ' · 起始日期晚于结束日期' : ''}</p>}
    {entries.length > 0 && !filtered.length && <p>没有符合筛选的批注。</p>}
    {filtered.slice(0, limit).map(entry => <article id={`${anchor}-${entry.id}`} tabIndex={-1} key={entry.id}>
      <header><strong>{kinds[entry.kind]} · {entry.action ?? states[entry.state]}</strong><time dateTime={entry.at} title={entry.at}>{Number.isNaN(Date.parse(entry.at)) ? entry.at : new Date(entry.at).toLocaleString()}</time></header>
      <blockquote>{entry.text || '（未填写文字）'}</blockquote>
      <p>对象：{entry.object}<br />版本：{entry.version}</p>
      <div className="qd-annotation-actions">
        {entry.previousId && <button type="button" className="qd-link" onClick={() => relation(entry.previousId)}>查看修改前原文</button>}
        {entry.nextId && <button type="button" className="qd-link" onClick={() => relation(entry.nextId)}>查看后续修改 / 撤回</button>}
        {entry.taskId && snap.tasks[entry.taskId] ? <button type="button" className="qd-link" onClick={() => {
          if (entry.kind === 'review') openWorkspace(entry.taskId!, { view: 'results', selected: entry.itemId ?? null, focus: true });
          else if (entry.kind === 'discussion') void openTaskDirection(entry.taskId!, entry.itemId);
          else locateTask(entry.taskId!);
        }}>返回来源{entry.kind === 'review' ? '任务成果' : entry.kind === 'discussion' ? '方向' : '任务'}</button> : ((!entry.taskId && entry.object === '项目方向') || (entry.planId && snap.ideaPlans?.[entry.planId]?.scope === 'project')) ? <button type="button" className="qd-link" onClick={() => void openProjectDirection()}>返回项目方向</button> : <span>来源任务不可用，保留历史原文</span>}
      </div>
      <details><summary>来源标识与原版本内容</summary><p>{entry.sourceId}</p>{entry.sourceText ? <pre>{entry.sourceText}</pre> : <p>未保存独立来源正文；批注原文和版本标识见上。</p>}</details>
    </article>)}
    {filtered.length > limit && <button type="button" className="qd-link" onClick={() => setLimit(limit + 20)}>再显示 20 条</button>}
    </details>}
  </div>;
}
