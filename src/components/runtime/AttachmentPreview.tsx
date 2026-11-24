import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { desktopHost, type RuntimeAttachment, type RuntimeAttachmentPreview } from '../../integration/desktop';
import './attachment-preview.css';
import { HtmlPreview } from './HtmlPreview';

const PdfPreview = lazy(() => import('./PdfPreview'));
const columns = (count: number) => Array.from({ length: count }, (_, index) => index < 26 ? String.fromCharCode(65 + index) : 'A' + String.fromCharCode(65 + index - 26));
const extension = (file: RuntimeAttachment) => file.name.split('.').at(-1)?.toUpperCase() || '文件';
const size = (bytes?: number) => bytes == null ? '' : bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/** Inline links stay part of the sentence. Only visible local images are read
 * automatically, through the same run-bound service as an explicit preview. */
export function InlineAttachmentPreview({ runId, attachment, featured = false }: { runId: string; attachment: RuntimeAttachment; featured?: boolean }) {
  const [open, setOpen] = useState(false), [visible, setVisible] = useState(false);
  const [data, setData] = useState<RuntimeAttachmentPreview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [thumbnail, setThumbnail] = useState('');
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const image = featured || /\.(png|jpe?g|gif|webp)(?:[?#]|$)/i.test(attachment.path);
  const requested = open || image && visible;
  useEffect(() => {
    if (!image || !trigger.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(trigger.current);
    return () => observer.disconnect();
  }, [image, attachment.path]);
  useEffect(() => {
    if (!requested) return;
    let active = true; setLoading(true); setError(''); setData(null);
    const host = desktopHost();
    (host?.previewRunAttachment ? host.previewRunAttachment(runId, attachment.path) : Promise.reject(new Error('请在 QuanDeck 桌面客户端中预览本地附件')))
      .then(result => { if (active) setData(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '附件暂时无法预览'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [runId, attachment.path, requested]);
  useEffect(() => {
    setThumbnail('');
    if (data?.kind !== 'image') return;
    const url = URL.createObjectURL(new Blob([Uint8Array.from(data.bytes)], { type: data.mime }));
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); trigger.current?.focus(); };
  }, [open]);
  async function reveal() {
    try { await desktopHost()?.revealRunAttachment?.(runId, attachment.path); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法定位文件'); }
  }
  return <span className={featured ? "qd-inline-attachment is-figure" : "qd-inline-attachment"}>
    <button ref={trigger} type="button" className={image ? 'has-picture' : ''} aria-label={`预览附件：${attachment.name}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(true)}>
      {thumbnail ? <img src={thumbnail} alt="" onError={() => setThumbnail('')} /> : <span className="qd-inline-attachment-type" aria-hidden="true">{image ? loading ? '读取中' : '图片' : '文件'}</span>}
      <span>{attachment.name}</span>
    </button>
    {open && createPortal(<dialog ref={dialog} id={id} className="qd-inline-attachment-dialog" aria-label={`附件：${attachment.name}`} onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}>
      <header><strong>{data?.name || attachment.name}</strong><button type="button" onClick={() => setOpen(false)} autoFocus>关闭预览</button></header>
      <div className="qd-inline-attachment-body">{loading && <p role="status">正在读取本地附件…</p>}{error && <p className="qd-attachment-error" role="alert">{error}</p>}{data && <PreviewBody data={data} />}</div>
      <footer>{data?.truncated && <span>预览已截取部分内容，完整内容请查看原文件。</span>}{data?.note && <span>{data.note}</span>}{desktopHost()?.revealRunAttachment && <button type="button" onClick={() => void reveal()}>在文件夹中查看</button>}</footer>
    </dialog>, document.body)}
  </span>;
}

function CodeDiff({ text, truncated }: { text: string; truncated?: boolean }) {
  const lines = text.split(/\r?\n/);
  let inHunk = false;
  const preview = lines.slice(0, 2000).map(line => {
    if (line.startsWith('diff --git ')) inHunk = false;
    if (line.startsWith('@@ ')) inHunk = true;
    const type = inHunk && line.startsWith('+') ? 'added' : inHunk && line.startsWith('-') ? 'removed' : 'context';
    return { line, type };
  });
  const additions = preview.filter(line => line.type === 'added').length;
  const removals = preview.filter(line => line.type === 'removed').length;
  return <section className="qd-code-diff" aria-label="代码差异">
    <header><strong>代码差异</strong><span>新增 {additions} 行 · 删除 {removals} 行{(truncated || lines.length > preview.length) && ' · 仅统计预览部分'}</span></header>
    <pre className="qd-attachment-text" tabIndex={0}>{preview.map((item, index) =>
      <span key={index} className={item.type}>{item.line + (index + 1 < preview.length ? '\n' : '')}</span>)}</pre>
  </section>;
}

export function PreviewBody({ data }: { data: RuntimeAttachmentPreview }) {
  const [url, setUrl] = useState('');
  const [sheet, setSheet] = useState(0), [mediaError, setMediaError] = useState('');
  useEffect(() => {
    setMediaError('');
    if (!('bytes' in data) || data.kind === 'pdf') return;
    const local = URL.createObjectURL(new Blob([Uint8Array.from(data.bytes)], { type: data.mime }));
    setUrl(local); return () => { URL.revokeObjectURL(local); };
  }, [data]);
  if (mediaError) return <p className="qd-attachment-error" role="alert">{mediaError}</p>;
  if (data.kind === 'image') return url ? <img className="qd-attachment-image" src={url} alt={data.name} onError={() => setMediaError('图片无法读取，请查看原文件。')} /> : <p role="status">正在加载图片…</p>;
  if (data.kind === 'video') return url ? <video className="qd-attachment-video" src={url} controls preload="metadata" playsInline onError={() => setMediaError('此视频格式无法播放，请在本地播放器中打开。')}><track kind="captions" />此视频格式暂不支持播放，请在本地播放器中打开。</video> : <p role="status">正在加载视频…</p>;
  if (data.kind === 'pdf') return <Suspense fallback={<p role="status">正在加载 PDF 阅读器…</p>}><PdfPreview bytes={data.bytes} name={data.name} /></Suspense>;
  if (data.kind === 'html') return <HtmlPreview html={data.html} name={data.name} />;
  if (data.kind === 'text') return /\.(diff|patch)$/i.test(data.name) && /^@@ /m.test(data.text)
    ? <CodeDiff text={data.text} truncated={data.truncated} />
    : <pre className="qd-attachment-text">{data.text}</pre>;
  const cover = data.cover && <figure className="qd-office-cover"><PreviewBody data={{kind:'image', ...data.cover, path:'', name:data.name + ' · 文档封面'}} /><figcaption>原文件自带封面</figcaption></figure>;
  if (data.kind === 'slides') {
    const index = Math.min(sheet, data.slides.length - 1);
    return <div className="qd-slides-preview">{index === 0 && cover}<section aria-label={`第 ${index + 1} 页文字`}>
      {data.slides[index]?.length ? <><h3>{data.slides[index][0]}</h3>{data.slides[index].slice(1).map((line,i) => <p key={i}>{line}</p>)}</> : <p>本页未包含可读取的文字，请打开原演示稿查看。</p>}
    </section><nav aria-label="幻灯片翻页"><button type="button" disabled={index <= 0} onClick={() => setSheet(index - 1)}>上一页</button><span>{index + 1} / {data.slides.length}</span><button type="button" disabled={index >= data.slides.length - 1} onClick={() => setSheet(index + 1)}>下一页</button></nav></div>;
  }
  if (data.kind === 'document') return <div className="qd-attachment-document">{cover}{data.blocks.map((block, index) => block.kind === 'table' ? <div className="qd-attachment-table-scroll" key={index} tabIndex={0} role="region" aria-label={`文档表格 ${index + 1}`}><table><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div> : block.kind === 'heading' ? <p className={`qd-attachment-heading level-${block.level}`} key={index}>{block.text}</p> : <p className={block.kind === 'list' ? 'qd-attachment-list' : ''} key={index}>{block.text}</p>)}</div>;
  if (data.kind === 'spreadsheet') {
    if (!data.sheets.length) return <p role="status">没有可预览的工作表。</p>;
    const current = data.sheets[Math.min(sheet, data.sheets.length - 1)];
    const count = Math.max(1, ...current.rows.map(row => row.cells.length));
    return <div className="qd-attachment-workbook">{cover}<label>工作表<select value={sheet} onChange={event => setSheet(Number(event.target.value))}>{data.sheets.map((item, i) => <option value={i} key={i}>{item.name}</option>)}</select></label><div className="qd-attachment-table-scroll" tabIndex={0} role="region" aria-label={current.name}><table><thead><tr><th aria-label="行号" />{columns(count).map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{current.rows.map((row, index) => <tr key={index}><th scope="row">{row.number}</th>{Array.from({ length: count }, (_, i) => <td key={i} title={row.cells[i]?.formula ? `公式：${row.cells[i].formula}` : undefined}>{row.cells[i]?.text}</td>)}</tr>)}</tbody></table></div></div>;
  }
  return null;
}

export function AttachmentPreview({ runId, attachment }: { runId: string; attachment: RuntimeAttachment }) {
  const [expanded, setExpanded] = useState(false), [data, setData] = useState<RuntimeAttachmentPreview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const id = useId();
  useEffect(() => { setExpanded(false); setData(null); setError(''); }, [runId, attachment.path]);
  useEffect(() => {
    if (!expanded || data) return;
    let active = true; setLoading(true); setError('');
    const host = desktopHost();
    (host?.previewRunAttachment ? host.previewRunAttachment(runId, attachment.path) : Promise.reject(new Error('请在 QuanDeck 桌面客户端中预览本地附件')))
      .then(result => { if (active) setData(result); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '附件暂时无法预览'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [runId, attachment.path, expanded, data]);
  async function reveal() { try { await desktopHost()?.revealRunAttachment?.(runId, attachment.path); } catch (reason) { setError(reason instanceof Error ? reason.message : '无法定位文件'); } }
  return <section className="qd-attachment" aria-label={`附件：${attachment.name}`}>
    <header className="qd-attachment-header"><span className="qd-attachment-format" aria-hidden="true">{extension(attachment)}</span><div><strong>{attachment.name}</strong><small>{size(data?.size ?? attachment.size)}</small></div><button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '预览'}</button></header>
    {expanded && <div id={id} className="qd-attachment-preview">{loading && <p role="status">正在读取本地附件…</p>}{error && <p className="qd-attachment-error" role="alert">{error}</p>}{data && <PreviewBody data={data} />}<footer>{data?.truncated && <p>预览已截取部分内容，完整内容请查看原文件。</p>}{data?.note && <p>{data.note}</p>}{desktopHost()?.revealRunAttachment && <button type="button" onClick={() => void reveal()}>在文件夹中查看</button>}</footer></div>}
  </section>;
}
