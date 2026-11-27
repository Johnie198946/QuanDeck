import { desktopHost, type RuntimeAttachmentPreview } from '../integration/desktop';
import { KNOWLEDGE_FILES } from './knowledgeNotes';
import { readOutputBlob } from './outputFiles';
import type { OutputAttachment } from './types';

export async function readNoteFilePreview(noteId: string, file: OutputAttachment): Promise<RuntimeAttachmentPreview> {
  const host = desktopHost();
  if (host?.previewKnowledgeAttachment) return host.previewKnowledgeAttachment(noteId, file.id);
  const blob = await readOutputBlob(KNOWLEDGE_FILES, file.id);
  if (blob.size !== file.size) throw new Error('附件大小与记录不一致');
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const info = { name: file.name, size: file.size, path: '' };
  const kind = ext === 'docx' ? 'document' : ext === 'xlsx' ? 'spreadsheet' : ext === 'pptx' ? 'slides' : undefined;
  if (kind) {
    const { parseOfficePreview } = await import('../../desktop/app/office-preview.mjs');
    return { ...info, ...parseOfficePreview(new Uint8Array(await blob.arrayBuffer()), kind) };
  }
  if (/^(png|jpe?g|gif|webp)$/.test(ext)) {
    const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
    return { ...info, kind: 'image', mime, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }
  if (ext === 'pdf') return { ...info, kind: 'pdf', mime: 'application/pdf', bytes: new Uint8Array(await blob.arrayBuffer()) };
  if (/^(txt|md|csv)$/.test(ext)) return { ...info, kind: 'text', text: await blob.slice(0,100000).text(), truncated: blob.size > 100000 };
  throw new Error('此格式可下载到本地打开');
}
