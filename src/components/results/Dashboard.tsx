import { useEffect, useMemo, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { overviewForest, filterOverview, flattenOverview, type OverviewFilter, type OverviewNode } from '../../data/overviewTree';
import { OverviewTree } from './OverviewTree';
import { OverviewDetails } from './OverviewDetails';
import { Icon } from '../ui/Icon';
import { useResultResize } from './useResultResize';
import './dashboard.css';
import './overview-tree.css';

const FILTERS: [OverviewFilter, string][] = [['all', '全部'], ['running', '进行中'], ['attention', '待我处理'], ['done', '已完成']];

export function Dashboard({ onTasks, onResults, onDirection, onCreateProject, onEditProject }: {
  onTasks: () => void; onResults?: (projectId?: string, taskId?: string) => void | Promise<void>;
  onDirection?: (projectId: string, taskId?: string, itemId?: string) => void | Promise<void>;
  onCreateProject: () => void; onEditProject?: (id: string) => void;
}) {
  const resizeRef = useResultResize();
  const { snap, projectSnapshots, switchProject, openWorkspace, toast } = useWorkdeck();
  const [dimension, setDimension] = useState<'projects' | 'tasks'>('projects');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OverviewFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1099px)').matches);
  const [opening, setOpening] = useState(false);
  useEffect(() => { const media = window.matchMedia('(max-width: 1099px)'); const resize = () => { setCompact(media.matches); setDetailOpen(false); }; media.addEventListener('change', resize); return () => media.removeEventListener('change', resize); }, []);
  const snapshots = useMemo(() => new Map([...projectSnapshots, snap].filter(item => item.project.id).map(item => [item.project.id, item])), [projectSnapshots, snap]);
  const forest = useMemo(() => overviewForest([...snapshots.values()]), [snapshots]);
  const project = forest.find(node => node.projectId === snap.project.id) ?? forest[0];
  const roots = dimension === 'projects' ? forest : project?.children ?? [];
  const visible = useMemo(() => filterOverview(roots, query, filter), [roots, query, filter]);
  const visibleNodes = flattenOverview(visible);
  const selected = visibleNodes.find(node => node.key === selectedKey) ??
    (dimension === 'projects' ? visible.find(node => node.projectId === snap.project.id) : undefined) ?? visible[0];
  const fullNode = selected && flattenOverview(roots).find(node => node.key === selected.key);
  const totalTasks = forest.reduce((total, node) => total + node.children.length, 0);
  const needsAttention = forest.flatMap(node => node.children).filter(node => node.bucket === 'attention').length;
  const enter = async (node: OverviewNode, view?: 'plan' | 'tasks' | 'results') => {
    if (opening) return;
    setOpening(true);
    try {
      if (node.projectId !== snap.project.id && !(await switchProject(node.projectId))) return;
      setDetailOpen(false);
      if (view === 'plan' && onDirection) await onDirection(node.projectId, node.taskId, node.itemId);
      else if (view === 'results' && onResults) await onResults(node.projectId, node.taskId);
      else if (view && node.taskId) openWorkspace(node.taskId, { view, selected: node.itemId ?? null, itemId: node.itemId ?? null, scope: 'root', pane: view === 'plan' ? 'main' : node.itemId ? 'side' : 'main', focus: true });
      else onTasks();
    } catch (error) { toast(error instanceof Error ? error.message : '暂未能打开，请重试', 'error'); }
    finally { setOpening(false); }
  };
  const newTask = () => { onTasks(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('quandeck:new-task'))); };
  const changeDimension = (next: 'projects' | 'tasks') => { setDimension(next); setQuery(''); setFilter('all'); setSelectedKey(null); setDetailOpen(false); };
  return <main className="qd-overview qd-tree-overview" aria-busy={opening || undefined}>
    <header className="qd-overview-header"><div><p>{snap.dateLabel}</p><h1>{dimension === 'projects' ? '项目总览' : '任务总览'}</h1><span className="qd-goal-map-description">看清目标如何拆分，再进入每一项的方向与交付。</span></div><button type="button" className="qd-btn primary" onClick={dimension === 'projects' || !project ? onCreateProject : newTask}><Icon name="plus" size={16} />{dimension === 'projects' || !project ? '新建项目' : '新任务'}</button></header>
    <div className="qd-overview-controls"><nav className="qd-dashboard-dimensions" aria-label="总览维度"><button type="button" aria-pressed={dimension === 'projects'} onClick={() => changeDimension('projects')}><Icon name="folder" size={15} />项目</button><button type="button" aria-pressed={dimension === 'tasks'} onClick={() => changeDimension('tasks')}><Icon name="check-square" size={15} />任务</button></nav><label className="qd-overview-search"><Icon name="search" size={16} /><input type="search" aria-label="搜索项目与任务" placeholder="搜索项目或任务" value={query} onChange={event => { setQuery(event.target.value); setDetailOpen(false); }} />{query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><Icon name="close" size={14} /></button>}</label></div>
    <div className="qd-overview-scope"><div>{dimension === 'projects' ? <p><strong>{forest.length}</strong> 个项目<span>／</span><strong>{totalTasks}</strong> 项任务{needsAttention > 0 && <button type="button" onClick={() => setFilter('attention')}>{needsAttention} 项需要你</button>}</p> : <label><Icon name="folder" size={16} /><select aria-label="任务看板项目" value={project?.projectId ?? ''} onChange={event => { setSelectedKey(null); setDetailOpen(false); void switchProject(event.target.value); }}>{forest.map(node => <option key={node.projectId} value={node.projectId}>{node.title}</option>)}</select><span>{project?.children.length ?? 0} 项任务</span></label>}</div><nav aria-label="总览任务筛选">{FILTERS.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setDetailOpen(false); }}>{label}</button>)}</nav></div>
    <section ref={resizeRef} className="qd-overview-tree-layout" aria-label="事项层级与详情"><section className="qd-overview-tree-main" aria-label={dimension === 'projects' ? '项目总览' : '任务总览'}>
      {!!visible.length && <div className="qd-goal-map-legend" aria-label="目标分解层级"><strong>目标分解图</strong><span>项目目标<Icon name="arrow-right" size={12} />任务<Icon name="arrow-right" size={12} />子任务</span><small>实线表示拆分关系</small></div>}
      {visible.length ? <OverviewTree key={`${dimension}:${project?.projectId}:${query}:${filter}`} nodes={visible} snapshots={snapshots} currentProjectId={snap.project.id} selectedKey={selected?.key} dimension={dimension} filtered={!!query.trim() || filter !== 'all'} onSelect={node => { setSelectedKey(node.key); if (compact) setDetailOpen(true); }} /> : <div className="qd-overview-tree-empty"><Icon name={forest.length ? 'search' : 'folder'} size={30} /><h2>{query || filter !== 'all' ? '没有找到匹配的事项' : dimension === 'projects' ? '先给想做的事一个位置' : '从第一项任务开始'}</h2><p>{query || filter !== 'all' ? '换个关键词，或查看全部任务。' : '目标、任务和交付，会沿着同一条线慢慢展开。'}</p><button type="button" className="qd-btn ghost" onClick={query || filter !== 'all' ? () => { setQuery(''); setFilter('all'); } : dimension === 'projects' || !project ? onCreateProject : newTask}>{query || filter !== 'all' ? '清除筛选' : dimension === 'projects' || !project ? '新建项目' : '新任务'}</button></div>}
    </section>
    {fullNode && <OverviewDetails node={fullNode} snapshot={snapshots.get(fullNode.projectId)!} compact={compact} open={detailOpen} onClose={() => setDetailOpen(false)} onOpen={(node, view) => { void enter(node, view); }} onEnter={projectId => { const node = forest.find(item => item.projectId === projectId); if (node) void enter(node); }} onEditProject={onEditProject} />}
    </section>
  </main>;
}
