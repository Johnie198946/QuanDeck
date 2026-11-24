import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { taskKey } from '../../data/collaboration';
import { dateDay, dayText, ganttColumns, planningTask, shiftPlannedTask, type GanttScale, type PlannedTask } from '../../data/projectPlanning';
import type { OverviewNode } from '../../data/overviewTree';
import type { Snapshot } from '../../data/types';
import { Icon } from '../ui/Icon';

export interface ProjectTreeRow { node: OverviewNode; snapshot: Snapshot; depth: number }
interface Edit { row: ProjectTreeRow; previous: PlannedTask; next: PlannedTask }
interface Drag { edit: Edit; startX: number; startingDay: number; edge: 'start' | 'move' | 'end'; bounds: DOMRect }

const scaleNames: [GanttScale,string][] = [['day','日'],['week','周'],['month','月']];

function dependencyEffects(row: ProjectTreeRow, next: PlannedTask) {
  const {snapshot,node} = row;
  const ledger = snapshot.collaboration?.tasks ?? {};
  const ownKey = taskKey(node.taskId!,node.itemId);
  const own = ledger[ownKey];
  return Object.values(ledger).filter(other=>other.key!==ownKey && !other.archived).flatMap(other=>{
    const range = planningTask(snapshot,other.taskId,other.workItemId);
    if(other.dependencies.includes(ownKey) && range.start && next.end && range.start<=next.end)
      return ['「'+other.title+'」已排在本任务完成之前'];
    if(own?.dependencies.includes(other.key) && range.end && next.start && next.start<=range.end)
      return ['前置任务「'+other.title+'」尚未排完'];
    return [];
  });
}

