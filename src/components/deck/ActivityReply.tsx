import { useRef, useState } from 'react';
import { desktopHost } from '../../integration/desktop';
import { hasDiscussionText, latestConclusion } from '../../data/discussion';
import { discussionSummary } from '../../data/discussionSnippets';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import type { Session } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { RuntimeRequests } from '../runtime/RuntimeRequests';
import './activity-reply.css';

export function ActivityReply({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const { snap, api, toast } = useWorkdeck();
  const runtime = session.runtime!;
  const host = desktopHost(), commands = api as Partial<RuntimeCommands>;
  const requests = Object.values(runtime.requests ?? (runtime.request ? { [runtime.request.id]: runtime.request } : {}));
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error,setError] = useState('');
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const lock = useRef(false);
  const plan = runtime.planId && snap.ideaPlans?.[runtime.planId];
  const conclusion = plan ? latestConclusion(plan,runtime.scope ?? 'root') : undefined;
  const questions = conclusion?.open.map(item => item.replace(/^Agent 提议，待用户确认：/,'')) ?? [];
  const question = questions.join('\n') || session.waitingQuestion || session.waitingReason;
  const submit = async (action: string, payload?: unknown) => {
    if (lock.current) return false;
    const data = payload as Record<string, unknown>;
    const id = typeof data.requestToken === 'string' ? data.requestToken : typeof data.requestId === 'string' ? data.requestId : 'turn';
    if (acknowledged.includes(id)) return false;
    setError(''); setBusy(true); lock.current = true;
    try {
      const result = host ? await host.controlRun(runtime.runId!,action,data)
        : await commands.controlSession!(session.id,'reply',data);
      if (result.ok === false) throw Error(result.message || '操作未送达，请重试。');
      setAcknowledged(previous => [...previous,id]);
      toast(id === 'turn' ? '回复已发送' : '已处理这项请求');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法发送，请重试。');
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  if (!host && !commands.controlSession) return <button type="button" className="qd-link" onClick={onOpen}>打开会话处理</button>;
  return <div className="qd-activity-reply">
    {requests.length ? <RuntimeRequests compact requests={requests.filter(request => !acknowledged.includes(request.token || request.id))} runId={runtime.runId!} tool={runtime.connection.tool} busy={busy || !!runtime.controlPending} onControl={submit} />
      : acknowledged.includes('turn') ? <p role="status">回复已发送</p> : <form onSubmit={event => {
        event.preventDefault();
        if (hasDiscussionText(text)) void submit('reply', {prompt:text.trim(), ...(plan ? {expectedVersion:plan.draftVersion, conclusionId:conclusion?.id} : {})});
      }}>
        {question && <p>{discussionSummary(question)}</p>}
        <label>回复 {session.title}<textarea value={text} rows={2} onChange={event => setText(event.target.value)} /></label>
        <button type="submit" className="qd-btn primary" disabled={busy || !!runtime.controlPending || !hasDiscussionText(text)}>发送回复</button>
      </form>}
    {error && <p className="qd-inline-error" role="alert">{error}</p>}
  </div>;
}
