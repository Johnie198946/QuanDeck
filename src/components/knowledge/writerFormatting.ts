const paragraphTags = 'p,div,h1,h2,h3,h4,h5,h6,blockquote';
const inlineCommands = ['bold', 'italic', 'strikeThrough'] as const;
type InlineCommand = typeof inlineCommands[number];
export interface BrushFormat {
  inline: Record<InlineCommand, boolean>;
  paragraph: string;
}

function elementAt(node: Node) {
  return node instanceof Element ? node : node.parentElement;
}

function editorRange(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) return range;
}

function paragraphAt(editor: HTMLElement, node: Node) {
  const found = elementAt(node)?.closest(paragraphTags);
  return found && found !== editor && editor.contains(found) ? found : undefined;
}

export function sampleFormat(editor: HTMLElement): BrushFormat | undefined {
  const range = editorRange(editor);
  if (!range) return;
  const paragraph = paragraphAt(editor, range.startContainer)?.localName || 'p';
  return {
    inline: { bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), strikeThrough: document.queryCommandState('strikeThrough') },
    paragraph: paragraph === 'div' ? 'p' : paragraph,
  };
}

export function paintFormat(editor: HTMLElement, format: BrushFormat) {
  const range = editorRange(editor);
  if (!range || range.collapsed || !range.toString().trim()) return false;
  const block = paragraphAt(editor, range.startContainer);
  // Paragraph styles belong to a whole paragraph. A partial selection only
  // receives character styles, leaving its neighbours and list structure intact.
  const scope = block || editor;
  if (scope.contains(range.endContainer) && !(elementAt(range.startContainer)?.closest('li,td,th')) &&
      range.toString() === scope.textContent && (block?.localName || 'p') !== format.paragraph) {
    document.execCommand('formatBlock', false, format.paragraph);
  }
  for (const command of inlineCommands) {
    if (document.queryCommandIndeterm(command) || document.queryCommandState(command) !== format.inline[command]) {
      document.execCommand(command);
      // Chromium normalizes a mixed selection on the first toggle.
      if (document.queryCommandState(command) !== format.inline[command]) document.execCommand(command);
    }
  }
  window.getSelection()?.collapseToEnd();
  return true;
}

const numbered = /^(\d{1,9})([.)、．）])$/;
const bullet = /^[-+*•]$/;
const previousNumber = /^(\d{1,9})(?:[.)][ \u00a0]+|[、．）])/;

function linePrefix(editor: HTMLElement, caret: Range) {
  const element = elementAt(caret.startContainer);
  const item = element?.closest('li');
  const block = element?.closest('li,' + paragraphTags) || editor;
  const prefix = caret.cloneRange();
  prefix.setStart(block, 0);
  // Enter creates block siblings; Shift+Enter creates BR inside a block.
  // Never select content across an earlier paragraph, image, or hard break.
  const boundaries = block.querySelectorAll('br,img,[contenteditable="false"],p,div,ol,ul');
  for (let i = boundaries.length - 1; i >= 0; i--) {
    const boundary = boundaries[i];
    if (boundary.contains(caret.startContainer)) continue;
    const after = document.createRange();
    after.setStartAfter(boundary);
    if (after.compareBoundaryPoints(Range.START_TO_START, caret) <= 0) {
      prefix.setStartAfter(boundary);
      break;
    }
  }
  return { prefix, item, block };
}

function orderedContext(block: Element, item: Element | null | undefined) {
  const list = item?.parentElement;
  if (item && list instanceof HTMLOListElement) return list.start + Array.from(list.children).indexOf(item);
  const previous = block.previousElementSibling;
  if (previous instanceof HTMLOListElement) return previous.start + previous.children.length;
  const match = previousNumber.exec(previous?.textContent || '');
  return match ? Number(match[1]) + 1 : undefined;
}

// Pasted notes can contain literal list prefixes. Keep their punctuation and
// spacing when continuing the line, including Chinese-style “3、安排”.
function continueTextList(prefix: Range, event: InputEvent) {
  const match = /^(?:(\d{1,9})([.)、．）])|([-+*•]))([ \u00a0]*)(.*)$/s.exec(prefix.toString());
  if (!match) return false;
  const [, digits, punctuation, bulletMark, spaces, body] = match;
  if (!spaces && !/[、．）]/.test(punctuation || '')) return false;
  event.preventDefault();
  if (!body.trim()) {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(prefix);
    document.execCommand('delete');
    return true;
  }
  const next = digits ? String(Number(digits) + 1).padStart(digits.length, '0') + punctuation : bulletMark;
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, next + spaces);
  return true;
}

/** Turn a typed marker into a native list. Enter, empty-item exit, and undo
 * then use the editor's normal editing commands. Never intercept IME commits. */
export function expandListMarker(editor: HTMLElement, event: InputEvent) {
  if (event.defaultPrevented || !event.cancelable || event.isComposing) return false;
  const enter = event.inputType === 'insertParagraph';
  if (!enter && !(event.inputType === 'insertText' && (event.data === ' ' || event.data === '　'))) return false;
  const caret = editorRange(editor);
  if (!caret?.collapsed || elementAt(caret.startContainer)?.closest('pre,code,table,[contenteditable="false"]')) return false;
  if (!enter && caret.startContainer instanceof Text && caret.startOffset > 0 &&
      !/[\d.)、．）+*•-]/.test(caret.startContainer.data[caret.startOffset - 1])) return false;
  const { prefix, item, block } = linePrefix(editor, caret);
  if (enter) return !item && continueTextList(prefix, event);
  const marker = prefix.toString();
  const explicit = numbered.exec(marker);
  const plain = /^\d{1,9}$/.test(marker);
  const expected = orderedContext(block, item);
  const number = explicit ? Number(explicit[1]) : plain && Number(marker) === expected ? expected : undefined;
  if (number === undefined && !bullet.test(marker)) return false;
  // Inside a list the marker is already painted by the browser. Suppress a
  // repeated prefix only when it actually matches this item.
  if (item && (number !== undefined ? expected !== number : item.parentElement?.localName !== 'ul')) return false;
  event.preventDefault();
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(prefix);
  document.execCommand('delete');
  if (!item) {
    document.execCommand(number === undefined ? 'insertUnorderedList' : 'insertOrderedList');
    const list = selection.anchorNode && elementAt(selection.anchorNode)?.closest('ol');
    if (number !== undefined && list && list.children.length === 1) list.start = number;
  }
  return true;
}
