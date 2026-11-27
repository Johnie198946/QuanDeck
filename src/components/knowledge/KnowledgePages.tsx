import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import {
  buildKnowledgeIndex, buildNoteGraph, knowledgeKindLabels, knowledgeRelations, recommendKnowledge, searchKnowledge,
  type KnowledgeGraphEdge, type KnowledgeRelation, type KnowledgeSource,
} from '../../data/knowledgeIndex';
import { emptyKnowledge, KNOWLEDGE_FILES, type KnowledgeDecision } from '../../data/knowledgeNotes';
import { downloadOutputFile } from '../../data/outputFiles';
import { mutateKnowledge, onKnowledgeChange, readKnowledge } from '../../data/knowledgeStore';
import { Icon, type IconName } from '../ui/Icon';
import type { Snapshot } from '../../data/types';
import type { NoteSelection } from '../../data/knowledgeNotes';
import type { OpenNoteReceipt } from './NoteReceiptMarks';
import { NotesWorkspace, type NoteDraft } from './NotesPage';
import { KnowledgeGraph } from './KnowledgeGraph';
import { InspirationCanvas } from './InspirationCanvas';
import { GraphAgentAction } from './GraphAgentAction';
import { IdeaDetail } from './IdeaDetail';
import { IdeaEvidence, readableNote, relationLabel } from './IdeaEvidence';
import { NoteThumbnail } from './NoteThumbnail';
import './knowledge.css';
import './knowledge-graph.css';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const asError = (error: unknown) => error instanceof Error ? error.message : '暂时无法加载资料，请重试';

function useKnowledgeLibrary() {
  const [library, setLibrary] = useState(emptyKnowledge);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let sequence = 0, current = true;
    const load = async () => {
      const ticket = ++sequence;
      try {
        const next = await readKnowledge();
        if (current && sequence === ticket) { setLibrary(next); setError(''); setReady(true); }
      } catch (error) {
        if (current && sequence === ticket) { setError(asError(error)); setReady(true); }
      }
    };
    const unsubscribe = onKnowledgeChange(() => void load());
    void load();
    return () => { current = false; unsubscribe(); };
  }, []);
  return { library, error, ready };
}

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

