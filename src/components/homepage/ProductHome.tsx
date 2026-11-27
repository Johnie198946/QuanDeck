import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Snapshot } from '../../data/types';
import { dateInZone } from '../../data/timeline';
import { Icon, type IconName } from '../ui/Icon';
import { useHomeKnowledge } from '../knowledge/KnowledgePages';
import { useScheduleClock } from '../schedule/useScheduleClock';
import { HomeDiscoveries } from './HomeDiscoveries';
import { legacyNoteSources } from '../../data/noteTaskSource';
import type { HomeTaskFocus } from './HomeBoard';
import { HomeProjects } from './HomeProjects';
import { HomeSchedule } from './HomeSchedule';
import './product-home.css';
import './home-followup.css';

interface Props {
  taskFocus?:HomeTaskFocus;
  initialSchedule?:{key:string;at:number;nonce:number};
  projects: Snapshot[];
  onOpenProject: (id: string) => void;
  onOpenIdea: (id: string, evidenceKey?: string) => void;
  onOpenNoteTodo: (noteId: string, todoId?: string, lineIndex?: number, quote?: string) => void;
  onOpenBoardTask: (projectId: string, taskId: string, itemId?: string, resultId?: string) => void;
  onCreateTask: (projectId?: string) => void;
  onOpenMonitor: (id: string) => void;
  onCreateProject: () => void;
  onWriteNote: () => void;
}

type Section = 'insights' | 'projects';
type Panel = { id: Section; label: string; icon: IconName; meta?: string; body: ReactNode };

export function ProductHome({ taskFocus, initialSchedule, projects, onOpenProject, onOpenIdea, onOpenNoteTodo, onCreateProject, onWriteNote, onOpenBoardTask, onCreateTask }: Props) {
  const [selection, setSelection] = useState<Section>();
  const { notes, discoveries, error, ready } = useHomeKnowledge();
  const legacySources = useMemo(() => legacyNoteSources(projects, notes), [projects, notes]);
  const clock = useScheduleClock();
  const today = dateInZone(clock, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const expanded = selection === 'insights' && !discoveries.length ? undefined : selection;
  const requestSequence = useRef(0);
  const [focusRequest, setFocusRequest] = useState<{ key: string; at: number; nonce: number } | undefined>(initialSchedule);
  const [focusAgenda, setFocusAgenda] = useState<{ key: string; nonce: number }>();
  const openBoard = (key: string) => {
    setFocusAgenda({ key, nonce: ++requestSequence.current });
  };
  const openSchedule = (key: string, at: number) => {
    setSelection(undefined);
    setFocusRequest({ key, at, nonce: ++requestSequence.current });
  };

  useEffect(()=>{if (taskFocus) setSelection('projects');},[taskFocus]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [expanded]);

  const panels: Panel[] = [
    { id: 'projects', label: '任务管理', icon: 'check-square',
      body: <HomeProjects taskFocus={taskFocus} focusAgenda={focusAgenda} onAgendaFocused={() => setFocusAgenda(undefined)} onOpenSchedule={openSchedule} projects={projects} notes={notes} legacyNoteSources={legacySources} onOpenNote={onOpenNoteTodo} onOpenBoardTask={onOpenBoardTask} onCreateTask={onCreateTask} onOpenProject={onOpenProject} onCreateProject={onCreateProject} today={today} expanded={expanded === 'projects'}/> },
  ];
  if (discoveries.length) panels.push({
    id: 'insights', label: '待核对的资料关联', icon: 'link', meta: discoveries.length + ' 条',
    body: <HomeDiscoveries discoveries={discoveries} onOpenNote={onOpenIdea} expanded={expanded === 'insights'}/>,
  });

  return <main className="qd-product-home">
    <div className={'qh-workspace' + (expanded ? ' is-focused' : '')}>
      <div className="qh-modules">
        {!expanded && <HomeSchedule onOpenBoard={openBoard} focusRequest={focusRequest} onScheduleFocused={() => setFocusRequest(undefined)} notes={notes} projects={projects} ready={ready} error={error} now={clock}
          onWriteNote={onWriteNote} onOpenProject={onOpenProject} onOpenNoteTodo={onOpenNoteTodo} onOpenResult={onOpenBoardTask}/>}
        {panels.filter(panel => !expanded || expanded === panel.id).map(panel =>
          <section key={panel.id} className={'qh-panel qh-panel-' + panel.id} aria-label={panel.label}>
            <header className="qh-panel-heading"><h2><button type="button" aria-expanded={expanded === panel.id} onClick={() => setSelection(expanded ? undefined : panel.id)}>
              <Icon name={panel.icon} size={19}/>{panel.label}</button></h2>
              {panel.meta && <span className="qh-section-meta">{panel.meta}</span>}
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
