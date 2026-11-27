import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { NoteTodo } from '../../data/noteTodos';
import { Icon } from '../ui/Icon';
import './note-row-actions.css';
import { writerLines, type WriterLine } from './noteEditorLines';

export interface NoteLineActionProps {
  todos: NoteTodo[];
  targetTodo?: string;
  onAddTodo: (index: number) => void;
  onRemoveTodo: (id: string) => void;
  onCompleteTodo: (id: string, completed: boolean) => void;
  onSendLine: (index: number, text: string) => void;
}

interface LinePosition {
  index: number; text: string;
  x: number; y: number; space: number; fontSize: string; fontFamily: string; startX: number; startY: number;
  active: boolean; todo?: NoteTodo;
}

// The two-character indent contains no text or buttons. Sharing, selecting and
// saving the note keep its original Markdown and the editor's native undo stack.
function indentLines(editor: HTMLElement, lines: WriterLine[], todos: Map<number, NoteTodo>) {
  const keep = new Set<Element>();
  let changed = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i], todo = todos.get(line.lineIndex);
    if (!todo) continue;
    const { startContainer: node, startOffset: at } = line.range;
    const previous = node instanceof Text
      ? (at === 0 ? node.previousSibling : null)
      : node.childNodes[at - 1];
    if (previous instanceof HTMLElement && previous.dataset.todoIndent === todo.id) {
      keep.add(previous);
      continue;
    }
    const marker = document.createElement('span');
    marker.dataset.todoIndent = todo.id;
    marker.setAttribute('aria-hidden', 'true');
    marker.contentEditable = 'false';
    if (node instanceof Text && !at) node.before(marker);
    else {
      const start = line.range.cloneRange();
      start.collapse(true);
      start.insertNode(marker);
    }
    keep.add(marker);
    changed = true;
  }
  for (const marker of editor.querySelectorAll('[data-todo-indent]')) {
    if (!keep.has(marker)) { marker.remove(); changed = true; }
  }
  return changed;
}

// Long enough to distinguish a pause from moving across the page or between keystrokes.
const ACTION_DELAY_MS = 800;
const two = (value: number) => String(value).padStart(2, '0');

type Options = NoteLineActionProps & {
  content: RefObject<HTMLElement | null>; seed: RefObject<HTMLElement | null>;
  body: string; disabled: boolean;
};

