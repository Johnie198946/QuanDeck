import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { readableNote } from './IdeaEvidence';
import type { CanvasEdge, CanvasNode } from './planetLayout';

export interface NotePassage extends CanvasNode {
  content: true;
  owner: string;
  parent: string;
  line: number;
  quote: string;
  kind: '小节' | '要点' | '段落' | '代码' | '表格';
}

const heading = /^(#{1,6})\s+(.+)/;
const bullet = /^\s*(?:[-*+] |\d+[.)] )\s*(?:\[[ xX]\]\s*)?/;
const fence = /^\s{0,3}(`{3,}|~{3,})/;

/** Each label and excerpt is taken from the original Markdown, with its source line. */
export function noteOutline(note: KnowledgeNote): NotePassage[] {
  const rows = note.body.split(/\r?\n/);
  const items: NotePassage[] = [];
  const headings: { level: number; id: string }[] = [];
  for (let line = 0; line < rows.length;) {
    const start = line;
    const text = rows[line].trim();
    line++;
    if (!text || /^(?:---+|\*\*\*+|___+)$/.test(text)) continue;
    const title = heading.exec(text);
    const code = fence.exec(rows[start]);
    let kind: NotePassage['kind'] = '段落';
    if (title) {
      kind = '小节';
      while (headings.length && headings[headings.length-1].level >= title[1].length) headings.pop();
    } else if (code) {
      kind = '代码';
      while (line < rows.length && !rows[line].trim().startsWith(code[1])) line++;
      if (line < rows.length) line++;
    } else if (bullet.test(rows[start])) {
      kind = '要点';
      while (line < rows.length && /^\s+\S/.test(rows[line]) && !bullet.test(rows[line])) line++;
    } else {
      if (text.startsWith('|')) kind = '表格';
      while (line < rows.length && rows[line].trim() && !heading.test(rows[line].trim()) && !bullet.test(rows[line]) && !fence.test(rows[line])) line++;
    }
    const quote = rows.slice(start,line).join('\n');
    const label = readableNote(title ? title[2] : code ? rows[start+1] || code[1] : text.replace(bullet,'')).replace(/^>\s*/, '').trim();
    if (!label) continue;
    const id = 'passage:'+JSON.stringify([note.id,start]);
    items.push({id, owner:note.id, content:true, parent:headings.at(-1)?.id ?? note.id, line:start, title:label, quote, kind});
    if (title) headings.push({level:title[1].length,id});
  }
  return items;
}

export const OUTLINE_PREVIEW = 5;

export function passageEdge(passage: NotePassage): CanvasEdge {
  return {key:'outline:'+passage.id, members:[passage.parent,passage.id], label:passage.kind, content:true};
}
