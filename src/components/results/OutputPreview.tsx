import { useEffect, useId, useRef, useState } from 'react';
import type { RuntimeAttachmentPreview } from '../../integration/desktop';
import type { OutputAttachment } from '../../data/types';
import { downloadOutputFile, readOutputPreview, type PublishedAttachmentPreview } from '../../data/outputFiles';
export type { PublishedAttachmentPreview } from '../../data/outputFiles';
import { PreviewBody } from '../runtime/AttachmentPreview';

export const isVisualDocument = (file: OutputAttachment) => /\.(html?|pdf|png|jpe?g|gif|webp|mp4|webm|mov|docx|xlsx|pptx|diff|patch)$/i.test(file.name);
export function OutputPreview({ projectId, outputId, file, initialOpen = false, publishedAttachment }: { projectId: string; outputId: string; file: OutputAttachment; initialOpen?: boolean; publishedAttachment?: PublishedAttachmentPreview }) {
  const [open, setOpen] = useState(initialOpen), [wide, setWide] = useState(false);
  const [data, setData] = useState<RuntimeAttachmentPreview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true; setLoading(true); setData(null); setError('');
    void readOutputPreview(projectId, outputId, file, publishedAttachment).then(value => { if (active) setData(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '暂时无法预览'); }).finally(() => { if (active) setLoading(false); });
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
