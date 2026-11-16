import { useEffect, useRef } from 'react';
import type { OverviewNode } from '../../data/overviewTree';
import type { Snapshot } from '../../data/types';
import { completedResults, resultTime } from '../../data/results';
import { resultExcerpt } from '../../data/resultPresentation';
import { discussionSummary } from '../../data/discussionSnippets';
import { Icon } from '../ui/Icon';
import { AgentLogo } from '../ui/AgentLogo';
import { ProgressIndicator } from '../journal/RunProgress';
import { DeleteWorkButton } from '../projects/DeleteWorkButton';

export function OverviewDetails({ node, snapshot, compact, open, onClose, onOpen, onEnter, onEditProject }: {
  node: OverviewNode; snapshot: Snapshot; compact: boolean; open: boolean; onClose: () => void;
  onOpen: (node: OverviewNode, view: 'tasks' | 'results') => void;
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
  const results = (node.taskId ? completedResults(snapshot, node.taskId, node.itemId ?? null) : node.children.flatMap(child => completedResults(snapshot, child.taskId!, null).map(record => ({ ...record, taskId: child.taskId }))))
    .sort((a, b) => b.at.localeCompare(a.at));
  const latest = results[0];
  const content = <>
    <header className="qd-overview-detail-head"><span>{node.kind === 'project' ? '项目概况' : node.kind === 'work' ? '子任务详情' : '任务详情'}</span>{compact && <button type="button" className="qd-icon-btn" aria-label="关闭详情" onClick={onClose}><Icon name="close" size={17} /></button>}</header>
    <h2>{node.title}</h2>
    <div className="qd-overview-detail-meta"><span className={`qd-outline-state state-${node.bucket}`}><i aria-hidden="true" />{node.state}</span>{node.kind !== 'project' && node.phase && <span>{node.phase}</span>}{agent ? <span className="qd-overview-detail-agent"><AgentLogo agent={agent} size={18} />{agent.name}</span> : node.owner && <span>{node.owner}</span>}</div>
    {node.description && node.description !== node.title && <p className="qd-overview-goal">{resultExcerpt(node.description, 240)}</p>}
    {node.detached && <p className="qd-overview-attention-note">这项历史任务的上级关系需要核对，原始记录仍保留。</p>}
    {node.progress && <section className="qd-overview-detail-progress" aria-label={`${node.progress.label}完成情况`}><header><span>{node.progress.label}</span><strong>{node.progress.done}<small> / {node.progress.total}</small></strong></header><div role="progressbar" aria-label={`${node.progress.label}完成进度`} aria-valuenow={node.progress.done} aria-valuemin={0} aria-valuemax={node.progress.total}><i style={{ width: `${node.progress.done / node.progress.total * 100}%` }} /></div>{node.progress.done === node.progress.total && node.bucket !== 'done' && <p>分支已结束，等待汇总或验收。</p>}</section>}
    {node.execution && <section className="qd-overview-live"><ProgressIndicator progress={node.execution} agentName={agent?.name || 'Agent'} color={agent?.color || 'var(--qd-brand)'} compact /></section>}
    {node.detail && node.bucket === 'attention' && <section className="qd-overview-attention-note"><h3>需要处理</h3><p>{discussionSummary(node.detail)}</p></section>}
    <div className="qd-overview-detail-actions"><button type="button" className="qd-btn primary" onClick={() => node.kind === 'project' ? onEnter(node.projectId) : onOpen(node, 'tasks')}>{node.kind === 'project' ? '进入项目' : node.bucket === 'attention' ? '处理待办' : '打开任务详情'}<Icon name="arrow-right" size={15} /></button>{node.taskId && results.length > 0 && <button type="button" className="qd-link" onClick={() => onOpen(node, 'results')}>查看成果<Icon name="external" size={13} /></button>}</div>
    <section className="qd-overview-latest"><header><h3>最近成果</h3><span>{results.length ? `${results.length} 份` : ''}</span></header>{latest ? <button type="button" onClick={() => {
      const taskId = node.taskId || ('taskId' in latest ? latest.taskId as string : undefined);
      if (taskId) onOpen({ ...node, taskId, itemId: latest.itemId }, 'results');
    }}><Icon name="box" size={18} /><span><strong>{latest.title}</strong><p>{resultExcerpt(latest.text, 100)}</p><small>{resultTime(latest.at)}{latest.attachments?.length ? ` · ${latest.attachments.length} 个文件` : ''}</small></span><Icon name="chevron-right" size={14} /></button> : <p>完成后，交付内容会归集到这里。</p>}</section>
    <details className="qd-overview-manage"><summary>管理{node.kind === 'project' ? '项目' : '任务'}</summary><div>{node.kind === 'project' && onEditProject && <button type="button" className="qd-link" onClick={() => onEditProject(node.projectId)}><Icon name="pencil" size={14} />编辑项目</button>}<DeleteWorkButton projectId={node.projectId} taskId={node.taskId} workItemId={node.itemId} title={node.title} /><span>删除前会检查关联执行</span></div></details>
  </>;
  if (compact) return open ? <dialog ref={dialog} className="qd-overview-detail-sheet" aria-label={`${node.title}详情`} onCancel={event => { event.preventDefault(); onClose(); }}>{content}</dialog> : null;
  return <aside className="qd-overview-detail" aria-label="选中事项详情">{content}</aside>;
}
