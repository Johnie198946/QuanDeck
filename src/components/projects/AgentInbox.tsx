import { useEffect, useMemo, useRef, useState } from 'react';
import { BlockedTaskMaterials } from '../deck/BlockedTaskMaterials';
import { blockedTaskSession } from '../../data/blockedTask';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { canRetryDispatch } from '../../data/dispatchRecovery';
import { resultExcerpt } from '../../data/resultExcerpt';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { NoteDelivery } from '../knowledge/NoteReceiptDetails';
import { Icon } from '../ui/Icon';
import { NoteDispatchTrail, type OpenNoteSource } from './NoteDispatchTrail';
import { inboxRows, type InboxFilter, type InboxRow } from './agentInboxData';
import type { ProjectBoardEntry } from './ProductProjects';
import './agent-inbox.css';

const filters = [['all','全部'],['running','执行中'],['returned','有成果'],['attention','需处理']] as const;
const dateFormat = new Intl.DateTimeFormat('zh-CN',{month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
function timestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '';
}
function matches(row: InboxRow, filter: InboxFilter) {
  return filter === 'all' || (filter === 'returned' ? row.results.length>0 : row.group === filter);
}

function TaskDetail({row,onOpenNote,onAttention}: {row:InboxRow; onOpenNote: OpenNoteSource; onAttention:(id:string)=>void}) {
  const {api,refreshProjects} = useWorkdeck();
  const runtime = api as typeof api & Partial<RuntimeCommands>;
  const [version,setVersion] = useState<string>();
  const current = row.results.find(entry=>entry.record.id===version) ?? row.results[0];
  const [busy,setBusy] = useState(false), [feedback,setFeedback] = useState('');
  const pending = useRef(false);
  async function retry() {
    if (pending.current) return;
    if (api.mode !== 'live' || !runtime.dispatchProjectTask) { setFeedback('请在桌面版连接 Agent 后再发送。'); return; }
    const {session,task,snapshot}=row;
    if (!canRetryDispatch(session) && !row.canDispatch) return;
    pending.current=true;
    setBusy(true);
    setFeedback('');
    try {
      const result = session ? await api.retryDispatch(session.id) :
        await runtime.dispatchProjectTask(snapshot.project.id,task.id,task.noteWork!.agentId);
      setFeedback(result.message || (result.ok?'已发给 '+row.agent:'发送失败，请重试'));
      await refreshProjects();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '暂时无法确认发送状态');
    } finally {
      pending.current=false;
      setBusy(false);
    }
  }
  return <section aria-label="任务详情" className="qi-detail">
    {row.problem && <p className="qi-problem"><Icon name="alert" size={15}/>{row.problem}</p>}
    {row.session && blockedTaskSession(row.snapshot,row.session) && <details className="qi-blocked-materials">
      <summary>补充材料并继续原任务</summary>
      <BlockedTaskMaterials key={row.session.id} snapshot={row.snapshot} session={row.session}/>
    </details>}
    {(row.attention || row.canDispatch || canRetryDispatch(row.session)) && <div className="qi-detail-actions">
      {(row.canDispatch || canRetryDispatch(row.session)) && <button type="button" className="qp-btn" disabled={busy} onClick={()=>void retry()}>{busy?'正在发送…':row.session?'重试发送':'发送给 '+row.agent}</button>}
      {row.attention && <button className="qi-link" type="button" onClick={()=>onAttention(row.attention!.id)}>{row.attention.action}<Icon name="arrow-right" size={13}/></button>}
    </div>}
    {feedback && <p role="status">{feedback}</p>}
    {current && <>
      <div className="qi-result-head"><h2>成果</h2>{row.results.length>1 && <label>查看记录 <select aria-label="选择成果记录" value={current.record.id} onChange={event=>setVersion(event.target.value)}>
        {row.results.map(entry=><option key={entry.record.id} value={entry.record.id}>{timestamp(entry.record.at)} · {entry.record.title}</option>)}
      </select></label>}</div>
      {current.record.title !== row.task.title && <h3>{current.record.title}</h3>}
      <NoteDelivery project={row.snapshot} taskId={row.task.id} entry={current}/>
    </>}
    {!current && !row.problem && <p className="qi-muted">{row.group==='running'?'结果会显示在这里。':'暂未收到成果。'}</p>}
    {row.task.inputs?.some(input=>input.noteSource) ? <details className="qi-source"><summary>原始需求</summary>
      <NoteDispatchTrail task={row.task} results={[]} onOpenNote={onOpenNote} onResult={()=>{}}/>
    </details> : row.task.originalTitle && row.task.originalTitle!==row.task.title && <details className="qi-source"><summary>原始需求</summary><p>{row.task.originalTitle}</p></details>}
  </section>;
}

