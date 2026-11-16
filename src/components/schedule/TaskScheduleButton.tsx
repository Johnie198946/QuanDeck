import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FormEvent } from 'react';
import { pathOf } from '../../data/orchestration';
import type { PlanItem } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import './schedule-editor.css';

export function TaskScheduleButton({ taskId, itemId, compact = false, projectId, date }: {
  taskId?: string; itemId?: string; compact?: boolean; projectId?: string; date?: string;
}) {
  const { snap, projectSnapshots } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const source = !projectId || projectId === snap.project.id ? snap : projectSnapshots.find(s => s.project.id === projectId) ?? snap;
  const linked = taskId && source.plans.find(p => !p.cancelled && p.taskId === taskId && p.workItemId === itemId && (p.date ?? source.date) === (date ?? snap.date));
  const title = itemId && taskId ? source.orchestrations?.[taskId]?.items[itemId]?.title : taskId ? source.tasks[taskId]?.title : '已有任务';
  return <>
    <button type="button" className={compact ? 'qd-icon-btn qd-schedule-trigger' : 'qd-text-btn qd-schedule-trigger'}
      aria-label={`${linked ? '调整日程' : '安排日程'}：${title}`} title={linked ? `${linked.start} · ${linked.minutes} 分钟，点击调整` : '安排到日程'}
      onClick={e => { e.stopPropagation(); setOpen(true); }}><Icon name="calendar" size={15}/>{!compact && <span>{linked ? linked.start : '安排任务'}</span>}</button>
    {open && createPortal(<TaskScheduleDialog initialTaskId={taskId} initialItemId={itemId} initialProjectId={projectId ?? snap.project.id} initialDate={date ?? snap.date} onClose={() => setOpen(false)}/>,document.body)}
  </>;
}

