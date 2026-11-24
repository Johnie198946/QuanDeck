import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkdeckDataSource } from './data/repository';
import { createDesktopDataSource } from './data/desktopRepository';
import { createHttpDataSource } from './data/httpRepository';
import { desktopHost } from './integration/desktop';
import { WorkdeckProvider, useWorkdeck } from './state/WorkdeckContext';
import { ProjectDialog } from './components/projects/ProjectDialog';
import { ProductNavigation, TopBar, type MainPage } from './components/layout/TopBar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ResultsGallery } from './components/results/ResultsGallery';
import { ScheduleSheet } from './components/schedule/ScheduleSheet';
import { Journal } from './components/journal/Journal';
import { Toasts } from './components/ui/Toasts';
import { MergeFxLayer } from './components/journal/MergeFx';
import { Workspace } from './components/workspace/Workspace';
import { QuanDeckMark } from './components/brand/QuanDeckLogo';
import { NotesPage, IdeasPage, SearchPage, useImportantKnowledge } from './components/knowledge/KnowledgePages';
import { ProjectHub, ProjectCreatePage } from './components/projects/ProductProjects';
import { ProductMonitor, ProductDispatchDock, useProductAttention } from './components/deck/ProductExecution';
import { ProductHome } from './components/homepage/ProductHome';
import { deriveProjectActivity, needsAttention } from './data/projectActivity';
import { taskCloseouts } from './data/taskCloseout';
import { businessJournal } from './data/businessTasks';

function LegacyJournal() {
  const { snap } = useWorkdeck();
  const closeouts = taskCloseouts(snap);
  const journal = businessJournal(snap, 'all', closeouts);
  const closed = journal.total > 0 && journal.completed === journal.total;
  const reviewOnly = !closed && journal.total > 0 && journal.blocks.every(block => {
    if (block.kind !== 'task') return true;
    const model = closeouts.get(block.taskId);
    return model?.done || model?.root.pending && model.children.every(child => child.pending || child.settled || child.label === '已取消');
  });
  const entries = deriveProjectActivity(snap).entries;
  return <Journal projection={{closeouts,journal,closed,reviewOnly}} attention={entries.filter(needsAttention)} running={entries.filter(entry => entry.state === 'running')} />;
}

const host = desktopHost();
const dataSourcePromise: Promise<WorkdeckDataSource> = host
  ? Promise.resolve(createDesktopDataSource(host))
  : import.meta.env.VITE_WORKDECK_API
    ? Promise.resolve(createHttpDataSource(import.meta.env.VITE_WORKDECK_API))
    : import('./data/repository').then(module => module.localDataSource);

type ProjectView = 'hub' | 'create' | 'legacy' | 'results';

