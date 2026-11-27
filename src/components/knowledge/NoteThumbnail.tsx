import { useEffect, useMemo, useRef, useState } from 'react';
import { readOutputBlob } from '../../data/outputFiles';
import { KNOWLEDGE_FILES, type KnowledgeNote } from '../../data/knowledgeNotes';
import type { OutputAttachment } from '../../data/types';
import { desktopHost } from '../../integration/desktop';
import { Icon, type IconName } from '../ui/Icon';
import { isNotePicture } from './noteDraft';

// The list, editor and reader can display the same image. Keep one source URL
// while any surface uses it, including across a Strict Mode effect replay.
type Picture = { owners: number; url: Promise<string> };
const pictures = new Map<string, Picture>();

export function acquireNotePicture(noteId: string, file: OutputAttachment) {
  const key = JSON.stringify([noteId, file.id, file.type, file.size]);
  let picture = pictures.get(key);
  if (!picture) {
    const host = desktopHost();
    const blob = host?.readKnowledgeImage
      ? host.readKnowledgeImage(noteId, file.id).then(bytes => new Blob([Uint8Array.from(bytes)], { type: file.type }))
      : readOutputBlob(KNOWLEDGE_FILES, file.id);
    picture = { owners: 0, url: blob.then(bytes => URL.createObjectURL(bytes)) };
    pictures.set(key, picture);
  }
  const entry = picture;
  entry.owners++;
  return {
    url: entry.url,
    release() {
      entry.owners--;
      queueMicrotask(() => {
        if (entry.owners || pictures.get(key) !== entry) return;
        pictures.delete(key);
        void entry.url.then(url => URL.revokeObjectURL(url), () => {});
      });
    },
  };
}

const visibility = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

function observeCover(element: Element, setVisible: (value: boolean) => void) {
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) visibility.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: '250px' });
  visibility.set(element, setVisible);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    visibility.delete(element);
    if (!visibility.size) { observer?.disconnect(); observer = undefined; }
  };
}

function useVisiblePicture(noteId: string, file: OutputAttachment, keepLoaded: boolean) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState('');
  useEffect(() => {
    const target = element.current;
    if (target) return observeCover(target, near => {
      if (near || !keepLoaded) setVisible(near);
    });
  }, [keepLoaded]);
  useEffect(() => {
    setSrc('');
    if (!visible) return;
    let active = true;
    const handle = acquireNotePicture(noteId, file);
    void handle.url.then(url => { if (active) setSrc(url); }, () => {});
    return () => { active = false; handle.release(); };
  }, [noteId, file.id, file.type, file.size, visible]);
  return { element, src, clear: () => setSrc('') };
}

export function DeferredNoteImage({ noteId, file, alt, className }: {
  noteId: string; file: OutputAttachment; alt: string; className?: string;
}) {
  const { element, src } = useVisiblePicture(noteId, file, true);
  return <span ref={element}><img src={src || undefined} decoding="async" alt={alt} className={className} data-note-image={file.id}/></span>;
}

function LocalCover({ noteId, file, icon }: { noteId: string; file: OutputAttachment; icon: IconName }) {
  const { element, src, clear } = useVisiblePicture(noteId, file, false);
  return <span className="qd-note-thumbnail has-picture" ref={element} aria-hidden="true">
    {src ? <img src={src} alt="" decoding="async" onError={clear}/> : <Icon name={icon} size={16}/>}
  </span>;
}

export function NoteThumbnail({ note, icon = 'pencil' }: { note: KnowledgeNote; icon?: IconName }) {
  const picture = useMemo(() => {
    if (!note.attachments.length) return;
    const files = new Map(note.attachments.filter(isNotePicture).map(file => [file.id, file]));
    for (const reference of note.body.matchAll(/!\[[^\]\n]*\]\(attachment:([\w-]+)\)/g)) {
      const match = files.get(reference[1]);
      if (match) return match;
    }
  }, [note.attachments, note.body]);
  return picture ? <LocalCover key={note.id + ':' + picture.id} noteId={note.id} file={picture} icon={icon}/>
    : <span className="qd-note-thumbnail" aria-hidden="true"><Icon name={icon} size={16}/></span>;
}