function TaskScheduleDialog({ initialTaskId, initialItemId, initialProjectId, initialDate, onClose }: {
  initialTaskId?: string; initialItemId?: string; initialProjectId: string; initialDate: string; onClose: () => void;
}) {
  const { snap, projectSnapshots, api, refreshProjects, toast } = useWorkdeck();
  const projects = [...projectSnapshots.filter(s => s.project.id !== snap.project.id), snap];
  const [projectId,setProjectId] = useState(initialProjectId);
  const source = projects.find(s => s.project.id === projectId) ?? snap;
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  const [taskId,setTaskId] = useState(initialTaskId ?? source.journal.blocks.find(b => b.kind === 'task')?.taskId ?? '');
  const [itemId,setItemId] = useState(initialItemId ?? '');
  const [date,setDate] = useState(initialDate);
  const existing = source.plans.find(p => !p.cancelled && p.taskId === taskId && (p.workItemId ?? '') === itemId && (p.date ?? source.date) === date);
  const [start,setStart] = useState(existing?.start ?? snap.now);
  const [minutes,setMinutes] = useState(existing?.minutes ?? source.tasks[taskId]?.estimate ?? 30);
  const [kind,setKind] = useState<PlanItem['kind']>(existing?.kind ?? 'flexible');
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const task = source.tasks[taskId]; const orchestration = source.orchestrations?.[taskId];
  const item = itemId ? orchestration?.items[itemId] : undefined;
  useEffect(() => { const trigger=document.activeElement as HTMLElement|null; const node=dialog.current; node?.showModal(); return () => {node?.close();trigger?.focus();}; },[]);
  const changeScope = (nextProject: string,nextTask: string,nextItem: string,nextDate=date) => {
    setProjectId(nextProject);setTaskId(nextTask);setItemId(nextItem);setDate(nextDate);setError('');
    const next=projects.find(s=>s.project.id===nextProject) ?? snap;
    const plan=next.plans.find(p=>!p.cancelled && p.taskId===nextTask && (p.workItemId??'')===nextItem && (p.date??next.date)===nextDate);
    setStart(plan?.start??snap.now);setMinutes(plan?.minutes??next.tasks[nextTask]?.estimate??30);setKind(plan?.kind??'flexible');
  };
  const submit = async(event:FormEvent) => {
    event.preventDefault();if(!task||busy)return;setBusy(true);setError('');
    try { await api.addPlan({taskId,...(itemId?{workItemId:itemId}:{}),title:item?.title??task.title,date,start,minutes,kind},projectId);await refreshProjects();toast(`已安排：${source.project.name} · ${date} ${start}`);onClose(); }
    catch(e){setError(e instanceof Error?e.message:'保存失败，请重试');}finally{setBusy(false);}
  };
  const cancelPlan = async() => {
    if(!existing||busy)return;setBusy(true);setError('');
    try{await api.removePlan(existing.id,projectId);await refreshProjects();toast('已取消安排，任务和实际记录保留');onClose();}
    catch(e){setError(e instanceof Error?e.message:'取消失败');setBusy(false);}
  };
  return <dialog ref={dialog} className="qd-schedule-dialog" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header><div><span className="qd-schedule-kicker">任务安排</span><h2 id={titleId}>{existing?'调整日程':'安排到日程'}</h2></div><button type="button" className="qd-icon-btn" aria-label="关闭日程安排" disabled={busy} onClick={onClose}><Icon name="close" size={18}/></button></header>
    <form onSubmit={submit}>
      <label>项目<select aria-label="日程项目" value={projectId} disabled={busy} onChange={e=>{const p=projects.find(s=>s.project.id===e.target.value)!;changeScope(p.project.id,p.journal.blocks.find(b=>b.kind==='task')?.taskId??'','');}}>{projects.map(s=><option key={s.project.id} value={s.project.id}>{s.project.name}</option>)}</select></label>
      <label><span className="qd-task-name">{taskId && <TaskIcon snapshot={source} taskId={taskId} workItemId={itemId || undefined} size={18}/>}关联任务</span><select aria-label="关联任务" value={taskId} onChange={e=>changeScope(projectId,e.target.value,'')} disabled={busy} required><option value="" disabled>选择任务</option>{source.journal.blocks.filter(b=>b.kind==='task').map(b=><option key={b.taskId} value={b.taskId}>{source.tasks[b.taskId]?.title}</option>)}</select></label>
      {orchestration && orchestration.itemOrder.length>0 && <label>安排范围<select aria-label="安排范围" value={itemId} onChange={e=>changeScope(projectId,taskId,e.target.value)} disabled={busy}><option value="">整个任务</option>{orchestration.itemOrder.map(id=>orchestration.items[id]).filter(Boolean).map(w=><option key={w.id} value={w.id}>{pathOf(orchestration,w.id).map(p=>p.title).join(' / ')}</option>)}</select></label>}
      <label>日期<input type="date" aria-label="日程日期" value={date} required disabled={busy} onChange={e=>changeScope(projectId,taskId,itemId,e.target.value)}/></label>
      <div className="qd-schedule-fields"><label>开始时间<input aria-label="开始时间" type="time" required value={start} onChange={e=>setStart(e.target.value)} disabled={busy}/></label><label>预计分钟<input aria-label="预计分钟" type="number" min={1} max={1440} required value={minutes} onChange={e=>setMinutes(Number(e.target.value))} disabled={busy}/></label><label>安排方式<select aria-label="安排方式" value={kind} onChange={e=>setKind(e.target.value as PlanItem['kind'])} disabled={busy}><option value="flexible">弹性</option><option value="fixed">固定</option></select></label></div>
      {existing && <p className="qd-schedule-explanation">保存会调整这一天的安排；切换日期可为同一任务另加一天。</p>}
      {error&&<p className="qd-dialog-error" role="alert">{error}</p>}{!task&&<p role="status">先在此项目添加任务，再安排时间。</p>}
      <footer>{existing&&<button type="button" className="qd-text-btn qd-schedule-cancel" disabled={busy} onClick={()=>void cancelPlan()}>取消此安排</button>}<button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>返回</button><button type="submit" className="qd-btn primary" disabled={busy||!task}>{busy?'保存中…':'保存安排'}</button></footer>
    </form>
  </dialog>;
}
