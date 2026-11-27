/** A line is a paragraph, list item, table row or explicit line break. Wrapping
 * a long sentence on screen must still offer exactly one task. */
interface VisibleLine { range: Range; text: string }
export interface WriterLine extends VisibleLine { lineIndex: number }
const blocks = new Set('P DIV LI BLOCKQUOTE H1 H2 H3 H4 H5 H6 PRE TR'.split(' '));

function visibleLines(root: HTMLElement): VisibleLine[] {
  const lines: VisibleLine[] = [];
  let range: Range | undefined;
  let text = '';
  function end() {
    if (range && text.trim()) lines.push({ range, text: text.trim() });
    range = undefined;
    text = '';
  }
  function add(node: Node, start: number, finish: number, label: string) {
    if (!range && !label.trim()) return;
    if (!range) {
      range = document.createRange();
      range.setStart(node, start);
    }
    range.setEnd(node, finish);
    text += label;
  }
  function visit(node: Node) {
    if (node instanceof Text) {
      let offset = 0;
      for (const part of node.data.split('\n')) {
        if (offset) end();
        if (part) add(node, offset, offset + part.length, part);
        offset += part.length + 1;
      }
      return;
    }
    if (!(node instanceof HTMLElement) || node.hasAttribute('data-todo-indent')) return;
    if (node.tagName === 'BR' || node.tagName === 'HR') { end(); return; }
    if (node.tagName === 'IMG' || node.dataset.noteRemoteImage || node.dataset.noteFile || node.dataset.noteLink) {
      const index = Array.prototype.indexOf.call(node.parentNode!.childNodes, node);
      add(node.parentNode!, index, index + 1, node.getAttribute('alt') || node.dataset.alt || node.dataset.label || node.textContent || '图片');
      return;
    }
    const boundary = blocks.has(node.tagName);
    if (boundary) end();
    for (const child of node.childNodes) visit(child);
    if (node.tagName === 'TD' || node.tagName === 'TH') text += ' ';
    if (boundary) end();
  }
  for (const node of root.childNodes) visit(node);
  end();
  return lines;
}

function sourceIndex(line: VisibleLine, starts: number[], source: string[]) {
  const node = line.range.startContainer;
  const child = node.childNodes[line.range.startOffset];
  const element = node instanceof HTMLElement ? child instanceof HTMLElement ? child : node : node.parentElement;
  const span = element?.closest<HTMLElement>('[data-source-start]');
  const breaks = node instanceof Text ? node.data.slice(0, line.range.startOffset).split('\n').length - 1 : 0;
  // Markdown's code node starts at the opening fence. Its first displayed
  // character is on the following source row.
  const code = element?.closest('pre')?.dataset.noteLine;
  if (code !== undefined && /^\s*(?:`{3,}|~{3,})/.test(source[Number(code)] ?? '')) return Number(code) + 1 + breaks;
  if (span) {
    const offset = Number(span.dataset.sourceStart);
    let i = 0, end = starts.length;
    while (i + 1 < end) {
      const mid = Math.floor((i + end) / 2);
      if (starts[mid] <= offset) i = mid; else end = mid;
    }
    return i + breaks;
  }
  const block = element?.closest<HTMLElement>('[data-note-line]');
  if (block) return Number(block.dataset.noteLine) + breaks;
}

/** Match the live editing DOM to the original Markdown. Parser positions also
 * cover image rows, table dividers, fenced code and repeated list items. */
export function writerLines(editor: HTMLElement, seed: HTMLElement, body: string): WriterLine[] {
  const visible = visibleLines(editor);
  const source = body.split('\n');
  const nonempty = source.flatMap((text, index) => text.trim() ? [index] : []);
  // Character formatting and native list markers don't change physical lines.
  if (nonempty.length === visible.length) {
    return visible.map((line, i) => ({ ...line, lineIndex: nonempty[i] }));
  }
  const starts = [0];
  for (const line of source) starts.push(starts[starts.length - 1] + line.length + 1);
  const parsed = visibleLines(seed);
  let minIndex = 0;
  return visible.flatMap((line, index) => {
    const parsedLine = parsed[index];
    const fromParser = parsedLine?.text === line.text ? sourceIndex(parsedLine, starts, source) : undefined;
    const lineIndex = fromParser !== undefined && fromParser >= minIndex
      ? fromParser : source.findIndex((raw, i) => i >= minIndex && raw.trim().includes(line.text));
    if (lineIndex < minIndex || lineIndex >= source.length) return [];
    minIndex = lineIndex + 1;
    return [{ ...line, lineIndex }];
  });
}
