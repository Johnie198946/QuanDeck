type Segment = { segment: string; isWordLike?: boolean };
const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment(value: string): Iterable<Segment> } }).Segmenter;
const segmenter = Segmenter ? new Segmenter('zh', { granularity: 'word' }) : undefined;

export function segmentKnowledgeWords(text: string): string[] {
  const normalized = text.normalize('NFKC').toLocaleLowerCase().slice(0, 5000);
  if (!segmenter) return normalized.match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? [];
  return Array.from(segmenter.segment(normalized)).filter(word => word.isWordLike).map(word => word.segment);
}
