import type { KnowledgeNote } from "./knowledgeNotes";
import { todoLineText } from "./noteTodos";

export interface NoteListImage {
  id: string;
  name: string;
}
export interface NoteListItem {
  noteId: string;
  noteTitle: string;
  revision: number;
  lineIndex: number;
  start: number;
  end: number;
  blockEnd: number;
  number?: string;
  raw: string;
  text: string;
  remaining: string;
  details: string[];
  status: "open" | "partial" | "struck";
  images: NoteListImage[];
  strikeRanges: { start: number; end: number }[];
}
export interface NoteList {
  items: NoteListItem[];
  counts: { open: number; partial: number; struck: number };
}
const numbered = /^\s*(?:~~)?(\d+)[.)、．）]\s*/u;
const bullet = /^\s*(?:~~)?(?:[-*+]\s+|[•●]\s*|\[[ xX]\]\s*)/u;
const imagePattern = /!\[([^\]\n]*)\]\(attachment:([^)\s]+)\)/gu;
const meaningful = (s: string) => /[\p{L}\p{N}\p{So}]/u.test(s);
function withoutMarker(s: string) {
  return s.replace(/^\s*(?:\d+[.)、．）]\s*|[-*+•●]\s*|\[[ xX]\]\s*)/u, "");
}
function strikeMatches(s: string) {
  // A literal in inline code or an escaped delimiter is not a deletion.
  const spans = [...s.matchAll(/(`+).*?\1/gu)].map((m) => [m.index!, m.index! + m[0].length]);
  const markers = [...s.matchAll(/(?<!\\)~~(?!~)/gu)].filter(
    (m) => !spans.some(([a, b]) => m.index! >= a && m.index! < b),
  );
  const matches: { start: number; end: number }[] = [];
  for (let i = 0; i + 1 < markers.length; i += 2)
    matches.push({ start: markers[i].index!, end: markers[i + 1].index! + 2 });
  return matches;
}
function images(raw: string, note: KnowledgeNote) {
  return [...raw.matchAll(imagePattern)].flatMap((m) => {
    const file = note.attachments.find((f) => f.id === m[2]);
    return file ? [{ id: file.id, name: file.name }] : [];
  });
}
export function noteListItems(note: KnowledgeNote): NoteListItem[] {
  const items: NoteListItem[] = [];
  const todoLines = new Set((note.todos ?? []).filter((t) => !t.follows).map((t) => t.lineIndex));
  let owner: NoteListItem | undefined,
    fence = "",
    offset = 0,
    afterBlank = false;
  for (const [lineIndex, raw] of note.body.split("\n").entries()) {
    const start = offset;
    offset += raw.length + 1;
    const delimiter = raw.trimStart().match(/^(`{3,}|~{3,})/u)?.[1];
    if (delimiter) {
      owner = undefined;
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = "";
      continue;
    }
    if (fence) continue;
    if (!raw.trim()) {
      afterBlank = true;
      continue;
    }
    const contiguous = !afterBlank;
    afterBlank = false;
    if (/^\s*#{1,6}\s/u.test(raw)) {
      owner = undefined;
      continue;
    }
    const number = raw.match(numbered)?.[1],
      fileRefs = images(raw, note);
    const prose = raw.replace(imagePattern, "");
    const isBullet = bullet.test(raw);
    if (!number && !todoLines.has(lineIndex) && (!isBullet || owner?.number)) {
      if (owner) {
        if (prose.trim() && !(isBullet && owner.number) && !contiguous && !/^\s+/u.test(raw)) {
          owner = undefined;
        } else {
          owner.images.push(...fileRefs);
          owner.blockEnd = start + raw.length;
          if (prose.trim()) owner.details.push(raw);
        }
      }
      continue;
    }
    const bare = withoutMarker(prose.replace(/~~/g, ""));
    if (!meaningful(todoLineText(bare))) {
      if (owner) { owner.images.push(...fileRefs); owner.blockEnd = start + raw.length; }
      continue;
    }
    const strikes = strikeMatches(raw);
    let unstruck = raw;
    for (const span of [...strikes].reverse())
      unstruck = unstruck.slice(0, span.start) + unstruck.slice(span.end);
    const remaining = todoLineText(withoutMarker(unstruck.replace(imagePattern, ""))).trim();
    const text = todoLineText(bare);
    // Only the text of the numbered heading determines its strike status. Captions,
    // screenshots, and explanatory sub-bullets are supporting material.
    owner = {
      noteId: note.id,
      noteTitle: note.title,
      revision: note.revision,
      lineIndex,
      start,
      end: start + raw.length,
      blockEnd: start + raw.length,
      number,
      raw,
      text,
      remaining,
      details: [],
      images: fileRefs,
      status: !strikes.length ? "open" : meaningful(remaining) ? "partial" : "struck",
      strikeRanges: strikes.map((r) => ({ start: start + r.start, end: start + r.end })),
    };
    items.push(owner);
  }
  return items;
}
