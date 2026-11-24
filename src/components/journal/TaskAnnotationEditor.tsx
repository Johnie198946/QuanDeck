import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { taskKey } from '../../data/collaboration';
import type { TaskAnnotationRevision } from '../../data/annotationHistory';

export function TaskAnnotationEditor({taskId, itemId, previous}: {taskId: string; itemId?: string; previous?: TaskAnnotationRevision}) {
  const { snap, api } = useWorkdeck();
  const key = taskKey(taskId, itemId);
  const row = snap.collaboration?.tasks[key];
  const [draft, setDraft] = useState<{text: string; revision: number} | undefined>(()=>previous ? undefined : {text:'',revision:0});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  if (!row || row.archived) return null;
  async function save() {
    if (!draft || !row || saving) return;
    setSaving(true);
    try {
      const result = await api.collaborate({type: 'write_task_annotation', projectId: snap.project.id, taskId, workItemId: itemId,
        idempotencyKey: crypto.randomUUID(), expectedVersion: row.version, payload: {text: draft.text.trim(), expectedRevision: draft.revision}});
      if (!result.ok) throw Error(result.message || '保存失败，请重试。');
      setDraft(undefined);
      setMessage('批注已保存');
    } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败，请重试。'); }
    finally { setSaving(false); }
  }
  return <div className="qd-annotation-editor">
    {draft ? <><label>我的批注<textarea autoFocus maxLength={2000} value={draft.text} disabled={saving}
      onChange={e => setDraft({...draft, text:e.target.value})} placeholder="记下对这项任务的想法…"/></label>
      <div><button type="button" className="qd-btn primary small" disabled={saving || !draft.text.trim()} onClick={()=>void save()}>保存批注</button>
      <button type="button" className="qd-link" disabled={saving} onClick={()=>{setDraft(undefined);setMessage('');}}>取消</button></div></> :
      <>{previous && <blockquote>{previous.text}</blockquote>}<button className="qd-link" type="button" onClick={()=>{setDraft({text:previous?.text ?? '',revision:previous?.revision ?? 0});setMessage('');}}>{previous ? '修改我的批注' : '写批注'}</button></>}
    {message && <p role="status">{message}</p>}
  </div>;
}
