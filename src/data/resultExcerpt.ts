import { parseDiscussionResponse } from './discussionPresentation';
import { readRuntimeSubmission } from './runtimeSubmission';

/** A verbatim opening excerpt, not an inferred summary. Full text remains in the reader. */
export function resultExcerpt(text: string, limit = 140): string {
  const submission = readRuntimeSubmission(text);
  const reply = parseDiscussionResponse(text);
  text = submission && 'envelope' in submission && typeof submission.envelope.payload.body === 'string' ? submission.envelope.payload.body : reply.conclusion?.summary ?? (reply.malformed ? reply.content || '回复格式待核对' : text);
  const paragraph = text.split(/\n\s*\n/).find(part => part.trim() && !/^\s*#{1,6}\s/.test(part)) ?? text;
  const plain = paragraph.replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[\s>#*-]+/gm, '').replace(/[*`_]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? `${plain.slice(0, limit).trimEnd()}…` : plain;
}
