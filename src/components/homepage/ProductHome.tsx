import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProductAttention } from '../../data/productAttention';
import type { Snapshot } from '../../data/types';
import { dateInZone } from '../../data/timeline';
import { Icon, type IconName } from '../ui/Icon';
import { useHomeKnowledge } from '../knowledge/KnowledgePages';
import { useScheduleClock } from '../schedule/useScheduleClock';
import { HomeDiscoveries } from './HomeDiscoveries';
import { legacyNoteSources } from '../../data/noteTaskSource';
import { HomeProjects } from './HomeProjects';
import { HomeAgenda } from './HomeAgenda';
import { HomeSchedule } from './HomeSchedule';
import './product-home.css';

interface Props {
  projects: Snapshot[];
  attention: ProductAttention[];
  onOpenProject: (id: string) => void;
  onOpenIdea: (id: string, evidenceKey?: string) => void;
  onOpenNoteTodo: (noteId: string, todoId?: string, lineIndex?: number, quote?: string) => void;
  onOpenBoardTask: (projectId: string, taskId: string, itemId?: string, resultId?: string) => void;
  onCreateTask: (projectId?: string) => void;
  onOpenMonitor: (id: string) => void;
  onCreateProject: () => void;
  onWriteNote: () => void;
}

type Section = 'attention' | 'insights' | 'projects';
type Panel = { id: Section; label: string; icon: IconName; meta: string; body: ReactNode };

export function ProductHome({ projects, attention, onOpenProject, onOpenIdea, onOpenNoteTodo, onOpenMonitor, onCreateProject, onWriteNote, onOpenBoardTask, onCreateTask }: Props) {
  const [selection, setSelection] = useState<Section>();
  const { notes, discoveries, error, ready } = useHomeKnowledge();
  const legacySources = useMemo(() => legacyNoteSources(projects, notes), [projects, notes]);
  const clock = useScheduleClock();
  const today = dateInZone(clock, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const expanded = selection === 'insights' && !discoveries.length ? undefined : selection;
  const ordered = useMemo(() => [...attention].sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent))), [attention]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [expanded]);

  const panels: Panel[] = [
    { id: 'attention', label: '现在需要处理', icon: 'inbox', meta: attention.length + ' 项',
      body: attention.length
        ? <HomeAgenda rows={expanded === 'attention' ? ordered : ordered.slice(0, 3)} projects={projects} today={today} onAction={onOpenMonitor} />
        : <div className="qh-empty"><Icon name="check-circle" size={20}/><span>项目暂时没有需要你处理的事。</span></div> },
    { id: 'projects', label: '项目进展', icon: 'folder', meta: projects.length + ' 个项目',
      body: <HomeProjects projects={projects} notes={notes} legacyNoteSources={legacySources} onOpenNote={onOpenNoteTodo} onOpenBoardTask={onOpenBoardTask} onCreateTask={onCreateTask} onOpenProject={onOpenProject} onCreateProject={onCreateProject} onOpenMonitor={onOpenMonitor} today={today} expanded={expanded === 'projects'}/> },
  ];
  if (discoveries.length) panels.push({
    id: 'insights', label: '待核对的资料关联', icon: 'link', meta: discoveries.length + ' 条',
    body: <HomeDiscoveries discoveries={discoveries} onOpenNote={onOpenIdea} expanded={expanded === 'insights'}/>,
  });

  return <main className="qd-product-home">
    <div className={'qh-workspace' + (expanded ? ' is-focused' : '')}>
      <div className="qh-modules">
        {!expanded && <HomeSchedule notes={notes} projects={projects} ready={ready} error={error} now={clock}
          onWriteNote={onWriteNote} onOpenProject={onOpenProject} onOpenNoteTodo={onOpenNoteTodo}/>}
        {panels.filter(panel => !expanded || expanded === panel.id).map(panel =>
          <section key={panel.id} className={'qh-panel qh-panel-' + panel.id} aria-label={panel.label}>
            <header className="qh-panel-heading"><h2><button type="button" aria-expanded={expanded === panel.id} onClick={() => setSelection(expanded ? undefined : panel.id)}>
              <Icon name={panel.icon} size={19}/>{panel.label}</button></h2>
              <span className="qh-section-meta">{panel.meta}</span>
              <button type="button" className="qh-section-more" aria-label={(expanded ? '收起' : '展开') + panel.label} onClick={() => setSelection(expanded ? undefined : panel.id)}>
                {expanded ? '收起' : '查看全部'}<Icon name={expanded ? 'contract' : 'chevron-right'} size={14}/></button>
            </header>
            {panel.body}
          </section>)}
      </div>
      {expanded && <nav className="qh-section-switch" aria-label="首页模块">
        <button type="button" onClick={() => setSelection(undefined)}><Icon name="chevron-left" size={16}/>返回首页</button>
        {panels.filter(panel => panel.id !== expanded).map(panel => <button key={panel.id} type="button" onClick={() => setSelection(panel.id)}><Icon name={panel.icon} size={16}/>{panel.label}</button>)}
      </nav>}
    </div>
  </main>;
}
