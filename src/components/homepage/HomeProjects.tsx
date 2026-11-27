import { useEffect, useMemo, useState } from 'react';
import { HomeBoard, type BoardProps } from './HomeBoard';
import { homeBoardCards } from './homeBoardData';
import { HomeProjectGantt } from './HomeProjectGantt';
import './home-task-desk.css';
import './home-sections.css';

const views = {board:'任务看板', list:'任务列表', gantt:'甘特图'} as const;
type View = keyof typeof views;

export function HomeProjects(props: BoardProps) {
  const { projects, notes, legacyNoteSources, today, focusAgenda } = props;
  const [mode, setMode] = useState<View>('board');
  useEffect(() => { if (focusAgenda) setMode('board'); }, [focusAgenda]);
  const cards = useMemo(() => homeBoardCards(projects, notes, legacyNoteSources, Date.now()), [projects, notes, legacyNoteSources, today]);
  return <div className="qhp-projects">
    <div className="qhp-controls">
      <div className="qhp-view-mode" role="group" aria-label="任务管理视图">
        {(Object.keys(views) as View[]).map(view=><button key={view} type="button" aria-pressed={mode===view} onClick={()=>setMode(view)}>{views[view]}</button>)}
      </div>
    </div>
    {mode === 'gantt' ? <HomeProjectGantt {...props} cards={cards}/> : <HomeBoard {...props} cards={cards} mode={mode}/>}
  </div>;
}
