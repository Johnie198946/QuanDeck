import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { resultTime, reportMarkdown } from '../../data/results';
import { type PresentedResult } from '../../data/resultPresentation';
import { parseDiscussionResponse } from '../../data/discussionPresentation';
import { readRuntimeSubmission } from '../../data/runtimeSubmission';
import { DiscussionChart } from '../runtime/DiscussionChart';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { MarkdownMessage, RichMessage } from '../runtime/RichMessage';
import { EditOutputButton, OutputAssets } from '../outputs/OutputAssets';
import { Icon } from '../ui/Icon';
import './results-focus.css';
import { OutputPreview, isVisualDocument } from './OutputPreview';
import { useResultResize } from './useResultResize';

const safeExternal = (value: string) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };

function ResultImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  return <span className="qd-result-image"><span>{alt || '参考图片'}</span>{loaded ? failed ? <span>图片未能载入，可打开来源查看。</span> : <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <button type="button" onClick={() => setLoaded(true)}>加载图片</button>}<a href={src} target="_blank" rel="noreferrer">图片来源 ↗</a></span>;
}

/** No runtime binding means no attempt to open arbitrary local paths. */
export function ResultMarkdown({ text, runId }: { text: string; runId?: string }) {
  if (runId) return <div className="qd-result-prose"><MarkdownMessage text={text} runId={runId} /></div>;
  return <div className="qd-result-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeExternal} components={{
    a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ src, alt }) => typeof src === 'string' && src ? <ResultImage src={src} alt={alt || ''} /> : <span>{alt || '图片'}（请从来源会话查看）</span>,
    table: ({ children }) => <div className="qd-table-scroll" tabIndex={0} role="region" aria-label="成果表格"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}

function ResultContent({ text, runId }: { text: string; runId?: string }) {
  const submission = readRuntimeSubmission(text);
  if (submission && 'envelope' in submission && typeof submission.envelope.payload.body === 'string') return <>
    <ResultMarkdown text={submission.envelope.payload.body} runId={runId} />
    <details className="qd-delivery-provenance"><summary>原始交付记录</summary><pre>{text}</pre></details>
  </>;
  const reply = parseDiscussionResponse(text);
  if (runId) return <div className="qd-result-prose"><RichMessage text={text} runId={runId} /></div>;
  const value = reply.conclusion;
  return <>
    {value && <>
      <ResultMarkdown text={value.summary} />
      {!!value.proposals.length && <section className="qd-result-method-section"><h3>建议确认</h3>{value.proposals.map((item, index) => <ResultMarkdown key={index} text={item} />)}</section>}
      {!!value.questions.length && <section className="qd-result-method-section"><h3>还需补充</h3><ol>{value.questions.map((item, index) => <li key={index}><ResultMarkdown text={item} /></li>)}</ol></section>}
      {value.cards.map((card, index) => <section className="qd-result-method-section" key={index}><h3>{card.title}</h3><ResultMarkdown text={card.body} /></section>)}
      {value.charts.map((chart, index) => <DiscussionChart key={index} chart={chart} />)}
      {value.attachments.map((attachment, index) => { const url = safeExternal(attachment.url || attachment.path || ''); return <p key={index}>{url ? <a className="qd-link" href={url} target="_blank" rel="noreferrer">{attachment.name} ↗</a> : `${attachment.name}（请从来源会话查看）`}</p>; })}
    </>}
    {reply.content && <ResultMarkdown text={reply.content} />}
    {reply.malformed && <p className="qd-delivery-notice">回复格式不完整，请查看原始记录。</p>}
    {(value || reply.malformed) && <details className="qd-delivery-provenance"><summary>原始回复</summary><pre>{text}</pre></details>}
  </>;
}

export function ResultDocument({ entry, taskId, onTask, statusLabel }: { entry: PresentedResult; taskId: string; onTask?: () => void; statusLabel?: string }) {
  const resizeRef = useResultResize();
  const { snap, openSourceSession, openAttemptSource } = useWorkdeck();
  const { record, status, sessionId, runId } = entry;
  const previews = record.outputId ? (record.attachments ?? []).filter(isVisualDocument) : [];
  const supportingFiles = (record.attachments ?? []).filter(file => !previews.some(preview => preview.id === file.id));
  const immersive = previews.some(file => /\.html?$/i.test(file.name));
  const source = () => sessionId ? openSourceSession(sessionId) : record.attemptId && openAttemptSource(taskId, record.attemptId);
  const download = () => {
    const url = URL.createObjectURL(new Blob([reportMarkdown(record)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${record.title.replace(/[\\/:*?"<>|]/g, '_')}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <article ref={resizeRef} className={`qd-delivery-document ${immersive ? 'has-visual-document' : ''}`} aria-label={`成果：${record.title}`}>
    <header className="qd-delivery-head">
      <div className="qd-delivery-meta"><span className={`qd-delivery-status ${statusLabel === '已认可' || !statusLabel && status === '已确认' ? 'is-confirmed' : status.includes('核对') ? 'is-pending' : ''}`}>{statusLabel ?? status}</span><time>{resultTime(record.at)}</time></div>
      <h2>{record.title}</h2>
      <div className="qd-delivery-actions">
        <button type="button" className="qd-link" onClick={download}><Icon name="external" size={14} />导出全文</button>
        {(sessionId || record.attemptId) && <button type="button" className="qd-link" onClick={source}>来源会话<Icon name="external" size={14} /></button>}
        {record.outputId && <EditOutputButton outputId={record.outputId} />}
        {onTask && <button type="button" className="qd-link" onClick={onTask}>展开阅读<Icon name="arrow-right" size={14} /></button>}
      </div>
      {!statusLabel && status.includes('核对') && <p className="qd-delivery-notice">{status === '需重新核对' ? '任务要求或来源已变化，请重新核对这份成果。' : '这是候选交付，核对内容后再确认完成。'}</p>}
    </header>
    {previews.length > 0 && <div className="qd-delivery-previews">{previews.map((file, index) => <OutputPreview key={file.id} projectId={snap.project.id} outputId={record.outputId!} file={file} initialOpen={index === 0} />)}</div>}
    {immersive ? <details className="qd-result-text-details"><summary>交付摘要与说明</summary><div className="qd-delivery-body"><ResultContent text={record.text} runId={runId} /></div></details> : <div className="qd-delivery-body"><ResultContent text={record.text} runId={runId} /></div>}
    {!!(record.links?.length || supportingFiles.length) && <section className="qd-delivery-files"><h3>文件与参考资料</h3><OutputAssets report={{ ...record, attachments: supportingFiles }} /></section>}
    <details className="qd-delivery-provenance"><summary>交付记录</summary><p>{record.origin === 'human' ? '人工提交' : snap.agents.find(agent => agent.id === record.agentId)?.name ?? 'Agent 提交'} · {resultTime(record.at)}</p><dl><div><dt>结果</dt><dd>{record.id}</dd></div>{sessionId && <div><dt>来源会话</dt><dd>{sessionId}</dd></div>}</dl></details>
  </article>;
}