export function useKnowledgeRecommendations(query: string) {
  const { index } = useKnowledgeIndex();
  return useMemo(() => recommendKnowledge(index, query), [index, query]);
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

export function NotesPage({ noteId, todoId, lineIndex, quote, selection, initialDraft, projects, onOpenReceipt }: { projects: Snapshot[]; onOpenReceipt: OpenNoteReceipt; selection?: NoteSelection; noteId?: string | null; todoId?: string; lineIndex?: number; quote?: string; initialDraft?: NoteDraft }) {
  const { library, error, ready } = useKnowledgeLibrary();
  return <main className="qd-knowledge-page">{ready
    ? <NotesWorkspace library={library} target={noteId} todoId={todoId} lineIndex={lineIndex} quote={quote} selection={selection} initialDraft={initialDraft} error={error} projects={projects} onOpenReceipt={onOpenReceipt} />
    : <p className="qd-knowledge-message" role="status">正在读取笔记…</p>}</main>;
}

type OpenDoors = { onOpenNote: (id: string) => void; onOpenProject?: (id: string) => void };
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

export function IdeasPage({ noteId, evidenceKey, onOpenNote, onOpenProject }: OpenDoors & { noteId?: string | null; evidenceKey?: string }) {
  const { library, error, index, ready } = useKnowledgeIndex();
  const open = useOpenSource({ onOpenNote, onOpenProject });
  const [mode, setMode] = useState<'graph' | 'logic'>('graph');
  const [mapView, setMapView] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<string>();
  const [activeRelation, setActiveRelation] = useState<string>();
  const [history, setHistory] = useState(false);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => { if (noteId) { setMode('graph'); setSelected(noteId); setActiveRelation(evidenceKey); setFilter(''); } }, [noteId, evidenceKey]);
  const graph = useMemo(() => buildNoteGraph(library, history), [library, history]);
  const adjacency = graph.adjacency;
  const query = filter.trim().normalize('NFKC').toLocaleLowerCase();
  const notes = useMemo(() => query ? graph.notes.filter(note => note.title.normalize('NFKC').toLocaleLowerCase().includes(query)) : graph.notes, [graph.notes, query]);
  const note = notes.find(item => item.id === selected) ?? notes.find(item => adjacency.has(item.id)) ?? notes[0];
  const relations = useMemo<KnowledgeRelation[]>(() => {
    if (!note) return [];
    const edges = adjacency.get(note.id) ?? [];
    const otherNotes = edges.map(edge => {
      if (edge.from === note.id) return edge.relation;
      const source = graph.sources.get(edge.from)!;
      return { ...edge.relation, id: source.id, source, title: edge.relation.kind === '冲突' ? edge.relation.title : source.title };
    });
    const projectRelations = knowledgeRelations(note, index.filter(source => !source.noteId), library, history);
    return [...otherNotes, ...projectRelations].sort((a, b) => Number(b.kind === '冲突') - Number(a.kind === '冲突'));
  }, [note, adjacency, graph.sources, index, library, history]);
  const decisions = useMemo(() => new Map(library.decisions.map(item => [item.evidence, item.result])), [library]);
  const current = relations.find(item => item.evidenceKey === activeRelation) ?? relations[0];
  const focusInspector = () => {
    if (matchMedia('(max-width: 820px)').matches) requestAnimationFrame(() => {
      inspector.current?.focus({ preventScroll: true });
      inspector.current?.scrollIntoView({ block: 'start' });
    });
  };
  const select = (id: string, evidence?: string) => {
    setSelected(id);
    setActiveRelation(evidence);
    setNotice('');
  };
  const selectEdge = (edge: KnowledgeGraphEdge) => {
    select(note && edge.members.includes(note.id) ? note.id : edge.members.find(id => notes.some(n => n.id === id)) ?? edge.from, edge.relation.evidenceKey);
    focusInspector();
  };
  const visibleEdges = useMemo(() => {
    const visible = new Set(notes.map(item => item.id));
    return graph.edges.filter(edge => edge.members.filter(id => visible.has(id)).length >= Math.min(2, edge.members.length));
  }, [notes, graph.edges]);

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

  return <main className="qd-knowledge-page qd-library-page">
    <header className="qd-idea-top">
      <h1>帮你想</h1>
      <div className="qd-idea-switch" role="group" aria-label="帮你想视图">
        <button type="button" aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}><Icon name="bulb" size={16}/>知识图谱</button>
        <button type="button" aria-pressed={mode === 'logic'} onClick={() => setMode('logic')}><Icon name="merge" size={16}/>灵感逻辑</button>
      </div>
      {mode === 'graph' && ready && <GraphAgentAction library={library}/>}
    </header>
    {error && <p className="qd-knowledge-message" role="alert">{error}</p>}
    {!ready ? <p className="qd-knowledge-message" role="status">正在读取笔记…</p>
      : mode === 'logic' ? <InspirationCanvas library={library} onOpenNote={onOpenNote}/>
      : <div className="qd-idea-workspace">
        <aside className="qd-idea-shelf qd-idea-panel" aria-label="灵感清单">
          <header><h2>灵感清单</h2><small>{graph.notes.length} 篇笔记</small></header>
          {graph.notes.length > 0 && <label className="qd-library-search"><Icon name="search" size={15}/>
            <input type="search" maxLength={150} value={filter} onChange={event => setFilter(event.target.value)}
              aria-label="查找图中笔记" placeholder="查找图中笔记"/>
          </label>}
          <ul>{notes.map(item => <li key={item.id}><button type="button" aria-current={note?.id === item.id ? 'true' : undefined} onClick={() => select(item.id)}>
            <NoteThumbnail note={item} icon="bulb"/><strong>{item.title}</strong><small>{readableNote(item.body).slice(0, 62) || (item.attachments.length ? '含附件' : '尚无正文')}</small>
            <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('zh-CN', { month:'short', day:'numeric' })}</time>
          </button></li>)}</ul>
          {query && <button type="button" className="qd-link qd-idea-reset" onClick={() => setFilter('')}>查看全部笔记</button>}
        </aside>
        {note ? <IdeaDetail key={note.id} note={note} relations={relations} activeKey={current?.evidenceKey} decisions={decisions}
          onOpenNote={onOpenNote} onRelation={key => { setActiveRelation(key); focusInspector(); }}/>
          : <section className="qd-idea-panel qd-library-empty"><Icon name={query ? 'search' : 'bulb'} size={30}/>
            <p>{query ? '没有匹配标题的笔记。' : '写下第一篇笔记后，这里就会显示它。'}</p>
            {!query && <button className="qd-btn ghost" type="button" onClick={() => window.dispatchEvent(new Event('quandeck:show-notes'))}>写笔记 <Icon name="arrow-right" size={14}/></button>}
          </section>}
        <section className="qd-idea-atlas qd-idea-panel" aria-label="知识图谱与关联说明">
          <header className="qd-idea-atlas-head"><div><h2>知识图谱</h2><p>{visibleEdges.length} 条连线</p></div>
            <div className="qd-idea-switch compact" role="group" aria-label="图谱显示方式">
              <button type="button" aria-pressed={mapView === 'map'} onClick={() => setMapView('map')}>图谱</button>
              <button type="button" aria-pressed={mapView === 'list'} onClick={() => setMapView('list')}>列表</button>
            </div>
          </header>
          {mapView === 'map' && notes.length > 0 && <KnowledgeGraph notes={notes} edges={visibleEdges} adjacency={adjacency} selected={note?.id} activeEdge={current?.evidenceKey}
            onSelect={id => { select(id); focusInspector(); }} onSelectEdge={selectEdge}/>}
          {mapView === 'list' && <div className="qd-idea-lines" role="region" aria-label="连线列表">
            {visibleEdges.length ? visibleEdges.map(edge => <button key={edge.relation.evidenceKey} type="button" aria-pressed={current?.evidenceKey === edge.relation.evidenceKey}
              onClick={() => selectEdge(edge)}>
              <strong>{graph.sources.get(edge.members[0])?.title}</strong><span>{relationLabel(edge.relation)}</span>
              <strong>{edge.members.length === 1 ? '本篇内的记录' : edge.members.slice(1).map(id => graph.sources.get(id)?.title).join('、')}</strong>
            </button>) : <p>暂无连线。</p>}
          </div>}
          <aside tabIndex={-1} ref={inspector} className="qd-idea-inspector" aria-label="笔记与连线详情">
            <header><h3><Icon name="link" size={16}/>连线说明</h3><label><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)}/>显示已忽略</label></header>
            {notice && <p role="status">{notice}</p>}
            {note && current ? <IdeaEvidence note={note} noteSource={graph.sources.get(note.id)!} relation={current}
              decision={decisions.get(current.evidenceKey)} saving={saving} onOpen={open} onDecide={result => void decide(current,result)}/>
              : <p>{note ? '这篇笔记暂时没有连线。' : '选中笔记或连线，可以查看关联依据。'}</p>}
          </aside>
          <details className="qd-library-method"><summary>连线怎么来的？</summary>
            <p>本机会比对笔记里的链接、关键词和数值。共同提及只是一条线索，可以点开连线查看两端原文。</p>
            <p>也可以请 Agent 阅读笔记、解释关系。图上标出解读来源；你可以保留或忽略每条发现。</p>
          </details>
        </section>
      </div>}
  </main>;
}
