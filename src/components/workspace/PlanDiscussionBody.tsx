import { useMemo } from 'react';
import { parseDiscussionResponse } from '../../data/discussionPresentation';
import type { DiscussionConclusion, IdeaPlan, Snapshot } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost } from '../../integration/desktop';
import { gateway } from '../../integration/gateway';
import { DiscussionCanvas } from '../discussion/DiscussionCanvas';
import type { CanvasFeedback } from '../discussion/BlockFeedback';
import { DiscussionChart } from '../runtime/DiscussionChart';
import { ReplyAttachment, MarkdownMessage } from '../runtime/RichMessage';

function conclusionSession(snap: Snapshot, plan: IdeaPlan, result: DiscussionConclusion) {
  return Object.values(snap.sessions).find(session => {
    if (session.runtime?.purpose !== 'discussion' || session.runtime.projectId !== snap.project.id ||
        session.runtime.planId !== plan.id || (session.runtime.scope ?? 'root') !== (result.scopeId ?? 'root')) return false;
    return result.sourceRef ? session.source?.connectionId === result.sourceRef.connectionId && session.source.sessionId === result.sourceRef.sessionId
      : !!result.sourceMessageId && session.rounds.some(round => round.id === result.sourceMessageId);
  });
}

/** The visible body is a projection of the saved conclusion, never a second draft. */
export function ConclusionMedia({ plan, result }: { plan: IdeaPlan; result: DiscussionConclusion }) {
  const { snap, api, toast } = useWorkdeck();
  const source = conclusionSession(snap, plan, result);
  const original = source?.rounds.find(round => round.id === result.sourceMessageId)?.reply;
  const savedMedia = useMemo(() => original && (!result.charts || !result.attachments) ? parseDiscussionResponse(original).conclusion : undefined, [original, result.charts, result.attachments]);
  const context: CanvasFeedback = {
    binding: { projectId: snap.project.id, taskId: plan.taskId, planId: plan.id, conclusionId: result.id, sourceMessageId: result.sourceMessageId, draftVersion: plan.draftVersion },
    feedback: snap.collaboration?.discussionFeedback?.filter(item => item.binding.conclusionId === result.id),
    onFeedback: input => {
      const host = desktopHost();
      return host && source?.runtime?.runId ? host.controlRun(source.runtime.runId, 'discussion_feedback', input) : api.recordDiscussionFeedback(input);
    },
    onOpenSource: source?.source ? async () => {
      try { const receipt = await gateway.openSource({ ...source.source!, mode: api.mode === 'sample' ? 'sample' : 'live', destination: 'native' }); toast(receipt.message, receipt.status === 'unavailable' ? 'error' : 'info'); }
      catch (error) { toast(error instanceof Error ? error.message : '暂未能打开源会话', 'error'); }
    } : undefined,
  };
  return <>
    {!!result.visualBlocks?.length && <DiscussionCanvas blocks={result.visualBlocks} context={context} />}
    {(result.charts ?? savedMedia?.charts)?.map((chart, i) => <DiscussionChart key={i} chart={chart} />)}
    {(result.attachments ?? savedMedia?.attachments)?.map((attachment, i) => <ReplyAttachment key={i} attachment={attachment} runId={source?.runtime?.runId ?? ''} />)}
  </>;
}

export function PlanDiscussionBody({ plan, result, showSummary = true }: { plan: IdeaPlan; result: DiscussionConclusion; showSummary?: boolean }) {
  const { snap } = useWorkdeck();
  const source = conclusionSession(snap, plan, result);
  return <div className="qd-direction-discussion-body" data-direction-conclusion={result.id}>
    {showSummary && <MarkdownMessage text={result.summary} runId={source?.runtime?.runId ?? ''} />}
    {!result.adopted && !!result.outline?.length && <div className="qd-direction-proposed-outline" aria-label="待确认方向正文">{result.outline.filter(section => section.lines.some(line => line.text.trim())).map((section, index) => <section id={`direction-${plan.id}-proposal-${index}`} tabIndex={-1} key={section.id}><h4>{section.title}</h4>{section.lines.length ? section.lines.map(line => <MarkdownMessage key={line.id} text={line.text} runId={source?.runtime?.runId ?? ''} />) : <p>此部分尚未制定。</p>}</section>)}</div>}
    {showSummary && <ConclusionMedia plan={plan} result={result} />}
    {!!result.proposed?.length && <details className="qd-direction-notes"><summary>本轮建议 · {result.proposed.length}</summary><MarkdownMessage text={result.proposed.map(text => `- ${text}`).join('\n')} runId={source?.runtime?.runId ?? ''} /></details>}
    {!!result.open.length && <details className="qd-direction-notes"><summary>可继续补充 · {result.open.length}</summary><MarkdownMessage text={result.open.map(text => `- ${text}`).join('\n')} runId={source?.runtime?.runId ?? ''} /></details>}
  </div>;
}
