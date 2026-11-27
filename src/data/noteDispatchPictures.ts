import { desktopHost } from '../integration/desktop';
import { KNOWLEDGE_FILES, type KnowledgeNote, type NoteSelection } from './knowledgeNotes';
import { noteListItems } from './noteListItems';
import { readOutputBlob, saveOutputFile } from './outputFiles';
import type { OutputAttachment } from './types';

const inlineImage = /!\[[^\]\n]*\]\(attachment:([\w-]+)\)/gu;
const isImage = (file:OutputAttachment) => /^image\/(png|jpeg|gif|webp)$/i.test(file.type);

/** Only selected text and the numbered/list items it actually touches may contribute images. */
export function noteDispatchPictures(note: KnowledgeNote, selection: NoteSelection): OutputAttachment[] {
  const start = selection.offset, end = start + selection.quote.length;
  if (!selection.quote || note.body.slice(start,end) !== selection.quote) return [];
  const ids = new Set<string>();
  for (const item of noteListItems(note)) {
    if (start < item.blockEnd && end > item.start) for (const image of item.images) ids.add(image.id);
  }
  for (const match of selection.quote.matchAll(inlineImage)) ids.add(match[1]);
  return [...ids].flatMap(id => {
    const file = note.attachments.find(f=>f.id===id);
    return file && isImage(file) ? [file] : [];
  });
}

/** Freeze the user's selections into this project's attachment storage before registering a task. */
export async function copyNoteDispatchPictures(projectId: string, noteId: string, files: readonly OutputAttachment[], draftUrls?: ReadonlyMap<string,string>): Promise<OutputAttachment[]> {
  const copied = new Map<string,OutputAttachment>();
  for (const file of files) {
    if (!isImage(file)) throw Error('所选附件不是支持的图片：'+file.name);
    const readImage = desktopHost()?.readKnowledgeImage;
    const draftUrl = draftUrls?.get(file.id);
    let blob: Blob;
    if (draftUrl?.startsWith('blob:')) {
      const response = await fetch(draftUrl);
      if (!response.ok) throw Error('草稿图片已变化，请重新选择：'+file.name);
      blob = await response.blob();
    } else if (readImage) {
      blob = new Blob([Uint8Array.from(await readImage(noteId,file.id))],{type:file.type});
    } else {
      blob = await readOutputBlob(KNOWLEDGE_FILES,file.id);
    }
    if (blob.size !== file.size) throw Error('图片大小与笔记记录不一致：'+file.name);
    if (file.sha256) {
      const digest = await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), n=>n.toString(16).padStart(2,'0')).join('');
      if (hash !== file.sha256) throw Error('图片内容与笔记记录不一致：'+file.name);
    }
    const saved = await saveOutputFile(projectId,new File([blob],file.name,{type:file.type}),true);
    copied.set(saved.id,saved);
  }
  return [...copied.values()];
}
