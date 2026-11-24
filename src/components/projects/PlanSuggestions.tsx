import { useRef, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { CollaborationProposal } from '../../data/collaboration';

export function PlanSuggestions() {
  const { snap, api, toast } = useWorkdeck();
  const [selection, setSelection] = useState<{proposal: CollaborationProposal; reject: boolean}>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const pending = Object.values(snap.collaboration?.proposals ?? {}).filter(proposal => proposal.status === 'pending');
  if (!pending.length && !selection) return null;
  const confirm = async () => {
    if (!selection || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const { proposal, reject } = selection;
      const result = await api.collaborate({projectId:snap.project.id, type:reject ? 'reject_plan' : 'adopt_plan',
        idempotencyKey:(reject ? 'reject:' : 'adopt:') + proposal.id, payload:{proposalId:proposal.id}});
      if (!result.ok) throw new Error(result.message ?? '建议暂时无法处理');
      toast(reject ? '已忽略这条建议' : '任务已创建');
      setSelection(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : '建议暂时无法处理');
    } finally { setBusy(false); sending.current = false; }
  };
  return <details className="qp-panel qp-suggestions qd-data-preview">
    <summary>待确认的新任务（{pending.length}）</summary>
    <ul>
      {pending.map(proposal => <li key={proposal.id}>
        <span>{proposal.taskKey && snap.collaboration?.tasks[proposal.taskKey]?.title || '项目建议'} · {proposal.tasks.length} 项</span>
        <button type="button" className="qd-link" onClick={() => {setError('');setSelection({proposal,reject:false});}}>核对建议</button>
        <button type="button" className="qd-link" onClick={() => {setError('');setSelection({proposal,reject:true});}}>忽略</button>
      </li>)}
    </ul>
    {selection && <ConfirmDialog title={selection.reject ? '忽略建议' : '确认新任务'} text={selection.reject ? '忽略后仍可查到这次决定。' : '检查任务和验收标准。确认后可在项目里安排执行。'}
        confirmLabel={selection.reject ? '确认忽略' : '确认创建'} busy={busy} error={error} onClose={() => setSelection(undefined)} onConfirm={() => void confirm()}>
      <ol>{selection.proposal.tasks.map(task => <li key={task.key}><strong>{task.title}</strong><p>{task.goal}</p><ul>{task.criteria.map((text,i)=><li key={i}>{text}</li>)}</ul></li>)}</ol>
    </ConfirmDialog>}
  </details>;
}