export function AgentInbox({initial,onWriteNote,onOpenNote,onAttention,onTools}:{
  initial?: ProjectBoardEntry; onWriteNote:()=>void; onOpenNote:OpenNoteSource; onAttention:(id:string)=>void; onTools:()=>void;
}) {
  const {snap, projectSnapshots}=useWorkdeck();
  const rows = useMemo(()=>{
    const projects = new Map(projectSnapshots.map(s=>[s.project.id,s]));
    if (snap.project.id) projects.set(snap.project.id,snap);
    return inboxRows([...projects.values()]);
  },[snap,projectSnapshots]);
  const [filter,setFilter]=useState<InboxFilter>('all');
  const [opened,setOpened]=useState<string|undefined>(()=>initial?.taskId ? JSON.stringify([initial.projectId,initial.taskId]) : undefined);
  const targetRow = useRef<HTMLLIElement>(null);
  const reveal = useRef(Boolean(initial?.taskId));
  useEffect(() => {
    if (reveal.current && targetRow.current) {
      targetRow.current.scrollIntoView({block:'start'});
      reveal.current=false;
    }
  },[rows]);
  const visible = rows.filter(row=>matches(row,filter));
  return <main aria-label="Agent 任务收件箱" className="qi-inbox">
    <header className="qi-head"><div><h1>帮你管</h1><p>发给 Agent 的任务和成果</p></div>
      <div className="qi-head-actions"><button type="button" className="qi-link" onClick={onTools}><Icon name="folder" size={15}/>项目工具</button>
      <button type="button" className="qp-btn primary" onClick={onWriteNote}><Icon name="pencil" size={15}/>写需求</button></div>
    </header>
    <section className="qi-stream" aria-label="收到的任务">
      <nav className="qi-filters" aria-label="任务筛选">{filters.map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}<span>{rows.filter(row=>matches(row,key)).length}</span></button>)}</nav>
      {visible.length===0 && <div className="qi-empty"><Icon name="inbox" size={30}/><h2>{rows.length?'这里暂时没有任务':'还没有发给 Agent 的任务'}</h2>
        {!rows.length && <p>在「帮你记」选中需求，点纸飞机发送。</p>}</div>}
      <ul className="qi-list">{visible.map(row=>{
        const expanded = opened===row.key;
        const latest = row.results[0];
        const excerpt = latest && resultExcerpt(latest.record.text,85);
        return <li key={row.key} data-open={expanded} ref={expanded ? targetRow : undefined}><button type="button" className="qi-row" aria-expanded={expanded} onClick={()=>setOpened(expanded?undefined:row.key)}>
          <span className={'qi-status is-'+row.group}><i/>{row.status}</span>
          <span className="qi-row-body"><strong>{row.task.title}</strong><span className="qi-meta">{row.agent}<i/> {row.snapshot.project.name}</span>
            {!expanded && excerpt && <span className="qi-excerpt">{excerpt}</span>}</span>
          <time dateTime={row.at}>{timestamp(row.at)}</time><Icon name={expanded?'chevron-down':'chevron-right'} size={15}/>
        </button>
        {expanded && <TaskDetail row={row} onOpenNote={onOpenNote} onAttention={onAttention}/>}</li>;
      })}</ul>
    </section>
  </main>;
}
