import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktopHost, type RuntimeRunView, type RuntimeRequest, type RuntimeAttachment } from '../../integration/desktop';
import { gateway } from '../../integration/gateway';
import { TOOL_LABELS, type ToolId } from '../../integration/contracts';
import { getConfiguredAgents } from '../../integration/configuredAgents';
import { AgentLogo } from '../ui/AgentLogo';
import { parseDiscussionResponse } from '../../data/discussionPresentation';
import { hasDiscussionText } from '../../data/discussion';
import { ConfirmationPanel } from './ConfirmationPanel';
import { RichMessage, UserMessage } from './RichMessage';
import { AttachmentPreview } from './AttachmentPreview';
import { RuntimeProgress } from './RuntimeProgress';
import { pendingDiscussion, redactRuntimeText, runtimeUserMessage, runtimeDeliveryIdle } from '../../data/runtimePresentation';
import { RuntimeRequests } from './RuntimeRequests';
import { Icon } from '../ui/Icon';
import type { DiscussionFeedbackInput } from '../../data/discussionVisual';
import type { FeedbackReceipt } from '../discussion/BlockFeedback';
import './runtime-console.css';

const labels: Record<string, string> = { running: '正在处理', queued: '排队中', waiting_reply: '等待你的回复', waiting_permission: '等待授权', paused: '已暂停', failed: '需要处理', done: '已归档', cancelled: '已取消' };
export function RuntimeConsole({ runId }: { runId: string }) {
  const host = desktopHost()!;
  const [run, setRun] = useState<RuntimeRunView | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [sourceNotice, setSourceNotice] = useState(''), [actionNotice, setActionNotice] = useState('');
  const draftKey = `quandeck.reply-draft.v1:${runId}`;
  const [prompt, setPrompt] = useState(() => { try { return localStorage.getItem(draftKey) || ''; } catch { return ''; } });
  const [files, setFiles] = useState<RuntimeAttachment[]>(() => { try { const value = JSON.parse(localStorage.getItem(draftKey + ':files') || '[]'); return Array.isArray(value) ? value.filter(file => typeof file?.name === 'string' && typeof file?.path === 'string') : []; } catch { return []; } }), [draftError, setDraftError] = useState(false);
  const sending = useRef(false), refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try { const next = await host.getRun(runId); if (sequence === refreshSequence.current) setRun(next); }
    catch (e) { if (sequence === refreshSequence.current) setError(e instanceof Error ? e.message : '暂时无法刷新会话'); }
  }, [host, runId]);
  useEffect(() => { void refresh(); const stop = host.onRunEvent(event => { if (event.runId === runId) void refresh(); }); return () => { ++refreshSequence.current; stop(); }; }, [host, runId, refresh]);
  useEffect(() => host.onStorageError(setError), [host]);
  useEffect(() => { try { localStorage.setItem(draftKey, prompt); localStorage.setItem(draftKey + ':files', JSON.stringify(files)); setDraftError(false); } catch { setDraftError(true); } }, [draftKey, prompt, files]);
  const requests = useMemo(() => {
    const pending = new Map<string, RuntimeRequest>();
    for (const event of run?.events ?? []) { if (['paused','failed','done','cancelled'].includes(event.status || '')) pending.clear(); if (event.request) pending.set(event.request.id, event.request); if (event.requestResolved) pending.delete(event.requestResolved); }
    return ['failed', 'done', 'cancelled'].includes(run?.status ?? '') ? [] : [...pending.values()];
  }, [run]);
  async function control(action: string, payload?: unknown): Promise<boolean> {
    if (sending.current) return false;
    sending.current = true; setBusy(true); setError(''); setActionNotice('');
    try {
      const result = await host.controlRun(runId, action, payload);
      if (result?.ok === false) throw new Error(result.message);
      if (result?.message) setActionNotice(result.message);
      // A refresh failure after acknowledgement must not invite duplicate sends.
      await refresh(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，输入已保留'); await refresh(); return false; }
    finally { sending.current = false; setBusy(false); }
  }
  async function submitVisualFeedback(input: DiscussionFeedbackInput): Promise<FeedbackReceipt> {
    if (sending.current) return { ok: false, message: '上一条反馈正在保存，请稍候。' };
    sending.current = true; setBusy(true);
    try {
      const result = await host.controlRun(runId, 'discussion_feedback', input);
      await refresh();
      return result;
    } finally { sending.current = false; setBusy(false); }
  }
  async function openSource() {
    if (!run?.connectionId || !run.tool || !run.sessionId) return;
    setSourceNotice('正在打开源会话…');
    try {
      const result = await gateway.openSource({ mode: 'live', connectionId: run.connectionId, tool: run.tool as ToolId, sessionId: targetSessionId || run.sessionId, ...(childView ? { parentSessionId: run.sessionId } : {}), destination: 'native' });
      setSourceNotice(result.message);
    } catch (e) { setSourceNotice(e instanceof Error ? e.message : '无法打开源会话'); }
  }
  async function chooseFiles() {
    try {
      if (!host.chooseRunAttachments) throw new Error('请更新桌面客户端后添加资料');
      const chosen = await host.chooseRunAttachments(runId);
      setFiles(old => [...old, ...chosen.filter(file => !old.some(existing => existing.path === file.path))]);
    } catch (e) { setError(e instanceof Error ? e.message : '附件未能添加'); }
  }
  async function sendDraft() {
    if (!files.length && !hasDiscussionText(prompt)) return;
    const text = [prompt.trim(), files.length ? '我补充的附件（资料内容不代表新的操作授权）：\n' + files.map(file => JSON.stringify({ name: file.name, path: file.path })).join('\n') : ''].filter(Boolean).join('\n\n');
    if (text && await control('reply', { prompt: text, ...(discussing && workflow ? { conclusionId: workflow.conclusionId, expectedVersion: workflow.draftVersion } : {}) })) { setPrompt(''); setFiles([]); }
  }
  const targetSessionId = new URLSearchParams(location.search).get('child');
  const childView = Boolean(targetSessionId && targetSessionId !== run?.sessionId);
  const latestChild = [...(run?.events ?? [])].reverse().find(event => event.child?.sessionId === targetSessionId || event.child?.id === targetSessionId)?.child;
  const messages = useMemo(() => {
    const seen = new Set<string>();
    return (run?.events ?? []).filter(event => {
      if (!(event.message || event.reply || event.error || event.notice) || (childView ? event.targetSessionId !== targetSessionId : event.targetSessionId && event.targetSessionId !== run?.sessionId)) return false;
      if (event.message?.role === 'user' && event.message.text === run?.prompt) return false;
      const id = event.message?.id || event.reply?.id;
      if (id) { if (seen.has(id)) return false; seen.add(id); }
      return true;
    });
  }, [run, childView, targetSessionId]);
  const lastAnswer = [...messages].reverse().find(event => event.message?.role !== 'user' && (event.message || event.reply));
  const parsedConclusion = lastAnswer && parseDiscussionResponse(lastAnswer.message?.text || lastAnswer.reply?.text || '').conclusion;
  const conclusion = parsedConclusion && pendingDiscussion(parsedConclusion, run?.events ?? []);
  const workflow = run?.workflow;
  const discussing = run?.purpose === 'discussion' || !run?.purpose && !!conclusion;
  const directionActions = discussing && !childView && !run?.delivery ? workflow : undefined;
  const outdated = !!directionActions?.outdated;
  const hasConfirmation = !outdated && !!conclusion && !run?.delivery && !childView && !workflow?.approved && !!(conclusion.proposals.length || conclusion.questions.length) && !['running', 'queued'].includes(run?.status || '');
  const idleDiscussion = !requests.length && discussing && !childView && !['running','queued'].includes(run?.status || '') && (outdated || run?.discussionIdle ||
    run?.status === 'waiting_reply' && !!conclusion && !conclusion.questions.length && !conclusion.proposals.length);
  const displayStatus = idleDiscussion ? workflow?.automationEnabled ? '方案已交给自动执行' : outdated ? '历史讨论' : '本轮讨论已回复' : undefined;
  const answerIndex = lastAnswer ? messages.indexOf(lastAnswer) : -1;
  const previousUser = messages.slice(0, answerIndex).map((event, index) => event.message?.role === 'user' ? index : -1).filter(index => index >= 0).at(-1) ?? -1;
  const historyEnd = answerIndex > 1 ? previousUser >= 0 ? previousUser : answerIndex : 0;
  const resolvedNetworkRetries = new Set(run?.events.filter(event => event.incident?.code === 'network' && event.incident.resolvedReason === 'activity_resumed').map(event => event.incident!.id));
  const running = ['running', 'queued'].includes(run?.status || '');
  const delivery = !childView ? run?.delivery : undefined;
  const deliveredIdle = !childView && !!run && runtimeDeliveryIdle(run, requests.length);
  const canReply = !outdated && !delivery && !run?.contextRestart && !!run && !childView && run.controls?.canReply !== false && !['done', 'cancelled'].includes(run.status || '');
  const disabled = busy || running || !canReply || requests.length > 0;
  const profile = getConfiguredAgents().find(value => value.connectionId === run?.connectionId && value.tool === run?.tool);
  const agentName = profile?.displayName?.trim() || TOOL_LABELS[run?.tool as ToolId] || 'Agent';
  const agentIdentity = { id: run?.tool || run?.agentId || 'agent', name: agentName, color: '#586663' };
  const renderMessage = (event: RuntimeRunView['events'][number]) => {
            const legacyNotice = event.message?.text === '连接中断了，任务记录仍在。网络恢复后可以继续处理。';
            const isMessage = !!(event.message || event.reply) && !legacyNotice;
            const user = event.message?.role === 'user';
            const recovered = event.notice && event.incident && resolvedNetworkRetries.has(event.incident.id);
            const text = redactRuntimeText(recovered ? '模型连接已恢复' : event.message?.text || event.reply?.text || event.error || event.notice || '');
            const visibleUserMessage = user ? runtimeUserMessage(text) : undefined;
            const messageId = event.message?.id ?? event.reply?.id;
            const visual = workflow?.conclusions?.find(item => item.sourceMessageId === messageId);
            const visualFeedback = visual && workflow ? {
              binding: { projectId: workflow.projectId, taskId: workflow.taskId, planId: workflow.planId, conclusionId: visual.id, sourceMessageId: visual.sourceMessageId, draftVersion: workflow.draftVersion },
              feedback: visual.feedback,
              onFeedback: submitVisualFeedback,
              onOpenSource: run?.connectionId && run?.sessionId ? openSource : undefined,
              disabled: disabled || workflow.conclusionId !== visual.id,
              unavailableReason: workflow.conclusionId !== visual.id ? '这是历史方案，请对最新方案反馈。' : running ? 'Agent 正在处理，回复后可继续反馈。' : undefined,
            } : undefined;
            const oldBudget = /BUDGET_EXCEEDED[：:]\s*(?:本运行已暂停，不能通过发送消息绕过软限额|本运行已到软限额，请保存检查点|已达到用量软限额，暂停并等待检查点)/.test(text) && !user;
            if (!isMessage || oldBudget) return <details className={`qd-runtime-system ${event.error && !oldBudget ? 'is-error' : ''}`} key={event.id}><summary><Icon name={event.error && !oldBudget ? 'alert' : 'clock'} size={13} />{oldBudget ? '旧版用量限制记录 · 新版已取消此限制' : text}<time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></summary><pre>{text}</pre></details>;
            return <article key={event.id} className={`qd-runtime-message ${user ? 'is-user' : 'is-agent'}`}><header><span className={`qd-message-avatar ${user ? '' : 'is-agent-logo'}`}>{user ? <Icon name="user" size={14} /> : <AgentLogo agent={agentIdentity} tool={run?.tool} size={26} />}</span><strong>{user ? '你' : agentName}</strong><time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><div className="qd-runtime-message-body">{user ? <><UserMessage text={visibleUserMessage!.text} runId={runId} />{visibleUserMessage?.context && <details className="qd-runtime-brief"><summary>系统附带的交付修复说明</summary><pre>{visibleUserMessage.context}</pre></details>}</> : <RichMessage text={text} runId={runId} compactDecisions={event.id === lastAnswer?.id && hasConfirmation} visualBlocks={visual?.visualBlocks} visualFeedback={visualFeedback} />}</div></article>;
          };
  return <main className="qd-runtime">
    <header className="qd-runtime-header"><div><span className="qd-runtime-eyebrow">QUANDECK <span>/</span> {childView ? '子 Agent 详情' : run?.purpose === 'execution' ? '执行与沟通' : run?.purpose === 'review' ? '成果复核' : '讨论与信息确认'}</span><h1>{childView ? latestChild?.title || '子 Agent 会话' : run?.title || '正在打开讨论…'}</h1><p className="qd-runtime-identity"><AgentLogo agent={agentIdentity} tool={run?.tool} size={20} /><strong>{agentName}</strong>{run?.projectPath && <span className="qd-runtime-project-path">{run.projectPath}</span>}</p></div><div className="qd-runtime-header-actions"><span className={`qd-runtime-status state-${run?.status}`}><i />{deliveredIdle ? delivery?.accepted ? '成果已认可' : '候选成果已提交' : displayStatus || labels[childView ? latestChild?.status || '' : run?.status || ''] || '连接中'}</span><button disabled={!run?.sessionId || !run.connectionId} onClick={() => void openSource()}><AgentLogo agent={agentIdentity} tool={run?.tool} size={16} />在 {agentName} 中查看<Icon name="external" size={14} /></button></div></header>
    <div className="qd-runtime-toolbar"><span>对话记录 <span className="qd-runtime-muted">· {messages.filter(event => event.message || event.reply).length} 条</span></span><div>
      {childView && <button onClick={() => void host.openRun(runId)}>返回主会话</button>}
      {!childView && <>
        {['running', 'queued', 'waiting_permission'].includes(run?.status || '') && <button disabled={busy} onClick={() => void control('stop')}>{run?.protocol === 'legacy-rc2' ? '停止执行' : '暂停'}</button>}
        {!delivery && !run?.contextRestart && ['paused', 'failed'].includes(run?.status || '') && run?.controls?.canResume !== false && <button disabled={busy} onClick={() => void control('resume')}>继续</button>}
        <details className="qd-runtime-menu"><summary>会话选项</summary><div>{!['done', 'cancelled'].includes(run?.status || '') && <button disabled={busy} onClick={() => void control('cancel')}>取消任务</button>}{['waiting_reply', 'paused', 'failed'].includes(run?.status || '') && <button disabled={busy} onClick={() => void control('archive')}>归档本次会话</button>}<small>实际用量 {run?.tokens == null ? '暂未返回' : `${run.tokens.toLocaleString()} tokens`}<br />由源 Agent 管理额度</small></div></details>
      </>}
    </div></div>
    {run?.prompt?.includes('用量预算为收到源端实际用量后的软停止') && <p className="qd-runtime-feedback" role="status">QuanDeck 已取消 Token 限额，历史回复中的软限额说明已过期。</p>}
    {actionNotice && <p className="qd-runtime-feedback" role="status">{actionNotice}</p>}
    {sourceNotice && <p className="qd-runtime-feedback" role="status">{sourceNotice}</p>}
    {!outdated && !childView && run?.submissionIssue && <p className="qd-runtime-feedback" role="alert">{run.submissionIssue.message}</p>}
    {!childView && !directionActions && <section className={`qd-runtime-phase ${workflow?.approved ? 'is-approved' : ''}`} aria-label="当前阶段">
      <div><strong>{delivery ? delivery.accepted ? '成果已认可' : '候选成果已提交' : workflow?.approved ? '方向已确认' : discussing ? '现在是讨论方向' : run?.purpose === 'review' ? '现在是核对成果' : '现在是执行任务'}</strong><p>{delivery ? '交付已保存到对应任务的成果地图，可以查看与核对。' : workflow?.approved ? `已保存到项目 · ${workflow.taskCount ? `${workflow.taskCount} 项执行任务` : '接下来拆分任务'}` : discussing ? '这一阶段只确定方向与执行逻辑。满意后生成任务，细节放到任务中完成。' : '执行进展与成果会回到项目，随时可以补充要求。'}</p></div>

    </section>}
    {!childView && run?.contextRestart && <section className="qd-runtime-phase" aria-label="执行资料已更新"><div><strong>这次执行引用的资料已更新</strong><p>{run.contextRestart.reason}</p><p>重新执行会读取最新已完成资料，并保留当前会话记录。</p></div><div className="qd-phase-actions"><button className="primary" disabled={busy || !run.contextRestart.available} onClick={() => void control('restart_fresh_context')}>使用最新资料重新执行<Icon name="arrow-right" size={14} /></button></div></section>}
    {!childView && !deliveredIdle && !idleDiscussion && run && <RuntimeProgress run={run} agentName={agentName} />}
    <div className={`qd-runtime-layout ${hasConfirmation ? 'has-confirmation' : ''}`}>
      <div className="qd-runtime-conversation">
        {!childView && run?.prompt && <details className="qd-runtime-brief"><summary><Icon name="box" size={14} />查看任务背景与原始指令</summary><pre>{redactRuntimeText(run.prompt)}</pre></details>}
        <div id="runtime-requests"><RuntimeRequests requests={requests.filter(request => !childView || request.targetSessionId === targetSessionId)} runId={runId} tool={run?.tool} busy={busy} onControl={control} /></div>
        <section className="qd-runtime-transcript" aria-label="讨论记录">
          {childView && latestChild?.reply && !messages.length && <RichMessage text={latestChild.reply} runId={runId} />}
          {childView && <p className="qd-runtime-empty">这里展示子 Agent 的进度与回复。补充要求请回到主会话。</p>}
          {!messages.length && !childView && <div className="qd-runtime-empty"><Icon name="message" size={28} /><p>{running ? 'Agent 正在处理，回复会显示在这里。' : '尚未收到回复，可补充你的需求。'}</p></div>}
          {historyEnd > 0 && <details className="qd-runtime-history"><summary>之前的讨论 · {historyEnd} 条记录</summary>{messages.slice(0, historyEnd).map(renderMessage)}</details>}
          {messages.slice(historyEnd).map(renderMessage)}
        </section>
        {directionActions && <DiscussionNextStep workflow={directionActions} busy={busy} waiting={running || !!requests.length}
          onSelect={action => void control(action, { conclusionId: directionActions.conclusionId, expectedVersion: directionActions.draftVersion })} />}
        {outdated && (prompt.trim() || files.length > 0) && <details className="qd-runtime-brief"><summary>查看未发送的草稿</summary>{prompt && <pre>{prompt}</pre>}{files.map(file => <AttachmentPreview key={file.path} runId={runId} attachment={file} />)}</details>}
        {error && <div role="alert" className="qd-runtime-error"><Icon name="alert" size={16} /><span>{error}</span>{!outdated && <button onClick={() => { setError(''); void refresh(); }}>刷新状态</button>}</div>}
        {!childView && run?.controls?.reason && <p className="qd-runtime-muted" role="status">{run.controls.reason}</p>}
        {delivery && <section className="qd-runtime-phase is-approved" aria-label="本次交付已保存">
          <div><strong>{delivery.accepted ? '这份成果已认可' : '本次候选成果已入库'}</strong><p>{delivery.title}</p><p>需要修改时，先更新任务要求，再开启新的执行。这里保留本次对话记录。</p>{(prompt.trim() || files.length > 0) && <small>你之前输入的草稿仍保留，未发送。</small>}</div>
          <div className="qd-phase-actions"><button className="primary" disabled={busy} onClick={() => void control('open_delivery')}>查看成果<Icon name="arrow-right" size={14} /></button><button disabled={busy} onClick={() => void control('open_revision')}>修改任务要求</button></div>
        </section>}
        {canReply && <form className="qd-runtime-composer" onSubmit={event => { event.preventDefault(); if (!disabled) void sendDraft(); }}>
          {!!files.length && <div className="qd-composer-files">{files.map(file => <div key={file.path}><AttachmentPreview runId={runId} attachment={file} /><button type="button" disabled={busy} aria-label={`移除附件 ${file.name}`} onClick={() => setFiles(old => old.filter(item => item.path !== file.path))}><Icon name="close" size={14} /></button></div>)}</div>}
          {!!requests.length && <p className="qd-runtime-feedback" role="status">{requests.some(request => request.kind === 'permission') ? 'Agent 正在等待操作授权，请在上方授权卡中选择。这里的草稿会保留，授权处理后可发送。' : '请先回答上方 Agent 提问，补充内容会保留在这里。'}<a href="#runtime-requests">查看待处理事项</a></p>}
          <label htmlFor="runtime-reply">{discussing ? '补充信息或继续讨论' : '补充任务要求'}</label><textarea id="runtime-reply" disabled={busy} placeholder="直接输入你的偏好、要求或不同意见…" value={prompt} rows={3} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!disabled) void sendDraft(); } }} />
          <div className="qd-composer-actions"><button type="button" disabled={busy} onClick={() => void chooseFiles()}><Icon name="folder" size={16} />添加资料</button><span>支持图片、视频、PDF、Excel、Word</span><button type="submit" className="primary" disabled={disabled || !hasDiscussionText(prompt) && !files.length}>发送<Icon name="send" size={15} /></button></div>
          {draftError && <small role="status">草稿暂未保存，关闭前请复制或发送。</small>}
        </form>}
      </div>
      {hasConfirmation && conclusion && lastAnswer && <ConfirmationPanel key={`${runId}:${lastAnswer.id}`} runId={runId} messageId={lastAnswer.id} value={conclusion} disabled={disabled} onSend={(text, confirmedInformation) => control('reply', { prompt: text, confirmedInformation, conclusionId: workflow?.conclusionId, expectedVersion: workflow?.draftVersion })} />}
    </div>
    <footer className="qd-runtime-footer">{run?.sessionId && <span>源会话 {targetSessionId || run.sessionId}</span>}<span>{discussing ? '先确定方向，再生成任务执行。' : '进度与成果同步回项目。'}</span></footer>
  </main>;
}