export function ProjectGantt({rows,select,tree,openEditor,save,day,crossProject,onCrossProject,selectedKey}: {
  rows:ProjectTreeRow[]; select:(row:ProjectTreeRow)=>void; tree:(row:ProjectTreeRow)=>ReactNode;
  openEditor:(row:ProjectTreeRow)=>void; save:(row:ProjectTreeRow,value:PlannedTask,expected:PlannedTask)=>Promise<boolean>; day:string;
  crossProject:boolean; onCrossProject:(mode:boolean)=>void; selectedKey?:string;
}) {
  const [scale,setScale]=useState<GanttScale>('week'),[offset,setOffset]=useState(0);
  const [pending,setPending]=useState<Edit>(),[undo,setUndo]=useState<Edit>(),[preview,setPreview]=useState<Edit>();
  const [saving,setSaving]=useState(false);
  const drag=useRef<Drag|undefined>(undefined);
  const moved=useRef(false);
  const today=dateDay(day) ?? Math.floor(Date.now()/86400000);
  const columns=ganttColumns(today,scale,offset);
  const first=columns[0].start, last=columns.at(-1)!.end, span=last-first;
  const width=Math.max(560,columns.length*62);
  const fmt=(value?:string)=>value?value.slice(5).replace('-','/'):'';
  const dependency= pending ? dependencyEffects(pending.row,pending.next) : [];
  const atX=(x:number,bounds:DOMRect)=>Math.round(first+(x-bounds.x)/bounds.width*span);
  const begin=(event:PointerEvent<HTMLElement>,row:ProjectTreeRow,value:PlannedTask,edge:Drag['edge'])=>{
    moved.current=false;
    if (saving || event.button!==0 || value.start===undefined || value.end===undefined) return;
    const track=event.currentTarget.closest('.qp-track')?.getBoundingClientRect();
    if(!track?.width)return;
    event.stopPropagation(); select(row);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={edit:{row,previous:value,next:value},bounds:track,edge,startX:event.clientX,startingDay:atX(event.clientX,track)};
  };
  const move=(event:PointerEvent<HTMLElement>)=>{
    if(!drag.current)return;
    const {bounds,startingDay,edit,edge}=drag.current;
    const delta=atX(event.clientX,bounds)-startingDay;
    setPreview({...edit,next:shiftPlannedTask(edit.previous,delta,edge)});
  };
  const finish=(event:PointerEvent<HTMLElement>)=>{
    if(!drag.current)return;
    const {bounds,startingDay,edit,edge}=drag.current;
    const next=shiftPlannedTask(edit.previous,atX(event.clientX,bounds)-startingDay,edge);
    drag.current=undefined;setPreview(undefined);
    moved.current=next.start!==edit.previous.start||next.end!==edit.previous.end;
    if(moved.current)setPending({...edit,next});
  };
  const openOnClick=(event:{detail:number},row:ProjectTreeRow)=>{if(event.detail===0||!moved.current)openEditor(row);};
  const pointer={onPointerMove:move,onPointerUp:finish,onPointerCancel:()=>{drag.current=undefined;setPreview(undefined);}};
  const commit=async(edit:Edit,revert=false)=>{
    setSaving(true);
    try {if(await save(edit.row,revert?edit.previous:edit.next,revert?edit.next:edit.previous)){
      setPending(undefined);setUndo(revert?undefined:edit);
    }} finally {setSaving(false);}
  };
  return <div className="qp-gantt">
    <div className="qp-gantt-controls qp-actions">
      <div className="qp-segments" aria-label="时间范围">{scaleNames.map(([key,label])=><button type="button" key={key} aria-pressed={scale===key} onClick={()=>{setScale(key);setOffset(0);}}>{label}</button>)}</div>
      <button type="button" className="qp-icon" aria-label="上一段时间" onClick={()=>setOffset(offset-1)}><Icon name="chevron-left" size={15}/></button>
      <span>{fmt(dayText(first))}–{fmt(dayText(last-1))}</span>
      <button type="button" className="qp-icon" aria-label="下一段时间" onClick={()=>setOffset(offset+1)}><Icon name="chevron-right" size={15}/></button>
      <button type="button" className="qp-btn" onClick={()=>setOffset(0)}>今天</button>
      <button type="button" className="qp-btn" disabled={!undo||saving} onClick={()=>undo&&void commit(undo,true)}><Icon name="undo" size={14}/>撤销排期</button>
      <label className="qp-cross"><input type="checkbox" checked={crossProject} onChange={event=>onCrossProject(event.target.checked)}/>所有项目</label>
    </div>
    {pending && <div className="qp-schedule-change" role="status">
      <strong>{pending.row.node.title}</strong><span>{pending.next.start} 至 {pending.next.end}</span>
      {dependency.length > 0 && <ul>{dependency.map(item=><li key={item}>{item}</li>)}</ul>}
      <button type="button" className="qp-btn primary" disabled={saving} onClick={()=>void commit(pending)}>确认排期</button>
      <button type="button" className="qp-btn" disabled={saving} onClick={()=>setPending(undefined)}>取消</button>
    </div>}
    <div className="qp-gantt-scroll" tabIndex={0} aria-label="甘特图，可滚动">
      <div className="qp-gantt-grid" style={{minWidth:width+218}}>
        <div className="qp-gantt-label qp-gantt-head">任务</div><div className="qp-gantt-dates qp-gantt-head">
          {columns.map(col=><span key={col.start} style={{flexGrow:col.end-col.start}}>{col.label}</span>)}
          {today>=first&&today<last&&<b className="qp-today" style={{left:((today-first)/span)*100+'%'}}>今天</b>}
        </div>
        {rows.map(row=>{
          const {node,snapshot}=row;
          const value=preview?.row.node.key===node.key?preview.next:planningTask(snapshot,node.taskId ?? '',node.itemId);
          const a=dateDay(value.start),z=dateDay(value.end);
          const p=a===undefined ? z : a;
          const q=z===undefined ? a : z;
          const left=p===undefined ? undefined : Math.max(first,p);
          const max=q===undefined ? undefined : Math.min(last,q+1);
          const intersects=left!==undefined && max!==undefined && max>left;
          const inRange=today>=first&&today<last;
          return <div key={node.key} className={'qp-gantt-row'+(node.key===selectedKey?' is-picked':'')}>
            <div className="qp-gantt-label">{tree(row)}</div><div className="qp-track">
              {columns.map(col=><i aria-hidden="true" key={col.start} style={{left:(col.start-first)/span*100+'%'}}/>)}
              {inRange&&<i className="qp-today-line" aria-hidden="true" style={{left:(today-first)/span*100+'%'}}/>}
              {node.taskId && (intersects ? <div className={'qp-bar '+node.bucket} style={{left:(left!-first)/span*100+'%',width:(max!-left!)/span*100+'%'}}>
                {a!==undefined&&z!==undefined&&p!>=first&&<button className="qp-bar-edge start" type="button" aria-label={'调整开始时间 '+node.title} onClick={event=>openOnClick(event,row)} onPointerDown={event=>begin(event,row,value,'start')} {...pointer}/>}
                <button type="button" className="qp-bar-body" onClick={()=>select(row)} onDoubleClick={()=>openEditor(row)} onPointerDown={event=>begin(event,row,value,'move')} {...pointer} title={node.title+' · '+(value.start||value.end)+(value.start&&value.end?' 至 '+value.end:'')}>{value.milestone&&<Icon name="pin" size={12}/>}{node.title}</button>
                {a!==undefined&&z!==undefined&&q!<last&&<button className="qp-bar-edge end" type="button" aria-label={'调整结束时间 '+node.title} onClick={event=>openOnClick(event,row)} onPointerDown={event=>begin(event,row,value,'end')} {...pointer}/>}
              </div> : <button type="button" className="qp-quiet qp-missing-date" onClick={()=>openEditor(row)}>{p===undefined?'设定日期':'在当前日期范围外'}</button>)}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
