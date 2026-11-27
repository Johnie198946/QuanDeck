import { useRef, useState, type ReactNode } from 'react';
import { KNOWLEDGE_FILES } from '../../data/knowledgeNotes';
import { usedKnowledgeFiles } from '../../data/deleteKnowledgeNote';
import { readKnowledge, saveNoteTodoOutcome } from '../../data/knowledgeStore';
import type { NoteTodo } from '../../data/noteTodos';
import { saveOutputFile, removeOutputFile } from '../../data/outputFiles';
import { draftRevision, withOutcomeLock, outcomeDraftKey, readOutcomeDraft, type OutcomeDraft } from '../../data/scheduleOutcomeDraft';
import type { ClosingProgress } from '../../data/scheduleProgress';
import { dateInZone, instant, nextDate, timeInZone } from '../../data/timeline';
import type { OutputAttachment, Snapshot } from '../../data/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ScheduleFilePicker } from './ScheduleFilePicker';
import { clearProgressDraft, progressDraft } from './ScheduleProgressLog';

export type OutcomeMode = 'record' | 'wait' | 'receive';
type Props = {
  now: number; zone: string; projects: Snapshot[]; onClose: () => void; onSaved?: () => void; inline?: boolean;
} & ({ noteId: string; todo: NoteTodo; mode: OutcomeMode } | {
  entryKey: string; title: string; currentResult: string; completed: boolean;
  submitPlan: (result: string, progress?: ClosingProgress) => Promise<void>;
});

