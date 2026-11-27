import { sameTableSizes, type NoteTableSizes } from '../../data/noteTableSizes';
import { documentTableSizes, restoreTableSizes } from './noteTableLayout';
import { NoteTableTools } from './NoteTableTools';
import { memo, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markNoteSource, notePassage, resolveNoteRange, type SelectedPassage } from './noteSelectionRange';
import { type NoteSelection } from '../../data/knowledgeNotes';
import { writerLines } from './noteEditorLines';
import { todoLineText } from '../../data/noteTodos';
import { NoteProgressMarks } from './NoteProgressMarks';
import type { ProgressRow } from './noteProgressRows';
import { NoteLineActions, type NoteLineActionProps } from './NoteLineActions';
import { NoteInlineCards, safeNoteUrl } from './NoteInlineCards';
import type { OutputAttachment } from '../../data/types';
import { clipboardTables, insertClipboardTable } from './noteClipboard';
import { NotePictureTools } from './NotePictureTools';
import { NoteInsertMenu } from './NoteInsertMenu';
import { Icon } from '../ui/Icon';
import { expandListMarker, paintFormat, sampleFormat, type BrushFormat } from './writerFormatting';

type WriterOptions = NoteLineActionProps & {
  children: ReactNode; progressRows:ProgressRow[];
  uploadedIds: ReadonlyMap<string, string>;
  noteId: string; files: OutputAttachment[]; incoming: OutputAttachment[];
  focusOnMount: boolean; targetLine?: number; targetQuote?: string; targetSelection?: NoteSelection;
  text: string; indexedText: string; refreshIndex: () => void; disabled: boolean; imageUrls: ReadonlyMap<string, string>;
  draftFiles: (files: File[], range: Range | undefined) => void;
  tableSizes?: NoteTableSizes; onEdit: (text: string, sizes?: NoteTableSizes) => void; onSelection: (selection?: SelectedPassage) => void;
  editor: (value: WriterHandle) => void;
  onAttach: () => void; onChoosePicture: () => void; onTranscript: () => void;
};
export interface WriterHandle {
  focusQuote: (selection: NoteSelection) => void;
  insertFile: (file: File, url: string, id: string, range?: Range) => Range | undefined;
  replaceFile: (from: string, to: string) => boolean;
  insertText: (text: string) => void;
}

