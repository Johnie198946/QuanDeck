import { useId, useState, type KeyboardEvent } from 'react';
import type { OverviewNode } from '../../data/overviewTree';
import type { Snapshot } from '../../data/types';
import { overviewDependencies } from './overviewDependencies';
import { AgentLogo } from '../ui/AgentLogo';
import { Icon } from '../ui/Icon';
import { TaskIcon } from '../ui/TaskIcon';

export function OverviewTree({ nodes, snapshots, currentProjectId, selectedKey, dimension, filtered, onSelect }: {
  nodes: OverviewNode[]; snapshots: Map<string, Snapshot>; currentProjectId: string; selectedKey?: string;
  dimension: 'projects' | 'tasks'; filtered: boolean; onSelect: (node: OverviewNode) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const listId = useId();
  const isOpen = (node: OverviewNode) => expanded[node.key] ?? (filtered ||
    (dimension === 'projects' ? node.kind === 'project' && node.projectId === currentProjectId : node.kind === 'task' && node.bucket !== 'done'));
  const toggle = (node: OverviewNode, value = !isOpen(node)) => setExpanded(previous => ({ ...previous, [node.key]: value }));
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, node: OverviewNode) => {
    if (event.key === 'ArrowRight' && node.children.length && !isOpen(node)) { event.preventDefault(); toggle(node, true); }
    if (event.key === 'ArrowLeft' && node.children.length && isOpen(node)) { event.preventDefault(); toggle(node, false); }
  };
  const render = (node: OverviewNode, depth: number) => {
    const open = isOpen(node), selected = node.key === selectedKey, snapshot = snapshots.get(node.projectId)!;
    const agent = node.agentId ? snapshot.agents.find(item => item.id === node.agentId) : undefined;
    const childId = `${listId}-${encodeURIComponent(node.key)}`;
    const progress = node.progress;
    const execution = node.execution;
    const dependencies = overviewDependencies(snapshot, node);
    const measured = execution && execution.mode !== 'unknown' && execution.value !== undefined && execution.total;
    return <li key={node.key} className={`qd-outline-node kind-${node.kind} ${selected ? 'is-selected' : ''}`} data-overview-node={node.key}>
      <div className="qd-outline-row">
        {node.children.length ? <button type="button" className="qd-outline-toggle" aria-label={`${open ? '收起' : '展开'} ${node.title}`} aria-expanded={open} aria-controls={childId} onClick={() => toggle(node)}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /></button> : <span className="qd-outline-toggle is-leaf" aria-hidden="true"><i /></span>}
        <button type="button" className="qd-outline-select" aria-pressed={selected} onClick={() => onSelect(node)} onKeyDown={event => keyboard(event, node)} aria-label={`查看${node.kind === 'project' ? '项目' : '任务'} ${node.title}详情`}>
          <span className={`qd-outline-symbol ${node.kind === 'project' ? 'is-project' : ''}`}>{node.kind === 'project' ? <Icon name="folder" size={20} /> : <TaskIcon snapshot={snapshot} taskId={node.taskId!} workItemId={node.itemId} size={20} />}</span>
          <span className="qd-outline-title"><small className="qd-goal-level">{node.kind === 'project' ? '项目目标' : node.kind === 'task' ? '任务' : '子任务'}</small><strong>{node.title}</strong><span>{node.detached ? '层级待核对' : node.kind === 'project' ? node.description || `${node.children.length} 项任务` : node.phase || (node.kind === 'work' ? '子任务' : '任务')}{progress ? <small>{progress.done}/{progress.total} {progress.label}</small> : execution?.amount ? <small>{execution.amount}</small> : null}{dependencies.length > 0 && <small className="qd-goal-dependency">依赖 {dependencies.length} 项</small>}</span></span>
          <span className={`qd-outline-state state-${node.bucket}`}><i aria-hidden="true" />{node.state}</span>
          <span className="qd-outline-owner">{agent ? <AgentLogo agent={agent} size={20} label={agent.name} /> : node.owner === '我' ? <Icon name="user" size={17} /> : null}</span>
          {progress ? <span className="qd-outline-progress" role="img" aria-label={`${progress.label}完成 ${progress.done}/${progress.total}`}><span><i style={{ width: `${progress.done / progress.total * 100}%` }} /></span></span> : measured ? <span className="qd-outline-progress is-measured" role="img" aria-label={execution!.amount}><span><i style={{ width: `${execution!.value! / execution!.total! * 100}%` }} /></span></span> : execution?.state === 'flowing' ? <span className="qd-outline-progress is-working" role="img" aria-label={execution.label}><span><i /></span></span> : <span className="qd-outline-progress" />}
        </button>
      </div>
      {node.children.length > 0 && open && <ul id={childId} className={`qd-outline-children ${depth > 3 ? 'is-deep' : ''}`}>{node.children.map(child => render(child, depth + 1))}</ul>}
    </li>;
  };
  return <ul className="qd-overview-outline" aria-label={dimension === 'projects' ? '项目与任务层级' : '任务与子任务层级'}>{nodes.map(node => render(node, 0))}</ul>;
}
