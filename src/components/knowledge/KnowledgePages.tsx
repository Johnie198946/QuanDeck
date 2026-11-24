import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import {
  buildKnowledgeIndex, knowledgeKindLabels, knowledgeRelations, recommendKnowledge, searchKnowledge,
  type KnowledgeRelation, type KnowledgeSource,
} from '../../data/knowledgeIndex';
import { emptyKnowledge, KNOWLEDGE_FILES, type KnowledgeDecision } from '../../data/knowledgeNotes';
import { downloadOutputFile } from '../../data/outputFiles';
import { mutateKnowledge, onKnowledgeChange, readKnowledge } from '../../data/knowledgeStore';
import { Icon } from '../ui/Icon';
import { NotesWorkspace, type NoteDraft } from './NotesPage';
import './knowledge.css';

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
    const active = library.notes.filter(note => !note.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15);
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
  const [notice, setNotice] = useState('');
  useEffect(() => { if (noteId) { setSelected(noteId); setActiveRelation(undefined); } }, [noteId]);
  const notes = useMemo(() => library.notes.filter(note => !note.archivedAt && (note.body.trim() || note.attachments.length))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [library]);
  const note = notes.find(item => item.id === selected) ?? notes[0];
  const relations = useMemo(() => note ? knowledgeRelations(note, index, library, history) : [], [note, index, library, history]);
  const decisions = useMemo(() => new Map(library.decisions.map(item => [item.evidence, item.result])), [library]);
  const current = relations.find(item => item.id === activeRelation) ?? relations[0];

  async function decide(relation: KnowledgeRelation, result: KnowledgeDecision['result']) {
    setNotice('');
    try {
      await mutateKnowledge(library => {
        library.decisions.push({ evidence: relation.evidenceKey, result, at: new Date().toISOString() });
      });
      setNotice(result === 'dismissed' ? '已忽略这条发现。' : '已保留这条关联。');
    } catch (error) { setNotice(asError(error)); }
  }

  return <main className="qd-knowledge-page">
    <header className="qd-knowledge-head"><h1>帮你想</h1></header>
    {(error || notice) && <p className="qd-knowledge-message" role="status">{error || notice}</p>}
    {!ready ? <p className="qd-knowledge-message">正在读取记录…</p> : !note ? <div className="qd-knowledge-empty"><p>有了记录，就能在这里看见它们之间的联系。</p></div> : <div className="qd-ideas-grid">
      <aside className="qd-knowledge-list" aria-label="灵感列表"><h2>灵感</h2><ul>{notes.map(item => <li key={item.id}>
        <button type="button" aria-current={note.id === item.id ? 'true' : undefined} onClick={() => { setSelected(item.id); setActiveRelation(undefined); }}>
          <strong>{item.title}</strong><small>{item.body.trim().slice(0, 52)}</small>
        </button>
      </li>)}</ul></aside>
      <article className="qd-idea-original"><h2>{note.title}</h2><p>{note.body || '只有附件'}</p><button type="button" className="qd-link" onClick={() => onOpenNote(note.id)}>打开笔记 <Icon name="external" size={14}/></button></article>
      <section className="qd-idea-graph" aria-label="知识图谱">
        <div className="qd-idea-graph-head"><h2>知识图谱</h2><button type="button" className="qd-link" aria-pressed={history} onClick={() => setHistory(value => !value)}>{history ? '仅当前发现' : '含已忽略发现'}</button></div>
        {relations.length ? <>
          <div className="qd-idea-graph-map"><strong>{note.title}</strong><ul aria-label="相关来源">{relations.map(relation => <li key={relation.id} data-kind={relation.kind}>
            <button type="button" aria-pressed={current?.id === relation.id} onFocus={() => setActiveRelation(relation.id)} onMouseEnter={() => setActiveRelation(relation.id)} onClick={() => void open(relation.source)}
              title={relation.evidence.join('\n')}><small>{relation.kind}{decisions.get(relation.evidenceKey) === 'dismissed' ? ' · 已忽略' : ''}</small>{relation.source.title}</button>
          </li>)}</ul></div>
          {current && <article className="qd-idea-evidence" aria-label="关联依据">
            <h3>{current.title}</h3>
            <ul>{current.evidence.map(line => <li key={line}>{line}</li>)}</ul>
            <p>{current.source.projectName ?? '个人笔记'} · {knowledgeKindLabels[current.source.kind]}</p>
            <div><button type="button" className="qd-link" onClick={() => void open(current.source)}>打开来源 <Icon name="external" size={13}/></button>
              {current.kind === '冲突' && decisions.get(current.evidenceKey) === 'accepted' && <span>已确认</span>}
              {current.kind === '冲突' && decisions.get(current.evidenceKey) === undefined && <button type="button" className="qd-link" onClick={() => void decide(current, 'accepted')}>确认有冲突</button>}
              {decisions.get(current.evidenceKey) !== 'dismissed' && <button type="button" className="qd-link" onClick={() => void decide(current, 'dismissed')}>忽略</button>}
              {decisions.get(current.evidenceKey) === 'dismissed' && <button type="button" className="qd-link" onClick={() => void decide(current, 'accepted')}>重新保留</button>}</div>
          </article>}
        </> : <p className="qd-knowledge-empty">还没有找到有依据的关联。</p>}
      </section>
    </div>}
  </main>;
}
