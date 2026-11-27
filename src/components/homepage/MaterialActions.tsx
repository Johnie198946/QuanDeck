import { useState } from 'react';
import type { MaterialMatch } from '../../data/materialRecall';
import { materialTargetKey, type MaterialTarget } from '../../data/materialUse';
import { useTodoMaterial } from '../../data/useTodoMaterial';
import type { OutputAttachment } from '../../data/types';
import { NoteFileCard } from '../knowledge/NoteInlineCards';
import { Icon } from '../ui/Icon';

export function MaterialFiles({files,noteId}:{files?:OutputAttachment[];noteId:string}) {
  if (!files?.length) return null;
  return <div className="qh-receipt-files">{files.map(file=>
    <details key={file.id}><summary><Icon name="attachment" size={13}/>{file.name}</summary>
      <NoteFileCard noteId={noteId} file={file} label={file.name}/>
    </details>)}</div>;
}

export function UseMaterial({match,target}:{match:MaterialMatch;target:MaterialTarget}) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const used=!!match.usedBy?.some(ref=>materialTargetKey(ref)===materialTargetKey(target));
  async function toggle() {
    if (busy) return;
    setBusy(true); setError('');
    try { await useTodoMaterial(match.noteId,match.todoId,match.at,target,!used); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '未能保存引用'); }
    finally { setBusy(false); }
  }
  return <><button type="button" className="qh-use-material" aria-pressed={used} disabled={busy}
    title={used ? '取消本任务的引用' : 'projectId' in target ? '归入此项目，供这个任务引用' : '关联这份成果与当前日程'}
    onClick={()=>void toggle()}><Icon name={used?'check':'plus'} size={12}/>{used?'已用于此任务':'用于此任务'}</button>
    {error && <span role="alert">{error}</span>}</>;
}
