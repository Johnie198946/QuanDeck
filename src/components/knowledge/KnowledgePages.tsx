import type { WorkspaceTarget } from '../../data/workspaceQuestion';
import { useKnowledgeLibrary } from './useKnowledgeLibrary';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import {
  buildKnowledgeIndex, buildNoteGraph, buildPersonalNoteGraph, knowledgeKindLabels, knowledgeRelations, searchKnowledge,
  type KnowledgeGraphEdge, type KnowledgeRelation, type KnowledgeSource,
} from '../../data/knowledgeIndex';
import { KNOWLEDGE_FILES, type KnowledgeDecision } from '../../data/knowledgeNotes';
import { downloadOutputFile } from '../../data/outputFiles';
import { mutateKnowledge } from '../../data/knowledgeStore';
import { Icon, type IconName } from '../ui/Icon';
import type { Snapshot } from '../../data/types';
import type { NoteSelection } from '../../data/knowledgeNotes';
import type { OpenNoteReceipt } from './NoteReceiptMarks';
import { NotesWorkspace, type NoteDraft } from './NotesPage';
import { exploreNoteLayers } from '../../data/personalNoteGraph';
import { NoteGraphPicker } from './NoteGraphPicker';
import { noteOutline, OUTLINE_PREVIEW, passageEdge, type NotePassage } from './noteOutline';
import type { CanvasEdge, CanvasNode } from './planetLayout';
import { KnowledgeGraph } from './KnowledgeGraph';
import { DEFAULT_GRAPH_PHYSICS } from './planetLayout';
import { InspirationCanvas } from './InspirationCanvas';
import { GraphAgentAction } from './GraphAgentAction';
import { IdeaDetail } from './IdeaDetail';
import { IdeaEvidence, relationLabel } from './IdeaEvidence';
import './knowledge.css';
import './knowledge-graph.css';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const asError = (error: unknown) => error instanceof Error ? error.message : '暂时无法加载资料，请重试';

function useKnowledgeIndex() {
  const { snap, projectSnapshots } = useWorkdeck();
  const state = useKnowledgeLibrary();
  const index = useMemo(() => {
    const projects = new Map(projectSnapshots.map(item => [item.project.id, item]));
    if (snap.project.id) projects.set(snap.project.id, snap);
    return buildKnowledgeIndex(state.library, [...projects.values()]);
  }, [state.library, snap, projectSnapshots]);
  return { ...state, index };
}

export interface HomeDiscovery {
  id: string;
  title: string;
  noteId: string;
  noteTitle: string;
  sourceTitle: string;
  sourceKind: string;
  kind: '冲突' | '同源' | '补充' | '复用' | '创新';
  explanation?: string;
  evidence: string[];
}

export function useHomeKnowledge() {
  const { library, index, error, ready } = useKnowledgeIndex();
  const discoveries = useMemo(() => {
    const active = [...library.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15);
    const acknowledged = new Set(library.decisions.map(item => item.evidence));
    const unique = new Map<string, HomeDiscovery>();
    const hasReasoning = library.agentGraph?.reasoning?.version === 2;
    if (hasReasoning) {
      const graph = buildNoteGraph(library);
      for (const {from, members, relation} of graph.edges) {
        const finding = relation.agent;
        if (!finding?.category || acknowledged.has(relation.evidenceKey)) continue;
        unique.set(relation.evidenceKey, {
          id: relation.evidenceKey, noteId: from, noteTitle: graph.sources.get(from)!.title,
          title: finding.label, sourceTitle: members.length === 1 ? '本篇笔记' : members.slice(1).map(id => graph.sources.get(id)!.title).join('、'), sourceKind: '笔记',
          kind: finding.category === '矛盾' ? '冲突' : finding.category,
          explanation: finding.consequence || finding.explanation, evidence: relation.evidence,
        });
      }
    }
    const projectSources = hasReasoning ? index.filter(source => !source.noteId) : index;
    for (const note of active) {
      for (const relation of knowledgeRelations(note, projectSources, library)) {
        if (acknowledged.has(relation.evidenceKey) || relation.kind !== '冲突' && relation.kind !== '同源') continue;
        const source = relation.source;
        const key = JSON.stringify(['note:' + note.id, source.id].sort());
        if (unique.has(key)) continue;
        unique.set(key, {
          id: relation.evidenceKey, noteId: note.id, noteTitle: note.title,
          sourceKind: knowledgeKindLabels[source.kind], sourceTitle: source.title,
          kind: relation.kind, evidence: relation.evidence,
          title: relation.kind === '冲突' ? note.title + ' · ' + relation.title : note.title + ' · 和「' + source.title + '」引用同一链接',
        });
      }
    }
    return [...unique.values()].sort((a, b) => Number(b.kind === '冲突') - Number(a.kind === '冲突'));
  }, [library, index]);
  return { notes: library.notes, discoveries, error, ready };
}