function Workbench() {
  const { snap, projectSnapshots, drag, setDrag, workspace, closeWorkspace, switchProject, toast } = useWorkdeck();
  const [page, setPage] = useState<MainPage>('home');
  const [projectView, setProjectView] = useState<ProjectView>('hub');
  const [editingProject, setEditingProject] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [runtimeOffline, setRuntimeOffline] = useState(false);
  const [selectedNote, setSelectedNote] = useState<string>();
  const [selectedIdea, setSelectedIdea] = useState<string>();
  const [selectedAttention, setSelectedAttention] = useState<string>();
  const [noteDraft, setNoteDraft] = useState<{text:string;files:File[]}>();
  const [search, setSearch] = useState({ query: '', revision: 0 });
  const discoveries = useImportantKnowledge();
  const projects = useMemo(() => {
    const list = projectSnapshots.filter(project => project.project.id !== snap.project.id && !project.project.deletedAt);
    return snap.project.id && !snap.project.deletedAt ? [snap, ...list] : list;
  }, [projectSnapshots, snap]);
  const { visible: attention } = useProductAttention(projects);

  const navigate = useCallback((next: MainPage) => {
    closeWorkspace();
    setPage(next);
    setProjectView('hub');
    if (next !== 'notes') setNoteDraft(undefined);
  }, [closeWorkspace]);

  const openSearch = useCallback((query: string) => {
    navigate('search');
    setSearch(previous => ({ query: query || (page === 'search' ? previous.query : ''), revision: previous.revision + 1 }));
  }, [navigate, page]);

  const openNote = (id: string) => {
    setSelectedNote(id);
    setNoteDraft(undefined);
    navigate('notes');
  };

  const openIdea = (noteId: string) => {
    setSelectedIdea(noteId);
    navigate('ideas');
  };
  const openMonitor = (id?: string) => {
    setSelectedAttention(id);
    navigate('monitor');
  };

  const openProject = async (projectId: string, view: ProjectView = 'hub') => {
    if (projectId !== snap.project.id && !await switchProject(projectId)) return;
    closeWorkspace();
    setPage('projects');
    setProjectView(view);
  };

  useEffect(() => {
    if (workspace) {
      setProjectView('hub');
      setPage('projects');
    }
  }, [workspace]);

  useEffect(() => {
    const runtimeStatus = (event: Event) => setRuntimeOffline(!(event as CustomEvent<{connected:boolean}>).detail.connected);
    const showJournal = () => { setPage('projects'); setProjectView('legacy'); };
    const showResults = () => { closeWorkspace(); setPage('projects'); setProjectView('results'); };
    const showMonitor = () => navigate('monitor');
    const showSchedule = () => setScheduleOpen(true);
    const openNotes = (event: Event) => {
      setSelectedNote(undefined);
      setNoteDraft((event as CustomEvent<{text:string; files:File[]}>).detail);
      navigate('notes');
    };
    const events: [string, EventListener][] = [
      ['quandeck:runtime-status', runtimeStatus],
      ['quandeck:show-journal', showJournal],
      ['quandeck:show-results', showResults],
      ['quandeck:show-deck', showMonitor],
      ['quandeck:show-schedule', showSchedule],
      ['quandeck:show-notes', openNotes],
    ];
    events.forEach(([name, handler]) => window.addEventListener(name, handler));
    return () => events.forEach(([name, handler]) => window.removeEventListener(name, handler));
  }, [closeWorkspace, navigate]);

  useEffect(() => {
    if (!drag) return;
    const end = () => setDrag(null);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, [drag, setDrag]);

  const activePage = workspace ? 'projects' : page;
  const createProject = () => {
    closeWorkspace();
    setPage('projects');
    setProjectView('create');
  };

  return <div className="qd-product-shell">
    <ProductNavigation page={activePage} onNavigate={next => next === 'search' ? openSearch('') : navigate(next)} onSettings={() => setSettingsOpen(true)} />
    <div className="qd-product-main">
      <TopBar page={activePage} onSearch={openSearch} onMonitor={() => openMonitor()} attentionCount={attention.length}>
        {activePage === 'projects' && snap.project.id && <span>{snap.project.name}</span>}
      </TopBar>
      {runtimeOffline && <div className="qd-product-offline" role="status">执行连接暂不可用。这里显示最近一次记录。</div>}
      {workspace ? <Workspace /> : <>
        {page === 'home' && <ProductHome projects={projects} attention={attention} discoveries={discoveries} onOpenProject={id => void openProject(id)} onOpenNote={openIdea} onOpenMonitor={openMonitor} onCreateProject={createProject} />}
        {page === 'notes' && <NotesPage noteId={selectedNote} initialDraft={noteDraft} />}
        {page === 'ideas' && <IdeasPage noteId={selectedIdea} onOpenNote={openNote} onOpenProject={id => void openProject(id)} />}
        {page === 'search' && <SearchPage key={search.revision} initialQuery={search.query} focusSearch onOpenNote={openNote} onOpenProject={id => void openProject(id)} />}
        {page === 'monitor' && <ProductMonitor selectedAttentionId={selectedAttention} />}
        {page === 'projects' && (projectView === 'create'
          ? <ProjectCreatePage onCancel={() => setProjectView('hub')} onCreated={id => void openProject(id)} />
          : projectView === 'results' && snap.project.id
            ? <ResultsGallery onNew={() => setProjectView('hub')} />
            : projectView === 'legacy' && snap.project.id
              ? <><div className="qd-product-legacy-bar"><button className="qd-link" type="button" onClick={() => setProjectView('hub')}>返回项目</button><button className="qd-link" type="button" onClick={() => setScheduleOpen(true)}>查看日程</button></div><LegacyJournal key={snap.project.id} /></>
              : <ProjectHub onCreateProject={createProject} onEditProject={setEditingProject} onOpenLegacyTasks={id => void openProject(id, 'legacy')} />)}
      </>}
    </div>
    <ProductDispatchDock onManage={() => setSettingsOpen(true)} />
    {editingProject && <ProjectDialog projectId={editingProject} onClose={() => setEditingProject(undefined)} onSaved={() => setEditingProject(undefined)} />}
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    <ScheduleSheet key={snap.project.id} open={scheduleOpen} onClose={() => setScheduleOpen(false)} />
    <MergeFxLayer />
    <Toasts />
  </div>;
}

function Loading() {
  return <div className="qd-loading" role="status"><QuanDeckMark size={30} /><span>正在载入 QuanDeck…</span></div>;
}

export default function App() {
  const [dataSource, setDataSource] = useState<WorkdeckDataSource | null>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active = true;
    void dataSourcePromise.then(source => { if (active) setDataSource(source); }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : '数据读取失败'); });
    return () => { active = false; };
  }, []);
  if (loadError) return <p role="alert">{loadError}</p>;
  if (!dataSource) return <Loading />;
  return <WorkdeckProvider source={dataSource} fallback={<Loading />}><Workbench /></WorkdeckProvider>;
}
