import { desktopHost } from '../integration/desktop';
import { KNOWLEDGE_FILES, type KnowledgeNote, type NoteSelection } from './knowledgeNotes';
import { noteListItems } from './noteListItems';
import { readOutputBlob, saveOutputFile } from './outputFiles';
import type { OutputAttachment } from './types';

const inlineImage = /!\[[^\]\n]*\]\(attachment:([\w-]+)\)/gu;
const isImage = (file:OutputAttachment) => /^image\/(png|jpeg|gif|webp)$/i.test(file.type);

const above = /上(?:面|方|一张)?的?(?:截图|图片|图)|(?:image|screenshot|figure) above/iu;
const below = /下(?:面|方|一张)?的?(?:截图|图片|图)|(?:image|screenshot|figure) below/iu;
const pointsToImage = /如图|见图|看图|图中|图里|这张图|(?:参照|参考|根据|按照|见|看|如|这张|所附)(?:这张)?截图|截图[中里]|\b(?:this|the attached) (?:image|screenshot|figure)\b/iu;

export interface DispatchPictureChoices {
  options: OutputAttachment[];
  suggested: OutputAttachment[];
  needsChoice: boolean;
}

export function noteDispatchPictureChoices(note: KnowledgeNote, selection: NoteSelection): DispatchPictureChoices {
  const start = selection.offset, end = start + selection.quote.length;
  const empty = {options: [], suggested: [], needsChoice:false};
  if (!selection.quote || start < 0 || note.body.slice(start,end) !== selection.quote) return empty;
  const files = new Map(note.attachments.filter(isImage).map(file => [file.id, file]));
  const idsIn = (text:string) => Array.from(text.matchAll(inlineImage), match => match[1]);
  const resolve = (ids:Iterable<string>) => Array.from(new Set(ids)).flatMap(id => files.get(id) ?? []);
  const accepted = (ids:Iterable<string>) => {
    const suggested = resolve(ids);
    return {options:suggested, suggested, needsChoice:!suggested.length};
  };

  const items = noteListItems(note);
  const owners = items.filter(item => start < item.blockEnd && end > item.start);
  const selectedIds = idsIn(selection.quote);
  if (owners.length || selectedIds.length) {
    const direct = accepted([...selectedIds,...owners.flatMap(item => item.images.map(image => image.id))]);
    if (selectedIds.length || direct.suggested.length) return direct;
  }

  const body = note.body;
  const captionStart = body.slice(0,start).lastIndexOf('\n') + 1;
  const captionBreak = body.indexOf('\n',end - 1);
  const caption = body.slice(captionStart,captionBreak < 0 ? body.length : captionBreak);
  // A user may select only “继续开发” within a paragraph that starts with “如图”.
  const description = selection.quote.includes('\n') ? selection.quote : caption;
  const wantsAbove = above.test(description), wantsBelow = below.test(description);
  if (!wantsAbove && !wantsBelow && !pointsToImage.test(description)) return empty;
  let offset = 0;
  const lines = body.split('\n').map(text => {
    const row = {text,start:offset,end:offset + text.length};
    offset = row.end + 1;
    return row;
  });
  const first = lines.findIndex(row => start <= row.end);
  const last = lines.findIndex(row => end - 1 <= row.end);
  // A screenshot can share the caption's paragraph without being inside the selection.
  const inCaption = idsIn(caption);
  if (inCaption.length) return accepted(inCaption);

  // Leave a blank paragraph between picture and caption, as the rich-text editor does.
  // Another paragraph, section or list item's picture ends the group.
  function adjacent(direction: -1 | 1) {
    const ids:string[] = [];
    let blank = false;
    for (let i = direction < 0 ? first - 1 : last + 1; i >= 0 && i < lines.length; i += direction) {
      const row = lines[i];
      if (!row.text.trim()) {
        if (blank) break;
        blank = true;
        continue;
      }
      if (row.text.replace(inlineImage,'').trim()) break;
      if (items.some(item => row.start >= item.start && row.start < item.blockEnd && !owners.includes(item))) break;
      blank = false;
      if (direction < 0) ids.unshift(...idsIn(row.text)); else ids.push(...idsIn(row.text));
    }
    return ids;
  }
  const preceding = wantsBelow && !wantsAbove ? [] : adjacent(-1);
  const following = wantsAbove && !wantsBelow ? [] : adjacent(1);
  if (preceding.length !== 0 && following.length === 0) return accepted(preceding);
  if (following.length !== 0 && preceding.length === 0) return accepted(following);
  // Both sides (or no nearby picture): the user chooses the referenced file explicitly.
  const candidates = preceding.length ? [...preceding,...following] : idsIn(note.body);
  return {options:resolve(candidates),suggested:[],needsChoice:true};
}

export function noteDispatchPictures(note: KnowledgeNote, selection: NoteSelection): OutputAttachment[] {
  return noteDispatchPictureChoices(note,selection).suggested;
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
