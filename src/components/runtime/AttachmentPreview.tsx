import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { desktopHost, type RuntimeAttachment, type RuntimeAttachmentPreview } from '../../integration/desktop';
import './attachment-preview.css';
import { HtmlPreview } from './HtmlPreview';

const PdfPreview = lazy(() => import('./PdfPreview'));
const columns = (count: number) => Array.from({ length: count }, (_, index) => index < 26 ? String.fromCharCode(65 + index) : 'A' + String.fromCharCode(65 + index - 26));
const extension = (file: RuntimeAttachment) => file.name.split('.').at(-1)?.toUpperCase() || '文件';
const size = (bytes?: number) => bytes == null ? '' : bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

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
  if (data.kind === 'text') return <pre className="qd-attachment-text">{data.text}</pre>;
  if (data.kind === 'document') return <div className="qd-attachment-document">{data.blocks.map((block, index) => block.kind === 'table' ? <div className="qd-attachment-table-scroll" key={index} tabIndex={0} role="region" aria-label={`文档表格 ${index + 1}`}><table><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div> : block.kind === 'heading' ? <p className={`qd-attachment-heading level-${block.level}`} key={index}>{block.text}</p> : <p className={block.kind === 'list' ? 'qd-attachment-list' : ''} key={index}>{block.text}</p>)}</div>;
  if (data.kind === 'spreadsheet') {
    if (!data.sheets.length) return <p role="status">没有可预览的工作表。</p>;
    const current = data.sheets[Math.min(sheet, data.sheets.length - 1)];
    const count = Math.max(1, ...current.rows.map(row => row.cells.length));
    return <div className="qd-attachment-workbook"><label>工作表<select value={sheet} onChange={event => setSheet(Number(event.target.value))}>{data.sheets.map((item, i) => <option value={i} key={i}>{item.name}</option>)}</select></label><div className="qd-attachment-table-scroll" tabIndex={0} role="region" aria-label={current.name}><table><thead><tr><th aria-label="行号" />{columns(count).map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{current.rows.map((row, index) => <tr key={index}><th scope="row">{row.number}</th>{Array.from({ length: count }, (_, i) => <td key={i} title={row.cells[i]?.formula ? `公式：${row.cells[i].formula}` : undefined}>{row.cells[i]?.text}</td>)}</tr>)}</tbody></table></div></div>;
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
