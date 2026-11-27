import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal, flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NoteExpansion } from '../../data/knowledgeNotes';
import type { OutputAttachment } from '../../data/types';
import { Icon } from '../ui/Icon';
import { LinkCard, NoteFileCard, safeNoteUrl } from './NoteInlineCards';
import './note-reader.css';

interface ReaderProps {
  noteId: string;
  title: string;
  body: string;
  files: OutputAttachment[];
  incoming: OutputAttachment[];
  imageUrls: ReadonlyMap<string, string>;
  expansions?: NoteExpansion[];
}

const fileId = (url?: string) => url?.match(/^attachment:([a-z0-9-]+)$/i)?.[1];

export function NoteReader({ noteId, title, body, files, incoming, imageUrls, expansions }: ReaderProps) {
  const [isReading, setReading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const page = useRef<HTMLElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const origin = useRef<{ x: number; y: number; focus: HTMLElement | null; range?: Range } | null>(null);

  useLayoutEffect(() => {
    const surface = page.current;
    if (!isReading || !surface) return;
    const changed = () => {
      if (document.fullscreenElement !== surface) dialog.current?.close();
    };
    surface.addEventListener('fullscreenchange', changed);
    return () => surface.removeEventListener('fullscreenchange', changed);
  }, [isReading]);

  function open() {
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selection = window.getSelection();
    const range = focus?.isContentEditable && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    origin.current = { x: scrollX, y: scrollY, focus, range };
    // Mount within this click so the native fullscreen request retains its user gesture.
    flushSync(() => setReading(true));
    dialog.current?.showModal();
    if (document.fullscreenEnabled && page.current) {
      // The modal also fills the window when the host cannot grant fullscreen.
      void page.current.requestFullscreen().catch(() => {});
    }
  }

  function close() {
    if (document.fullscreenElement === page.current && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => dialog.current?.close());
    } else dialog.current?.close();
  }

  function restore() {
    const previous = origin.current;
    origin.current = null;
    setReading(false);
    if (!previous) return;
    const focus = previous.focus?.isConnected && previous.focus !== document.body ? previous.focus : entry.current;
    focus?.focus({ preventScroll: true });
    if (previous.range?.commonAncestorContainer.isConnected) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(previous.range);
    }
    window.scrollTo({ left: previous.x, top: previous.y, behavior: 'instant' });
  }

  function markdown(value: string) {
    const components: ComponentProps<typeof ReactMarkdown>['components'] = {
      p: ({ children }) => <div className="qn-reader-paragraph">{children}</div>,
      a: ({ href, title: label, children }) => {
        const id = fileId(href);
        if (id) return <NoteFileCard noteId={noteId} file={files.find(file => file.id === id)} label={String(children)}
          pending={id.startsWith('pending-') || incoming.some(file => file.id === id)} />;
        if (label === '预览卡片' && href) return <LinkCard url={href} label={String(children)} />;
        return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      },
      img: ({ src, alt }) => {
        const url = imageUrls.get(fileId(typeof src === 'string' ? src : undefined) ?? '');
        return url ? <img src={url} alt={alt || '笔记插图'} /> : <span>{alt || '图片'}</span>;
      },
    };
    return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={components}
      urlTransform={url => fileId(url) ? url : safeNoteUrl(url)}>{value}</ReactMarkdown>;
  }

  return <>
    <button type="button" ref={entry} className="qd-note-share" aria-label="全屏阅读" title="全屏阅读"
      aria-haspopup="dialog" onMouseDown={e => e.preventDefault()} onClick={open}><Icon name="expand" size={19} /></button>
    {isReading && createPortal(<dialog ref={dialog} className="qn-reader-dialog" aria-label="笔记全屏阅读"
      onClose={event => { if (event.target === event.currentTarget) restore(); }}
      onCancel={event => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        close();
      }}>
      <section ref={page} className="qn-reader-page" tabIndex={0}>
        <button type="button" className="qn-reader-close" aria-label="退出全屏阅读" title="退出全屏阅读（Esc）" onClick={close}>
          <Icon name="close" size={22} />
        </button>
        <article className="qn-reader-copy">
          {title && <h1>{title}</h1>}
          {markdown(body)}
          {expansions?.map(item => <section className="qn-reader-answer" key={item.id}>
            <h2>{item.question}</h2>
            <blockquote>{item.selection.quote}</blockquote>
            {markdown(item.answer)}
          </section>)}
        </article>
      </section>
    </dialog>, document.body)}
  </>;
}
