import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import {
  buildKnowledgeIndex, buildNoteGraph, knowledgeKindLabels, knowledgeRelations, recommendKnowledge, searchKnowledge,
  type KnowledgeGraphEdge, type KnowledgeRelation, type KnowledgeSource,
} from '../../data/knowledgeIndex';
import { emptyKnowledge, KNOWLEDGE_FILES, type KnowledgeDecision } from '../../data/knowledgeNotes';
import { downloadOutputFile } from '../../data/outputFiles';
import { mutateKnowledge, onKnowledgeChange, readKnowledge } from '../../data/knowledgeStore';
import { Icon } from '../ui/Icon';
import { NotesWorkspace, type NoteDraft } from './NotesPage';
import { KnowledgeGraph } from './KnowledgeGraph';
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

export function useImportantKnowledge(): { id: string; title: string; noteId: string }[] {
  const { library, index } = useKnowledgeIndex();
  return useMemo(() => {
    const active = [...library.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15);
    const acknowledged = new Set(library.decisions.map(item => item.evidence));
    const unique = new Map<string, { id: string; title: string; noteId: string; priority: number }>();
    for (const note of active) {
      for (const relation of knowledgeRelations(note, index, library)) {
        if (acknowledged.has(relation.evidenceKey) || relation.kind !== '冲突' && relation.kind !== '同源') continue;
        const source = relation.source;
        const key = JSON.stringify(['note:' + note.id, source.id].sort());
        if (unique.has(key)) continue;
        unique.set(key, {
          id: relation.evidenceKey, noteId: note.id, priority: relation.kind === '冲突' ? 2 : 1,
          title: relation.kind === '冲突' ? note.title + ' · ' + relation.title : note.title + ' · 和「' + source.title + '」引用同一链接',
        });
      }
    }
    return [...unique.values()].sort((a, b) => b.priority - a.priority).slice(0, 3);
  }, [library, index]);
}

export function NotesPage({ noteId, initialDraft }: { noteId?: string | null; initialDraft?: NoteDraft }) {
  const { library, error, ready } = useKnowledgeLibrary();
  return <main className="qd-knowledge-page">{ready
    ? <NotesWorkspace library={library} target={noteId} initialDraft={initialDraft} error={error} />
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
      {hits.length > 0 && <ol aria-label="查找结果">{hits.slice(0, max).map(source => <li key={source.id}>
        <button type="button" className="qd-knowledge-hit" onClick={() => void open(source)}>
          <Icon name={source.kind === 'project' ? 'folder' : source.kind === 'task' ? 'check-square' : source.kind === 'file' ? 'box' : 'external'} size={19}/>
          <div><strong>{source.title}</strong><p>{source.excerpt}</p><small>{knowledgeKindLabels[source.kind]} · {source.projectName ?? '个人笔记'}{source.at && ` · ${new Date(source.at).toLocaleDateString('zh-CN')}`}</small></div>
          <Icon name="chevron-right" size={16}/>
        </button>
      </li>)}</ol>}
      {hits.length > max && <button type="button" className="qd-btn ghost" onClick={() => setMax(current => current + 24)}>显示更多</button>}
    </div>}
  </main>;
}

