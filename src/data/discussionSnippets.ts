import { parseDiscussionResponse } from './discussionPresentation';

const malformedNote = '回复格式暂未识别，请打开会话查看原文。';
const plain = (value: string) => value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/`([^`]+)`/g, '$1');
/** Display projection only: source receipts and confirmation state remain untouched. */
export function discussionSummary(text: string): string {
  const view = parseDiscussionResponse(text);
  return view.submission ? plain(view.submission.title) : view.conclusion ? plain(view.conclusion.summary) : view.malformed ? view.content || malformedNote : text;
}
export function discussionQuestion(text: string): string {
  const view = parseDiscussionResponse(text);
  if (view.submission) return plain(view.submission.title);
  if (view.conclusion) return plain(view.conclusion.questions.length ? view.conclusion.questions.join('；') : view.conclusion.summary);
  return view.malformed ? view.content || malformedNote : text;
}
/** Human-readable expansion, deliberately does not label model proposals as confirmed facts. */
export function discussionDetail(text: string): string {
  const view = parseDiscussionResponse(text), value = view.conclusion;
  if (!value) return view.submission ? view.content : view.malformed ? view.content || malformedNote : text;
  return [plain(value.summary), value.proposals.length ? `待确认建议\n${value.proposals.map(item => `• ${plain(item)}`).join('\n')}` : '', value.questions.length ? `待补充信息\n${value.questions.map(item => `• ${plain(item)}`).join('\n')}` : '', value.cards.length || value.charts.length || value.attachments.length ? '包含卡片或附件，可打开会话查看。' : ''].filter(Boolean).join('\n\n');
}
