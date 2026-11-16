import { businessTasks } from '../../data/businessTasks';
import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Snapshot, WorkItem, Orchestration } from '../../data/types';
import { taskView, VIEW_LABEL } from '../../data/derive';
import { latestAttempt, WORK_LABEL, WORK_TONE } from '../../data/orchestration';
import { taskMapChildren, taskMapGroups, taskMapPath } from '../../data/taskMap';
import { Icon } from '../ui/Icon';
import { WorkIcon } from '../work/WorkStatus';
import { TaskTree } from './TaskTree';
import './task-map.css';

interface Props {
  snap: Snapshot;
  taskId: string;
  itemId?: string | null;
  onSelect: (taskId: string, itemId: string | null) => void;
}

function MiniRing({ done, total }: { done: number; total: number }) {
  return <span className="qd-map-ring" role="img" aria-label={`直属子任务 ${done}/${total} 已完成`}>
    <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" /><circle cx="24" cy="24" r="20" pathLength="100" strokeDasharray={`${total ? done / total * 100 : 0} 100`} /></svg>
    <span>{total ? Math.round(done / total * 100) : 0}<small>%</small></span>
  </span>;
}

function MapNode({ snap, item, orchestration, selected, onSelect, onDrill }: {
  snap: Snapshot; item: WorkItem; orchestration: Orchestration; selected: boolean; onSelect: () => void; onDrill: () => void;
}) {
  const children = taskMapChildren(orchestration, item.id);
  const step = latestAttempt(orchestration, item)?.step;
  const total = children.length || step?.total || 0;
  const done = children.length ? children.filter(child => child.status === 'done').length : Math.max(0, Math.min(total, step?.completed ?? 0));
  return <article className={`qd-map-node tone-${WORK_TONE[item.status]} ${selected ? 'is-selected' : ''}`} data-map-node={item.id}>
    <button type="button" className="qd-map-node-select" aria-label={`查看 ${item.title}，${WORK_LABEL[item.status]}`} aria-pressed={selected} onClick={onSelect}>
      <span className="qd-map-node-state"><WorkIcon status={item.status} size={13} />{WORK_LABEL[item.status]}</span>
      <strong className="qd-task-name"><TaskIcon snapshot={snap} taskId={orchestration.taskId} workItemId={item.id} size={20} /><span>{item.title}</span></strong>
      {total > 0 && <span className="qd-map-node-progress"><span aria-hidden="true"><i style={{ width: `${done / total * 100}%` }} /></span><small>{done}/{total} {children.length ? '子任务' : '步'}</small></span>}
      {!total && <span className="qd-map-node-caption">{item.status === 'done' ? '任务已完成' : item.owner === 'me' ? '由我完成' : item.status === 'blocked' ? `${item.dependsOnTaskIds.length} 项前置` : item.waiting?.kind === 'permission' ? '需要授权' : item.status === 'waiting_reply' ? '需要你的决定' : '查看方法与结果'}</span>}
    </button>
    {children.length > 0 && <button type="button" className="qd-map-drill" aria-label={`展开 ${item.title} 的 ${children.length} 个子任务`} onClick={onDrill}>进入分支<Icon name="arrow-right" size={12} /></button>}
  </article>;
}