export function NoteLineActions({ content, seed, body, disabled, todos, targetTodo, onAddTodo, onRemoveTodo, onCompleteTodo, onSendLine }: Options) {
  const menuPrefix = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const pointerY = useRef<number | undefined>(undefined);
  const ime = useRef(false);
  const navigated = useRef<string | undefined>(undefined);
  const [positions, setPositions] = useState<LinePosition[]>([]);

  useLayoutEffect(() => {
    const editor = content.current, source = seed.current, layer = overlay.current;
    const sheet = editor?.parentElement;
    if (!editor || !source || !layer || !sheet) return;
    const byLine = new Map(todos.map(todo => [todo.lineIndex, todo]));
    let lines: WriterLine[] = [];
    let active: number | undefined;
    let frame = 0;
    let idleTimer: number | undefined;
    let settled = false;
    let crossing: number | undefined;
    let toolsRight = 0;

    function display() {
      const bounds = layer!.getBoundingClientRect();
      // Range rectangles are viewport pixels. Absolute offsets are local CSS
      // pixels, which can differ when a window or its content is zoomed.
      const scale = bounds.width / parseFloat(getComputedStyle(layer!).width) || 1;
      const next: LinePosition[] = [];
      for (const { range, text, lineIndex } of lines) {
        const todo = byLine.get(lineIndex);
        if (!todo && active !== lineIndex) continue;
        const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
        const first = rects[0], last = rects.at(-1);
        if (!first || !last) continue;
        const endpoint = range.endContainer;
        const font = getComputedStyle(endpoint instanceof Element ? endpoint : endpoint.parentElement ?? editor!);
        next.push({ index: lineIndex, text, active: active === lineIndex, todo,
          fontSize: font.fontSize, fontFamily: font.fontFamily,
          startX: (first.left - bounds.left) / scale, startY: ((first.top + first.bottom) / 2 - bounds.top) / scale,
          space: (bounds.right - last.right) / scale, x: (last.right - bounds.left) / scale,
          y: ((last.top + last.bottom) / 2 - bounds.top) / scale });
      }
      setPositions(next);
    }

    function caretLine() {
      if (document.activeElement !== editor) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed) return;
      const caret = selection.getRangeAt(0);
      if (!editor!.contains(caret.startContainer)) return;

      const line = lines.find(({ range }) => range.isPointInRange(caret.startContainer, caret.startOffset));
      if (line) {
        const rest = line.range.cloneRange();
        rest.setStart(caret.startContainer, caret.startOffset);
        if (rest.toString() === '' && !rest.cloneContents().querySelector('img')) return line.lineIndex;
        return;
      }
      // Some browsers place the caret just outside the last inline element.
      const box = caret.getBoundingClientRect();
      if (!box.height) return;
      const row = atHeight((box.top + box.bottom) / 2);
      const last = lines.find(item => item.lineIndex === row)?.range.getClientRects();
      if (last?.length && Math.abs(box.left - last[last.length - 1].right) < 2) return row;
    }

    function pickLine() {
      if (!settled || ime.current) return;
      if (pointerY.current === undefined && layer!.contains(document.activeElement)) return active;
      if (document.activeElement === editor && window.getSelection()?.isCollapsed === false) return;
      return pointerY.current === undefined ? caretLine() : atHeight(pointerY.current);
    }

    function measure() {
      cancelAnimationFrame(frame);
      if (!settled && !byLine.size) {
        // Nothing needs positioning while the user types. Drop any old todo indentation.
        if (editor!.querySelector('[data-todo-indent]')) indentLines(editor!, [], byLine);
        lines = [];
        setPositions(old => old.length ? [] : old);
        return;
      }
      lines = writerLines(editor!, source!, body);
      if (!ime.current && indentLines(editor!, lines, byLine)) lines = writerLines(editor!, source!, body);
      active = pickLine();
      display();
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    function atHeight(y: number) {
      // Logical lines are in reading order. Only measure the few rows near
      // the pointer, including when a single paragraph wraps over many lines.
      let low = 0, high = lines.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const rect = lines[mid].range.getBoundingClientRect();
        if (y < rect.top - 4) high = mid;
        else if (y > rect.bottom + 4) low = mid + 1;
        else return lines[mid].lineIndex;
      }
    }
    function hide(retain?: number) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
      settled = false;
      if (active !== undefined || retain !== crossing) {
        crossing = retain;
        active = undefined;
        display();
      }
    }

    function waitForPause(retain?: number) {
      hide(retain);
      if (ime.current) return;
      idleTimer = window.setTimeout(() => {
        settled = true;
        crossing = undefined;
        measure();
      }, ACTION_DELAY_MS);
    }

    function hover(event: PointerEvent) {
      if (!(event.target instanceof Node) || !sheet!.contains(event.target)) {
        pointerY.current = undefined;
        if (settled || crossing !== undefined || idleTimer !== undefined) hide();
        return;
      }
      // Once reached, the controls must stay in place while the user clicks or tabs.
      if (event.target instanceof Element && event.target.closest('.qd-note-line-tools, .qd-todo-options')) return;
      pointerY.current = event.clientY;
      if (event.buttons) hide();
      else {
        if (active !== undefined) {
          const group = layer!.querySelector(`[data-note-row="${active}"] .qd-note-line-tools`);
          if (group) toolsRight = group.getBoundingClientRect().right;
        }
        const previous = active ?? crossing;
        const row = previous !== undefined && atHeight(event.clientY) === previous
          ? lines.find(line => line.lineIndex === previous) : undefined;
        const end = row?.range.getClientRects();
        const last = end?.[end.length - 1];
        if (last && event.clientX >= last.right && event.clientX <= toolsRight && Math.abs(event.clientY - (last.bottom + last.top) / 2) <= Math.max(12, last.height / 2)) {
          // Keep the buttons visible while the pointer crosses the blank gap.
          if (active === previous && settled) return;
          clearTimeout(idleTimer);
          settled = true;
          active = previous;
          crossing = undefined;
          display();
        } else waitForPause(row?.lineIndex);
      }
    }
    const leave = () => {
      pointerY.current = undefined;
      hide();
    };
    const typing = () => { pointerY.current = undefined; waitForPause(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && !['Alt','Control','Meta','Shift'].includes(event.key)) typing();
    };
    const selection = () => {
      if (document.activeElement !== editor) return;
      if (!window.getSelection()?.isCollapsed) hide();
      else if (pointerY.current === undefined) waitForPause();
    };
    const focusOut = (event: FocusEvent) => {
      if (!layer!.contains(event.relatedTarget as Node)) hide();
    };
    const beginIme = () => { ime.current = true; typing(); };
    const endIme = () => { ime.current = false; typing(); schedule(); };
    // A freshly opened note is hydrated by the parent writer's layout effect.
    measure();
    waitForPause();
    const mutation = new MutationObserver(schedule);
    mutation.observe(editor, { childList: true, characterData: true, subtree: true, attributeFilter: ['style', 'data-has-answer'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(editor);
    document.addEventListener('pointermove', hover);
    sheet.addEventListener('focusout', focusOut);
    sheet.addEventListener('pointerleave', leave);
    sheet.addEventListener('load', schedule, true);
    editor.addEventListener('beforeinput', typing);
    editor.addEventListener('input', typing);
    editor.addEventListener('keydown', keydown);
    editor.addEventListener('compositionstart', beginIme);
    editor.addEventListener('compositionend', endIme);
    document.addEventListener('selectionchange', selection);
    return () => {
      clearTimeout(idleTimer);
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      document.removeEventListener('pointermove', hover);
      sheet.removeEventListener('focusout', focusOut);
      sheet.removeEventListener('pointerleave', leave);
      sheet.removeEventListener('load', schedule, true);
      editor.removeEventListener('beforeinput', typing);
      editor.removeEventListener('input', typing);
      editor.removeEventListener('keydown', keydown);
      editor.removeEventListener('compositionstart', beginIme);
      editor.removeEventListener('compositionend', endIme);
      document.removeEventListener('selectionchange', selection);
    };
  }, [content, seed, body, todos]);

  useLayoutEffect(() => {
    if (!targetTodo || navigated.current === targetTodo) return;
    const target = overlay.current?.querySelector<HTMLButtonElement>(`button[data-todo-id="${CSS.escape(targetTodo)}"]`);
    if (!target) return;
    navigated.current = targetTodo;
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.focus({ preventScroll: true });
  }, [targetTodo, positions]);

  return <div ref={overlay} className="qd-note-line-layer" aria-label="笔记行操作">
    {positions.map(({ index, text, x, y, space, fontSize, fontFamily, startX, startY, active, todo }) => {
      const date = todo && new Date(todo.dueAt);
      const dateText = date && two(date.getMonth() + 1) + '-' + two(date.getDate());
      const timeText = date && two(date.getHours()) + ':' + two(date.getMinutes());
      const menuId = menuPrefix + '-' + index;
      const anchor = '--qd-todo-' + CSS.escape(menuId);
      const sendButton = <button type="button" disabled={disabled} aria-label="发送此行到帮你管" title="发送到帮你管"
        onMouseDown={event => event.preventDefault()} onClick={event => {
          event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
          onSendLine(index, text);
        }}><Icon name="plane" size={14}/></button>;
      return <div key={index} className="qd-note-line-row" data-note-row={index}>
        {todo && <button className="qd-note-line-check" type="button" role="checkbox" aria-checked={!!todo.completedAt}
          aria-label={(todo.completedAt ? '重新打开待办' : '完成待办') + ' · ' + text} data-todo-id={todo.id}
          style={{ left: startX, top: startY }} disabled={disabled}
          onMouseDown={event => event.preventDefault()} onClick={() => onCompleteTodo(todo.id, !todo.completedAt)}>
          {todo.completedAt && <Icon name="check" size={12}/>}
        </button>}
        <div className="qd-note-line-tools" style={{ left: `calc(${x}px + 2ic)`, top: y, maxWidth: `calc(${space}px - 2ic)`, fontSize, fontFamily }}>
          {todo && <button type="button" className="qd-note-time" style={{ anchorName: anchor }} popoverTarget={menuId} data-completed={!!todo.completedAt} disabled={disabled}
            aria-label={'截止 ' + dateText + ' ' + timeText + '，查看待办操作'} title="查看待办操作">
            <span className="qd-note-time-date" aria-hidden="true"><span>{dateText}</span></span><time dateTime={todo.dueAt}>{timeText}</time>
          </button>}
          {todo && <div popover="auto" style={{ positionAnchor: anchor }} className="qd-todo-options" id={menuId} role="group" aria-label="待办操作">
            <button type="button" className="qd-note-line-remove" disabled={disabled}
              title="还原为普通文字，并从首页日程移除" onClick={() => onRemoveTodo(todo.id)}>取消待办</button>
            {sendButton}
          </div>}
          {active && <div className="qd-note-transient-tools">
            {!todo && <button type="button" className="qd-note-line-add" disabled={disabled} aria-label="将此行设为待办" title="加入日程"
              onMouseDown={event => event.preventDefault()} onClick={() => onAddTodo(index)}><Icon name="check-square" size={12}/>to do</button>}
            {sendButton}
          </div>}
        </div>
      </div>;
    })}
  </div>;
}
