import { useMemo, useRef, useState } from 'react';
import type { Snapshot } from '../../data/types';
import { projectMemoryNotes, type ProjectMemoryNote } from '../../data/projectMemoryNotes';
import { useWorkdeck } from '../../state/WorkdeckContext';

const labels = { situation: '适用情境', action: '采用的做法', outcome: '观察到的结果', limitation: '限制与下次调整' } as const;
const blank = { situation: '', action: '', outcome: '', limitation: '' };

export function ProjectReflection({ snapshot }: { snapshot: Snapshot }) {
  const { api } = useWorkdeck();
  const [edit, setEdit] = useState<ProjectMemoryNote>();
  const [form, setForm] = useState(blank);
  const [artifactId, setArtifactId] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(8);
  const pending = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const notes = useMemo(() => projectMemoryNotes(snapshot).filter(note => note.status !== 'withdrawn'), [snapshot]);
  const sources = useMemo(() => {
    const eligible = (snapshot.collaboration?.artifacts ?? []).filter(item => {
    const task = snapshot.collaboration?.tasks[item.key];
    return task?.acceptedArtifactId === item.id && !task.archived && !task.requiresRevalidation;
    });
    const found = eligible.filter(item => (item.title + ' ' + snapshot.collaboration?.tasks[item.key]?.title).toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase())).slice(0, 30);
    const selected = eligible.find(item => item.id === artifactId);
    return selected && !found.includes(selected) ? [selected, ...found] : found;
  }, [snapshot, sourceQuery, artifactId]);
  const save = async (status: ProjectMemoryNote['status'], current?: ProjectMemoryNote) => {
    if (busy) return;
    setBusy(true); setMessage('');
    const original = current ?? edit;
    const source = snapshot.collaboration?.artifacts.find(item => item.id === (current?.source.artifactId ?? artifactId));
    try {
      const payload = {
        ...(original ? { noteId: original.noteId, expectedRevision: original.revision } : {}),
        status, ...(current ? { situation: current.situation, action: current.action, outcome: current.outcome, limitation: current.limitation } : form),
        ...(source ? { artifactId: source.id, artifactHash: source.hash } : {}),
      };
      const fingerprint = JSON.stringify({ projectId: snapshot.project.id, payload });
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: 'memory-note:' + crypto.randomUUID() };
      const result = await api.collaborate({ projectId: snapshot.project.id, type: 'record_memory_note', idempotencyKey: pending.current.key, payload });
      if (!result.ok) throw new Error(result.message || '保存失败');
      pending.current = undefined;
      setMessage(status === 'withdrawn' ? '已撤回，历史版本仍可追溯' : status === 'confirmed' ? '已确认适用经验；不会改变项目规范' : '已保存候选经验');
      setEdit(undefined); setForm(blank); setArtifactId(''); setOpen(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <section className="qd-memory-reflection" aria-label="项目复盘经验">
    <p>记录什么情境下有效、依据是什么、下次如何调整。确认后的相关经验可供新任务参考，不替代规范。</p>
    <button type="button" className="qd-btn ghost" disabled={busy} onClick={() => { setOpen(!open); setEdit(undefined); setForm(blank); setArtifactId(''); }}>记录一次复盘</button>
    {open && <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save('candidate'); }}>
      {Object.entries(labels).map(([key, label]) => <label key={key}>{label}<textarea required maxLength={1000} rows={2} value={form[key as keyof typeof form]} onChange={event => setForm(value => ({ ...value, [key]: event.target.value }))} /></label>)}
      <label>查找已验收来源<input type="search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="成果或任务名称" /></label>
      <label>作为依据的成果<select required value={artifactId} onChange={event => setArtifactId(event.target.value)}><option value="">请选择当前已验收的成果</option>{sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
      {!sources.length && <p>暂无匹配的已验收成果。随手想法可以先记在项目中，有结果后再提炼经验。</p>}
      <button type="submit" className="qd-btn primary" disabled={busy || !artifactId}>保存候选经验</button>
    </form>}
    <p role="status">{message}</p>
    {!notes.length && <p>尚无复盘经验。任务完成后，可从具体成果中提炼下一次能用的做法。</p>}
    {notes.slice(0, limit).map(note => <article key={note.id}>
      <header><strong>{note.situation}</strong><span>{note.stale ? '来源变化，需复核' : note.status === 'confirmed' ? '已确认经验' : '候选经验'} · v{note.revision}</span></header>
      <dl><dt>做法</dt><dd>{note.action}</dd><dt>结果</dt><dd>{note.outcome}</dd><dt>限制与下次调整</dt><dd>{note.limitation}</dd></dl>
      <div className="qd-memory-note-actions"><button type="button" className="qd-link" onClick={() => setSourceOpen(sourceOpen === note.id ? undefined : note.id)}>查看依据</button><button type="button" className="qd-link" disabled={busy} onClick={() => { setEdit(note); setForm({ situation: note.situation, action: note.action, outcome: note.outcome, limitation: note.limitation }); setArtifactId(note.source.artifactId); setSourceQuery(''); setOpen(true); }}>修订</button>{note.status === 'candidate' && <button type="button" className="qd-link" disabled={busy || note.stale} onClick={() => void save('confirmed', note)}>确认经验</button>}<button type="button" className="qd-link" disabled={busy} onClick={() => void save('withdrawn', note)}>撤回</button></div>
      {sourceOpen === note.id && <div className="qd-memory-note-source"><p>来源任务：{snapshot.collaboration?.tasks[note.source.taskKey]?.title ?? '来源任务已删除'} · 验收 {note.source.reviewId}</p><pre>{snapshot.collaboration?.artifacts.find(item => item.id === note.source.artifactId)?.body ?? '来源已删除，不能作为当前依据'}</pre></div>}
    </article>)}
    {notes.length > limit && <button type="button" className="qd-btn ghost" onClick={() => setLimit(value => value + 8)}>再看 8 条</button>}
  </section>;
}
