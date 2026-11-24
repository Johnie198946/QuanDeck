import { useRef, useState } from 'react';
import { taskKey } from '../../data/collaboration';
import { currentDeliverySlots } from '../../data/deliveryContract';
import { desktopHost, type TaskAgentAlternative } from '../../integration/desktop';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { ProductTaskTarget } from './ProductExecution';

type AgentChoice = { id: string; title: string };
type Completed = Exclude<TaskAgentAlternative, { error: string }>;

export function TaskAgentComparison({ target, choices, onClose }: {
  target: ProductTaskTarget; choices: AgentChoice[]; onClose: () => void;
}) {
  const { api, snap, toast } = useWorkdeck();
  const key = taskKey(target.taskId, target.itemId);
  const ledger = snap.collaboration?.tasks[key];
  const currentSpec = snap.collaboration?.specs.find(spec => spec.key === key && spec.revision === ledger?.specRevision);
  const planningRevision = snap.projectPlanning?.revision ?? 0;
  const [origin] = useState(() => ({
    projectId: snap.project.id,
    specId: currentSpec?.id,
    revision: currentSpec?.revision,
    taskVersion: ledger?.version,
    planningRevision,
  }));
  const [picked, setPicked] = useState(() => choices.slice(0, 2).map(choice => choice.id));
  const [results, setResults] = useState<TaskAgentAlternative[]>();
  const [draft, setDraft] = useState<{ title: string; body: string; sources: Completed[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const current = origin.projectId === snap.project.id && origin.specId === currentSpec?.id &&
    origin.revision === currentSpec?.revision && origin.planningRevision === planningRevision && !!ledger &&
    origin.taskVersion === ledger.version && !ledger.activeRunId && !['done', 'cancelled', 'in_review'].includes(ledger.status);
  const canRun = current && !!origin.specId && origin.revision !== undefined && picked.length >= 2;
  const success = results?.filter((result): result is Completed => !('error' in result)) ?? [];
  const slots = currentDeliverySlots(snap, key).filter(slot => slot.contract);
  const contract = slots.length === 1 ? slots[0].contract : undefined;
  const textSlot = contract?.kind === 'text' && ['markdown', 'txt'].includes(contract.format) ? slots[0] : undefined;
  const needsFilesOrMoreContent = slots.length > 0 && !textSlot;
  const name = (id: string) => choices.find(choice => choice.id === id)?.title ?? id;
  const close = () => { if (!pending.current) onClose(); };
  const toggle = (id: string) => setPicked(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  const compare = async () => {
    const run = desktopHost()?.compareTaskAgents;
    const { projectId, specId, revision } = origin;
    if (!run || pending.current || !canRun || !specId || revision === undefined) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await run({ projectId, taskId: target.taskId, itemId: target.itemId ?? undefined, specId, expectedSpecRevision: revision, agentIds: picked });
      setResults(response.alternatives);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '对比未完成，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  };
  const adopt = async () => {
    if (!current || origin.taskVersion === undefined || !draft?.title.trim() || !draft.body.trim() || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const sources = draft.sources.map(source => name(source.agentId) + '（' + source.sourceSessionId + '）').join('、');
      const body = draft.body.trim() + '\n\n方案来源：' + sources;
      const result = await api.saveTaskOutput({ projectId: origin.projectId, taskId: target.taskId, workItemId: target.itemId,
        title: draft.title, body, taskSpecRevision: origin.revision, status: needsFilesOrMoreContent ? 'draft' : 'published',
        ...(textSlot?.contract ? { deliveryItems: [{ slotId: textSlot.id, contractRevision: textSlot.contract.revision, body }] } : {}),
        comparisonVersion: { task: origin.taskVersion, planning: origin.planningRevision } });
      if (!result.ok) { setError(result.message || '候选成果未提交。'); return; }
      toast(needsFilesOrMoreContent ? '已保存方案草稿。补齐交付物后，可以提交验收。' : '已提交为候选成果，可以在成果页验收。');
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '候选成果未提交。'); }
    finally { pending.current = false; setBusy(false); }
  };
  const select = (row: Completed) => setDraft({ title: row.title, body: row.body, sources: [row] });
  const combine = () => setDraft({
    title: '综合方案',
    body: success.map(row => '## ' + name(row.agentId) + '\n\n' + row.body).join('\n\n'),
    sources: success,
  });
  return <ConfirmDialog className="qd-task-agent-compare" title={results ? '对比方案' : '请多个 Agent 出方案'}
    text={results ? needsFilesOrMoreContent ? '选一份或合并几份，保存为草稿后补齐交付物。' : '选一份或合并几份，核对后提交候选，再单独验收。' : '将当前任务的文字资料分别发给所选 Agent。每个 Agent 独立出方案。'}
    confirmLabel={busy ? '请稍候…' : results ? needsFilesOrMoreContent ? '保存方案草稿' : '提交候选成果' : '发给所选 Agent'}
    onClose={close} onConfirm={() => void (results ? adopt() : compare())} busy={busy}
    confirmDisabled={results ? !current || !draft?.title.trim() || !draft.body.trim() : !canRun}
    error={!current ? '任务或验收标准已更新，请重新打开对比。' : error}>
    {!results ? <>
      <fieldset className="qd-product-dispatch-choices" disabled={busy}><legend>选择 2 至 4 位 Agent</legend>{choices.map(choice =>
        <label key={choice.id} className={picked.includes(choice.id) ? 'is-selected' : ''}>
          <input type="checkbox" checked={picked.includes(choice.id)} disabled={!picked.includes(choice.id) && picked.length >= 4} onChange={() => toggle(choice.id)} />
          {choice.title}
        </label>,
      )}</fieldset>
      <p className="qd-compare-scope">随任务发送目标、验收标准和研究文字。此操作只生成方案。</p>
      {busy && <p role="status">正在分别等待各位 Agent 的方案…</p>}
    </> : <>
      <div className="qd-compare-cards">{results.map(row => <article key={row.agentId}>
        <strong>{name(row.agentId)}</strong>
        {'error' in row ? <p>{row.error}</p> : <>
          <h3>{row.title}</h3><p>{row.summary}</p>
          <details><summary>查看方案</summary><p>{row.body}</p></details>
          <button type="button" className="qd-btn" disabled={busy || !current} onClick={() => select(row)}>采用这份</button>
        </>}
      </article>)}</div>
      <div className="qd-compare-actions">
        {success.length > 1 && <button type="button" className="qd-btn" disabled={busy || !current} onClick={combine}>合并方案</button>}
        <button type="button" className="qd-link" disabled={busy} onClick={() => { setResults(undefined); setDraft(undefined); setError(''); }}>重新对比</button>
      </div>
      {draft && <div className="qd-compare-draft">
        <label>候选标题<input value={draft.title} maxLength={120} disabled={busy} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
        <label>候选内容<textarea value={draft.body} rows={7} maxLength={24000} disabled={busy} onChange={event => setDraft({ ...draft, body: event.target.value })}/></label>
      </div>}
    </>}
  </ConfirmDialog>;
}
