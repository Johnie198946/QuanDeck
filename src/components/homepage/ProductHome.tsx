import { useMemo, useState, type ReactNode } from 'react';
import { overviewProject } from '../../data/overviewTree';
import type { ProductAttention } from '../../data/productAttention';
import type { Snapshot } from '../../data/types';
import { Icon, type IconName } from '../ui/Icon';
import './product-home.css';

interface Props {
  projects: Snapshot[];
  attention: ProductAttention[];
  discoveries: { id: string; title: string; noteId: string }[];
  onOpenProject: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenMonitor: (id: string) => void;
  onCreateProject: () => void;
}
export function ProductHome({ projects, attention, discoveries, onOpenProject, onOpenNote, onOpenMonitor, onCreateProject }: Props) {
  const [expanded, setExpanded] = useState<string>();
  const ordered = useMemo(() => [...attention].sort((a,b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent))), [attention]);
  const progress = useMemo(() => projects.map(overviewProject), [projects]);
  const panels: { id: string; name: string; icon: IconName; body: ReactNode }[] = [
    { id: 'attention', name: '现在需要处理', icon: 'inbox', body: <>
      {attention.length ? <ul className="qd-home-rows">{(expanded ? ordered : ordered.slice(0, 3)).map(row => <li key={row.id}>
        <div><strong>{row.title}</strong><p>{projects.find(project => project.project.id === row.projectId)?.project.name} · {row.detail}</p></div>
        <button className="qd-btn ghost" type="button" onClick={() => onOpenMonitor(row.id)}>{row.action}</button>
      </li>)}</ul> : <p className="qd-home-empty">目前没有需要你处理的事。</p>}
    </> },
    ...(discoveries.length ? [{
      id: 'insights', name: '新发现', icon: 'bulb' as const,
      body: <ul className="qd-home-rows">{(expanded ? discoveries : discoveries.slice(0, 1)).map(item => <li key={item.id}>
        <strong>{item.title}</strong><button className="qd-btn ghost" type="button" onClick={() => onOpenNote(item.noteId)}>看依据</button>
      </li>)}</ul>,
    }] : []),
    { id: 'progress', name: '项目进展', icon: 'chart', body: progress.length
      ? <ul className="qd-home-rows">{(expanded ? progress : progress.slice(0, 3)).map(row => <li key={row.key}>
        <button className="qd-home-project-link" type="button" onClick={() => onOpenProject(row.projectId)}>
          <div><strong>{row.title}</strong><p>{row.state}</p></div>
          {row.progress && <div className="qd-home-progress"><progress value={row.progress.done} max={row.progress.total} aria-label={row.title + '主任务进度'} /><span>{row.progress.done} / {row.progress.total} 项</span></div>}
          <Icon name="chevron-right" size={16} />
        </button>
      </li>)}</ul>
      : <div className="qd-home-empty"><p>项目建好后，进展会显示在这里。</p><button type="button" className="qd-btn primary" onClick={onCreateProject}>新建项目</button></div> },
  ];
  const selected = panels.find(panel => panel.id === expanded);
  const count = attention.length;
  return <main className="qd-product-home">
    <header className="qd-home-header"><h1>{count ? '有 ' + count + ' 件事需要你处理' : '目前没有待办事项'}</h1></header>
    <div className={selected ? 'qd-home-grid is-expanded' : 'qd-home-grid'}>
      <div className="qd-home-panels">
        {(selected ? [selected] : panels).map(panel => <section className="qd-home-panel" aria-label={panel.name} key={panel.id}>
          <h2><button type="button" aria-expanded={expanded === panel.id} onClick={() => setExpanded(expanded === panel.id ? undefined : panel.id)}>
            <Icon name={panel.icon} size={19} /><span>{panel.name}</span><Icon name={expanded === panel.id ? 'contract' : 'expand'} size={15} />
          </button></h2>
          {panel.body}
        </section>)}
      </div>
      {selected && <nav className="qd-home-panel-jumps" aria-label="首页模块">
        {panels.filter(panel => panel !== selected).map(panel => <button key={panel.id} type="button" onClick={() => setExpanded(panel.id)} className="qd-btn ghost">{panel.name}</button>)}
        <button type="button" onClick={() => setExpanded(undefined)} className="qd-btn ghost">返回首页</button>
      </nav>}
    </div>
  </main>;
}
