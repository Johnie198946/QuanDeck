import { useMemo, useRef, useState } from 'react';
import { ActivityReply } from '../deck/ActivityReply';
import { BlockedTaskMaterials } from '../deck/BlockedTaskMaterials';
import { blockedTaskSession } from '../../data/blockedTask';
import { pendingSessionStatus } from '../../data/derive';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { canRetryDispatch } from '../../data/dispatchRecovery';
import { WORK_LABEL } from '../../data/orchestration';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { NoteDelivery } from '../knowledge/NoteReceiptDetails';
import { Icon } from '../ui/Icon';
import { NoteDispatchTrail, type OpenNoteSource } from './NoteDispatchTrail';
import { formatInboxTime, inboxResultVersions, type InboxRow } from './agentInboxData';

interface DetailProps {
  row: InboxRow;
  itemId?: string;
  resultId?: string;
  onShowTask: () => void;
  onOpenNote: OpenNoteSource;
  onAttention: (id:string)=>void;
}

export function InboxTaskDetail({row,itemId,resultId,onShowTask,onOpenNote,onAttention}: DetailProps) {
  const {api,refreshProjects} = useWorkdeck();
  const runtime = api as typeof api & Partial<RuntimeCommands>;
  const [version,setVersion] = useState(resultId);
  const versions=useMemo(()=>inboxResultVersions(row,itemId,resultId),[row,itemId,resultId]);
  const current = version ? versions.find(entry=>entry.record.id===version) ??
    versions.find(entry=>entry.slotId===version || entry.artifactId===version || entry.record.outputId===version ||
      entry.record.outputId && 'output:'+entry.record.outputId===version) : versions[0];
  const { session, attention } = row;
  const gate = attention?.kind === 'permission' || attention?.kind === 'decision';
  const blocked = !gate && blockedTaskSession(row.snapshot,session);
  const question = !gate && !blocked && attention?.kind==='question' && session?.runtime?.runId &&
    session.id===attention.entry?.sessionId && pendingSessionStatus(session)!=='waiting_permission';
  const resend = !gate && !blocked && !question && (row.canDispatch || canRetryDispatch(session));
  const reviewOutside = attention && !blocked && !question && !resend && (gate || !current || attention.label !== '待修改');
  const ledger=row.snapshot.collaboration;
  const versionLabels=useMemo(()=>{
    const reviews=new Map(ledger?.reviews.map(review=>[review.submissionId,review.verdict]));
    const verdicts=new Map(ledger?.submissions.map(submission=>[submission.artifactId,reviews.get(submission.id)]));
    const currentIds=new Set(ledger?.submissions.filter(submission=>ledger.tasks[submission.key]?.latestSubmissionId===submission.id).map(submission=>submission.artifactId));
    return new Map(ledger?.artifacts.map(artifact=>{
      const verdict=verdicts.get(artifact.id);
      const state=ledger?.tasks[artifact.key];
      let status=currentIds.has(artifact.id) ? '待验收' : '历史版本';
      if (verdict==='needs_changes') status='已退回';
      if (verdict==='accepted') {
        status=state?.acceptedArtifactId===artifact.id ? '已验收' : '曾验收';
        if (ledger?.freshness[artifact.id]==='stale' || state?.requiresRevalidation) status='需复核';
      }
      return [artifact.id, 'v'+artifact.version+' · '+status];
    }));
  },[ledger]);
  const [busy,setBusy] = useState(false), [feedback,setFeedback] = useState('');
  const pending = useRef(false);
  async function retry() {
    if (pending.current) return;
    if (api.mode !== 'live' || !runtime.dispatchProjectTask) { setFeedback('请在桌面版连接 Agent 后再发送。'); return; }
    const {session,task,snapshot}=row;
    if (!canRetryDispatch(session) && !row.canDispatch) return;
    pending.current=true;
    setBusy(true);
    setFeedback('');
    try {
      const result = session ? await api.retryDispatch(session.id) :
        await runtime.dispatchProjectTask(snapshot.project.id,task.id,task.noteWork!.agentId);
      setFeedback(result.message || (result.ok?'已发给 '+row.agent:'发送失败，请重试'));
      await refreshProjects();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '暂时无法确认发送状态');
    } finally {
      pending.current=false;
      setBusy(false);
    }
  }
  if (row.reminderGone) return <section aria-label="任务详情" className="qi-detail"><p role="status">这条提醒已处理或更新。</p>
    <button type="button" className="qi-link" onClick={onShowTask}>查看当前任务</button></section>;
  return <section aria-label="任务详情" className="qi-detail">
    {itemId && <header className="qi-scope">
      <div><small>子任务</small><h2>{row.item?.title ?? '原子任务已不可用'}</h2>
        {row.item && <p>{WORK_LABEL[row.item.status]}{row.item.statusReason && ' · ' + row.item.statusReason}</p>}</div>
      <button type="button" className="qi-link" onClick={onShowTask}>查看整个任务</button>
    </header>}
    {row.problem && !question && <p className="qi-problem"><Icon name="alert" size={15}/>{row.problem}</p>}
    {blocked && session && <BlockedTaskMaterials key={session.id} snapshot={row.snapshot} session={session}/>}
    {question && session && attention && <ActivityReply key={session.id} session={session} snapshot={row.snapshot} onOpen={()=>onAttention(attention.id)}/>}
    {resend && <div className="qi-detail-actions"><button type="button" className="qp-btn" disabled={busy} onClick={()=>void retry()}>{busy?'正在发送…':session?'重试发送':'发送给 '+row.agent}</button></div>}
    {reviewOutside && attention && <div className="qi-detail-actions"><button className="qi-link" type="button" onClick={()=>onAttention(attention.id)}>{attention.action}<Icon name="arrow-right" size={13}/></button></div>}
    {feedback && <p role="status">{feedback}</p>}
    {current && <>
      <div className="qi-result-head"><h2>成果 {current.artifactId && <small>{versionLabels.get(current.artifactId)}</small>}</h2>{versions.length>1 && <label>查看记录 <select aria-label="选择成果记录" value={current.record.id} onChange={event=>setVersion(event.target.value)}>
        {versions.map(entry=><option key={entry.record.id} value={entry.record.id}>{entry.artifactId && versionLabels.get(entry.artifactId)+' · '}{formatInboxTime(entry.record.at)} · {entry.record.title}</option>)}
      </select></label>}</div>
      {current.record.title !== row.task.title && <h3>{current.record.title}</h3>}
      <NoteDelivery project={row.snapshot} taskId={row.task.id} entry={current} showReply={!blocked && !question && !resend && !reviewOutside}/>
    </>}
    {!current && version && <p className="qi-muted" role="status">这版成果已不可用。{versions.length>0 && <button type="button" className="qi-link" onClick={()=>setVersion(undefined)}>查看最新成果</button>}</p>}
    {!current && !version && !row.problem && <p className="qi-muted">{row.group==='running'?'结果会显示在这里。':'暂未收到成果。'}</p>}
    {row.task.inputs?.some(input=>input.noteSource) ? <details className="qi-source"><summary>原始需求</summary>
      <NoteDispatchTrail task={row.task} results={[]} onOpenNote={onOpenNote} onResult={()=>{}}/>
    </details> : row.task.originalTitle && row.task.originalTitle!==row.task.title && <details className="qi-source"><summary>原始需求</summary><p>{row.task.originalTitle}</p></details>}
  </section>;
}
