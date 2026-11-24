import { useId, useRef, useState } from 'react';
import type { IdeaPlan } from '../../data/types';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { rejectedAdmissionStopped, rejectedDirectionDraft } from '../../data/dispatchRecovery';
import { pendingSessionStatus } from '../../data/derive';
import { hasDiscussionText, latestConclusion } from '../../data/discussion';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { toolForAgent, useConfiguredAgents } from '../../integration/configuredAgents';
import { AgentConnectionSetup } from '../deck/AgentConnectionSetup';
import { DiscussionHandoff } from './DiscussionDialogs';
import { ConclusionMedia } from './PlanDiscussionBody';
import { MarkdownMessage } from '../runtime/RichMessage';
import { DiscussionMemory } from './DiscussionMemory';
import { Icon } from '../ui/Icon';

type Draft = { text: string; messageId: string };
const emptyDraft = (): Draft => ({ text: '', messageId: crypto.randomUUID() });

export function DirectionReply({ plan, scope, onScope }: { plan: IdeaPlan; scope: string; onScope: (scope: string) => void }) {
  const { snap, api, openSourceSession } = useWorkdeck();
  const { agents } = useConfiguredAgents(snap.agents);
  const configuredAgent = agents.find(a => a.id === plan.discussion?.agentId) ?? agents.find(a => a.id === snap.defaultAgent) ?? agents[0];
  const section = plan.draft.sections.find(s => s.id === scope);
  const latest = latestConclusion(plan, scope);
  const recent = plan.discussion?.sessionId ? snap.sessions[plan.discussion.sessionId] : undefined;
  const discussionAgentId = plan.discussion?.agentId ?? recent?.agentId ?? configuredAgent?.id ?? snap.defaultAgent;
  const matching = Object.values(snap.sessions).filter(session => session.runtime?.purpose === 'discussion' &&
    session.runtime.projectId === snap.project.id && session.runtime.planId === plan.id && (session.runtime.scope ?? 'root') === scope &&
    session.agentId === discussionAgentId && !session.linkedAsHistory);
  const scoped = recent && matching.find(session => session.id === recent.id);
  const active = matching.find(session => !['archived', 'failed', 'cancelled'].includes(session.status));
  const agent = active ? agents.find(item => item.id === active.agentId) : configuredAgent;
  const key = JSON.stringify(['quandeck.direction-draft', snap.project.id, plan.id, scope, discussionAgentId]);
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (typeof saved?.text === 'string' && typeof saved.messageId === 'string') return saved;
    } catch { /* The editor also works with in-memory drafts. */ }
    return rejectedDirectionDraft(scoped) ?? emptyDraft();
  });
  const [error, setError] = useState(''), [sent, setSent] = useState('');
  const [sentQuestion, setSentQuestion] = useState<{ text: string; previousReply?: string }>();
  const [busy, setBusy] = useState(false), [source, setSource] = useState('');
  const [recovery, setRecovery] = useState<'retry' | 'reconcile' | undefined>();
  const retry = recovery === 'retry' || rejectedAdmissionStopped(scoped) && scoped?.runtime?.initialDirectionMessage?.id === draft.messageId;
  const uncertain = recovery === 'reconcile' ? source : scoped?.dispatchPhase === 'unknown' ? scoped.id : undefined;
  const [fallback, setFallback] = useState(false), [setup, setSetup] = useState(false);
  const sending = useRef(false), id = useId();
  const remember = (value: Draft) => {
    setDraft(value);
    try { if (value.text || sending.current) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Keep the current draft in memory. */ }
  };
  const waiting = active && ['pending', 'queued', 'running'].includes(active.status);
  const pendingRequest = active && pendingSessionStatus(active);
  const replySession = latest?.sourceRef && Object.values(snap.sessions).find(session =>
    session.runtime?.purpose === 'discussion' && session.runtime.projectId === snap.project.id &&
    session.runtime.planId === plan.id && (session.runtime.scope ?? 'root') === scope &&
    session.source?.connectionId === latest.sourceRef!.connectionId && session.source.sessionId === latest.sourceRef!.sessionId);
  const displayedSession = waiting || !latest ? active : replySession;
  const sourceSession = displayedSession ?? (!latest ? scoped : undefined);
  const otherReply = scope === 'root' && !latest ? [...(plan.discussion?.conclusions ?? [])].reverse()
    .map(item => plan.draft.sections.find(s => s.id === item.scopeId)).find(Boolean) : undefined;
  const executionUnderway = !!plan.adopted && plan.adopted.draftVersion === plan.draftVersion &&
    snap.collaboration?.goalAutomation?.[plan.id]?.enabled;
  const noDiscussionAction = executionUnderway && latest?.source === 'agent' && !latest.open.length &&
    !latest.proposed?.length && !pendingRequest && !waiting;
  const latestText = draft.text.trim();
  const canSend = !uncertain && !busy && !waiting && !pendingRequest && hasDiscussionText(latestText);
  const send = async () => {
    if (!canSend || sending.current) return;
    if (!agent) { setSetup(true); return; }
    const runtime = api as typeof api & Partial<RuntimeCommands>;
    if (toolForAgent(agent) === 'workbuddy' || !runtime.sendDirectionMessage) { setFallback(true); return; }
    sending.current = true; setBusy(true); setError(''); setSource(''); setRecovery(undefined); setSent('');
    remember(draft);
    try {
      const result = await runtime.sendDirectionMessage({projectId:snap.project.id, planId:plan.id, scope, agentId:agent.id,
        draftVersion:plan.draftVersion, conclusionId:latest?.id, messageId:draft.messageId, text:latestText});
      if (!result.ok) { setSource(result.sessionId ?? ''); setRecovery(result.recovery); throw Error(result.message || '意见暂未发送，请重试'); }
      setSent('已发送'); setSentQuestion({ text:latestText, previousReply:latest?.id });
      setDraft(emptyDraft());
      try { sessionStorage.removeItem(key); } catch { /* Sent receipt remains visible. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂未收到发送回执，请重试'); }
    finally { sending.current = false; setBusy(false); }
  };
  const reconcile = async () => {
    if (!uncertain || sending.current) return;
    sending.current = true; setBusy(true);
    try {
      const result = await api.reconcile(uncertain);
      if (result.ok) { setRecovery(undefined); setSource(''); setError(''); setSent(result.message || '已核对发送状态'); }
      else setError(result.message || '暂未找到受理回执');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法核对发送状态'); }
    finally { sending.current = false; setBusy(false); }
  };
  const answeredBy = latest && snap.agents.find(item => item.id === latest.agentId)?.name;
  const replyLabel = latest?.source === 'manual' ? '已记录的讨论结论' : latest?.source === 'sample' ? '示例回复' : 'AI 回复';
  return <div role="form" className="qd-direction-reply" aria-label="方案意见">
    <div className="qd-direction-reply-inner">
      <div className="qd-direction-reply-label"><label htmlFor={id}><Icon name="message" size={16} />{section ? '讨论「' + section.title + '」' : latest ? '继续讨论方案' : '和 AI 讨论方案'}</label>
        <div className="qd-direction-reply-actions">
          {section && <button type="button" className="qd-link" onClick={() => onScope('root')}>返回整个方案</button>}
          {otherReply && <button type="button" className="qd-link" onClick={() => onScope(otherReply.id)}>查看「{otherReply.title}」的回复</button>}
          {sourceSession?.source && <button type="button" className="qd-link" onClick={() => openSourceSession(sourceSession.id)}>完整对话<Icon name="external" size={12} /></button>}
        </div>
      </div>
      {latest && <section aria-live="polite" aria-label={replyLabel} key={latest.id} className="qd-direction-inline-answer">
        <strong>{waiting && latest.source === 'agent' ? '上一条 AI 回复' : replyLabel}{answeredBy && <small> · {answeredBy}</small>}</strong>
        <div className="qd-direction-answer-text" tabIndex={0}><MarkdownMessage text={latest.summary} runId={replySession?.runtime?.runId ?? ''} /><ConclusionMedia plan={plan} result={latest} /></div>
      </section>}
      {noDiscussionAction && <p className="qd-direction-next-step">方案已确认，本条无需回复。可在「任务」查看执行进度。</p>}
      {sentQuestion && sentQuestion.previousReply === latest?.id && <p className="qd-direction-own-question"><strong>你</strong> {sentQuestion.text}</p>}
      {scoped?.runtime?.submissionIssue && <p className="qd-direction-sent" role="status">这次回复未同步到当前方案。{scoped.source && <button type="button" className="qd-link" onClick={() => openSourceSession(scoped.id)}>查看原回复</button>}</p>}
      <DiscussionMemory session={displayedSession} planId={plan.id} scope={scope} />
      {waiting && <p className="qd-direction-sent" role="status">{snap.agents.find(item => item.id === active?.agentId)?.name || 'AI'} 正在回复…</p>}
      <form className="qd-direction-reply-line" onSubmit={event => { event.preventDefault(); void send(); }}><textarea id={id} data-direction-input rows={1} maxLength={10000} disabled={busy || !!pendingRequest}
        placeholder={pendingRequest ? '请先处理上方的请求…' : latest ? '继续追问或补充意见…' : '写下你想讨论的问题…'} value={draft.text}
        onChange={e => { remember({ text:e.target.value, messageId:crypto.randomUUID() }); setSent(''); setError(''); if (!uncertain) { setRecovery(undefined); setSource(''); } }}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {uncertain ? <button type="button" className="qd-btn ghost small" disabled={busy} onClick={() => void reconcile()}>核对发送状态</button> :
          <button type="submit" className="qd-btn primary small" disabled={!canSend}>{busy ? '发送中…' : !agent ? '配置 Agent' : retry ? '重试发送' : latest ? '发送追问' : '发送问题'}<Icon name="plane" size={15} /></button>}
      </form>
      {(error || retry) && <div role="alert">{error || '上次意见尚未发送。'} {source && !recovery && <button type="button" className="qd-link" onClick={() => openSourceSession(source)}>查看原会话</button>}</div>}
      {sent && !waiting && (!sentQuestion || sentQuestion.previousReply === latest?.id) && <p className="qd-direction-sent" title={sent} role="status">{sent}</p>}
    </div>
    {fallback && agent && <DiscussionHandoff plan={plan} scope={scope} agent={agent} opinion={latestText} onClose={() => setFallback(false)} />}
    {setup && <AgentConnectionSetup onClose={() => setSetup(false)} />}
  </div>;
}
