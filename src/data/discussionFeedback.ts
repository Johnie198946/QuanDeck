import { ensureCollaboration } from './collaboration';
import type { Snapshot } from './types';
import { visualHash, type DiscussionFeedbackInput, type DiscussionFeedbackResult, type DiscussionBlockFeedback, type DiscussionVisualBlock } from './discussionVisual';

function audit(snapshot: Snapshot, type: string, input: DiscussionFeedbackInput, detail: string) {
  const c = ensureCollaboration(snapshot);
  c.events.push({ id: `discussion:${input.feedbackId}:${++c.sequence}`, sequence: c.sequence, type, taskKey: input.binding.taskId, actor: 'human', at: new Date().toISOString(), detail });
}
export function findDiscussionBlock(snapshot: Snapshot, input: DiscussionFeedbackInput): DiscussionVisualBlock | undefined {
  const p = snapshot.ideaPlans?.[input.binding.planId];
  return p?.discussion?.conclusions.find(c => c.id === input.binding.conclusionId)?.visualBlocks?.find(b => b.id === input.blockId);
}
/** A feedback receipt changes only discussion evidence, never consent or task lifecycle. */
export function recordDiscussionFeedback(snapshot: Snapshot, input: DiscussionFeedbackInput): DiscussionFeedbackResult {
  const b = input?.binding;
  if (!b || snapshot.project.id !== b.projectId || typeof input.feedbackId !== 'string' || !/^[\w:-]{1,180}$/.test(input.feedbackId) || typeof input.text !== 'string' || input.text.length > 10000 || !['prefer','reject','request_change','comment'].includes(input.action)) return { ok: false, message: '反馈内容或项目来源无效' };
  const plan = snapshot.ideaPlans?.[b.planId], task = snapshot.tasks[b.taskId];
  if (!plan || plan.taskId !== b.taskId || (plan.scope!=='project'&&!task)) return { ok: false, message: '反馈对应的任务已变化' };
  const conclusion = plan.discussion?.conclusions.find(c => c.id === b.conclusionId);
  const block = findDiscussionBlock(snapshot, input);
  if (!conclusion || !block || block.hash !== input.blockHash || b.sourceMessageId !== conclusion.sourceMessageId || input.optionId && !block.options?.some(o => o.id === input.optionId)) return { ok: false, message: '卡片来源已变化，请刷新后再操作' };
  const c = ensureCollaboration(snapshot), list = c.discussionFeedback ??= [];
  const previous = list.find(f => f.feedbackId === input.feedbackId);
  const fingerprint = (value: DiscussionFeedbackInput) => visualHash({ binding: value.binding, feedbackId: value.feedbackId, blockId: value.blockId, blockHash: value.blockHash, optionId: value.optionId, action: value.action, text: value.text });
  if (previous) return fingerprint(previous) === fingerprint(input) ? { ok: true, data: { feedback: structuredClone(previous) }, message: '反馈已记录' } : { ok: false, message: '反馈标识已被不同内容使用，请重新提交' };
  if (plan.draftVersion !== b.draftVersion || [...(plan.discussion?.conclusions ?? [])].reverse().find(c => c.scopeId === conclusion.scopeId)?.id !== conclusion.id) return { ok: false, message: '已有更新的方案，请在最新卡片上反馈' };
  const feedback: DiscussionBlockFeedback = { ...structuredClone(input), recordedAt: new Date().toISOString(), delivery: 'pending' };
  list.push(feedback); audit(snapshot, 'discussion_feedback_recorded', input, JSON.stringify({ feedbackId: input.feedbackId, blockId: block.id, blockHash: block.hash, action: input.action }));
  return { ok: true, data: { feedback: structuredClone(feedback) }, message: '已保存到讨论，尚未发送' };
}
/** Internal adapter receipt only; this is not exposed as a renderer command. */
export function recordDiscussionDelivery(snapshot: Snapshot, feedbackId: string, delivery: 'sent' | 'failed' | 'unknown', error?: string): DiscussionBlockFeedback | undefined {
  const f = snapshot.collaboration?.discussionFeedback?.find(f => f.feedbackId === feedbackId);
  if (!f || f.delivery === 'sent') return f;
  f.delivery = delivery;
  if (error) f.error = error.slice(0, 2000); else delete f.error;
  audit(snapshot, `discussion_feedback_${delivery}`, f, JSON.stringify({ feedbackId, error: f.error }));
  return structuredClone(f);
}
export function discussionFeedbackPrompt(snapshot: Snapshot, input: DiscussionFeedbackInput): string {
  const block = findDiscussionBlock(snapshot, input), option = block?.options?.find(o => o.id === input.optionId);
  const actions = { prefer: '偏好这项', reject: '不选这项', request_change: '希望调整', comment: '补充意见' };
  return `用户对讨论卡片的反馈（不是整份方案确认，也不是执行授权）：\n卡片：${block?.title ?? input.blockId}\n${option ? `选项：${option.title}\n` : ''}态度：${actions[input.action]}\n补充：${input.text || '无额外文字'}\n卡片内容：${JSON.stringify(block)}\n只围绕这个反馈更新方向；保留其他已确认条件，不重复要求用户确认。`;
}
