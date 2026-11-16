import type { DiscussionConclusion, IdeaPlan } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost } from '../../integration/desktop';
import { gateway } from '../../integration/gateway';
import { DiscussionCanvas } from '../discussion/DiscussionCanvas';
import type { CanvasFeedback } from '../discussion/BlockFeedback';
import { MarkdownMessage } from '../runtime/RichMessage';

/** The visible body is a projection of the saved conclusion, never a second draft. */
export function PlanDiscussionBody({ plan, result }: { plan: IdeaPlan; result: DiscussionConclusion }) {
  const { snap, api, toast } = useWorkdeck();
  const source = result.sourceRef
    ? Object.values(snap.sessions).find(session => session.source?.connectionId === result.sourceRef!.connectionId && session.source.sessionId === result.sourceRef!.sessionId)
    : plan.discussion?.sessionId ? snap.sessions[plan.discussion.sessionId] : undefined;
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
  return <div className="qd-direction-discussion-body" data-direction-conclusion={result.id}>
    <MarkdownMessage text={result.summary} runId={source?.runtime?.runId ?? ''} />
    {!result.adopted && !!result.outline?.length && <div className="qd-direction-proposed-outline" aria-label="待确认方向正文">{result.outline.map(section => <section key={section.id}><h4>{section.title}</h4>{section.lines.length ? section.lines.map(line => <MarkdownMessage key={line.id} text={line.text} runId={source?.runtime?.runId ?? ''} />) : <p>此部分尚未制定。</p>}</section>)}</div>}
    {!!result.visualBlocks?.length && <DiscussionCanvas blocks={result.visualBlocks} context={context} />}
    {!!result.proposed?.length && <details className="qd-direction-notes"><summary>本轮建议 · {result.proposed.length}</summary><MarkdownMessage text={result.proposed.map(text => `- ${text}`).join('\n')} runId={source?.runtime?.runId ?? ''} /></details>}
    {!!result.open.length && <details className="qd-direction-notes"><summary>可继续补充 · {result.open.length}</summary><MarkdownMessage text={result.open.map(text => `- ${text}`).join('\n')} runId={source?.runtime?.runId ?? ''} /></details>}
  </div>;
}
