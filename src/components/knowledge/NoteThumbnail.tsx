import { useEffect, useMemo, useRef, useState } from 'react';
import { readOutputBlob } from '../../data/outputFiles';
import { KNOWLEDGE_FILES, type KnowledgeNote } from '../../data/knowledgeNotes';
import type { OutputAttachment } from '../../data/types';
import { desktopHost } from '../../integration/desktop';
import { Icon, type IconName } from '../ui/Icon';
import { isNotePicture } from './noteDraft';

export async function readNotePicture(noteId: string, file: OutputAttachment): Promise<Blob> {
  const host = desktopHost();
  return host?.readKnowledgeImage
    ? new Blob([Uint8Array.from(await host.readKnowledgeImage(noteId, file.id))], { type: file.type })
    : readOutputBlob(KNOWLEDGE_FILES, file.id);
}

const visibility = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

function observeCover(element: Element, setVisible: (value: boolean) => void) {
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) visibility.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: '80px' });
  visibility.set(element, setVisible);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    visibility.delete(element);
    if (!visibility.size) { observer?.disconnect(); observer = undefined; }
  };
}

function LocalCover({ noteId, file, icon }: { noteId: string; file: OutputAttachment; icon: IconName }) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState('');
  useEffect(() => element.current ? observeCover(element.current, setVisible) : undefined, []);
  useEffect(() => {
    setSrc('');
    if (!visible) return;
    let active = true;
    let url: string | undefined;
    void readNotePicture(noteId, file).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch(() => {}); // A missing local file keeps its note icon.
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [visible, noteId, file.id, file.type]);
  return <span className="qd-note-thumbnail has-picture" ref={element} aria-hidden="true">
    {src ? <img src={src} alt="" onError={() => setSrc('')} /> : <Icon name={icon} size={16}/>}
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
