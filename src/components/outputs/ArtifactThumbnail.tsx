import { projectFilePath } from '../../data/projectFilePath';
import { createContext, useEffect, useRef, useState } from 'react';
import type { CollaborationArtifact } from '../../data/collaboration';
import type { OutputAttachment } from '../../data/types';
import { readOutputPreview, type PublishedAttachmentPreview } from '../../data/outputFiles';
import { VisualPhoto } from '../discussion/VisualMedia';
import './artifact-thumbnail.css';

export function artifactCover(artifact?: CollaborationArtifact) {
  const pictures = artifact?.attachments?.filter(file => /\.(png|jpe?g|webp|gif)$/i.test(file.name)) ?? [];
  return pictures.find(file => /(?:封面|总览|桌面|1440|1920|cover|desktop|overview)/i.test(file.name)) ?? pictures[0];
}

export function ArtifactThumbnail({ artifact, projectId }: { artifact: CollaborationArtifact; projectId: string }) {
  const file = artifactCover(artifact);
  return file && artifact.outputId ? <StoredPicture projectId={projectId} outputId={artifact.outputId} file={file} /> : null;
}

export interface OutputPictureScope { projectId: string; outputId: string; files: OutputAttachment[]; publishedAttachment?: PublishedAttachmentPreview }
export const OutputPictures = createContext<OutputPictureScope | undefined>(undefined);

/** A result can embed its own registered picture by ID or by an unambiguous file name. */
export function outputPicture(scope: OutputPictureScope | undefined, src: string) {
  if (!scope || !src) return undefined;
  try {
    const ref = decodeURIComponent(src);
    const files = scope.files.filter(file => /\.(png|jpe?g|gif|webp)$/i.test(file.name));
    if (ref.startsWith('attachment:')) return files.find(file => file.id === ref.slice(11));
    const name = projectFilePath(ref);
    if (!name) return undefined;
    const matches = files.filter(file => name.includes('/') ? file.projectRelativePath === name : file.name === name);
    return matches.length === 1 ? matches[0] : undefined;
  } catch { return undefined; }
}

export function StoredPicture({ projectId, outputId, file, publishedAttachment, alt, inline = false }: { projectId: string; outputId: string; file: OutputAttachment; publishedAttachment?: PublishedAttachmentPreview; alt?: string; inline?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<{key: string; url?: string; error?: string}>();
  const key = JSON.stringify([projectId, outputId, file.id, publishedAttachment?.reference, publishedAttachment?.contentHash]);
  useEffect(() => {
    if (!ref.current || visible) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [file.id, visible]);
  useEffect(() => {
    if (!visible) return;
    let active = true, url = '';
    void readOutputPreview(projectId, outputId, file, publishedAttachment).then(data => {
      if (!active) return;
      if (data.kind !== 'image') throw new Error('没有可显示的图片');
      url = URL.createObjectURL(new Blob([Uint8Array.from(data.bytes)], { type: data.mime }));
      setSource({key, url});
    }).catch(() => { if (active) setSource({key, error: '图片暂未载入，可在成果中查看附件'}); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [key, visible, file.name, file.size]);
  const current = source?.key === key ? source : undefined;
  return <aside className={inline ? "qd-artifact-thumbnail is-inline" : "qd-artifact-thumbnail"} aria-label="成果图片" ref={ref}>
    {current?.url ? <VisualPhoto localUrl={current.url} alt={alt || file.name} /> : <span role="status">{current?.error || '正在载入成果图…'}</span>}
  </aside>;
}
