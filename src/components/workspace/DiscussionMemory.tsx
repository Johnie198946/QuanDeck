import { useMemo, useState } from 'react';
import { discussionMemory, providedSessionMemory, type ProvidedLesson } from '../../data/discussionMemory';
import { hashText } from '../../data/contentHash';
import { projectMemoryNotes } from '../../data/projectMemoryNotes';
import type { Session } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';

export function DiscussionMemory({ session, planId, scope, through }: { session?: Session; planId: string; scope: string; through?: string }) {
  const { snap } = useWorkdeck();
  const rows = useMemo(() => discussionMemory(snap, session?.id, planId, scope, through), [snap, session?.id, planId, scope, through]);
  return <ProvidedMemory rows={rows} label={through === undefined ? '已提供给本次讨论的经验' : '回复时已提供的经验'} sessionId={session?.id} />;
}

export function ExecutionMemory({ sessionId }: { sessionId: string }) {
  const { snap } = useWorkdeck();
  const rows = useMemo(() => providedSessionMemory(snap, sessionId), [snap, sessionId]);
  return <ProvidedMemory rows={rows} label="已提供给本次执行的经验" initialLabel="首次执行" sessionId={sessionId} />;
}

function ProvidedMemory({ rows, label, sessionId, initialLabel = "首次提问" }: { rows: ProvidedLesson[]; label: string; sessionId?: string; initialLabel?: string }) {
  const { snap } = useWorkdeck();
  const [expanded, setExpanded] = useState(false);
  // Resolving current source validity can inspect accepted artifacts. Only do it on request.
  const current = useMemo(() => expanded ? projectMemoryNotes(snap) : [], [expanded, snap]);
  if (!rows.length) return null;
  return <details key={sessionId} onToggle={event => setExpanded(event.currentTarget.open)} className="my-2 text-xs text-[var(--qd-muted)]">
    <summary className="w-fit cursor-pointer py-1">{label} · {rows.length}</summary>
    {expanded && <ul className="my-2 grid max-h-[min(32vh,20rem)] gap-3 overflow-y-auto overscroll-contain border-l border-[var(--qd-line)] pl-3">
      {rows.map(row => <LessonRow key={row.note.id} row={row} initialLabel={initialLabel} current={current.find(n => n.noteId === row.note.noteId)} />)}
    </ul>}
  </details>;
}

function LessonRow({ row: { note, source, followUpAt }, current, initialLabel }: { row: ProvidedLesson; initialLabel: string; current?: ReturnType<typeof projectMemoryNotes>[number] }) {
  const [readSource, setReadSource] = useState(false);
  const changed = current?.status === 'withdrawn' ? '现已撤回'
    : current && current.revision !== note.revision ? '已修订至 v' + current.revision
    : !current || current.stale ? '当前来源需复核' : undefined;
  const sourceVerified = useMemo(() => source && hashText(source.body) === note.source.hash, [source, note.source.hash]);
  return <li className="grid gap-1 leading-relaxed [overflow-wrap:anywhere]">
    <p><strong className="text-[var(--qd-text)]">{note.situation}</strong> · v{note.revision} · {followUpAt
      ? '追问 ' + new Date(followUpAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : initialLabel}{changed && ' · ' + changed}</p>
    <p>{note.action}</p>
    <p>适用限制：{note.limitation}</p>
    {source && sourceVerified ? <details onToggle={event => setReadSource(event.currentTarget.open)}>
      <summary className="w-fit cursor-pointer">来源：{source.title} · v{source.version}</summary>
      {readSource && <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap" tabIndex={0} aria-label="来源正文">{source.body}</div>}
    </details> : <p>原始成果已不可核对</p>}
  </li>;
}
