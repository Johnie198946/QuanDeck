import { deriveProjectActivity } from '../../data/projectActivity';
import { workItemPresentation } from '../../data/workItemPresentation';
import { taskExecutionPresentation } from '../../data/taskExecutionPresentation';
import { businessTasks } from '../../data/businessTasks';
import { DeleteWorkButton } from "../projects/DeleteWorkButton";
import { TaskIcon } from "../ui/TaskIcon";
import { useState } from "react";
import { childrenOf, topItems, summarize } from "../../data/orchestration";
import { taskView, VIEW_LABEL } from "../../data/derive";
import type { Orchestration, Snapshot, WorkItem } from "../../data/types";
import { Icon } from "../ui/Icon";
import { WorkIcon } from "../work/WorkStatus";

export function TaskTree({ snap, taskIds, taskId, itemId, onSelect }: {
  snap: Snapshot; taskIds?: string[]; taskId?: string; itemId?: string | null;
  onSelect: (taskId: string, itemId: string | null) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const tasks = businessTasks(snap);
  const activity = deriveProjectActivity(snap).entries;
  const roots = taskIds ? taskIds.flatMap(id => tasks.filter(task => task.id === id)) : tasks;
  const isOpen = (id: string) => open[id] ?? id === taskId;
  const toggle = (id: string) => setOpen(previous => ({ ...previous, [id]: !isOpen(id) }));
  const child = (o: Orchestration, item: WorkItem, ancestors: string[]): React.ReactNode => {
    if (ancestors.includes(item.id)) return null;
    const display = workItemPresentation(snap, o, item, activity), state = display.state;
    const kids = childrenOf(o, item.id);
    const expanded = open[item.id] ?? true;
    return <li key={item.id} className="qd-result-tree-child">
      <div className={`qd-result-tree-row ${taskId === o.taskId && itemId === item.id ? "is-selected" : ""}`}>
        {kids.length ? <button type="button" className="qd-result-fold" aria-label={`${expanded ? "收起" : "展开"}${item.title}`} aria-expanded={expanded} onClick={() => setOpen(previous => ({ ...previous, [item.id]: !expanded }))}><Icon name={expanded ? "chevron-down" : "chevron-right"} size={13} /></button> : <span className="qd-result-fold" />}
        <button type="button" className="qd-result-tree-select" aria-pressed={taskId === o.taskId && itemId === item.id} onClick={() => onSelect(o.taskId, item.id)}>
          <WorkIcon status={state} size={14} /><span><strong className="qd-task-name"><TaskIcon snapshot={snap} taskId={o.taskId} workItemId={item.id} size={18} /><span>{item.title}</span></strong><small>{display.label}</small></span>
        </button>
        <DeleteWorkButton projectId={snap.project.id} taskId={o.taskId} workItemId={item.id} title={item.title} />
      </div>
      {kids.length > 0 && expanded && <ul>{kids.map(kid => child(o, kid, [...ancestors, item.id]))}</ul>}
    </li>;
  };
  return <ul className="qd-result-tree" aria-label="主任务与子任务">
    {roots.map(task => {
      const o = snap.orchestrations?.[task.id];
      const children = o ? topItems(o) : [];
      const sum = o && children.length ? summarize(snap, o) : null;
      const attention = taskExecutionPresentation(snap, task.id).attention;
      const label = attention.length ? attention.map(item => item.label).join(" · ") : sum?.overall.label;
      return <li key={task.id} className="qd-result-tree-root">
        <div className={`qd-result-tree-row ${taskId === task.id && !itemId ? "is-selected" : ""}`}>
          {children.length ? <button type="button" className="qd-result-fold" aria-label={`${isOpen(task.id) ? "收起" : "展开"}${task.title}的子任务`} aria-expanded={isOpen(task.id)} onClick={() => toggle(task.id)}><Icon name={isOpen(task.id) ? "chevron-down" : "chevron-right"} size={14} /></button> : <span className="qd-result-fold" />}
          <button type="button" className="qd-result-tree-select" aria-pressed={taskId === task.id && !itemId} onClick={() => onSelect(task.id, null)}>
            <TaskIcon snapshot={snap} taskId={task.id} size={20} /><span><strong>{task.title}</strong><small>{task.completion ? "已完成" : sum ? `一级子任务 ${sum.done}/${sum.total} 完成 · ${label}` : VIEW_LABEL[taskView(snap, task)]}</small></span>
          </button>
          <DeleteWorkButton projectId={snap.project.id} taskId={task.id} title={task.title} />
        </div>
        {o && children.length > 0 && isOpen(task.id) && <ul>{children.map(item => child(o, item, []))}</ul>}
      </li>;
    })}
    {!roots.length && <li className="qd-result-empty">还没有任务。先在任务页记录一件事。</li>}
  </ul>;
}