export function IdeasPage({ noteId, onOpenNote, onOpenProject }: OpenDoors & { noteId?: string | null }) {
  const { library, error, index, ready } = useKnowledgeIndex();
  const open = useOpenSource({ onOpenNote, onOpenProject });
  const [selected, setSelected] = useState<string>();
  const [activeRelation, setActiveRelation] = useState<string>();
  const [history, setHistory] = useState(false);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => { if (noteId) { setSelected(noteId); setActiveRelation(undefined); setFilter(''); } }, [noteId]);
  const graph = useMemo(() => buildNoteGraph(library, history), [library, history]);
  const adjacency = useMemo(() => {
    const neighbours = new Map<string, KnowledgeGraphEdge[]>();
    for (const edge of graph.edges) {
      for (const id of [edge.from, edge.to]) {
        const list = neighbours.get(id);
        if (list) list.push(edge);
        else neighbours.set(id, [edge]);
      }
    }
    for (const edges of neighbours.values()) edges.sort((a, b) => b.relation.rank - a.relation.rank);
    return neighbours;
  }, [graph.edges]);
  const query = filter.trim().normalize('NFKC').toLocaleLowerCase();
  const notes = useMemo(() => query ? graph.notes.filter(note => note.title.normalize('NFKC').toLocaleLowerCase().includes(query)) : graph.notes, [graph.notes, query]);
  const note = graph.notes.find(item => item.id === selected);
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
  const select = (id?: string) => {
    setSelected(id);
    setActiveRelation(undefined);
    setNotice('');
    if (id && matchMedia('(max-width: 1000px)').matches) {
      requestAnimationFrame(() => {
        inspector.current?.focus({ preventScroll: true });
        inspector.current?.scrollIntoView({ block: 'start' });
      });
    }
  };

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
    <header className="qd-library-header">
      <h1>帮你想</h1>
      <details className="qd-library-method"><summary>连线怎么来的？</summary>
        <p>图谱由本机规则生成，无需调用大模型。每篇已保存的笔记都是一个节点。共用同一链接或出现足够明确的共同关键词时会连线。相关笔记中，如果同一指标用相同单位写了不同数值，例如两处预算的金额不同，就会标为可能冲突。</p>
        <p>点笔记可查看连线依据。主动使用笔记中的「就这段提问」才会调用已连接的模型。追加到笔记的答复也会参与匹配。</p>
      </details>
    </header>
    {error && <p className="qd-knowledge-message" role="alert">{error}</p>}
    {!ready ? <p className="qd-knowledge-message" role="status">正在读取笔记…</p> : <div className="qd-library-layout">
      <section className="qd-library-panel" aria-labelledby="qd-library-graph-title">
        <header className="qd-library-panel-head">
          <div><h2 id="qd-library-graph-title">知识图谱</h2>
            <p>{graph.notes.length} 篇笔记 <span>·</span> {graph.edges.length} 条连线 <span>·</span> {graph.notes.length - adjacency.size} 篇暂无连线</p></div>
          {graph.notes.length > 0 && <label className="qd-library-search"><Icon name="search" size={16} />
            <input type="search" maxLength={150} value={filter} onChange={event => setFilter(event.target.value)} aria-label="查找图中笔记" placeholder="查找图中笔记" />
          </label>}
        </header>
        {notes.length > 0 ? <KnowledgeGraph notes={notes} edges={graph.edges} adjacency={adjacency} selected={note?.id} onSelect={select} />
          : <p className="qd-library-empty">{query ? '没有匹配标题的笔记。' : '写下第一篇笔记后，这里就会显示它。'}</p>}
        <footer className="qd-library-panel-foot">
          <span><i />有依据的关联</span><span><i />可能冲突</span>
          {graph.edges.length > 220 && <span>图上优先显示主要连线</span>}
          {query && <button type="button" className="qd-link" onClick={() => setFilter('')}>查看全部笔记</button>}
        </footer>
      </section>
      <aside ref={inspector} tabIndex={-1} className="qd-library-panel qd-library-inspector" aria-label="笔记与连线详情">
        {!note ? <><h2>连线依据</h2><p>点一篇笔记，查看它的原文和关联依据。</p></> : <>
          <header><h2>{note.title}</h2><button type="button" className="qd-icon-btn" aria-label="清除当前笔记选择" title="清除选择" onClick={() => select()}><Icon name="close" size={16} /></button></header>
          <p className="qd-library-excerpt">{note.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim() || (note.attachments.length ? '只有附件' : '笔记暂无正文')}</p>
          <button type="button" className="qd-link" onClick={() => onOpenNote(note.id)}>打开笔记 <Icon name="external" size={14}/></button>
          <div className="qd-library-inspector-heading"><h3>连线依据</h3><label><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} />显示已忽略</label></div>
          {notice && <p role="status">{notice}</p>}
          {relations.length > 0 ? <>
            <ul className="qd-library-relations" aria-label="来自其他资料的关联">{relations.map(relation => <li key={relation.evidenceKey}>
              <button type="button" aria-pressed={current?.evidenceKey === relation.evidenceKey} onClick={() => setActiveRelation(relation.evidenceKey)}>
                <span data-kind={relation.kind}>{relation.kind === '冲突' ? '可能冲突' : relation.kind}</span>
                <strong>{relation.source.title}</strong>
                {decisions.get(relation.evidenceKey) === 'dismissed' && <small>已忽略</small>}
              </button>
            </li>)}</ul>
            {current && <article className="qd-library-evidence" aria-label="关联依据">
              <h3>{current.title}</h3>
              <ul>{current.evidence.map((line, i) => <li key={i}>{line}</li>)}</ul>
              <p>{current.source.projectName ?? '个人笔记'} · {knowledgeKindLabels[current.source.kind]}</p>
              <div><button type="button" className="qd-link" onClick={() => void open(current.source)}>打开来源 <Icon name="external" size={13}/></button>
                {current.kind === '冲突' && decisions.get(current.evidenceKey) === 'accepted' && <span>已确认</span>}
                {current.kind === '冲突' && decisions.get(current.evidenceKey) === undefined && <button type="button" className="qd-link" disabled={saving} onClick={() => void decide(current, 'accepted')}>确认有冲突</button>}
                {decisions.get(current.evidenceKey) !== 'dismissed' && <button type="button" className="qd-link" disabled={saving} onClick={() => void decide(current, 'dismissed')}>忽略</button>}
                {decisions.get(current.evidenceKey) === 'dismissed' && <button type="button" className="qd-link" disabled={saving} onClick={() => void decide(current, 'accepted')}>重新保留</button>}</div>
            </article>}
          </> : <p>还没有找到有依据的关联。</p>}
        </>}
      </aside>
    </div>}
  </main>;
}