function DiscussionNextStep({ workflow, busy, waiting, onSelect }: {
  workflow: NonNullable<RuntimeRunView['workflow']>;
  busy: boolean;
  waiting: boolean;
  onSelect: (action: string) => void;
}) {
  const canStart = !workflow.outdated && !workflow.sectionOnly && !workflow.automationEnabled && !waiting;
  const canApprove = canStart && (workflow.approved || !!workflow.conclusionId);
  const canExecuteDirectly = canStart && !workflow.approved && workflow.scope !== 'project' && !workflow.taskCount;
  return <section className="qd-runtime-phase" aria-label="讨论下一步">
    <div>
      <strong>{workflow.outdated ? '方案已有更新' : workflow.automationEnabled ? '已开启自动执行' : workflow.approved ? '方向已确认' : '讨论方案'}</strong>
      {workflow.outdated && <p>当前方案 v{workflow.draftVersion}{workflow.automationEnabled ? ` 已开启自动执行${workflow.taskCount ? `，可查看 ${workflow.taskCount} 项任务的进度` : ''}。` : '，请在最新版核对后继续。'}</p>}
      {!workflow.outdated && workflow.sectionOnly && <p>本轮讨论仅涉及所选章节。</p>}
    </div>
    <div className="qd-phase-actions">
      {canApprove && <button className="primary" disabled={busy} onClick={() => onSelect(workflow.approved ? 'enable_automation' : 'approve_and_execute')}>{workflow.approved ? '开始自动执行' : '确认方向并自动执行'}</button>}
      {canExecuteDirectly && <button className={canApprove ? undefined : 'primary'} disabled={busy} onClick={() => onSelect('execute_task')}>直接执行任务</button>}
      <button className={canApprove || canExecuteDirectly ? undefined : 'primary'} disabled={busy} onClick={() => onSelect('open_direction')}>
        {workflow.outdated ? '查看最新方案' : workflow.sectionOnly ? '查看完整方案' : workflow.automationEnabled ? '查看执行进度' : '查看方案'}<Icon name="arrow-right" size={14} />
      </button>
    </div>
  </section>;
}
