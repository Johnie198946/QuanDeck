import { applyCollaboration, taskKey } from './collaboration';
import { hashText, stableContent } from './contentHash';
import { checkResultReply, type ResultReplyInput, type ResultRevision } from './resultReply';
import type { CommandResult, Snapshot } from './types';
import { rejectedAdmissionStopped } from './dispatchRecovery';

type Receipt = CommandResult & {sessionId?:string};
interface Ports {
  load(): Promise<Snapshot | undefined>;
  mutate(update: (snapshot:Snapshot) => void): void;
  sendText(): Promise<Receipt>;
  stop(): Promise<Receipt>;
  reconcile(sessionId:string): Promise<Receipt>;
  submit(snapshot: Snapshot, revision: ResultRevision): Promise<Receipt>;
}

export async function sendResultReply(input:ResultReplyInput, ports:Ports):Promise<Receipt> {
  const {target, text, messageId} = input;
  let snapshot = await ports.load();
  if (!snapshot) return {ok:false,message:'项目不存在'};
  const fingerprint = hashText(stableContent({target,text}));
  const attempts = Object.values(snapshot.sessions).filter(s => s.runtime?.resultRevision?.messageId === messageId);
  if (attempts.some(s => s.runtime!.resultRevision!.fingerprint !== fingerprint)) return {ok:false,message:'这条修改意见已发生变化，请重新发送'};
  let previous = attempts.at(-1);
  if (previous && previous.dispatchPhase !== 'acknowledged' && !rejectedAdmissionStopped(previous)) {
    await ports.reconcile(previous.id);
    snapshot = await ports.load();
    if (!snapshot) return {ok:false,message:'项目不存在'};
    previous = snapshot.sessions[previous.id];
  }
  if (previous?.dispatchPhase === 'acknowledged') return {ok:true,sessionId:previous.id,message:'修改意见已送达'};
  if (previous && !rejectedAdmissionStopped(previous)) return {ok:false,sessionId:previous.id,message:'上次发送的回执待核对，请在执行记录中查看'};

  if (!target.artifactId) return ports.sendText();
  const original = snapshot.sessions[target.sessionId];
  const reason = checkResultReply(snapshot,target);
  if (reason || !original?.runtime) return {ok:false,message:reason || '原执行已不存在'};
  if (original.runtime.stoppedConfirmed !== true) {
    // The native driver allows only one live executor for a work item. Await its stop receipt.
    const stopped = await ports.stop();
    if (!stopped.ok) return stopped;
  }
  const key = taskKey(target.taskId,target.itemId);
  const receiptKey = 'result-reply:' + messageId;
  let reviewId = '';
  ports.mutate(draft => {
    const reason = checkResultReply(draft,target);
    if (reason) throw Error(reason);
    if (!draft.sessions[target.sessionId].runtime?.stoppedConfirmed) throw Error('原执行尚未停稳，请稍后重试');
    const ledger = draft.collaboration!, task = ledger.tasks[key];
    const saved = ledger.receipts[receiptKey]?.result.resourceId;
    if (saved) {
      const review = ledger.reviews.find(r => r.id === saved);
      if (review?.submissionId !== task.latestSubmissionId || review?.note !== text ||
          review?.key !== key || review.verdict !== 'needs_changes') throw Error('上次登记的修改意见已变化，请重新发送');
      reviewId = saved;
      return;
    }
    const reply = applyCollaboration(draft, {
      projectId:target.projectId, taskId:target.taskId, workItemId:target.itemId, type:'review',
      expectedVersion:task.version, idempotencyKey:receiptKey,
      payload:{submissionId:task.latestSubmissionId,verdict:'needs_changes',checks:[],note:text,resultReply:true},
    },{kind:'human',name:'用户回复成果'});
    if (!reply.ok || !reply.resourceId) throw Error(reply.message || '修改意见未保存');
    reviewId = reply.resourceId;
  });
  const current = await ports.load();
  if (!current) return {ok:false,message:'项目已不存在'};
  return ports.submit(current,{messageId,reviewId,fingerprint,sourceSessionId:target.sessionId});
}
