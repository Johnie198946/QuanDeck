import { useEffect, useId, useRef, useState } from 'react';
import { desktopHost, type OutputAttachmentVersion, type RuntimeAttachmentPreview } from '../../integration/desktop';
import type { OutputAttachment } from '../../data/types';
import { downloadOutputFile, readOutputBlob } from '../../data/outputFiles';
import { PreviewBody } from '../runtime/AttachmentPreview';

export const isVisualDocument = (file: OutputAttachment) => /\.(html?|pdf|png|jpe?g|gif|webp|mp4|webm|mov|docx|xlsx)$/i.test(file.name);
export interface PublishedAttachmentPreview { reference: OutputAttachmentVersion; contentHash: string }
export function OutputPreview({ projectId, outputId, file, initialOpen = false, publishedAttachment }: { projectId: string; outputId: string; file: OutputAttachment; initialOpen?: boolean; publishedAttachment?: PublishedAttachmentPreview }) {
  const [open, setOpen] = useState(initialOpen), [wide, setWide] = useState(false);
  const [data, setData] = useState<RuntimeAttachmentPreview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true; setLoading(true); setData(null); setError('');
    async function load(): Promise<RuntimeAttachmentPreview> {
      const host = desktopHost();
      if (host?.previewOutputAttachment) return host.previewOutputAttachment(projectId, outputId, file.id, publishedAttachment?.reference);
      const blob = await readOutputBlob(projectId, file.id);
      if (blob.size > 25 * 1024 * 1024 || blob.size !== file.size) throw new Error('附件大小与记录不一致，无法预览');
      if (publishedAttachment) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
        const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== publishedAttachment.contentHash.toLowerCase()) throw new Error('附件内容校验失败，与已发布版本不一致');
      }
      const meta = { name: file.name, path: '', size: blob.size };
      if (/\.html?$/i.test(file.name)) return { ...meta, kind: 'html', html: await blob.text() };
      const kind = /\.(png|jpe?g|gif|webp)$/i.test(file.name) ? 'image' : /\.(mp4|webm|mov)$/i.test(file.name) ? 'video' : /\.pdf$/i.test(file.name) ? 'pdf' : null;
      if (kind) return { ...meta, kind, mime: blob.type || file.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
      if (/\.(txt|md|csv)$/i.test(file.name)) return { ...meta, kind: 'text', text: (await blob.text()).slice(0, 100000), truncated: blob.size > 100000 };
      throw new Error('请在 QuanDeck 桌面端预览此文档，或下载原文件。');
    }
    void load().then(value => { if (active) setData(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '暂时无法预览'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, projectId, outputId, file.id, file.size, file.name, file.type, publishedAttachment?.reference.versionId, publishedAttachment?.reference.artifactId, publishedAttachment?.reference.slotId, publishedAttachment?.contentHash]);
  useEffect(() => {
    if (!wide) return;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); requestAnimationFrame(() => document.getElementById(id + '-expand')?.focus()); };
  }, [wide, id]);
  const content = <>
    <header><div><span>交付文档</span><strong>{file.name}</strong></div><div className="qd-output-preview-actions">
      {open && <button type="button" id={id + '-expand'} aria-pressed={wide} onClick={() => setWide(!wide)}>{wide ? '退出沉浸阅读' : '沉浸阅读'}</button>}
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => { setOpen(!open); setWide(false); }}>{open ? '收起' : '预览'}</button>
      <button type="button" onClick={() => void downloadOutputFile(projectId, file).catch(reason => setError(String(reason.message || reason)))}>下载</button>
    </div></header>
    {open && <div id={id} className="qd-output-preview-content">{loading && <p role="status">正在载入图文内容…</p>}{error && <p role="alert">{error}</p>}{data && <PreviewBody data={data} />}</div>}
  </>;
  return wide ? <dialog ref={dialog} className="qd-output-preview is-expanded" aria-label={`沉浸阅读：${file.name}`} onCancel={event => { event.preventDefault(); setWide(false); }}>{content}</dialog> : <section className="qd-output-preview" aria-label={`预览附件：${file.name}`}>{content}</section>;
}
