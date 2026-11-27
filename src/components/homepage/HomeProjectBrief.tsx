import { useMemo, useState } from 'react';
import { fileNoteQuote, unfileNoteQuote } from '../../data/knowledgeStore';
import { NoteTaskDialog, type NoteTaskSource } from '../knowledge/NoteTaskDialog';
import { Icon } from '../ui/Icon';
import { BriefLibrary } from './BriefLibrary';
import { BriefEvidenceDialog } from './BriefEvidenceDialog';
import { briefDate, BriefTaskTrail } from './BriefTaskTrail';
import type { BoardProps } from './HomeBoard';
import { HomeBoardDetail } from './HomeBoardDetail';
import { needsHandoff, homeBoardCards, type BoardCard } from './homeBoardData';
import { briefHandoff, buildProjectBriefs, PERSONAL_BRIEF_ID, searchBriefEvidence, type BriefEvidence, type ProjectBrief } from './projectBriefs';
import { ProjectBriefInsights } from './ProjectBriefInsights';
import { RelatedDrafts } from './RelatedDrafts';
import './project-brief.css';

interface Props extends BoardProps { onCreateProject: () => void; onOpenMonitor: (id: string) => void }

function railStatus(brief: ProjectBrief) {
  if (brief.waitingOnMe) return brief.waitingOnMe + ' 项等我处理';
  if (brief.focus && needsHandoff(brief.focus)) return briefHandoff(brief.focus).label;
  if (brief.counts.running) return brief.counts.running + ' 项进行中';
  if (brief.counts.pending) return brief.counts.pending + ' 项待开始';
  return brief.cards.length ? '全部完成' : '暂无任务';
}

