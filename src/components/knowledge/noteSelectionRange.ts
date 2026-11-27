import { locateSelection, makeSelection, type NoteSelection } from '../../data/knowledgeNotes';

// Keep the Markdown parser's offsets in the hidden preview. The live editor gets plain text
// nodes, so metadata and AI controls never end up in a saved note.
interface MarkdownNode {
  type: string; value?: string; children?: MarkdownNode[]; tagName?: string;
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number; line?: number }; end: { offset?: number } };
}
export function markNoteSource() {
  return (root: MarkdownNode) => {
    function visit(parent: MarkdownNode) {
      if (parent.type === 'element' && parent.position?.start.line) {
        parent.properties = { ...parent.properties, 'data-note-line': parent.position.start.line - 1 };
      }
      if (!parent.children) return;
      parent.children = parent.children.map(child => {
        if (child.type !== 'text') { visit(child); return child; }
        if (!child.value?.trim()) return child;
        const span = child.position ?? (parent.children?.length === 1 ? parent.position : undefined);
        if (span?.start.offset === undefined || span.end.offset === undefined) return child;
        return { type: 'element', tagName: 'span', properties: {
          'data-source-start': span.start.offset, 'data-source-end': span.end.offset,
        }, children: [child] };
      });
    }
    visit(root);
  };
}

const significant = (value: string) => value.replace(/[\s\u200b]/g, '');
function editorTexts(editor: HTMLElement) {
  const result: Text[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.parentElement?.closest('[contenteditable="false"]') && significant(node.data)) result.push(node);
  }
  return result;
}

// Markdown escapes and entities can occupy several source characters for a single glyph.
type SourceGlyph = { start: number; end: number; char: string };
const sourceIndex = new WeakMap<HTMLElement, { body: string; glyphs: SourceGlyph[] }>();
function sourceGlyphs(seed: HTMLElement, body: string) {
  const indexed = sourceIndex.get(seed);
  if (indexed?.body === body) return indexed.glyphs;
  const glyphs: SourceGlyph[] = [];
  const decoder = document.createElement('textarea');
  for (const span of seed.querySelectorAll<HTMLElement>('[data-source-start]')) {
    if (span.closest('[data-note-link],[data-note-file]')) continue;
    const first = Number(span.dataset.sourceStart), limit = Number(span.dataset.sourceEnd);
    const label = span.textContent || '', raw = body.slice(first, limit);
    const literal = raw === label;
    let at = 0;
    for (let i = 0; i < label.length; i++) {
      let from = at, end = at + 1;
      if (!literal && raw[at] === '\\' && raw[at+1] === label[i]) end++;
      else if (!literal && raw[at] === '&' && /^&(?:#\d+|#x[\da-f]+|[a-z]\w*);/i.test(raw.slice(at,at+48))) {
        const entity = raw.slice(at, raw.indexOf(';',at)+1);
        decoder.innerHTML = entity;
        const decoded = decoder.value;
        if (decoded && label.startsWith(decoded,i)) {
          end = at + entity.length;
          for (let part = 0; part < decoded.length; part++) if (significant(decoded[part])) glyphs.push({ start:first+at, end:first+end, char:decoded[part] });
          i += decoded.length - 1; at = end; continue;
        }
      } else if (raw[at] !== label[i]) {
        const found = raw.indexOf(label[i],at);
        if (found < 0) { if (significant(label[i])) return []; continue; }
        from = found; end = found + 1;
      }
      if (significant(label[i])) glyphs.push({start:first+from, end:first+end, char:label[i]});
      at = end;
    }
  }
  sourceIndex.set(seed, { body, glyphs });
  return glyphs;
}

function selectedText(range: Range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('[contenteditable="false"]').forEach(node => node.remove());
  return fragment.textContent ?? '';
}

export interface SelectedPassage { selection: NoteSelection; range: Range; label: string }
export function notePassage(editor: HTMLElement, seed: HTMLElement, body: string, range: Range): SelectedPassage | undefined {
  const fragment = range.cloneContents();
  const controls = fragment.querySelectorAll('[contenteditable="false"]');
  let label: string;
  if (controls.length) {
    controls.forEach(node => node.remove());
    fragment.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    fragment.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6').forEach(node => { if (node.nextSibling) node.after('\n'); });
    label = fragment.textContent ?? '';
  } else {
    label = editor.ownerDocument.getSelection()?.toString() ?? range.toString();
  }
  const selected = significant(label);
  if (!selected) return;
  const prefix = document.createRange();
  prefix.selectNodeContents(editor); prefix.setEnd(range.startContainer, range.startOffset);
  const offset = significant(selectedText(prefix)).length;
  const glyphs = sourceGlyphs(seed, body);
  let start: number, end: number;
  if (glyphs.slice(offset, offset+selected.length).map(glyph=>glyph.char).join('') === selected) {
    start = glyphs[offset].start; end = glyphs[offset+selected.length-1].end;
  } else {
    start = body.indexOf(label);
    if (start < 0 || body.indexOf(label,start+1) >= 0) return;
    end = start + label.length;
  }
  return { selection: makeSelection(body,start,end), range: range.cloneRange(), label };
}

export function resolveNoteRange(editor: HTMLElement, seed: HTMLElement, body: string, selection: NoteSelection): Range | undefined {
  const offset = locateSelection(body, selection);
  if (offset === undefined) return;
  const glyphs = sourceGlyphs(seed, body);
  const start = glyphs.findIndex(glyph => glyph.end > offset);
  const after = glyphs.findIndex(glyph => glyph.start >= offset + selection.quote.length);
  const end = (after < 0 ? glyphs.length : after) - 1;
  if (start < 0 || end < start) return;
  const range = document.createRange();
  let index = 0;
  for (const node of editorTexts(editor)) {
    for (let i = 0; i < node.length; i++) {
      if (!significant(node.data[i])) continue;
      if (glyphs[index]?.char !== node.data[i]) return;
      if (index === start) range.setStart(node,i);
      if (index === end) { range.setEnd(node,i+1); return range; }
      index++;
    }
  }
}