export function NotesPage({ onOpenNoteGraph, onOpenWorkspaceSource, noteId, todoId, lineIndex, quote, selection, initialDraft, projects, onOpenReceipt }: { onOpenNoteGraph:(id:string)=>void; onOpenWorkspaceSource:(target:WorkspaceTarget)=>void; projects: Snapshot[]; onOpenReceipt: OpenNoteReceipt; selection?: NoteSelection; noteId?: string | null; todoId?: string; lineIndex?: number; quote?: string; initialDraft?: NoteDraft }) {
  const { library, error, ready } = useKnowledgeLibrary();
  return <main className="qd-knowledge-page">{ready
    ? <NotesWorkspace onOpenNoteGraph={onOpenNoteGraph} onOpenWorkspaceSource={onOpenWorkspaceSource} library={library} target={noteId} todoId={todoId} lineIndex={lineIndex} quote={quote} selection={selection} initialDraft={initialDraft} error={error} projects={projects} onOpenReceipt={onOpenReceipt} />
    : <p className="qd-knowledge-message" role="status">正在读取笔记…</p>}</main>;
}

type OpenDoors = { onOpenNote: (id: string, todoId?: string, lineIndex?: number, quote?: string) => void; onOpenProject?: (id: string) => void };
function useOpenSource({ onOpenNote, onOpenProject }: OpenDoors) {
  const { snap, switchProject, openWorkspace, openProjectDirection, closeWorkspace, toast } = useWorkdeck();
  return async (source: KnowledgeSource) => {
    if (source.file) {
      try { await downloadOutputFile(source.noteId ? KNOWLEDGE_FILES : source.projectId ?? '', source.file); }
      catch (error) { toast(asError(error), 'error'); }
      return;
    }
    if (source.noteId) { onOpenNote(source.noteId); return; }
    if (!source.projectId) return;
    if (source.projectId !== snap.project.id && !await switchProject(source.projectId)) return;
    if (source.kind === 'project' || source.kind === 'decision' && !source.taskId) {
      onOpenProject?.(source.projectId);
      return;
    }
    if (source.planId) {
      if (!source.taskId) await openProjectDirection(source.projectId);
      else openWorkspace(source.taskId, {
        view: 'plan', planId: source.planId, itemId: source.itemId ?? null, scope: source.sectionId ?? 'root',
        pane: source.conclusionId ? 'side' : 'main',
      });
      await frame();
      if (source.conclusionId) window.dispatchEvent(new CustomEvent('quandeck:select-conclusion', {
        detail: { planId: source.planId, conclusionId: source.conclusionId },
      }));
      else if (source.sectionId) document.querySelector(`[data-plan-section="${CSS.escape(source.sectionId)}"]`)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (source.taskId) {
      const result = source.kind === 'artifact' || source.id.includes(':artifact:') || source.id.includes(':output:');
      openWorkspace(source.taskId, {
        view: result ? 'results' : 'tasks', selected: source.itemId ?? null, itemId: source.itemId ?? null,
        ...(result ? { focus: true } : {}),
      });
      return;
    }
    if (source.blockId) {
      closeWorkspace();
      window.dispatchEvent(new CustomEvent('quandeck:show-journal'));
      await frame(); await frame();
      const block = document.querySelector<HTMLElement>(`[data-journal-block="${CSS.escape(source.blockId)}"]`);
      if (block) { block.scrollIntoView({ block: 'nearest' }); block.focus(); }
      else toast('可在项目日记中查看这条记录');
    }
  };
}

const resultIcons: Record<KnowledgeSource['kind'], IconName> = {
  note: 'pencil', project: 'folder', task: 'check-square', journal: 'calendar', plan: 'flask',
  artifact: 'box', file: 'link', decision: 'check-circle', memory: 'clock',
};

export function SearchPage({ initialQuery, focusSearch = false, onOpenNote, onOpenProject }: OpenDoors & { initialQuery?: string; focusSearch?: boolean }) {
  const { error, index, ready } = useKnowledgeIndex();
  const open = useOpenSource({ onOpenNote, onOpenProject });
  const [value, setValue] = useState(initialQuery ?? '');
  const [query, setQuery] = useState(initialQuery?.trim() ?? '');
  const [max, setMax] = useState(24);
  useEffect(() => {
    if (initialQuery !== undefined) { setValue(initialQuery); setQuery(initialQuery.trim()); setMax(24); }
  }, [initialQuery]);

  const hits = useMemo(() => searchKnowledge(index, query, max + 1), [index, query, max]);
  const submit = (event: FormEvent) => { event.preventDefault(); setQuery(value.trim()); setMax(24); };

  return <main className={'qd-knowledge-page qd-knowledge-search' + (query ? ' has-query' : '')} aria-label="帮你找">
    <form onSubmit={submit} role="search" className="qd-knowledge-search-form">
      <Icon name="search" size={24} />
      <input aria-label="搜索项目、笔记、任务或成果" placeholder="搜索项目、笔记、任务或成果" maxLength={200} value={value} autoFocus={focusSearch}
        onChange={event => setValue(event.target.value)} />
      {value && <button type="button" className="qd-icon-btn" aria-label="清空搜索" onClick={() => { setValue(''); setQuery(''); }}><Icon name="close" size={16}/></button>}
      <button type="submit" className="qd-btn primary">搜索</button>
    </form>
    {!!query && <div className="qd-knowledge-hits" aria-live="polite">
      {error && <p role="alert">{error}</p>}
      {!ready && <p role="status">正在读取资料…</p>}
      {ready && !hits.length && <p className="qd-knowledge-empty">没有找到相关内容。试试更短的词。</p>}
      {hits.length > 0 && <h2>{hits.length > max ? '相关结果' : hits.length + ' 条相关结果'}</h2>}
      {hits.length > 0 && <ol aria-label="查找结果">{hits.slice(0, max).map(source => <li key={source.id}>
        <button type="button" className="qd-knowledge-hit" onClick={() => void open(source)}>
          <Icon name={resultIcons[source.kind]} size={19}/>
          <div><strong>{source.title}</strong><p>{source.excerpt}</p><small>{knowledgeKindLabels[source.kind]} · {source.projectName ?? '个人笔记'}{source.at && ` · ${new Date(source.at).toLocaleDateString('zh-CN')}`}</small></div>
          <Icon name="chevron-right" size={16}/>
        </button>
      </li>)}</ol>}
      {hits.length > max && <button type="button" className="qd-btn ghost" onClick={() => setMax(current => current + 24)}>显示更多</button>}
    </div>}
  </main>;
}

export function IdeasPage({ noteId, personalNote, evidenceKey, canvas, templateId, onOpenNote, onOpenProject }: OpenDoors & { personalNote?: boolean; noteId?: string | null; evidenceKey?: string; templateId?: string; canvas?: "link"|"note" }) {
  const { library, error, index, ready } = useKnowledgeIndex();
  const open = useOpenSource({ onOpenNote, onOpenProject });
  const [mode, setMode] = useState<'graph' | 'logic'>('graph');
  const [mapView, setMapView] = useState<'map' | 'list'>('map');
  const [localRoot, setLocalRoot] = useState<string | undefined>(personalNote ? noteId ?? undefined : undefined);
  const [picker, setPicker] = useState<'center' | 'links'>();
  const [passageId, setPassageId] = useState<string>();
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(() => new Set());
  const [showContent, setShowContent] = useState(true);
  const [depth, setDepth] = useState(1);
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [labels, setLabels] = useState(true);
  const [physics, setPhysics] = useState(DEFAULT_GRAPH_PHYSICS);
  const [filtersOpen, setFiltersOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const filterPanel = useRef<HTMLElement>(null);
  const filterToggle = useRef<HTMLButtonElement>(null);
  const helpPanel = useRef<HTMLElement>(null);
  const graphSurface = useRef<HTMLDivElement>(null);
  const [surfaceHeight, setSurfaceHeight] = useState<number>();
  const [selected, setSelected] = useState<string>();
  const [activeRelation, setActiveRelation] = useState<string>();
  const [history, setHistory] = useState(false);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!noteId && !templateId) return;
    setLocalRoot(personalNote ? noteId ?? undefined : undefined);
    setDepth(1);
    setPassageId(undefined);
    setMode(canvas || templateId ? 'logic' : 'graph');
    setSelected(personalNote ? undefined : noteId ?? undefined);
    setActiveRelation(evidenceKey);
    setFilter('');
  }, [noteId, personalNote, evidenceKey, canvas, templateId]);
  const personal = !!localRoot;
  const graph = useMemo(() => personal ? buildPersonalNoteGraph(library) : buildNoteGraph(library, history), [library, history, personal]);
  const availableCenters = useMemo(() => graph.notes.filter(n => !n.archivedAt), [graph.notes]);
  const center = graph.notes.find(item => item.id === localRoot);
  const layers = useMemo(() => localRoot ? exploreNoteLayers(graph, localRoot, depth) : undefined, [graph, localRoot, depth]);
  const adjacency = graph.adjacency;
  const degrees = useMemo(() => new Map(graph.notes.map(n => [n.id, adjacency.get(n.id)?.length ?? 0])), [graph.notes, adjacency]);
  const query = filter.trim().normalize('NFKC').toLocaleLowerCase();
  // These groups describe the existing graph, rather than inventing topic classifications.
  const groups = useMemo(() => [
    { key: 'core', label: '多关联笔记', color: '#7654a8', count: 0 },
    { key: 'linked', label: '关联笔记', color: '#247a66', count: 0 },
    { key: 'single', label: '独立笔记', color: '#386eaa', count: 0 },
  ].map(group => ({ ...group, count: graph.notes.filter(n => {
    const degree = adjacency.get(n.id)?.length ?? 0;
    return group.key === (degree > 1 ? 'core' : degree ? 'linked' : 'single');
  }).length })), [graph.notes, adjacency]);
  const notes = useMemo(() => graph.notes.filter(n => {
    if (layers) return layers.ids.has(n.id);
    const degree = degrees.get(n.id) ?? 0;
    const group = degree > 1 ? 'core' : degree ? 'linked' : 'single';
    return !hiddenGroups.includes(group) && (!connectedOnly || degree > 0) &&
      (!query || n.title.normalize('NFKC').toLocaleLowerCase().includes(query));
  }), [graph.notes, layers, degrees, hiddenGroups, connectedOnly, query]);
  const note = notes.find(item => item.id === selected);
  const relations = useMemo<KnowledgeRelation[]>(() => {
    if (!note || personal) return [];
    const edges = adjacency.get(note.id) ?? [];
    const otherNotes = edges.map(edge => {
      if (edge.from === note.id) return edge.relation;
      const source = graph.sources.get(edge.from)!;
      return { ...edge.relation, id: source.id, source, title: edge.relation.kind === '冲突' ? edge.relation.title : source.title };
    });
    const projectRelations = knowledgeRelations(note, index.filter(source => !source.noteId), library, history);
    return [...otherNotes, ...projectRelations].sort((a, b) => Number(b.kind === '冲突') - Number(a.kind === '冲突'));
  }, [note, personal, adjacency, graph.sources, index, library, history]);
  const decisions = useMemo(() => new Map(library.decisions.map(item => [item.evidence, item.result])), [library]);
  const current = relations.find(item => item.evidenceKey === activeRelation);
  const trigger = useRef<Element | null>(null);
  const select = (id: string, evidence?: string) => {
    if (!inspector.current?.contains(document.activeElement)) trigger.current = document.activeElement;
    setPassageId(undefined);
    setSelected(id);
    if (window.matchMedia('(max-width: 900px)').matches) setFiltersOpen(false);
    setActiveRelation(evidence);
    setNotice('');
    requestAnimationFrame(() => inspector.current?.focus({ preventScroll:true }));
  };
  const dismiss = (restoreFocus = false) => {
    setPassageId(undefined); setSelected(undefined); setActiveRelation(undefined); setNotice('');
    if (restoreFocus) requestAnimationFrame(() => {
      const el = trigger.current;
      if (el?.isConnected && (el instanceof HTMLElement || el instanceof SVGElement)) el.focus({ preventScroll:true });
      else document.querySelector<HTMLInputElement>('.qd-planet-atlas input[type=search]')?.focus({preventScroll:true});
    });
  };
  const selectEdge = (edge: KnowledgeGraphEdge) =>
    select(note && edge.members.includes(note.id) ? note.id : edge.members.find(id => notes.some(n => n.id === id)) ?? edge.from, edge.relation.evidenceKey);
  const visibleEdges = useMemo(() => {
    const visible = new Set(notes.map(item => item.id));
    return graph.edges.filter(edge => edge.members.filter(id => visible.has(id)).length >= Math.min(2, edge.members.length));
  }, [notes, graph.edges]);

  const outlines = useMemo(() => new Map(personal ? notes.map(n => [n.id,noteOutline(n)]) : []), [personal,notes]);
  const visiblePassages = useMemo(() => !showContent ? [] :
    [...outlines].flatMap(([id, passages]) => expandedNotes.has(id) ? passages : passages.slice(0,OUTLINE_PREVIEW)), [outlines,expandedNotes,showContent]);
  const passagesById = useMemo(() => new Map(visiblePassages.map(p => [p.id,p])), [visiblePassages]);
  const passage = passageId && passagesById.get(passageId) || undefined;
  const canvasNotes = useMemo<CanvasNode[]>(() => [...notes,...visiblePassages], [notes,visiblePassages]);
  const edgeIndex = useMemo(() => new Map(visibleEdges.map(e => [e.relation.evidenceKey,e])), [visibleEdges]);
  const canvasEdges = useMemo<CanvasEdge[]>(() => [
    ...visibleEdges.map(e => ({members:e.members, key:e.relation.evidenceKey, label:personal ? '手动关联' : relationLabel(e.relation), conflict:e.relation.kind === '冲突'})),
    ...visiblePassages.map(passageEdge),
  ], [visibleEdges,visiblePassages,personal]);
  const selectedPath = note ? layers?.paths.get(note.id) : undefined;
  const pathTitles = selectedPath?.map(id => graph.sources.get(id)?.title ?? '') ?? [];
  const notePassages = note && outlines.get(note.id) || [];
  function selectPassage(item: NotePassage) {
    select(item.owner);
    setPassageId(item.id);
  }
  function pickNode(id: string) {
    const item = passagesById.get(id);
    if (item) selectPassage(item);
    else select(id);
  }
  function pickEdge(edge: CanvasEdge) {
    if (edge.content) { const item = passagesById.get(edge.members[1]); if (item) selectPassage(item); return; }
    const source = edgeIndex.get(edge.key);
    if (source) selectEdge(source);
  }
  const relatedNotes = useMemo(() => {
    if (!note) return [];
    const ids = new Set((adjacency.get(note.id) ?? []).flatMap(edge => edge.members).filter(id => id !== note.id));
    return graph.notes.filter(n => ids.has(n.id) && (!layers || layers.ids.has(n.id))).map(({id, title}) => ({id, title}));
  }, [note, adjacency, graph.notes, layers]);
  function resetFilters() { setFilter(''); setHiddenGroups([]); setConnectedOnly(false); }
  function explore(id: string) {
    if (!availableCenters.some(n => n.id === id)) return;
    resetFilters();
    setLocalRoot(id);
    setDepth(1);
    setExpandedNotes(new Set());
    setPicker(undefined);
    setSelected(undefined);
    setPassageId(undefined);
    setActiveRelation(undefined);
    setMapView('map');
    setNotice('');
    if (window.innerWidth <= 900) setFiltersOpen(false);
  }
  function selectRelated(id: string) {
    resetFilters();
    select(id);
  }
  function globalView() { setLocalRoot(undefined); setDepth(1); dismiss(); resetFilters(); }
  function openLocal() {
    if (localRoot) return;
    if (note && !note.archivedAt) explore(note.id);
    else if (availableCenters.length === 1) explore(availableCenters[0].id);
    else setPicker('center');
  }
  function changeDepth(value: number) {
    setDepth(value);
    if (localRoot && selected && !exploreNoteLayers(graph,localRoot,value).ids.has(selected)) dismiss();
  }
  function closeFilters() {
    setFiltersOpen(false);
    requestAnimationFrame(() => filterToggle.current?.focus());
  }
  useEffect(() => {
    if (ready && localRoot && !center) { setLocalRoot(undefined); setPicker(undefined); dismiss(); }
  }, [ready, localRoot, center]);
  useEffect(() => {
    let wide = window.innerWidth > 900;
    const resize = () => {
      const next = window.innerWidth > 900;
      if (next !== wide) { setFiltersOpen(next); wide = next; }
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    const surface = graphSurface.current;
    if (!surface) return;
    const resize = () => {
      if (window.innerWidth > 600) { setSurfaceHeight(undefined); return; }
      const rect = surface.getBoundingClientRect();
      const ratio = rect.width / surface.offsetWidth || 1;
      setSurfaceHeight(Math.max(190, (window.innerHeight - Math.max(0,rect.top) - 32) / ratio));
    };
    resize();
    window.addEventListener('resize',resize);
    // The existing product navigation can wrap without a viewport resize.
    const observer = new ResizeObserver(resize);
    const header = surface.previousElementSibling;
    if (header) observer.observe(header);
    return () => { window.removeEventListener('resize',resize); observer.disconnect(); };
  }, [mode,ready,personal]);
  useLayoutEffect(() => {
    if (!ready || mode !== 'graph') return;
    let focusFrame = 0;
    const searchShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || helpOpen) return;
      const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]';
      if (event.composedPath().some(target => target instanceof Element && target.closest(editable))) return;
      const popup = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')]
        .some(element => element.getClientRects().length && !element.closest('[hidden], [aria-hidden="true"], [inert]') && getComputedStyle(element).visibility !== 'hidden');
      if (popup) return;
      event.preventDefault();
      if (personal) {setPicker('center');return;}
      setFiltersOpen(true);
      if (searchInput.current) searchInput.current.focus();
      else focusFrame = requestAnimationFrame(() => searchInput.current?.focus());
    };
    // Scoped to this mounted graph view, so it also works while the main navigation has focus.
    document.addEventListener('keydown',searchShortcut);
    return () => { document.removeEventListener('keydown',searchShortcut); cancelAnimationFrame(focusFrame); };
  }, [ready,mode,helpOpen,personal]);
  function graphKey(event: React.KeyboardEvent<HTMLElement>) {
    if (picker) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (helpOpen) setHelpOpen(false);
      else if (filtersOpen && window.innerWidth <= 900) closeFilters();
      else if (note) dismiss(true);
    }
    if (event.key === 'Tab' && window.innerWidth <= 900) {
      const panel = helpOpen ? helpPanel.current : filtersOpen ? filterPanel.current : note ? inspector.current : null;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  async function decide(relation: KnowledgeRelation, result: KnowledgeDecision['result']) {
    setNotice('');
    setSaving(true);
    try {
      await mutateKnowledge(library => {
        const decision = { evidence: relation.evidenceKey, result, at: new Date().toISOString() };
        library.decisions = [...library.decisions.filter(entry => entry.evidence !== decision.evidence), decision];
      });
      setNotice(result === 'dismissed' ? '已忽略这条发现。' : '已保留这条关联。');
    } catch (error) { setNotice(asError(error)); }
    finally { setSaving(false); }
  }

  return <main className={"qd-knowledge-page qd-library-page" + (mode === 'graph' ? ' qd-white-graph' : '')}>
    <header className="qd-idea-top">
      <h1>帮你想</h1>
      <div className="qd-idea-switch" role="group" aria-label="帮你想视图">
        <button type="button" aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}><Icon name="bulb" size={16}/>知识图谱</button>
        <button type="button" aria-pressed={mode === 'logic'} onClick={() => setMode('logic')}><Icon name="merge" size={16}/>灵感逻辑</button>
      </div>
      {mode === 'graph' && ready && !personal && <GraphAgentAction library={library}/>}
    </header>
    {error && <p className="qd-knowledge-message" role="alert">{error}</p>}
    {!ready ? <p className="qd-knowledge-message" role="status">正在读取笔记…</p>
      : mode === 'logic' ? <InspirationCanvas initialTemplateId={templateId} initialSelection={canvas && noteId ? {kind:canvas,id:noteId} : undefined} library={library} onOpenNote={onOpenNote}/>
      : <section className="qd-planet-atlas qd-idea-panel" aria-label="知识图谱与关联说明" onKeyDown={graphKey}>
        <header className="qd-idea-atlas-head">
          <div className="qd-graph-heading"><h2>知识图谱</h2><p><span>{notes.length} 篇笔记</span> · <span>{visibleEdges.length} {personal ? '条手动关联' : '条连线'}</span></p></div>
          <div className="qd-idea-switch compact" role="group" aria-label="图谱范围">
            <button type="button" aria-pressed={!localRoot} onClick={globalView}>全局图谱</button>
            <button type="button" aria-pressed={!!localRoot} disabled={!availableCenters.length}
              onClick={openLocal}>局部图谱</button>
          </div>
          <div className="qd-planet-actions">
            <button type="button" className="qd-graph-tool" aria-label="操作说明" aria-expanded={helpOpen} onClick={() => {
              setHelpOpen(!helpOpen);
              if (!helpOpen) requestAnimationFrame(() => helpPanel.current?.querySelector('button')?.focus());
            }}><Icon name="help-circle" size={17}/><span>操作说明</span></button>
            <button ref={filterToggle} type="button" className="qd-graph-tool" aria-expanded={filtersOpen} aria-controls="knowledge-graph-filters"
              aria-label={filtersOpen ? '收起筛选面板' : '展开筛选面板'} onClick={() => {
                const next = !filtersOpen; setFiltersOpen(next);
                if (next && window.innerWidth <= 900) { dismiss(); requestAnimationFrame(() => searchInput.current?.focus()); }
              }}><Icon name="sliders" size={17}/></button>
          </div>
        </header>
        {center && layers && <div className="qd-personal-bar">
          <label className="qd-personal-center">中心笔记<select aria-label="中心笔记" value={center.id} onChange={event => explore(event.target.value)}>
            {graph.notes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
          <div className="qd-personal-depth" role="group" aria-label="看多远"><span>看多远</span>
            {['直接关联','最多 2 步','最多 3 步'].map((label,i) => <button key={label} type="button" aria-pressed={depth===i+1} onClick={() => changeDepth(i+1)}>{label}</button>)}
          </div>
          <button type="button" className="qd-personal-link" onClick={() => setPicker('links')}><Icon name="link" size={15}/>关联其他图谱</button>
          <div className="qd-personal-status" role="status">
            {notice && <span>{notice} · </span>}<span>{!layers.layerCounts[0] ? '尚未关联其他图谱'
              : layers.nextCount ? <button type="button" onClick={() => changeDepth(depth+1)}>再看 {layers.nextCount} 篇间接关联</button>
              : depth === 3 ? '已显示 3 步内的关联' : '已显示全部关联'}</span>
          </div>
        </div>}
        <div ref={graphSurface} className="qd-planet-body" style={surfaceHeight ? {height:surfaceHeight} : undefined} data-open={!!note} data-filters={filtersOpen}>
          {filtersOpen && <>
            <button type="button" className="qd-graph-scrim" aria-label="关闭筛选面板" onClick={closeFilters}/>
            <aside ref={filterPanel} id="knowledge-graph-filters" className="qd-graph-filters" aria-label="图谱筛选">
              <header><strong>探索你的知识</strong><small>EXPLORE</small><button type="button" className="qd-planet-close" aria-label="关闭筛选" onClick={closeFilters}><Icon name="close" size={16}/></button></header>
              {!personal && <label className="qd-library-search"><Icon name="search" size={15}/>
                <input ref={searchInput} type="search" maxLength={150} value={filter} onChange={event => {setFilter(event.target.value);dismiss();}}
                  aria-label="查找图中笔记" placeholder="搜索笔记标题"/>
                {filter ? <button type="button" aria-label="查看全部笔记" onClick={() => setFilter('')}><Icon name="close" size={13}/></button> : <kbd>/</kbd>}
              </label>}
              <button type="button" className="qd-graph-browse" onClick={() => setMapView(mapView === 'map' ? 'list' : 'map')}>{mapView === 'map' ? '按列表浏览笔记' : '回到图谱画布'}<Icon name="arrow-right" size={12}/></button>
              {!personal && <><div className="qd-graph-filter-title"><span>知识分组</span><button type="button" onClick={() => setHiddenGroups([])}>全部显示</button></div>
              <p className="qd-graph-group-hint">按现有连线数量分组</p>
              {groups.map(group => <label className="qd-graph-group" key={group.key}>
                <input type="checkbox" aria-label={'显示' + group.label} checked={!hiddenGroups.includes(group.key)} onChange={event => setHiddenGroups(current => event.target.checked ? current.filter(key => key !== group.key) : [...current,group.key])}/>
                <i style={{background:group.color}}/><span>{group.label}</span><small>{group.count}</small>
              </label>)}
              </>}
              <div className="qd-graph-options">
                <label>显示笔记名称<input type="checkbox" checked={labels} onChange={event => setLabels(event.target.checked)}/></label>
                {personal && <label>显示正文要点<input type="checkbox" checked={showContent} onChange={event => {setShowContent(event.target.checked);setPassageId(undefined);}}/></label>}
                {!personal && <><label>仅看有关联的笔记<input type="checkbox" checked={connectedOnly} onChange={event => setConnectedOnly(event.target.checked)}/></label>
                <label>显示已忽略<input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)}/></label></>}
              </div>
              <details className="qd-graph-physics">
                <summary>布局与引力<Icon name="chevron-right" size={13}/></summary>
                <label htmlFor="knowledge-graph-repulsion">节点斥力<output>{physics.repulsion}%</output></label>
                <input id="knowledge-graph-repulsion" aria-label="节点斥力" type="range" min="40" max="180" step="10" value={physics.repulsion}
                  onChange={event => setPhysics(current => ({...current,repulsion:Number(event.target.value)}))}/>
                <label htmlFor="knowledge-graph-elasticity">连线弹性<output>{physics.elasticity}%</output></label>
                <input id="knowledge-graph-elasticity" aria-label="连线弹性" type="range" min="40" max="180" step="10" value={physics.elasticity}
                  onChange={event => setPhysics(current => ({...current,elasticity:Number(event.target.value)}))}/>
                <p>调整节点疏密，以及拖动时的连线牵引和回弹速度。</p>
                <button type="button" disabled={physics.repulsion === 100 && physics.elasticity === 100} onClick={() => setPhysics(DEFAULT_GRAPH_PHYSICS)}>恢复默认引力</button>
              </details>
              <div className="qd-idea-switch compact" role="group" aria-label="图谱显示方式">
                <button type="button" aria-pressed={mapView === 'map'} onClick={() => setMapView('map')}>图谱</button>
                <button type="button" aria-pressed={mapView === 'list'} onClick={() => setMapView('list')}>列表</button>
              </div>
              {!personal && <button type="button" className="qd-graph-reset" onClick={resetFilters}>重置筛选</button>}
              <p className="qd-graph-filter-foot"><Icon name="merge" size={13}/>一个节点，一条思考的线索</p>
            </aside>
          </>}
          <div className="qd-graph-canvas">
            {mapView === 'map' ? notes.length ? <KnowledgeGraph rootId={localRoot} selectedPath={selectedPath} notes={canvasNotes} edges={canvasEdges} selected={passage?.id ?? note?.id} activeEdge={activeRelation} labels={labels} degrees={degrees} physics={physics}
              onSelect={pickNode} onLocal={id => {const item=passagesById.get(id); if (item) selectPassage(item); else if (graph.notes.find(n => n.id === id)?.archivedAt) select(id); else explore(id);}} onSelectEdge={pickEdge} onDismiss={() => dismiss()}/>
              : <div className="qd-library-empty"><Icon name={graph.notes.length ? 'search' : 'bulb'} size={30}/>
                  <p>{!graph.notes.length ? '写下第一篇笔记后，这里就会显示它。' : query ? '没有匹配标题的笔记。' : '当前筛选下没有笔记。'}</p>
                  {graph.notes.length ? <button className="qd-btn ghost" type="button" onClick={resetFilters}>重置筛选</button>
                    : <button className="qd-btn ghost" type="button" onClick={() => window.dispatchEvent(new Event('quandeck:show-notes'))}>写笔记 <Icon name="arrow-right" size={14}/></button>}
                </div>
            : <div className="qd-planet-list">
                <div className="qd-idea-lines" role="region" aria-label="连线列表">
                  {visibleEdges.length ? visibleEdges.map(edge => <button key={edge.relation.evidenceKey} type="button" aria-pressed={activeRelation === edge.relation.evidenceKey} onClick={() => selectEdge(edge)}>
                    <strong>{graph.sources.get(edge.members[0])?.title}</strong><span>{personal ? '手动关联' : relationLabel(edge.relation)}</span>
                    <strong>{edge.members.length === 1 ? '本篇内的记录' : edge.members.slice(1).map(id => graph.sources.get(id)?.title).join('、')}</strong>
                  </button>) : <p>{query && !notes.length ? '没有匹配标题的笔记。' : '暂无连线。'}</p>}
                </div>
                <details open className="qd-planet-directory"><summary>笔记目录（{notes.length}）</summary>
                  {notes.map(n => <button type="button" key={n.id} onClick={() => select(n.id)}>{n.title}<Icon name="chevron-right" size={14}/></button>)}
                </details>
              </div>}
          </div>
          {note && <aside ref={inspector} tabIndex={-1} className="qd-idea-inspector qd-planet-drawer" aria-label="笔记与连线详情">
            <header><h3><Icon name={current ? 'link' : 'pencil'} size={16}/>{current ? '连线说明' : '笔记详情'}</h3>
              <button type="button" className="qd-planet-close" aria-label="关闭说明" onClick={() => dismiss(true)}><Icon name="close" size={16}/></button></header>
            <div className="qd-graph-detail-scroll">
              {personal && pathTitles.length > 1 && <p className="qd-personal-path" aria-label="关联路径"><strong>关联路径 · {pathTitles.length-1} 步</strong><span>{pathTitles.join(' → ')}</span></p>}
              {personal && activeRelation && !passage && <p className="qd-personal-path">这两篇笔记由你手动关联。</p>}
              {!personal && notice && <p role="status">{notice}</p>}
              {passage ? <section className="qd-passage-detail"><small>来自《{note.title}》 · 第 {passage.line+1} 行</small>
                <h2>原文{passage.kind}</h2><blockquote>{passage.quote}</blockquote><button type="button" className="qd-link" onClick={() => onOpenNote(note.id,undefined,passage.line)}>打开原文 <Icon name="external" size={14}/></button>
              </section> : current ? <>
                <button type="button" className="qd-link qd-planet-back" onClick={() => setActiveRelation(undefined)}><Icon name="chevron-left" size={14}/>笔记详情</button>
                <IdeaEvidence note={note} noteSource={graph.sources.get(note.id)!} relation={current}
                  decision={decisions.get(current.evidenceKey)} saving={saving} onOpen={open} onDecide={result => void decide(current,result)}/>
              </> : <IdeaDetail key={note.id} note={note} relations={relations} decisions={decisions} onOpenNote={onOpenNote} onRelation={key => select(note.id,key)} relatedNotes={relatedNotes} onSelectNote={selectRelated} hideEvidence={personal}/>}
              {personal && !passage && notePassages.length > OUTLINE_PREVIEW && <button type="button" className="qd-link qd-personal-more" onClick={() => {
                setShowContent(true);
                setExpandedNotes(previous => {const next=new Set(previous);if(next.has(note.id)) next.delete(note.id);else next.add(note.id);return next;});
              }}>{expandedNotes.has(note.id) ? '收起正文要点' : '显示全部 '+notePassages.length+' 条正文要点'}</button>}
            </div>
            {!note.archivedAt && <footer className="qd-graph-expand">
              {note.id !== localRoot ? <button type="button" onClick={() => explore(note.id)}><Icon name="merge" size={17}/><span>{localRoot ? '以这篇笔记为中心' : '打开本篇图谱'}</span><Icon name="arrow-right" size={16}/></button>
                : <button type="button" onClick={() => setPicker('links')}><Icon name="link" size={16}/><span>管理直接关联</span></button>}
            </footer>}
          </aside>}
          {helpOpen && <aside ref={helpPanel} className="qd-graph-help" aria-label="图谱操作说明"><header><strong>顺着线索，继续想</strong><button type="button" aria-label="关闭操作说明" onClick={() => setHelpOpen(false)}><Icon name="close" size={16}/></button></header>
            <dl><dt>拖动星球</dt><dd>牵引相邻节点，松手后弹性回归。</dd><dt>单击节点</dt><dd>打开详情抽屉，阅读原文或打开笔记编辑。</dd><dt>展开关联</dt><dd>双击笔记打开本篇图谱。小圆点是本篇的正文要点。手动连接其他图谱后，可沿这些连线查看最多 3 步。</dd><dt>缩放和平移</dt><dd>滚轮、双指或下方按钮缩放；拖动空白平移，复位按钮适应画布。</dd><dt>键盘操作</dt><dd>/ 搜索，聚焦画布后用方向键切换节点，Enter 打开，Esc 关闭抽屉。</dd></dl>
            <p>分组与连线来自当前笔记和现有关系。点击连线可查看依据，未找到关联的笔记也会保留。</p>
          </aside>}
        </div>
        {picker === 'center' && <NoteGraphPicker notes={availableCenters} onClose={() => setPicker(undefined)} onPick={explore}/>}
        {picker === 'links' && center && <NoteGraphPicker key={center.id} notes={graph.notes} root={center}
          initialIds={(adjacency.get(center.id) ?? []).map(e => e.from===center.id ? e.to : e.from)}
          onClose={() => setPicker(undefined)} onUpdated={() => {setPicker(undefined);setNotice('已更新图谱');}}/>}
        <footer className="qd-planet-foot"><details className="qd-library-method"><summary>连线怎么来的？</summary>
          <p>{personal ? '正文连线表示笔记包含的小节或要点。跨笔记的连线由你确认，一条算一步。' : '本机会比对笔记里的链接、关键词和数值。Agent 可以核对原文，识别同源、补充、矛盾、复用和创新。点一条线即可查看依据。'}</p></details><span>拖动节点感受引力 · 单击查看详情</span>
        </footer>
      </section>}
  </main>;
}
