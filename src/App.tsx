import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { Icon } from './components/ui/Icon';
import { Toasts } from './components/ui/Toasts';
import { MergeFxLayer } from './components/journal/MergeFx';
import { Workspace } from './components/workspace/Workspace';
import { QuanDeckMark } from './components/brand/QuanDeckLogo';
import { switchMethodBoard } from './data/methodBoards';
import { mutateKnowledge } from './data/knowledgeStore';
import type { WorkspaceTarget } from './data/workspaceQuestion';
import type { NoteSelection } from './data/knowledgeNotes';
import { NotesPage, IdeasPage, SearchPage } from './components/knowledge/KnowledgePages';
import { inboxRows } from './components/projects/agentInboxData';
import type { OpenNoteReceipt } from './components/knowledge/NoteReceiptMarks';
import type { HomeTaskFocus } from './components/homepage/HomeBoard';
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

type ProjectView = 'hub' | 'tools' | 'create' | 'legacy' | 'results';

function Workbench() {
  const { snap, projectSnapshots, drag, setDrag, workspace, closeWorkspace, switchProject, toast } = useWorkdeck();
  const navigationId=useRef(0);
  const toolsOrigin=useRef<string>(undefined);
  const [page, setPage] = useState<MainPage>('home');
  type ReturnPoint = { page: MainPage; scroll: number; focus: HTMLElement | null };
  const [trail, setTrail] = useState<ReturnPoint[]>([]);
  const restoring = useRef<ReturnPoint | null>(null);
  const [homeTask,setHomeTask] = useState<HomeTaskFocus>();

  const [boardEntry, setBoardEntry] = useState<ProjectBoardEntry>();
  const [homeRevision, setHomeRevision] = useState(0);
  const [projectView, setProjectView] = useState<ProjectView>('hub');
  const [editingProject, setEditingProject] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [runtimeOffline, setRuntimeOffline] = useState(false);
  const [selectedNote, setSelectedNote] = useState<{ id: string; todoId?: string; lineIndex?: number; quote?: string; selection?: NoteSelection }>();
  const [selectedIdea, setSelectedIdea] = useState<{ noteId: string; personalNote?: boolean; evidenceKey?: string; canvas?:"note"|"link"; templateId?: string }>();
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
    navigationId.current++;
    toolsOrigin.current=undefined;
    closeWorkspace();
    setTrail([]);
    setHomeTask(undefined);
    restoring.current=null;
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
  const openNoteGraph = (noteId: string) => {
    setSelectedIdea({ noteId, personalNote: true });
    navigate('ideas');
  };
  const openMonitor = (id?: string) => {
    setSelectedAttention(id);
    navigate('monitor');
  };

  function drillInto(next: MainPage) {
    if (page === next) return;
    const origin = {page, scroll: window.scrollY, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null};
    setTrail(previous => {
      const existing = previous.findIndex(point=>point.page===next);
      return existing < 0 ? [...previous,origin] : previous.slice(0,existing);
    });
    closeWorkspace();
    setPage(next);
  }
  function goBack() {
    navigationId.current++;
    const origin=trail.at(-1);
    if (!origin) return;
    restoring.current=origin;
    setTrail(trail.slice(0,-1));
    closeWorkspace();
    setPage(origin.page);
  }
  const inspectReminder = (id:string) => {
    navigationId.current++;
    setSelectedAttention(id);
    drillInto('monitor');
  };

  const openProject = async (projectId: string, view: ProjectView = 'hub') => {
    const request=++navigationId.current;
    if (view === 'hub') {
      drillInto('projects');
      setBoardEntry({projectId,inbox:true});
      setProjectView('hub');
      return;
    }
    if (projectId !== snap.project.id && !await switchProject(projectId)) return;
    if (request !== navigationId.current) return;
    closeWorkspace();
    if (view!=='tools') setBoardEntry(undefined);
    drillInto('projects');
    setProjectView(view);
  };

  function showTools(show:boolean, projectId?:string) {
    if (show) {
      toolsOrigin.current=projectId || snap.project.id;
      void openProject(toolsOrigin.current,'tools');
      return;
    }
    navigationId.current++;
    if (toolsOrigin.current && toolsOrigin.current !== snap.project.id) {
      setBoardEntry({projectId:snap.project.id,inbox:true});
    } else if (!boardEntry?.inbox) {
      setBoardEntry(undefined);
    }
    toolsOrigin.current=undefined;
    setProjectView('hub');
  }

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
    const origin=restoring.current;
    restoring.current=null;
    if (!origin) {
      if (window.scrollY) window.scrollTo(0,0);
      return;
    }
    const frame=requestAnimationFrame(()=>{
      window.scrollTo(0,origin.scroll);
      if (origin.focus?.isConnected) origin.focus.focus({preventScroll:true});
    });
    return ()=>cancelAnimationFrame(frame);
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
  const openBoard = async (id?: string, taskId?: string, itemId?: string, resultId?: string, attentionId?:string, fromNote=false) => {
    const request=++navigationId.current;
    const projectId = id || projects[0]?.project.id;
    if (!projectId) { createProject(); return; }
    if (!taskId) {
      if (projectId !== snap.project.id && !await switchProject(projectId)) return;
      if (request!==navigationId.current) return;
      toolsOrigin.current=undefined;
      drillInto('projects');
      setProjectView('tools');
      setBoardEntry({projectId});
      return;
    }
    const project=projects.find(snapshot=>snapshot.project.id===projectId);
    // Receipts may arrive before refreshProjects has delivered the new task to the list.
    const managed=fromNote || !!project && inboxRows([project]).some(row=>row.task.id===taskId);
    if (managed) {
      drillInto('projects');
      setProjectView('hub');
      setBoardEntry({projectId,taskId,itemId,resultId,attentionId,inbox:true});
    } else if (project?.tasks[taskId]) {
      drillInto('home');
      setHomeTask({projectId,taskId,itemId,resultId,nonce:performance.now()});
    } else {
      toast('这项任务已不可用。','info');
    }
  };
  const openReceipt: OpenNoteReceipt = row => {
    const alert=row.attentionId && attention.find(item=>item.id===row.attentionId && item.projectId===row.projectId);
    if (alert && (alert.kind==='permission' || alert.kind==='decision')) {
      inspectReminder(alert.id);
      return;
    }
    const recordId=row.entry?.record.id;
    const version=recordId?.startsWith('artifact:') ? recordId : row.entry?.artifactId ?? recordId ?? row.resultId;
    void openBoard(row.projectId,row.taskId,row.itemId,version,row.attentionId,true);
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
    navigationId.current++;
    closeWorkspace();
    setPage('projects');
    setProjectView('create');
  };

  const pageNames:Record<MainPage,string>={home:'首页',notes:'笔记',monitor:'提醒',ideas:'帮你想',projects:'任务列表',search:'搜索结果'};
  const previous=trail.at(-1);
  const keep=(view:MainPage)=>page===view || trail.some(point=>point.page===view);
  const mode=(view:MainPage)=>page===view ? 'visible' as const : 'hidden' as const;
  return <div className={'qd-product-shell' + (activePage === 'home' ? ' qd-home-shell' : activePage === 'notes' ? ' qd-notes-shell' : activePage === 'projects' ? ' qd-projects-shell' : '')}>
    <a className="qd-skip-nav" href="#qd-page-content">跳到页面内容</a>
    <ProductNavigation page={activePage} running={running} offline={runtimeOffline} onNavigate={openPage} onSettings={() => setSettingsOpen(true)} />
    <div className="qd-product-main">
      <TopBar page={activePage} onSearch={openSearch} onMonitor={() => openMonitor()} attentionCount={attention.length}>
        {activePage === 'projects' && (projectView === 'create' ? '新建项目' : projectView === 'hub' && !workspace && (!boardEntry || boardEntry.inbox) ? null : snap.project.name || null)}
      </TopBar>
      <div id="qd-page-content" tabIndex={-1}>
        {runtimeOffline && <div className="qd-product-offline" role="status">执行连接暂不可用。这里显示最近一次记录。</div>}
        {previous && !workspace && <div className="qd-product-legacy-bar"><button type="button" className="qd-link" onClick={goBack}><Icon name="chevron-left" size={14}/>返回{pageNames[previous.page]}</button></div>}
        {workspace ? <Workspace /> : <>
          {keep('home') && <Activity mode={mode('home')}><ProductHome taskFocus={homeTask} initialSchedule={sourceSchedule} key={homeRevision} onOpenBoardTask={openBoard} onCreateTask={id => void openBoard(id)} projects={projects} onOpenNoteTodo={openNote} onOpenProject={id => void openProject(id)} onOpenIdea={openIdea} onOpenMonitor={openMonitor} onCreateProject={createProject} onWriteNote={writeNote} /></Activity>}
          {keep('notes') && <Activity mode={mode('notes')}><NotesPage onOpenNoteGraph={openNoteGraph} onOpenWorkspaceSource={openWorkspaceSource} noteId={selectedNote?.id} todoId={selectedNote?.todoId} lineIndex={selectedNote?.lineIndex} quote={selectedNote?.quote} selection={selectedNote?.selection} initialDraft={noteDraft} projects={projects} onOpenReceipt={openReceipt} /></Activity>}
          {keep('ideas') && <Activity mode={mode('ideas')}><IdeasPage personalNote={!!selectedIdea?.personalNote} templateId={selectedIdea?.templateId} canvas={selectedIdea?.canvas} noteId={selectedIdea?.noteId} evidenceKey={selectedIdea?.evidenceKey} onOpenNote={openNote} onOpenProject={id => void openProject(id)} /></Activity>}
          {keep('search') && <Activity mode={mode('search')}><SearchPage key={search.revision} initialQuery={search.query} focusSearch onOpenNote={openNote} onOpenProject={id => void openProject(id)} /></Activity>}
          {keep('monitor') && <Activity mode={mode('monitor')}><ProductMonitor onOpenTask={openBoard} selectedAttentionId={selectedAttention} /></Activity>}
          {keep('projects') && <Activity mode={mode('projects')}>{projectView === 'create'
            ? <ProjectCreatePage onCancel={() => setProjectView('hub')} onCreated={id => void openProject(id)} />
            : projectView === 'results' && snap.project.id
              ? <ResultsGallery onNew={() => setProjectView('hub')} />
              : projectView === 'legacy' && snap.project.id
                ? <><div className="qd-product-legacy-bar"><button className="qd-link" type="button" onClick={() => setProjectView('hub')}>返回项目</button><button className="qd-link" type="button" onClick={() => setScheduleOpen(true)}>查看日程</button></div><LegacyJournal key={snap.project.id} /></>
                : <ProjectHub initialProjectTools={projectView === 'tools'} onWriteNote={writeNote}
                    onShowTools={showTools} onOpenNote={openNote} onAttention={inspectReminder} boardEntry={boardEntry?.inbox || boardEntry?.projectId === snap.project.id ? boardEntry : undefined} onCreateProject={createProject} onEditProject={setEditingProject} onOpenLegacyTasks={id => void openProject(id, 'legacy')} />}</Activity>}
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
