import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { switchMethodBoard } from './data/methodBoards';
import { mutateKnowledge } from './data/knowledgeStore';
import type { WorkspaceTarget } from './data/workspaceQuestion';
import type { NoteSelection } from './data/knowledgeNotes';
import { NotesPage, IdeasPage, SearchPage } from './components/knowledge/KnowledgePages';
import { requestDeliveryFocus } from './components/results/deliveryNavigation';
import { ProjectHub, ProjectCreatePage, type ProjectBoardEntry } from './components/projects/ProductProjects';
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
  const [boardEntry, setBoardEntry] = useState<ProjectBoardEntry>();
  const [homeRevision, setHomeRevision] = useState(0);
  const [projectView, setProjectView] = useState<ProjectView>('hub');
  const [editingProject, setEditingProject] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [runtimeOffline, setRuntimeOffline] = useState(false);
  const [selectedNote, setSelectedNote] = useState<{ id: string; todoId?: string; lineIndex?: number; quote?: string; selection?: NoteSelection }>();
  const [selectedIdea, setSelectedIdea] = useState<{ noteId: string; evidenceKey?: string; canvas?:"note"|"link"; templateId?: string }>();
  const [selectedAttention, setSelectedAttention] = useState<string>();
  const [sourceSchedule,setSourceSchedule]=useState<{key:string;at:number;nonce:number}>();
  const [noteDraft, setNoteDraft] = useState<{text:string;files:File[]}>();
  const [search, setSearch] = useState({ query: '', revision: 0 });
  const projects = useMemo(() => {
    const list = projectSnapshots.filter(project => project.project.id !== snap.project.id && !project.project.deletedAt);
    return snap.project.id && !snap.project.deletedAt ? [snap, ...list] : list;
  }, [projectSnapshots, snap]);
  const seenDivision = useRef(new Map<string, string|null>());
  useEffect(() => {
    const announcements:string[]=[];
    for (const snapshot of projects) {
      const id=snapshot.project.id;
      const latest=snapshot.noteWorkChanges?.at(-1);
      const previous=seenDivision.current.get(id);
      seenDivision.current.set(id,latest?.id??null);
      if (previous===undefined || !latest || previous===latest.id) continue;
      // Direct sends already show their division receipt in the note. Background changes surface here.
      if (page==='notes' && latest.request.startsWith('send-')) continue;
      announcements.push(snapshot.project.name+' · '+latest.title);
    }
    if(announcements.length) toast(announcements.join(' / '),'info',7000);
  },[projects,page,toast]);
  const { visible: attention } = useProductAttention(projects);
  const running = useMemo(() => projects.reduce((sum, project) => sum + deriveProjectActivity(project).counts.running, 0), [projects]);

  const navigate = useCallback((next: MainPage) => {
    closeWorkspace();
    setSourceSchedule(undefined);
    setBoardEntry(undefined);
    setPage(next);
    setProjectView('hub');
    if (next !== 'notes') setNoteDraft(undefined);
  }, [closeWorkspace]);

  useEffect(() => host?.onAgendaReminderClick?.(() => {
    setScheduleOpen(false);
    setSettingsOpen(false);
    setEditingProject(undefined);
    navigate('home');
    setHomeRevision(revision => revision + 1);
  }), [navigate]);

  const openSearch = useCallback((query: string) => {
    navigate('search');
    setSearch(previous => ({ query: query || (page === 'search' ? previous.query : ''), revision: previous.revision + 1 }));
  }, [navigate, page]);

  const openNote = (id: string, todoId?: string, lineIndex?: number, quote?: string, selection?: NoteSelection) => {
    setSelectedNote({ id, todoId, lineIndex, quote, selection });
    setNoteDraft(undefined);
    navigate('notes');
  };

  const openIdea = (noteId: string, evidenceKey?: string) => {
    setSelectedIdea({ noteId, evidenceKey });
    navigate('ideas');
  };
  const openMonitor = (id?: string) => {
    setSelectedAttention(id);
    navigate('monitor');
  };

  const openProject = async (projectId: string, view: ProjectView = 'hub') => {
    if (projectId !== snap.project.id && !await switchProject(projectId)) return;
    closeWorkspace();
    setBoardEntry(undefined);
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
  useLayoutEffect(() => {
    if (window.scrollY) window.scrollTo(0, 0);
  }, [activePage, projectView]);
  const writeNote = () => {
    setSelectedNote(undefined);
    setNoteDraft({ text: '', files: [] });
    navigate('notes');
  };
  const openPage = (next: MainPage) => {
    if (next === 'search') return openSearch('');
    if (next === 'monitor') return openMonitor();
    navigate(next);
  };
  const openBoard = async (id?: string, taskId?: string, itemId?: string, resultId?: string) => {
    const projectId = id || projects[0]?.project.id;
    if (!projectId) { createProject(); return; }
    if (projectId !== snap.project.id && !await switchProject(projectId)) return;
    navigate('projects');
    if (resultId) requestDeliveryFocus(projectId, {taskId, workItemId:itemId}, resultId);
    setBoardEntry({projectId, taskId, itemId, resultId});
  };
  const openWorkspaceSource = (target:WorkspaceTarget) => {
    switch(target.page){
      case 'notes': return openNote(target.id,target.todoId,undefined,undefined,target.selection && {...target.selection});
      case 'projects': return void openBoard(target.id,target.taskId,target.itemId);
      case 'search': return openSearch(target.query);
      case 'monitor': return openMonitor(target.id);
      case 'ideas': {
        const open = () => { setSelectedIdea({noteId:target.id,evidenceKey:target.evidenceKey,canvas:target.canvas,templateId:target.templateId}); navigate('ideas'); };
        if (target.boardId) {
          void mutateKnowledge(lib=>switchMethodBoard(lib,target.boardId!)).then(open).catch(error=>toast(error instanceof Error?error.message:'无法打开画布','error'));
        } else open();
        return;
      }
      case 'home': navigate('home');setSourceSchedule({key:target.key,at:target.at,nonce:performance.now()});return;
    }
  };
  const createProject = () => {
    closeWorkspace();
    setPage('projects');
    setProjectView('create');
  };

  return <div className={'qd-product-shell' + (activePage === 'home' ? ' qd-home-shell' : activePage === 'notes' ? ' qd-notes-shell' : activePage === 'projects' ? ' qd-projects-shell' : '')}>
    <a className="qd-skip-nav" href="#qd-page-content">跳到页面内容</a>
    <ProductNavigation page={activePage} running={running} offline={runtimeOffline} onNavigate={openPage} onSettings={() => setSettingsOpen(true)} />
    <div className="qd-product-main">
      <TopBar page={activePage} onSearch={openSearch} onMonitor={() => openMonitor()} attentionCount={attention.length}>
        {activePage === 'projects' && (projectView === 'create' ? '新建项目' : snap.project.name || null)}
      </TopBar>
      <div id="qd-page-content" tabIndex={-1}>
        {runtimeOffline && <div className="qd-product-offline" role="status">执行连接暂不可用。这里显示最近一次记录。</div>}
        {workspace ? <Workspace /> : <>
          {page === 'home' && <ProductHome initialSchedule={sourceSchedule} key={homeRevision} onOpenBoardTask={openBoard} onCreateTask={id => void openBoard(id)} projects={projects} onOpenNoteTodo={openNote} onOpenProject={id => void openProject(id)} onOpenIdea={openIdea} onOpenMonitor={openMonitor} onCreateProject={createProject} onWriteNote={writeNote} />}
          {page === 'notes' && <NotesPage onOpenWorkspaceSource={openWorkspaceSource} noteId={selectedNote?.id} todoId={selectedNote?.todoId} lineIndex={selectedNote?.lineIndex} quote={selectedNote?.quote} selection={selectedNote?.selection} initialDraft={noteDraft} projects={projects} onOpenReceipt={row => row.attentionId ? openMonitor(row.attentionId) : void openBoard(row.projectId,row.taskId,row.itemId,row.resultId)} />}
          {page === 'ideas' && <IdeasPage templateId={selectedIdea?.templateId} canvas={selectedIdea?.canvas} noteId={selectedIdea?.noteId} evidenceKey={selectedIdea?.evidenceKey} onOpenNote={openNote} onOpenProject={id => void openProject(id)} />}
          {page === 'search' && <SearchPage key={search.revision} initialQuery={search.query} focusSearch onOpenNote={openNote} onOpenProject={id => void openProject(id)} />}
          {page === 'monitor' && <ProductMonitor selectedAttentionId={selectedAttention} />}
          {page === 'projects' && (projectView === 'create'
            ? <ProjectCreatePage onCancel={() => setProjectView('hub')} onCreated={id => void openProject(id)} />
            : projectView === 'results' && snap.project.id
              ? <ResultsGallery onNew={() => setProjectView('hub')} />
              : projectView === 'legacy' && snap.project.id
                ? <><div className="qd-product-legacy-bar"><button className="qd-link" type="button" onClick={() => setProjectView('hub')}>返回项目</button><button className="qd-link" type="button" onClick={() => setScheduleOpen(true)}>查看日程</button></div><LegacyJournal key={snap.project.id} /></>
                : <ProjectHub onOpenNote={openNote} onAttention={openMonitor} boardEntry={boardEntry?.projectId === snap.project.id ? boardEntry : undefined} onCreateProject={createProject} onEditProject={setEditingProject} onOpenLegacyTasks={id => void openProject(id, 'legacy')} />)}
        </>}
      </div>
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