export function ScheduleOutcomeDialog(props: Props) {
  const {now,zone,projects,onClose} = props;
  const note = 'todo' in props ? props : undefined;
  const todo = note?.todo;
  const mode = note?.mode ?? 'record';
  const entryKey = 'entryKey' in props ? props.entryKey :
    (mode === 'receive' ? 'followup:' : 'note:') + props.noteId + ':' + props.todo.id;
  const key = outcomeDraftKey(entryKey,mode);
  const [draft,setDraft] = useState<OutcomeDraft>(() => readOutcomeDraft(key) ?? {
    text: 'currentResult' in props ? props.currentResult : mode === 'receive' ? '' : mode === 'wait' ? todo?.followup?.note ?? '' : todo?.outcome?.text ?? '',
    url: todo?.outcome?.url ?? '', projectId:todo?.outcome?.projectId ?? '', purpose:todo?.outcome?.purpose ?? '',
    date: todo?.followup?.dueAt ? dateInZone(Date.parse(todo.followup.dueAt),zone) : nextDate(dateInZone(now,zone)),
    time:timeInZone(Date.parse(todo?.followup?.dueAt ?? todo?.dueAt ?? '') || now,zone), files:[], expectedAt:todo?.outcome?.at ?? null,
  });
  const [initialRevision] = useState(() => draftRevision(key));
  const revision = useRef(initialRevision);
  const current = useRef(draft);
  const locked = useRef(false);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const completing = mode !== 'wait' && (mode === 'receive' || ('completed' in props ? !props.completed : !todo?.completedAt));
  const newerOutcome = note && draft.expectedAt !== (todo?.outcome?.at ?? null);
  const label = completing ? '保存并完成日程' : '保存';
  const title = mode === 'wait' ? '设为待跟进' : mode === 'receive' ? '记下收到的材料' : '记录结果';

  function update(patch: Partial<OutcomeDraft>) {
    if (draftRevision(key) !== revision.current) {
      setError('草稿已在其他窗口更新，请收起后重新打开。'); return false;
    }
    const next = {...current.current, ...patch, revision:crypto.randomUUID()};
    try {
      localStorage.setItem(key, JSON.stringify(next)); revision.current = next.revision;
      current.current = next; setDraft(next); setError(''); return true;
    } catch {
      if (!patch.files) {current.current = next; setDraft(next);}
      setError('本机空间不足。请在离开前保存结果。'); return false;
    }
  }
  async function addFiles(files: File[]) {
    if (locked.current || !files.length) return;
    const added: OutputAttachment[] = [];
    locked.current = true; setBusy(true);
    try {
      if ((todo?.outcome?.files?.length ?? 0) + current.current.files.length + files.length > 20) throw Error('每份结果最多 20 个文件');
      for (const file of files) added.push(await saveOutputFile(KNOWLEDGE_FILES,file));
      if (!update({files:[...current.current.files,...added]})) throw Error('文件未能加入，请重新打开草稿后再试');
    } catch (cause) {
      await Promise.allSettled(added.map(f=>removeOutputFile(KNOWLEDGE_FILES,f.id)));
      setError(cause instanceof Error ? cause.message : '材料未能保存');
    } finally { locked.current=false; setBusy(false); }
  }
  async function removeFile(file: OutputAttachment) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      await withOutcomeLock(key,async () => {
        const used = usedKnowledgeFiles(await readKnowledge());
        if (!update({files: current.current.files.filter(f=>f.id!==file.id)})) return;
        if (!used.has(file.id)) await removeOutputFile(KNOWLEDGE_FILES,file.id);
      });
    } catch {setError('材料移除失败，请重试');}
    finally {locked.current=false;setBusy(false);}
  }
  async function submit() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await withOutcomeLock(key,async () => {
        const savedRevision = revision.current;
        if (draftRevision(key) !== savedRevision) throw Error('草稿已在其他窗口更新，请收起后重新打开。');
        const progress = progressDraft(entryKey);
        if ('submitPlan' in props) await props.submitPlan(draft.text, progress);
        else {
          const dueAt = mode === 'wait' ? instant(draft.time,draft.date,zone) : undefined;
          if (dueAt && Date.parse(dueAt) <= now) throw Error('请选择未来的跟进时间');
          await saveNoteTodoOutcome(props.noteId,props.todo.id,{
            text:draft.text,url:draft.url,dueAt,received:mode==='receive',finish:true,
            ...(mode !== 'wait' && {projectId:draft.projectId,purpose:draft.purpose}),
            appendFiles:draft.files.filter(f=>!todo?.outcome?.files?.some(saved=>saved.id===f.id)),expectedAt:draft.expectedAt,progress,
          });
        }
        if (progress) clearProgressDraft(entryKey,progress.id);
        if (draftRevision(key) === savedRevision) localStorage.removeItem(key);
      });
      (props.onSaved ?? onClose)();
    } catch (cause) {setError(cause instanceof Error ? cause.message : '保存失败，请重试');}
    finally {locked.current=false; setBusy(false);}
  }
  const disabled = mode === 'wait' ? !draft.date || !draft.time : !draft.text.trim() && !draft.url.trim() && !draft.files.length && !todo?.outcome?.files?.length;
  const fields: ReactNode = <>
    {newerOutcome && <p role="status" className="qh-shelf-purpose">
      这份结果在别处更新了。最新记录为「{todo?.outcome?.text || todo?.outcome?.url || '材料已调整'}」。
      <button type="button" className="qd-link" onClick={()=>update({expectedAt:todo?.outcome?.at ?? null})}>保留我的草稿并继续</button>
    </p>}
    {mode === 'wait' && <div className="qh-outcome-when">
      <label>下次跟进日期<input type="date" value={draft.date} onChange={e=>update({date:e.target.value})}/></label>
      <label>时间<input type="time" value={draft.time} onChange={e=>update({time:e.target.value})}/></label>
    </div>}
    <label>{mode === 'wait' ? '已做什么（可选）' : '结果说明'}
      <textarea autoFocus rows={3} maxLength={2000} value={draft.text} onChange={e=>update({text:e.target.value})}
        placeholder="写下结论、拿到的材料，或保存位置"/>
    </label>
    {note && <details open={draft.url || draft.projectId || draft.purpose || draft.files.length ? true : undefined}>
      <summary>材料与用途</summary>
      <label>材料链接（可选）<input type="url" value={draft.url} onChange={e=>update({url:e.target.value})} maxLength={2048} placeholder="https://"/></label>
      {mode !== 'wait' && <>
        <ScheduleFilePicker disabled={busy} onFiles={addFiles}/>
        {!!todo?.outcome?.files?.length && <p>{todo.outcome.files.map(f=>f.name).join(' · ')}</p>}
        {draft.files.map(file=><div key={file.id}>{file.name} <button type="button" disabled={busy} aria-label={'移除 '+file.name} onClick={()=>void removeFile(file)}>移除</button></div>)}
        <label>用在哪个项目（可选）<select value={draft.projectId} onChange={e=>update({projectId:e.target.value})}>
          <option value="">暂不归入项目</option>
          {draft.projectId && !projects.some(p=>p.project.id===draft.projectId) && <option value={draft.projectId}>原关联项目</option>}
          {projects.map(({project})=><option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <label>准备用来做什么（可选）<input value={draft.purpose} maxLength={240} onChange={e=>update({purpose:e.target.value})}/></label>
      </>}
    </details>}
  </>;
  if (props.inline) return <section className="qh-outcome-inline qh-outcome-dialog" aria-label={title}>
    {fields}{error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>收起</button>
    <button type="button" className="qd-btn primary" disabled={busy || disabled || newerOutcome} onClick={()=>void submit()}>{label}</button></footer>
  </section>;
  return <ConfirmDialog className="qh-outcome-dialog" title={title} text={'title' in props ? props.title : props.todo.text}
    confirmLabel={label} busy={busy} error={error} onClose={()=>{if(!busy)onClose();}} onConfirm={()=>void submit()} confirmDisabled={disabled || newerOutcome}>
    {fields}
  </ConfirmDialog>;
}