const inlineId = (src?: string) => src?.match(/^attachment:([0-9a-z-]{1,80})$/i)?.[1];
const allowLink = safeNoteUrl;
const escapePictureLabel = (value: string) => value.replace(/[\[\]\r\n]/g, ' ');
const escapeText = (value: string) => value.replace(/\u200b/g, '').replace(/\u00a0/g, ' ').replace(/[\\*`_~[\]]/g, '\\$&');

function markdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
  if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) return '';
  const content = () => Array.from(node.childNodes).map(markdown).join('');
  if (node instanceof DocumentFragment) return content();
  const label = escapePictureLabel(node.dataset.label ?? '');
  if (node.dataset.noteFile) return `[${label}](attachment:${node.dataset.noteFile})`;
  if (node.dataset.noteLink && allowLink(node.dataset.noteLink)) return `[${label}](<${node.dataset.noteLink}> "预览卡片")`;
  const remote = node.dataset.noteRemoteImage;
  if (remote && allowLink(remote)) return `![${escapePictureLabel(node.dataset.alt ?? '')}](<${remote}>)`;
  const tag = node.tagName;
  switch (tag) {
    case 'IMG': {
      const id = node.dataset.noteImage;
      return id ? `![${escapePictureLabel(node.getAttribute('alt') || '图片')}](attachment:${id})` : '';
    }
    case 'BR': return '\n';
    case 'P': case 'DIV': return '\n\n' + content().trimEnd() + '\n\n';
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return '\n\n' + '#'.repeat(Number(tag.slice(1))) + ' ' + content().trim() + '\n\n';
    case 'B': case 'STRONG': return '**' + content() + '**';
    case 'EM': case 'I': return '*' + content() + '*';
    case 'S': case 'STRIKE': case 'DEL': {
      // GFM delimiters must touch non-whitespace on each side.
      const value = content();
      return value.trim() ? value.replace(/^(\s*)([\s\S]*?\S)(\s*)$/, '$1~~$2~~$3') : value;
    }
    case 'BLOCKQUOTE': return '\n\n' + content().trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    case 'OL': case 'UL': return '\n\n' + Array.from(node.children).filter(item => item.tagName === 'LI').map((item, index) => {
      const bullet = tag === 'OL' ? (Number(node.getAttribute('start') ?? 1) + index) + '. ' : '- ';
      return bullet + markdown(item).trim().split('\n').join('\n' + ' '.repeat(bullet.length));
    }).join('\n') + '\n\n';
    case 'PRE': return '\n\n```\n' + (node.textContent ?? '').trimEnd() + '\n```\n\n';
    case 'CODE': return '`' + (node.textContent ?? '').replace(/`/g, '\\`') + '`';
    case 'A': {
      const href = allowLink(node.getAttribute('href') ?? '');
      return href ? '[' + content() + '](<' + href + '>)' : content();
    }
    case 'HR': return '\n\n---\n\n';
    case 'TABLE': {
      const rows = Array.from(node.querySelectorAll('tr')).map(row =>
        '| ' + Array.from(row.children).map(cell => markdown(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |');
      const divider = '| ' + Array.from(node.querySelector('tr')?.children ?? []).map(() => '---').join(' | ') + ' |';
      return '\n\n' + [rows[0], divider, ...rows.slice(1)].join('\n') + '\n\n';
    }
    case 'INPUT': return node instanceof HTMLInputElement && node.type === 'checkbox' ? (node.checked ? '[x] ' : '[ ] ') : '';
    default: return content();
  }
}
export const writerBody = (editor: HTMLElement) => markdown(editor).replace(/\n{3,}/g, '\n\n').trim();
export const plainNoteBody = (value: string) => value
  .replace(/\[([^\]]*)\]\(<(https?:\/\/[^>]+)> "预览卡片"\)/g, '$1（$2）')
  .replace(/(?<!!)\[([^\]]*)\]\(attachment:[^)]+\)/g, '[附件 $1]')
  .replace(/!\[([^\]]*)\]\(attachment:[^)]+\)/g, (_, title: string) => '[图片 ' + title + ']')
  .replace(/\[([^\]]*)\]\(<?(https?:\/\/[^>)]+)>?\)/g, (_, title: string, url: string) => title + '（' + url + '）')
  .replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~/g, (_, b, i, s) => b ?? i ?? s)
  .replace(/\\([\\*`_~[\]])/g, '$1');

// The editor already contains the live text. Parse its Markdown only when the source index changes.
const NoteSource = memo(function NoteSource({ text }: { text: string }) {
  return (<ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} rehypePlugins={[markNoteSource]} urlTransform={(url, key) => (key === 'src' || key === 'href') && inlineId(url) ? url : allowLink(url)}
        components={{ a: ({href,title,children,node}) => {
          const id = inlineId(href);
          if (id || (href && title === '预览卡片')) return <span contentEditable={false} data-note-line={(node?.position?.start.line ?? 1) - 1}
            data-note-file={id} data-note-link={id ? undefined : href}>{children}</span>;
          return <a href={href} title={title}>{children}</a>;
        }, img: ({ src, alt, node }) => {
          const source = typeof src === 'string' ? src : '';
          const id = inlineId(source);
          if (id) return <img data-note-line={(node?.position?.start.line ?? 1) - 1} data-note-image={id} alt={alt ?? '图片'} />;
          if (source) return <span data-note-line={(node?.position?.start.line ?? 1) - 1} contentEditable={false} className="qd-writer-remote-picture" data-note-remote-image={source} data-alt={alt}>外部图片 · {alt || '图片'}</span>;
          return <span>{alt}</span>;
        } }}>
        {text}
      </ReactMarkdown>);
});

export function NoteWriter({ tableSizes, children, progressRows, noteId, uploadedIds, files, incoming, focusOnMount, text, indexedText, refreshIndex, disabled, imageUrls, draftFiles, onEdit, onSelection, editor, onAttach, onChoosePicture, onTranscript, todos, targetTodo, targetLine, targetQuote, targetSelection, onAddTodo, onRemoveTodo, onCompleteTodo, onSendLine }: WriterOptions) {
  const content = useRef<HTMLDivElement>(null);
  const pinnedHeader = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = pinnedHeader.current;
    if (!header) return;
    // Keep caret and quote navigation clear of wrapped toolbar controls.
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--qd-note-header-height', header.offsetHeight + 'px');
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {observer.disconnect();root.style.removeProperty('--qd-note-header-height');};
  }, []);
  const initialFocus = useRef(focusOnMount);
  const seed = useRef<HTMLDivElement>(null);
  const lastSizes = useRef<NoteTableSizes | undefined>(undefined);
  const lastBody = useRef<string | undefined>(undefined);
  const lastRange = useRef<Range | undefined>(undefined);
  const [link, setLink] = useState<string>();
  const [formatState, setFormatState] = useState({ bold: false, italic: false, strikeThrough: false });
  const [linkError, setLinkError] = useState(false);
  const [clipboardMessage, setClipboardMessage] = useState('');
  useEffect(() => {
    if (!clipboardMessage) return;
    const timer = setTimeout(() => setClipboardMessage(''),3500);
    return () => clearTimeout(timer);
  }, [clipboardMessage]);
  const [brush, setBrush] = useState<BrushFormat>();
  const linkField = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (lastBody.current !== text && content.current && seed.current) {
      const hydrated = seed.current.cloneNode(true) as HTMLElement;
      hydrated.querySelectorAll('[data-source-start]').forEach(span => span.replaceWith(...span.childNodes));
      // Chromium can toggle <s> inside an editor, but treats <del> as an
      // immutable deletion. The persisted Markdown represents a text style.
      for (const deletion of hydrated.querySelectorAll('del')) {
        const strike = document.createElement('s');
        strike.append(...deletion.childNodes);
        deletion.replaceWith(strike);
      }
      hydrated.querySelectorAll<HTMLElement>('[data-note-file],[data-note-link]').forEach(card => {
        card.dataset.label = card.textContent ?? '';
      });
      // Markdown omits trailing empty paragraphs. Restore a typing line after a saved divider.
      if (hydrated.lastElementChild?.tagName === 'HR') {
        const paragraph = document.createElement('p');
        paragraph.append(document.createElement('br'));
        hydrated.append(paragraph);
      }
      restoreTableSizes(hydrated, tableSizes);
      content.current.replaceChildren(...hydrated.childNodes);
      lastSizes.current = tableSizes;
      lastBody.current = text;
    }
    if (content.current && !sameTableSizes(lastSizes.current, tableSizes)) {
      restoreTableSizes(content.current, tableSizes);
      lastSizes.current = tableSizes;
    }
    content.current?.querySelectorAll<HTMLImageElement>('img[data-note-image]').forEach(image => {
      const url = imageUrls.get(image.dataset.noteImage ?? '');
      if (url && image.getAttribute('src') !== url) image.src = url;
      if (!url) image.removeAttribute('src');
    });
  }, [text, imageUrls, tableSizes]);
  useLayoutEffect(() => {
    if (initialFocus.current) content.current?.focus({ preventScroll: true });
  }, []);

  // A search result points at the original words, even after another paragraph moves.
  // Scrolling and painting a range keeps the writing caret and autosave untouched.
  useEffect(() => {
    if ((targetLine === undefined && !targetSelection) || !content.current || !seed.current) return;
    const root = content.current;
    const body = lastBody.current ?? '';
    const lines = targetSelection ? [] : writerLines(root, seed.current, body);
    const quote = targetQuote && todoLineText(targetQuote);
    let found = lines.find(line => line.lineIndex === targetLine && (!quote || line.text === quote));
    if (!found && quote) {
      const matches = lines.filter(line => line.text === quote);
      if (matches.length === 1) found = matches[0];
    }
    const range = targetSelection ? resolveNoteRange(root,seed.current,body,targetSelection) : found?.range;
    if (!range) return;
    const clear = () => globalThis.CSS?.highlights?.delete('qd-recalled-passage');
    if (typeof Highlight === 'function') CSS.highlights.set('qd-recalled-passage', new Highlight(range));
    const frame = requestAnimationFrame(() => {
      const sticky = document.querySelector('.qd-note-sticky-header')?.getBoundingClientRect().height ?? 0;
      const rect = range.getBoundingClientRect();
      if (rect.top < sticky || rect.bottom > innerHeight) window.scrollBy(0, rect.top - (innerHeight + sticky) / 2);
    });
    root.addEventListener('pointerdown', clear, {once:true});
    root.addEventListener('keydown', clear, {once:true});
    return () => {
      cancelAnimationFrame(frame);
      clear();
      root.removeEventListener('pointerdown', clear);
      root.removeEventListener('keydown', clear);
    };
  }, [noteId, targetLine, targetQuote, targetSelection]);

  function capture(notify = true) {
    if (!content.current) return;
    // Native redo may restore the original insertion, including its temporary id.
    for (const inline of content.current.querySelectorAll<HTMLElement>('[data-note-file^="pending-"],[data-note-image^="pending-"]')) {
      const key = inline.dataset.noteFile ? 'noteFile' : 'noteImage';
      const id = uploadedIds.get(inline.dataset[key]!);
      if (id) inline.dataset[key] = id;
    }
    const body = writerBody(content.current);
    const sizes = documentTableSizes(content.current);
    if (body === lastBody.current && sameTableSizes(lastSizes.current,sizes)) return;
    lastBody.current = body;
    lastSizes.current = sizes;
    if (notify) onEdit(body, sizes);
  }

  function setRange(range?: Range) {
    const node = content.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    if (!range || !node.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
    }
    const container = range.startContainer;
    const card = (container instanceof Element ? container : container.parentElement)?.closest('[data-note-file],[data-note-link]');
    if (card) {
      range = document.createRange();
      range.setStartAfter(card);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function focusQuote(selection: NoteSelection) {
    if (!content.current || !seed.current) return;
    refreshIndex();
    const range = resolveNoteRange(content.current, seed.current, text, selection);
    if (!range) return;
    setRange(range);
    range.startContainer.parentElement?.scrollIntoView({block:'nearest'});
  }

  useLayoutEffect(() => {
    editor({
      focusQuote,
      insertFile(file, url, id, range) {
        setRange(range ?? lastRange.current);
        let element: HTMLElement;
        if (url) {
          const picture = document.createElement('img');
          picture.dataset.noteImage = id; picture.alt = escapePictureLabel(file.name); picture.src = url;
          element = picture;
        } else {
          element = cardElement('noteFile', id, file.name);
        }
        document.execCommand('insertHTML', false, element.outerHTML + '<br>');
        capture();
        return getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).cloneRange() : undefined;
      },
      replaceFile(from, to) {
        const key = CSS.escape(from);
        const object = content.current?.querySelector<HTMLElement>(`[data-note-image="${key}"],[data-note-file="${key}"]`);
        if (!object) return false;
        if (to) object.dataset[object.dataset.noteFile ? 'noteFile' : 'noteImage'] = to;
        else object.remove();
        capture(false);
        return true;
      },
      insertText(value) { setRange(lastRange.current); document.execCommand('insertText', false, value); capture(); },
    });
  });

  useEffect(() => {
    const inspect = () => {
      const selection = window.getSelection(), node = content.current;
      if (document.activeElement?.closest('[data-note-prompt]')) return;
      if (!selection?.rangeCount || !node || node.dataset.formatBrush === 'true') { onSelection(undefined); return; }
      const range = selection.getRangeAt(0);
      if (!node.contains(range.commonAncestorContainer)) { onSelection(undefined); return; }
      lastRange.current = range.cloneRange();
      const next = { bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), strikeThrough: document.queryCommandState('strikeThrough') };
      setFormatState(old => old.bold === next.bold && old.italic === next.italic && old.strikeThrough === next.strikeThrough ? old : next);
      if (range.collapsed || !seed.current) { onSelection(undefined); return; }
      refreshIndex();
      onSelection(notePassage(node, seed.current, text, range));
    };
    document.addEventListener('selectionchange', inspect);
    return () => document.removeEventListener('selectionchange', inspect);
  }, [text, onSelection, refreshIndex]);

  function format(command: string, value?: string) {
    if (disabled) return;
    const node = content.current;
    const selection = window.getSelection();
    // Recreating an identical collapsed selection discards pending typing styles.
    if (!node || document.activeElement !== node || !selection?.anchorNode || !node.contains(selection.anchorNode)) setRange(lastRange.current);
    document.execCommand(command, false, value);
    capture();
    setFormatState({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), strikeThrough: document.queryCommandState('strikeThrough') });
  }

  useEffect(() => {
    const node = content.current;
    if (!node || disabled) return;
    function handleMarker(event: InputEvent) {
      if (node && expandListMarker(node, event)) capture();
    }
    node.addEventListener('beforeinput', handleMarker);
    return () => node.removeEventListener('beforeinput', handleMarker);
  }, [disabled, onEdit]);

  function insertTable(rows: number, columns: number) {
    setRange(lastRange.current);
    const table = document.createElement('table');
    table.dataset.inserted = 'true';
    const header = table.createTHead().insertRow();
    const tbody = table.createTBody();
    for (let r = 0; r < rows; r++) {
      const row = r === 0 ? header : tbody.insertRow();
      for (let c = 0; c < columns; c++) {
        const cell = row.appendChild(document.createElement(r === 0 ? 'th' : 'td'));
        cell.appendChild(document.createElement('br'));
      }
    }
    document.execCommand('insertHTML', false, table.outerHTML + '<p><br></p>');
    const inserted = content.current?.querySelector<HTMLTableElement>('table[data-inserted]');
    if (inserted) {
      delete inserted.dataset.inserted;
      const caret = document.createRange();
      caret.setStart(inserted.rows[0].cells[0], 0);
      caret.collapse(true);
      setRange(caret);
    }
    capture();
  }

  function toggleBrush() {
    if (brush || disabled) { setBrush(undefined); return; }
    const node = content.current;
    if (!node) return;
    setRange(lastRange.current);
    setBrush(sampleFormat(node));
  }

  function finishBrush() {
    if (brush && !disabled && content.current && paintFormat(content.current, brush)) {
      setBrush(undefined);
      capture();
    }
  }

  function cardElement(key: 'noteLink' | 'noteFile', value: string, label: string) {
    const element = document.createElement('span');
    element.contentEditable = 'false';
    element.dataset[key] = value;
    element.dataset.label = escapePictureLabel(label);
    element.textContent = element.dataset.label;
    return element;
  }
  function insertLinkCard(url: string, range = lastRange.current) {
    setRange(range);
    const label = window.getSelection()?.toString().trim() || url;
    const element = cardElement('noteLink', url, label);
    document.execCommand('insertHTML', false, element.outerHTML + ' ');
    capture();
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    try {
      const table = clipboardTables(event.clipboardData);
      if (table) {
        const range = window.getSelection();
        if (!range?.rangeCount || !content.current?.contains(range.anchorNode)) setRange(lastRange.current);
        if (content.current) insertClipboardTable(content.current, table);
        capture(); return;
      }
    } catch (error) { setClipboardMessage(error instanceof Error ? error.message : '无法粘贴表格'); return; }
    const files = Array.from(event.clipboardData.files);
    if (files.length) { draftFiles(files, lastRange.current); return; }
    const plain = event.clipboardData.getData('text/plain');
    const uri = allowLink(plain.trim());
    if (uri && !/\s/u.test(plain.trim())) insertLinkCard(uri, getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).cloneRange() : undefined);
    else if (plain) { document.execCommand('insertText', false, plain); capture(); }
  }

  return <>
    <div className="qd-note-sticky-header" ref={pinnedHeader}>
      {children}
      <div className="qd-writer-bar" role="toolbar" aria-label="笔记格式">
        <div className="qd-writer-tools">
          <button type="button" aria-label="撤销" title="撤销" onMouseDown={event => event.preventDefault()} onClick={() => format('undo')}><Icon name="undo" size={17} /></button>
          <button type="button" aria-label="重做" title="重做" onMouseDown={event => event.preventDefault()} onClick={() => format('redo')}><Icon name="undo" size={17} className="qd-writer-redo" /></button>
          <button type="button" aria-label="格式刷" title="格式刷 · 复制文字格式" aria-pressed={!!brush} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={toggleBrush}><Icon name="paintbrush" size={17} /></button>
        </div>
        <div className="qd-writer-tools">
          <select aria-label="段落样式" defaultValue="p" onChange={event => format('formatBlock', event.target.value)}>
            <option value="p">正文</option><option value="h2">标题 1</option><option value="h3">标题 2</option><option value="blockquote">引用</option>
          </select>
          {([['bold', '加粗', 'B'], ['italic', '斜体', 'I'], ['strikeThrough', '删除线', 'S']] as const).map(([command, label, glyph]) =>
            <button key={command} type="button" aria-pressed={formatState[command]} className={'qd-writer-' + command} aria-label={label} title={label} onMouseDown={event => event.preventDefault()} onClick={() => format(command)}>{glyph}</button>)}
        </div>
        <div className="qd-writer-tools">
          <button type="button" aria-label="项目符号" title="项目符号" onMouseDown={event => event.preventDefault()} onClick={() => format('insertUnorderedList')}><Icon name="list-bullets" size={19}/></button>
          <button type="button" aria-label="编号列表" title="编号列表" onMouseDown={event => event.preventDefault()} onClick={() => format('insertOrderedList')}><Icon name="list-numbers" size={19}/></button>
        </div>
        <NoteInsertMenu disabled={disabled} onPicture={onChoosePicture} onAttach={onAttach} onTranscript={onTranscript}
          onLink={() => { setLink(''); setLinkError(false); requestAnimationFrame(() => linkField.current?.focus()); }}
          onTable={insertTable} onRule={() => format('insertHTML', '<hr><p><br></p>')}/>
        <NoteTableTools root={content} disabled={disabled} save={capture}/>
      </div>
      {link !== undefined && <form className="qd-writer-link" onSubmit={event => {
        event.preventDefault();
        const url = allowLink(link.trim());
        if (!url) { setLinkError(true); return; }
        insertLinkCard(url);
        setLink(undefined);
      }}><input ref={linkField} aria-label="链接地址" value={link} placeholder="https://" onChange={event => setLink(event.target.value)} />
        <button className="qd-btn primary" type="submit">插入</button><button className="qd-btn ghost" type="button" onClick={() => setLink(undefined)}>取消</button>
        {linkError && <small role="alert">请输入完整的网址</small>}
      </form>}
      {clipboardMessage && <p role="status" className="qd-writer-brush-hint">{clipboardMessage}</p>}
      {brush && <p className="qd-writer-brush-hint" role="status">选中要套用格式的文字，按 Esc 取消。</p>}
    </div>
    <div ref={seed} data-note-source hidden aria-hidden="true">
      <NoteSource text={indexedText} />
    </div>
    <div className="qd-writer-sheet">
    <div ref={content} className="qd-writer-content" role="textbox" aria-label="笔记正文" aria-multiline="true"
      aria-readonly={disabled} tabIndex={0} contentEditable={!disabled} suppressContentEditableWarning
      data-format-brush={!!brush} onMouseUp={finishBrush}
      onKeyUp={event => {
        if (event.key === 'Escape') setBrush(undefined);
        else if (event.key === 'Shift' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a')) finishBrush();
      }}
      data-placeholder="开始记录，或直接粘贴截图。"
      onBeforeInput={event => {
        if (event.nativeEvent instanceof InputEvent && event.nativeEvent.inputType.startsWith('insert') &&
            (lastBody.current?.length ?? 0) + (event.nativeEvent.data?.length ?? 1) > 50_000) event.preventDefault();
      }}
      onInput={() => capture()} onPaste={paste}
      onDragOver={event => { if (!disabled && event.dataTransfer.types.some(type => type === 'Files' || type === 'text/uri-list' || type === 'text/plain')) event.preventDefault(); }}
      onDrop={event => {
        const dropped = Array.from(event.dataTransfer.files);
        const location = event.dataTransfer.getData('text/uri-list').split(/\r?\n/).find(line => line && !line.startsWith('#'))
          || event.dataTransfer.getData('text/plain').trim();
        const url = /\s/u.test(location) ? '' : allowLink(location);
        if (!dropped.length && !url) return;
        event.preventDefault();
        if (disabled) return;
        const point = document.caretRangeFromPoint(event.clientX,event.clientY);
        const range = point && content.current?.contains(point.commonAncestorContainer) ? point : lastRange.current;
        if (dropped.length) draftFiles(dropped,range);
        else insertLinkCard(url,range);
      }} />
    <NotePictureTools root={content}/>
    {!!progressRows.length && <NoteProgressMarks content={content} seed={seed} body={text} rows={progressRows}/>}
    <NoteInlineCards content={content} noteId={noteId} files={files} incoming={incoming}/>
    <NoteLineActions content={content} seed={seed} body={text} disabled={disabled} todos={todos} targetTodo={targetTodo}
      onAddTodo={onAddTodo} onRemoveTodo={onRemoveTodo} onCompleteTodo={onCompleteTodo} onSendLine={onSendLine} />
    </div>
  </>;
}
