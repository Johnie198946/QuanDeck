import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { makeSelection, type NoteSelection } from '../../data/knowledgeNotes';
import { Icon } from '../ui/Icon';

type WriterOptions = {
  text: string; disabled: boolean; imageUrls: ReadonlyMap<string, string>;
  draftFiles: (files: File[], range: Range | undefined) => void;
  onEdit: (text: string) => void; onSelection: (selection?: NoteSelection) => void;
  editor: (value: WriterHandle) => void;
  onAttach: () => void; onChoosePicture: () => void; onTranscript: () => void;
};
export interface WriterHandle {
  focusQuote: (quote: string) => void;
  insertPicture: (file: File, url: string, id: string, range?: Range) => void;
  replacePicture: (from: string, to: string) => boolean;
  insertText: (text: string) => void;
}

const inlineId = (src?: string) => src?.match(/^attachment:([0-9a-z-]{1,80})$/i)?.[1];
const allowLink = (value: string) => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
};
const escapePictureLabel = (value: string) => value.replace(/[\[\]\r\n]/g, ' ');
const escapeText = (value: string) => value.replace(/\u200b/g, '').replace(/\u00a0/g, ' ').replace(/[\\*`_~[\]]/g, '\\$&');

function markdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
  if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) return '';
  const content = () => Array.from(node.childNodes).map(markdown).join('');
  if (node instanceof DocumentFragment) return content();
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
    case 'S': case 'STRIKE': case 'DEL': return '~~' + content() + '~~';
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
  .replace(/!\[([^\]]*)\]\(attachment:[^)]+\)/g, (_, title: string) => '[图片 ' + title + ']')
  .replace(/\[([^\]]*)\]\(<?(https?:\/\/[^>)]+)>?\)/g, (_, title: string, url: string) => title + '（' + url + '）')
  .replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~/g, (_, b, i, s) => b ?? i ?? s)
  .replace(/\\([\\*`_~[\]])/g, '$1');