export function HomeProjectBrief({projects,notes,legacyNoteSources,today,onCreateProject,onCreateTask,onOpenMonitor,...navigation}: Props) {
  const {onOpenBoardTask,onOpenProject,onOpenNote} = navigation;
  const {briefs,evidence} = useMemo(() => {
    const now = Date.now();
    return buildProjectBriefs(projects,homeBoardCards(projects,notes,legacyNoteSources,now),notes,now);
  }, [projects,notes,legacyNoteSources,today]);
  const [picked,setPicked] = useState('');
  const [search,setSearch] = useState('');
  const [scope,setScope] = useState('');
  const [library,setLibrary] = useState(false);
  const [detail,setDetail] = useState('');
  const [reading,setReading] = useState<BriefEvidence>();
  const [sending,setSending] = useState<NoteTaskSource>();
  const [filing,setFiling] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const active = briefs.find(brief => brief.id === picked) ?? briefs[0];
  const rows = useMemo(() => library ? searchBriefEvidence(evidence,search,scope || undefined) : [], [evidence,search,scope,library]);
  const selected = active?.cards.find(card => card.key === detail);
  const personal = active?.id === PERSONAL_BRIEF_ID;
  const filteredScope = scope && scope === active?.id ? scope : '';

  function selectProject(id: string) {
    setPicked(id); setSearch(''); setLibrary(false); setScope(''); setError(''); setNotice('');
  }

  function openLibrary() {
    setScope(active?.id ?? ''); setSearch(''); setLibrary(true);
  }

  function openTask(card: BoardCard) {
    if (card.projectId && card.taskId) onOpenBoardTask(card.projectId,card.taskId);
    else setDetail(card.key);
  }

  function openEvidence(row: BriefEvidence) {
    if (row.noteId && (row.kind === 'note' || row.kind === 'source')) {
      onOpenNote(row.noteId,row.todoId,row.lineIndex,row.text); return;
    }
    if (row.kind === 'progress' || row.kind === 'decision' || row.kind === 'source' || (row.kind === 'result' && !row.resultId)) {
      setReading(row); return;
    }
    if (row.projectId && row.taskId) { onOpenBoardTask(row.projectId,row.taskId,row.itemId,row.resultId); return; }
    const containing = row.cardKey && briefs.find(brief => brief.cards.some(card => card.key === row.cardKey));
    if (containing && row.cardKey) { setPicked(containing.id); setDetail(row.cardKey); return; }
    if (row.projectId && row.projectId !== PERSONAL_BRIEF_ID) onOpenProject(row.projectId);
  }

  async function manageQuote(row: BriefEvidence) {
    if (!active || !row.noteId || filing) return;
    setError(''); setNotice(''); setFiling(row.id);
    try {
      if (row.filingId && row.projectId === active.id) {
        await unfileNoteQuote(row.noteId,row.filingId); setNotice('已移出「' + active.name + '」');
      } else if (row.lineIndex !== undefined) {
        await fileNoteQuote(active.id,row.noteId,row.lineIndex,row.text); setNotice('已归入「' + active.name + '」');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { setFiling(''); }
  }

  function filingButton(row: BriefEvidence) {
    if (!active || personal || !row.noteId || (row.kind !== 'note' && row.kind !== 'source')) return null;
    const remove = !!row.filingId && row.projectId === active.id;
    if (!remove && (row.lineIndex === undefined || row.projectId === active.id || active.evidence.some(other =>
      other.noteId === row.noteId && other.lineIndex === row.lineIndex && other.text === row.text))) return null;
    return <button type="button" className="qpb-file" disabled={!!filing} onClick={() => void manageQuote(row)}>
      <Icon name={remove ? 'undo' : 'plus'} size={12}/>{remove ? '移出本项目资料' : '归入「' + active.name + '」'}</button>;
  }

  const focus = active?.focus;
  const handoff = focus && briefHandoff(focus);
  const latest = active?.evidence.find(row => row.kind === 'progress' || row.kind === 'decision' || row.kind === 'result');
  return <div className="qpb-workspace">
    <aside className="qpb-rail" aria-label="项目索引">
      <label className="qpb-find"><Icon name="search" size={14}/><input type="search" aria-label="找原话或成果" placeholder="找原话、进展、成果…" value={search}
        onChange={e => { setSearch(e.target.value); setNotice(''); setError(''); if (!library) setScope(''); setLibrary(true); }}/></label>
      <div className="qpb-railhead"><span>我的项目</span><button type="button" aria-label="新建项目" onClick={onCreateProject}><Icon name="plus" size={14}/></button></div>
      <nav className="qpb-index" aria-label="选择项目简报">{briefs.map(brief => <button key={brief.id} type="button"
        aria-label={'查看简报 ' + brief.name} aria-pressed={active?.id === brief.id} onClick={() => selectProject(brief.id)}>
        <Icon name={brief.id === PERSONAL_BRIEF_ID ? 'check-square' : 'folder'} size={15}/>
        <span><strong>{brief.name}</strong><small>{railStatus(brief)}</small></span>
      </button>)}</nav>
    </aside>
    {library ? <div className="qpb-dossier">
      {active && !personal && scope === active.id && !search.trim() && <RelatedDrafts brief={active} allEvidence={evidence} onOpen={openEvidence} filingButton={filingButton}/>}
      <BriefLibrary key={search + '|' + filteredScope} records={rows} briefs={briefs} active={active} query={search} scope={filteredScope}
        setScope={setScope} onOpen={openEvidence} manageSource={filingButton} onClose={() => {setLibrary(false);setScope('');setSearch('');setError('');}}/>
      {error && <p role="alert" className="qhb-error">{error}</p>}
      {notice && <p role="status" className="qpb-notice">{notice}</p>}
    </div> : active ? <article key={active.id} className="qpb-dossier" aria-label={active.name + '项目简报'}>
      <header className="qpb-title">
        <div><h3>{active.name}</h3>{active.goal && <p>{active.goal}</p>}</div>
        {!personal && <button type="button" onClick={() => onOpenProject(active.id)}>打开项目<Icon name="external" size={12}/></button>}
      </header>
      <div className={'qpb-next ' + (handoff?.needsMe ? 'is-attention' : '')}>
        <div className="qpb-signal"><Icon name={handoff?.needsMe ? 'bell' : 'arrow-right'} size={14}/>{focus && needsHandoff(focus) ? handoff?.label : focus?.state === 'done' ? '已收尾' : '下一步'}</div>
        <div className="qpb-next-copy"><h4>{active.nextAction || active.summary}</h4>{active.why && <p>{active.why}</p>}</div>
        {focus ? <button className="qpb-primary" type="button" onClick={() => {
          if (active.focusTarget?.resultId) openEvidence(active.focusTarget);
          else if (focus.attention && handoff?.needsMe) onOpenMonitor(focus.attention.id);
          else openTask(focus);
        }}>{active.focusTarget?.resultId ? '看成果' : active.actionLabel}<Icon name="arrow-right" size={13}/></button> :
          !personal && <button className="qpb-primary" type="button" onClick={() => onCreateTask(active.id)}>新建任务<Icon name="plus" size={13}/></button>}
      </div>
      {latest && <button className="qpb-latest" type="button" onClick={() => openEvidence(latest)}>
        <Icon name="clock" size={14}/><span>最近变化</span><strong>{active.summary}</strong><time dateTime={latest.at}>{briefDate(latest.at)}</time><Icon name="chevron-right" size={12}/>
      </button>}
      {!!active.cards.length && <BriefTaskTrail brief={active} onEvidence={openEvidence} onTask={openTask} onLibrary={openLibrary}/>}
      {!active.cards.length && <button type="button" className="qpb-text-action" onClick={openLibrary}>查看项目资料<Icon name="chevron-right" size={13}/></button>}
      {!personal && !!active.evidence.length && <ProjectBriefInsights projectId={active.id} sources={active.evidence} onOpenSource={id => {
        const row=active.evidence.find(item=>item.id === id);
        if (row) openEvidence(row);
      }}/>}
    </article> : <div className="qpb-dossier qpb-no-project"><Icon name="folder" size={25}/><h3>还没有项目</h3>
      <button className="qpb-primary" type="button" onClick={onCreateProject}><Icon name="plus" size={14}/>新建项目</button></div>}
    {selected && <HomeBoardDetail key={selected.key} card={selected} notes={notes} projects={projects} {...navigation}
      onClose={() => setDetail('')} onSend={source => {setDetail('');setSending(source);}}/>}
    {sending && <NoteTaskDialog source={sending} onOpenTask={({projectId,taskId})=>onOpenBoardTask(projectId,taskId)} onClose={() => setSending(undefined)}/>}
    {reading && <BriefEvidenceDialog entry={reading} onClose={() => setReading(undefined)} onLocate={() => {
      setReading(undefined);
      if (reading.noteId) onOpenNote(reading.noteId,reading.todoId,reading.lineIndex);
      else if (reading.projectId && reading.taskId) onOpenBoardTask(reading.projectId,reading.taskId,reading.itemId);
      else if (reading.projectId) onOpenProject(reading.projectId);
    }}/>}
  </div>;
}
