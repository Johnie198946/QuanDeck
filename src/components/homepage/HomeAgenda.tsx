import { useId, useMemo, useState } from 'react';
import { taskKey } from '../../data/collaboration';
import { overviewProject, type OverviewNode } from '../../data/overviewTree';
import { dateDay, planningTask } from '../../data/projectPlanning';
import type { ProductAttention } from '../../data/productAttention';
import { taskCloseouts } from '../../data/taskCloseout';
import type { Snapshot } from '../../data/types';
import { Icon, type IconName } from '../ui/Icon';

const nextSteps: Record<ProductAttention['kind'], string> = {
  question: '打开对话，回答执行者的问题。', permission: '查看操作范围，决定是否允许。',
  decision: '查看方案，再确认采用哪种做法。', review: '打开交付物，对照要求验收。',
  blocked: '查看阻塞原因，补齐缺少的条件。', overdue: '查看未完成事项，调整交付安排。',
  stalled: '查看最近一步，确认是否需要介入。',
};
const symbols: Record<ProductAttention['kind'], IconName> = {
  question:'message', permission:'lock', decision:'bulb', review:'check-square', blocked:'alert', overdue:'clock', stalled:'clock',
};

function findScope(nodes: OverviewNode[], row: ProductAttention): OverviewNode | undefined {
  for (const node of nodes) {
    if (node.taskId !== row.taskId) continue;
    if (node.itemId === row.itemId) return node;
    const child = findScope(node.children, row);
    if (child) return child;
  }
}

function WorkDetails({ item, project, id, today }: { item: ProductAttention; project?: Snapshot; id: string; today: string }) {
  const overview = useMemo(() => project && overviewProject(project), [project]);
  const closings = useMemo(() => project && taskCloseouts(project), [project]);
  const node = overview && findScope(overview.children, item);
  const closeout = item.taskId && closings?.get(item.taskId);
  const scope = closeout ? item.itemId ? closeout.children.find(entry => entry.itemId === item.itemId) : closeout.root : undefined;
  const pending = node?.children.filter(child => child.bucket !== 'done' && child.bucket !== 'cancelled') ?? [];
  const completion = node?.progress;
  const run = node?.execution;
  const pct = completion?.total ? Math.round(completion.done / completion.total * 100)
    : run?.mode === 'percent' ? run.value : undefined;
  const taskRecord = project && item.taskId ? project.collaboration?.tasks[taskKey(item.taskId,item.itemId)] : undefined;
  const deadline = project && item.taskId ? dateDay(planningTask(project,item.taskId,item.itemId).end) : undefined;
  const day = dateDay(today);
  const left = deadline !== undefined && day !== undefined ? deadline - day : undefined;
  const dueSoon = left === 0 ? '今天截止' : left === 1 ? '明天截止' : undefined;
  const risk = taskRecord?.blockReason || scope?.remaining[0] ||
    (item.kind === 'overdue' || item.kind === 'stalled' ? item.detail : undefined) ||
    (dueSoon && pending.length ? dueSoon + '，还有 ' + pending.length + ' 项子任务未完成。' : undefined);
  return <div className="qh-work-details" id={id}>
    <div className="qh-detail-block"><h4>当前进展</h4>{pct !== undefined ? <>
      <div className="qh-progress-line"><progress max={100} value={pct} aria-label={completion ? '子任务完成比例' : '本轮执行进度'}/><b>{pct}%</b></div>
      <small>{completion ? completion.done + ' / ' + completion.total + ' 项子任务已完成' : '本轮执行进度'}</small>
    </> : <p>{scope?.artifactTitle ? '已提交「' + scope.artifactTitle + '」' : item.label}</p>}</div>
    {pending.length > 0 && <div className="qh-detail-block"><h4>剩余任务 <span>({pending.length})</span></h4><ul>
      {pending.slice(0,3).map(child => <li key={child.key}><span>{child.title}</span><small>{child.state}</small></li>)}
      {pending.length > 3 && <li>另有 {pending.length - 3} 项</li>}</ul></div>}
    <div className="qh-detail-block">{risk && <><h4>可能的风险</h4><p className="qh-risk">{risk}</p></>}
      <h4>下一步</h4><p>{nextSteps[item.kind]}</p></div>
  </div>;
}

function AgendaRow({ item, project, open, first, toggle, onAction, today }: {
  item: ProductAttention; project?: Snapshot; open: boolean; first: boolean; today: string; toggle: () => void; onAction: (id: string) => void;
}) {
  const id = useId();
  const plan = project && item.taskId ? planningTask(project,item.taskId,item.itemId) : undefined;
  const due = plan?.end;
  const summary = item.entry?.detail || (plan?.information?.trim() !== item.title.trim() && plan?.information) || item.detail;
  const date = due && new Date(due + 'T12:00:00');
  const dateLabel = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN',{month:'long',day:'numeric'}) : undefined;
  return <li className={open ? 'is-open' : ''}>
    <div className="qh-task-row">
      <Icon name={symbols[item.kind]} size={17}/>
      <div className="qh-task-copy"><div className="qh-task-title">
        <h3><button type="button" onClick={toggle} aria-expanded={open} aria-controls={id}>{item.title}</button></h3>
        <span className="qh-task-project">{project?.project.name}</span><span className="qh-task-badge">{item.label}</span>
        {dateLabel && <time dateTime={due}><Icon name="calendar" size={12}/>{dateLabel}</time>}
      </div><p>{summary}</p></div>
      <button type="button" className={'qh-action' + (first ? ' is-primary' : '')} onClick={() => onAction(item.id)}>{item.action}</button>
      <button type="button" className="qh-row-toggle" aria-expanded={open} aria-controls={id} aria-label={(open?'收起':'展开') + '「' + item.title + '」详情'} onClick={toggle}><Icon name="chevron-down" size={14}/></button>
    </div>
    {open && <WorkDetails item={item} project={project} id={id} today={today}/>}
  </li>;
}

export function HomeAgenda({ rows, projects, onAction, today }: { rows: ProductAttention[]; today: string; projects: Snapshot[]; onAction: (id: string) => void }) {
  const [picked, setPicked] = useState<string | null>();
  const open = picked === null ? undefined : rows.find(row => row.id === picked)?.id ?? rows[0]?.id;
  const byId = useMemo(() => new Map(projects.map(p => [p.project.id, p])), [projects]);
  return <ol className="qh-agenda">{rows.map((item,i) =>
    <AgendaRow key={item.id} item={item} project={byId.get(item.projectId)} open={open === item.id} first={i === 0} today={today}
      toggle={() => setPicked(open === item.id ? null : item.id)} onAction={onAction}/>)}</ol>;
}