export function NoteWriter({ text, disabled, imageUrls, draftFiles, onEdit, onSelection, editor, onAttach, onChoosePicture, onTranscript }: WriterOptions) {
  const content = useRef<HTMLDivElement>(null);
  const seed = useRef<HTMLDivElement>(null);
  const lastBody = useRef<string | undefined>(undefined);
  const lastRange = useRef<Range | undefined>(undefined);
  const [link, setLink] = useState<string>();
  const [formatState, setFormatState] = useState({ bold: false, italic: false, strikeThrough: false });
  const [linkError, setLinkError] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (lastBody.current !== text && content.current && seed.current) {
      content.current.replaceChildren(...Array.from(seed.current.childNodes, child => child.cloneNode(true)));
      lastBody.current = text;
    }
    content.current?.querySelectorAll<HTMLImageElement>('img[data-note-image]').forEach(image => {
      const url = imageUrls.get(image.dataset.noteImage ?? '');
      if (url && image.getAttribute('src') !== url) image.src = url;
      if (!url) image.removeAttribute('src');
    });
  }, [text, imageUrls]);

  function capture(notify = true) {
    if (!content.current) return;
    const body = writerBody(content.current);
    if (body === lastBody.current) return;
    lastBody.current = body;
    if (notify) onEdit(body);
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
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function focusQuote(quote: string) {
    const node = content.current;
    if (!node) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const pieces: Text[] = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) pieces.push(text as Text);
    let offset = 0;
    const lengthBefore = pieces.map(piece => { const start = offset; offset += piece.length; return start; });
    const start = pieces.map(piece => piece.data).join('').indexOf(quote);
    if (start === -1) return;
    const end = start + quote.length;
    const from = pieces.findIndex((piece, index) => lengthBefore[index] + piece.length > start);
    const to = pieces.findIndex((piece, index) => lengthBefore[index] + piece.length >= end);
    if (from === -1 || to === -1) return;
    const range = document.createRange();
    range.setStart(pieces[from], start - lengthBefore[from]);
    range.setEnd(pieces[to], end - lengthBefore[to]);
    setRange(range);
    pieces[from].parentElement?.scrollIntoView({ block: 'nearest' });
  }

  useLayoutEffect(() => {
    editor({
      focusQuote,
      insertPicture(file, url, id, range) {
        setRange(range ?? lastRange.current);
        const picture = document.createElement('img');
        picture.dataset.noteImage = id;
        picture.alt = escapePictureLabel(file.name);
        picture.src = url;
        document.execCommand('insertHTML', false, picture.outerHTML + '<br>');
        capture();
      },
      replacePicture(from, to) {
        const image = content.current?.querySelector<HTMLImageElement>(`img[data-note-image="${CSS.escape(from)}"]`);
        if (!image) return false;
        if (to) image.dataset.noteImage = to;
        else image.remove();
        capture(false);
        return true;
      },
      insertText(value) { setRange(lastRange.current); document.execCommand('insertText', false, value); capture(); },
    });
  });

  useEffect(() => {
    const inspect = () => {
      const selection = window.getSelection(), node = content.current;
      if (!selection?.rangeCount || !node) return;
      const range = selection.getRangeAt(0);
      if (!node.contains(range.commonAncestorContainer)) return;
      lastRange.current = range.cloneRange();
      setFormatState({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), strikeThrough: document.queryCommandState('strikeThrough') });
      const quote = selection.toString().trim();
      if (!quote) { onSelection(undefined); return; }
      const before = document.createRange();
      before.selectNodeContents(node);
      before.setEnd(range.startContainer, range.startOffset);
      const offset = markdown(before.cloneContents()).trim().length;
      const body = lastBody.current ?? text;
      const index = body.indexOf(quote, Math.max(0, offset - 18));
      const at = index >= 0 ? index : body.indexOf(quote);
      onSelection(at < 0 ? undefined : makeSelection(body, at, at + quote.length));
    };
    document.addEventListener('selectionchange', inspect);
    return () => document.removeEventListener('selectionchange', inspect);
  }, [text, onSelection]);

  function format(command: string, value?: string) {
    if (disabled) return;
    setRange(lastRange.current);
    document.execCommand(command, false, value);
    capture();
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const files = Array.from(event.clipboardData.files);
    if (files.length) { draftFiles(files, lastRange.current); return; }
    const plain = event.clipboardData.getData('text/plain');
    if (plain) { document.execCommand('insertText', false, plain); capture(); }
  }

  return <>
    <div className="qd-writer-bar" role="toolbar" aria-label="笔记格式">
      <div className="qd-writer-tools">
        <button type="button" aria-label="撤销" title="撤销" onMouseDown={event => event.preventDefault()} onClick={() => format('undo')}><Icon name="undo" size={17} /></button>
        <button type="button" aria-label="重做" title="重做" onMouseDown={event => event.preventDefault()} onClick={() => format('redo')}><Icon name="undo" size={17} className="qd-writer-redo" /></button>
      </div>
      <div className="qd-writer-tools">
        <select aria-label="段落样式" defaultValue="p" onChange={event => format('formatBlock', event.target.value)}>
          <option value="p">正文</option><option value="h2">标题 1</option><option value="h3">标题 2</option><option value="blockquote">引用</option>
        </select>
        {([['bold', '加粗', 'B'], ['italic', '斜体', 'I'], ['strikeThrough', '删除线', 'S']] as const).map(([command, label, glyph]) =>
          <button key={command} type="button" aria-pressed={formatState[command]} className={'qd-writer-' + command} aria-label={label} title={label} onMouseDown={event => event.preventDefault()} onClick={() => format(command)}>{glyph}</button>)}
      </div>
      <div className="qd-writer-tools">
        <button type="button" aria-label="项目符号" title="项目符号" onMouseDown={event => event.preventDefault()} onClick={() => format('insertUnorderedList')}>• ☰</button>
        <button type="button" aria-label="编号列表" title="编号列表" onMouseDown={event => event.preventDefault()} onClick={() => format('insertOrderedList')}>1. ☰</button>
      </div>
      <div className="qd-writer-tools">
        <button type="button" aria-label="插入链接" title="插入链接" onMouseDown={event => event.preventDefault()} onClick={() => { setLink(link === undefined ? '' : undefined); setLinkError(false); window.requestAnimationFrame(() => linkField.current?.focus()); }}><Icon name="link" size={17}/></button>
        <button type="button" title="插入图片" onClick={onChoosePicture}>图片</button>
        <button type="button" title="插入附件" onClick={onAttach}>附件</button>
        <button type="button" title="导入转写" onClick={onTranscript}>导入转写</button>
      </div>
    </div>
    {link !== undefined && <form className="qd-writer-link" onSubmit={event => {
      event.preventDefault();
      const url = allowLink(link.trim());
      if (!url) { setLinkError(true); return; }
      if (lastRange.current?.collapsed === false) format('createLink', url);
      else {
        setRange(lastRange.current);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.textContent = url;
        document.execCommand('insertHTML', false, anchor.outerHTML + ' ');
        capture();
      }
      setLink(undefined);
    }}><input ref={linkField} aria-label="链接地址" value={link} placeholder="https://" onChange={event => setLink(event.target.value)} />
      <button className="qd-btn primary" type="submit">插入</button><button className="qd-btn ghost" type="button" onClick={() => setLink(undefined)}>取消</button>
      {linkError && <small role="alert">请输入完整的网址</small>}
    </form>}
    <div ref={seed} hidden aria-hidden="true">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={(url, key) => key === 'src' && inlineId(url) ? url : allowLink(url)}
        components={{ img: ({ src, alt }) => {
          const source = typeof src === 'string' ? src : '';
          const id = inlineId(source);
          if (id) return <img data-note-image={id} alt={alt ?? '图片'} />;
          if (source) return <span contentEditable={false} className="qd-writer-remote-picture" data-note-remote-image={source} data-alt={alt}>外部图片 · {alt || '图片'}</span>;
          return <span>{alt}</span>;
        } }}>
        {text}
      </ReactMarkdown>
    </div>
    <div ref={content} className="qd-writer-content" role="textbox" aria-label="笔记正文" aria-multiline="true"
      aria-readonly={disabled} tabIndex={0} contentEditable={!disabled} suppressContentEditableWarning
      data-placeholder="开始记录，或直接粘贴截图。"
      onBeforeInput={event => {
        if (event.nativeEvent instanceof InputEvent && event.nativeEvent.inputType.startsWith('insert') &&
            (lastBody.current?.length ?? 0) + (event.nativeEvent.data?.length ?? 1) > 50_000) event.preventDefault();
      }}
      onInput={() => capture()} onPaste={paste}
      onDragOver={event => { if (!disabled && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={event => {
        const files = Array.from(event.dataTransfer.files);
        if (files.length) { event.preventDefault(); if (!disabled) draftFiles(files, lastRange.current); }
      }} />
  </>;
}