/** A focused parent and its direct children keep the map readable at any depth. */
export function TaskMap({ snap, taskId, itemId = null, onSelect }: Props) {
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [focus, setFocus] = useState(taskId);
  const [edges, setEdges] = useState<{ id: string; path: string }[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const rootNode = useRef<HTMLButtonElement>(null);
  const selectId = useId();
  const task = snap.tasks[taskId];
  const orchestration = snap.orchestrations?.[taskId];
  const parent = orchestration?.items[focus];
  const currentFocus = parent ? parent.id : taskId;
  const children = orchestration ? taskMapChildren(orchestration, currentFocus) : [];
  const groups = orchestration ? taskMapGroups(orchestration, children) : [];
  const path = orchestration && parent ? taskMapPath(orchestration, parent.id) : [];
  const done = children.filter(item => item.status === 'done').length;
  const selected = itemId ? orchestration?.items[itemId] : null;
  const title = parent?.title ?? task?.title ?? '选择任务';
  const state = parent ? WORK_LABEL[parent.status] : task ? VIEW_LABEL[taskView(snap, task)] : '';
  const focusSelected = parent ? itemId === parent.id : !itemId;

  useEffect(() => { setFocus(taskId); }, [taskId]);
  useEffect(() => {
    if (!itemId) { setFocus(taskId); return; }
    if (!orchestration || !selected) return;
    if (selected.id !== currentFocus && selected.parentTaskId !== currentFocus) setFocus(selected.parentTaskId);
  }, [taskId, itemId, selected?.parentTaskId, currentFocus, orchestration]);

  useLayoutEffect(() => {
    if (mode !== 'map' || !canvas.current) return;
    const node = canvas.current;
    const measure = () => {
      if (!rootNode.current) return;
      const bounds = node.getBoundingClientRect();
      const root = rootNode.current.getBoundingClientRect();
      const startX = root.left - bounds.left + root.width / 2;
      const startY = root.bottom - bounds.top;
      const next = [...node.querySelectorAll<HTMLElement>('[data-map-node]')].map(child => {
        const rect = child.getBoundingClientRect();
        const x = rect.left - bounds.left + rect.width / 2;
        const y = rect.top - bounds.top;
        const midY = y - 12;
        return { id: child.dataset.mapNode!, path: `M ${startX} ${startY} V ${midY} H ${x} V ${y}` };
      });
      setEdges(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.querySelectorAll<HTMLElement>('[data-map-node]').forEach(child => observer.observe(child));
    measure();
    return () => observer.disconnect();
  }, [currentFocus, taskId, mode, children.map(item => item.id).join('|')]);

  const drill = (id: string) => { setFocus(id); onSelect(taskId, id === taskId ? null : id); };
  if (!task) return <p className="qd-result-empty">选择一个主任务查看地图。</p>;
  return <div className="qd-task-map">
    <div className="qd-map-tools">
      <label htmlFor={selectId} className="qd-map-task-switch"><TaskIcon snapshot={snap} taskId={taskId} size={18} /><select id={selectId} aria-label="切换主任务" value={taskId} onChange={event => { setFocus(event.target.value); onSelect(event.target.value, null); }}>{businessTasks(snap).map(root => <option key={root.id} value={root.id}>{root.title}</option>)}</select></label>
      <div className="qd-map-view-switch" role="group" aria-label="任务视图"><button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>地图</button><button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>列表</button></div>
    </div>
    {mode === 'list' ? <TaskTree snap={snap} taskId={taskId} itemId={itemId} onSelect={onSelect} /> : <>
      {parent && <nav className="qd-map-breadcrumb" aria-label="当前任务层级"><button type="button" onClick={() => drill(taskId)}>主任务</button>{path.map(item => <span key={item.id}><Icon name="chevron-right" size={11} /><button type="button" aria-current={item.id === currentFocus ? 'location' : undefined} title={item.title} onClick={() => drill(item.id)}>{item.title}</button></span>)}</nav>}
      <div className="qd-map-canvas" ref={canvas}>
        <svg className="qd-map-edges" aria-hidden="true">{edges.map(edge => <path key={edge.id} d={edge.path} className={edge.id === itemId ? 'is-selected' : ''} />)}</svg>
        <button type="button" ref={rootNode} className={`qd-map-focus ${focusSelected ? 'is-selected' : ''}`} aria-pressed={focusSelected} onClick={() => onSelect(taskId, parent?.id ?? null)}>
          <span><small>{parent ? '当前分支' : '主任务'}<b>{state}</b></small><strong className="qd-task-name"><TaskIcon snapshot={snap} taskId={taskId} workItemId={parent?.id} size={24} /><span>{title}</span></strong><em>{children.length ? `${done} / ${children.length} 直属子任务完成` : '尚未拆分子任务'}</em></span>
          {children.length > 0 && <MiniRing done={done} total={children.length} />}
        </button>
        {orchestration && groups.map((group, index) => <section className="qd-map-phase" key={group.phase} aria-label={`${group.phase || '未分组'}阶段`}>
          <header><h3><span>{String(index + 1).padStart(2, '0')}</span>{group.phase || '未分组'}</h3><div role="img" aria-label={`${group.phase || '未分组'} ${group.items.filter(item => item.status === 'done').length}/${group.items.length} 完成`}><span>{group.items.filter(item => item.status === 'done').length}/{group.items.length}</span><i>{group.items.map(item => <b className={`tone-${WORK_TONE[item.status]}`} key={item.id} />)}</i></div></header>
          <div className="qd-map-node-grid">{group.items.map(item => <MapNode key={item.id} snap={snap} item={item} orchestration={orchestration} selected={itemId === item.id} onSelect={() => onSelect(taskId, item.id)} onDrill={() => drill(item.id)} />)}</div>
        </section>)}
        {!children.length && <div className="qd-map-no-children"><Icon name="check-square" size={22} /><p>{parent ? '这就是当前分支的末级任务' : '这项任务还没有拆分'}</p><button type="button" className="qd-link" onClick={() => onSelect(taskId, parent?.id ?? null)}>查看任务方法与结果<Icon name="arrow-right" size={13} /></button></div>}
      </div>
      {children.length > 0 && <p className="qd-map-legend"><span><i />已完成</span><span><i />执行中</span><span><i />待处理</span><span>连线表示上下级</span></p>}
    </>}
  </div>;
}
