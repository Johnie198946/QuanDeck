import { TaskProgressTrail } from '../journal/TaskProgressTrail';
import { useEffect, useRef } from 'react';
import type { OverviewNode } from '../../data/overviewTree';
import type { Snapshot } from '../../data/types';
import { resultExcerpt } from '../../data/resultPresentation';
import { discussionSummary } from '../../data/discussionSnippets';
import { overviewDependencies } from './overviewDependencies';
import { Icon } from '../ui/Icon';
import { AgentLogo } from '../ui/AgentLogo';
import { ProgressIndicator } from '../journal/RunProgress';
import { DeleteWorkButton } from '../projects/DeleteWorkButton';

export function OverviewDetails({ node, snapshot, compact, open, onClose, onOpen, onEnter, onEditProject }: {
  node: OverviewNode; snapshot: Snapshot; compact: boolean; open: boolean; onClose: () => void;
  onOpen: (node: OverviewNode, view: 'plan' | 'tasks' | 'results') => void;
  onEnter: (projectId: string) => void; onEditProject?: (projectId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!compact || !open) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, [compact, open]);
  const agent = snapshot.agents.find(agent => agent.id === node.agentId);
  const dependencies = overviewDependencies(snapshot, node);
  const content = <>
    <header className="qd-overview-detail-head"><span>{node.kind === 'project' ? '项目概况' : node.kind === 'work' ? '子任务详情' : '任务详情'}</span>{compact && <button type="button" className="qd-icon-btn" aria-label="关闭详情" onClick={onClose}><Icon name="close" size={17} /></button>}</header>
    <h2>{node.title}</h2>
    <div className="qd-overview-detail-meta"><span className={`qd-outline-state state-${node.bucket}`}><i aria-hidden="true" />{node.state}</span>{node.kind !== 'project' && node.phase && <span>{node.phase}</span>}{agent ? <span className="qd-overview-detail-agent"><AgentLogo agent={agent} size={18} />{agent.name}</span> : node.owner && <span>{node.owner}</span>}</div>
    {node.description && node.description !== node.title && <p className="qd-overview-goal">{resultExcerpt(node.description, 240)}</p>}
    {node.detached && <p className="qd-overview-attention-note">这项历史任务的上级关系需要核对，原始记录仍保留。</p>}
    <TaskProgressTrail snapshot={snapshot} scope={{ taskId: node.taskId, workItemId: node.itemId }} compact />
    {node.execution && <section className="qd-overview-live"><ProgressIndicator progress={node.execution} agentName={agent?.name || 'Agent'} color={agent?.color || 'var(--qd-brand)'} compact /></section>}
    {node.detail && node.bucket === 'attention' && <section className="qd-overview-attention-note"><h3>{node.awaitingReview ? '待验收' : '需要处理'}</h3><p>{discussionSummary(node.detail)}</p></section>}
    {!!dependencies.length && <section className="qd-overview-dependencies"><h3>开始前需要</h3><ul>{dependencies.map((title,index) => <li key={index}><Icon name="arrow-right" size={12} />{title}</li>)}</ul></section>}
    <div className="qd-overview-detail-actions"><button type="button" className="qd-btn primary" onClick={() => onOpen(node, 'plan')}>方向方案<Icon name="arrow-right" size={15} /></button><button type="button" className="qd-link" onClick={() => node.kind === 'project' ? onEnter(node.projectId) : onOpen(node, node.awaitingReview ? 'results' : 'tasks')}>{node.kind === 'project' ? '进入任务工作台' : node.awaitingReview ? '查看待验收成果' : node.bucket === 'attention' ? '处理待办' : '打开任务详情'}</button></div>
    <button type="button" className="qd-overview-delivery-link" onClick={() => onOpen(node, 'results')}><Icon name="box" size={18} /><span><strong>进入成果地图</strong><small>{node.kind === 'project' ? '查看项目与各任务的交付' : '查看这项任务的交付内容'}</small></span><Icon name="arrow-right" size={15} /></button>
    <details className="qd-overview-manage"><summary>管理{node.kind === 'project' ? '项目' : '任务'}</summary><div>{node.kind === 'project' && onEditProject && <button type="button" className="qd-link" onClick={() => onEditProject(node.projectId)}><Icon name="pencil" size={14} />编辑项目</button>}<DeleteWorkButton projectId={node.projectId} taskId={node.taskId} workItemId={node.itemId} title={node.title} /><span>删除前会检查关联执行</span></div></details>
  </>;
  if (compact) return open ? <dialog ref={dialog} className="qd-overview-detail-sheet" aria-label={`${node.title}详情`} onCancel={event => { event.preventDefault(); onClose(); }}>{content}</dialog> : null;
  return <aside className="qd-overview-detail" aria-label="选中事项详情">{content}</aside>;
}
