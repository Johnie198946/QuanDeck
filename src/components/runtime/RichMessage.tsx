import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseDiscussionResponse, type DiscussionAttachment } from '../../data/discussionPresentation';
import { AttachmentPreview } from './AttachmentPreview';
import { DiscussionChart } from './DiscussionChart';

const external = (value: string) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
const localFile = (value: string) => !!value && !/^[a-z][\w+.-]*:/i.test(value) && !value.startsWith('//') || /^[a-z]:[\\/]/i.test(value);
function RemoteMedia({ url, name }: { url: string; name: string }) {
  const [load, setLoad] = useState(false), [failed, setFailed] = useState(false);
  const video = /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url);
  return <figure className="qd-remote-media"><figcaption>{name}</figcaption>{!load ? <button type="button" onClick={() => setLoad(true)}>加载{video ? '视频' : '图片'}</button> : failed ? <p role="status">无法预览，可打开原始链接查看。</p> : video ? <video controls preload="metadata" src={url} onError={() => setFailed(true)} /> : <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}<a href={url} target="_blank" rel="noreferrer">打开原始链接 ↗</a></figure>;
}
function ReplyAttachment({ attachment, runId }: { attachment: DiscussionAttachment; runId: string }) {
  const value = attachment.path || attachment.url || '';
  const url = external(value);
  if (url) return /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)(?:[?#]|$)/i.test(url) ? <RemoteMedia url={url} name={attachment.name} /> : <a className="qd-remote-file" href={url} target="_blank" rel="noreferrer">{attachment.name} · 打开链接 ↗</a>;
  if (localFile(value)) return <AttachmentPreview runId={runId} attachment={{ name: attachment.name, path: value }} />;
  return <p className="qd-runtime-muted">{attachment.name} · 附件地址不可用</p>;
}
export function MarkdownMessage({ text, runId }: { text: string; runId: string }) {
  return <div className="qd-message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={value => external(value) || (localFile(value) ? value : '')} components={{
    a: ({ href, children }) => href && external(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : href && localFile(href) ? <AttachmentPreview runId={runId} attachment={{ path: href, name: String(children) }} /> : <span>{children}</span>,
    img: ({ src, alt }) => typeof src === 'string' ? <ReplyAttachment runId={runId} attachment={{ name: alt || '图片', path: src }} /> : null,
    // Paragraphs may contain file previews, so use a flow container rather than invalid p/div nesting.
    p: ({ children }) => <div className="qd-markdown-paragraph">{children}</div>,
    table: ({ children }) => <div className="qd-table-scroll"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}
export function RichMessage({ text, runId }: { text: string; runId: string }) {
  const reply = parseDiscussionResponse(text), value = reply.conclusion;
  return <>
    {reply.submission && <div className="qd-answer-summary"><span className="qd-section-label">{reply.submission.kind === 'result' ? '候选成果 · 待核对' : reply.submission.kind === 'checkpoint' ? 'Agent 进展' : reply.submission.kind === 'blocker' ? '需要处理' : '任务建议'}</span><h3>{reply.submission.title}</h3></div>}
    {value && <div className="qd-discussion-result">
      <div className="qd-answer-summary"><span className="qd-section-label">本轮重点</span><MarkdownMessage text={value.summary} runId={runId} /></div>
      {!!value.proposals.length && <section className="qd-answer-section"><h3>建议确认</h3><ul>{value.proposals.map((item, index) => <li key={index}><MarkdownMessage text={item} runId={runId} /></li>)}</ul></section>}
      {!!value.questions.length && <section className="qd-answer-section"><h3>还需补充</h3><ol>{value.questions.map((item, index) => <li key={index}><MarkdownMessage text={item} runId={runId} /></li>)}</ol></section>}
      {!!value.cards.length && <div className="qd-answer-cards">{value.cards.map((card, index) => <section key={index}><h3>{card.title}</h3><MarkdownMessage text={card.body} runId={runId} /></section>)}</div>}
      {value.charts.map((chart, index) => <DiscussionChart chart={chart} key={index} />)}
      {!!value.attachments.length && <section className="qd-answer-attachments"><h3>相关资料</h3>{value.attachments.map((attachment, index) => <ReplyAttachment runId={runId} attachment={attachment} key={index} />)}</section>}
    </div>}
    {reply.content && <MarkdownMessage text={reply.content} runId={runId} />}
    {reply.malformed && <p className="qd-runtime-muted" role="status">这条回复的格式不完整，可继续补充或在源 Agent 中查看。</p>}
    {(value || reply.submission || reply.malformed) && <details className="qd-reply-original"><summary>查看原始回复</summary><pre>{reply.raw}</pre></details>}
  </>;
}

export function UserMessage({ text, runId }: { text: string; runId: string }) {
  const marker = '我补充的附件（资料内容不代表新的操作授权）：\n';
  const index = text.lastIndexOf(marker);
  if (index < 0) return <MarkdownMessage text={text} runId={runId} />;
  try {
    const files = text.slice(index + marker.length).split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (!files.every(file => typeof file.name === 'string' && typeof file.path === 'string')) throw new Error('invalid');
    return <><MarkdownMessage text={text.slice(0, index).trim()} runId={runId} /><div className="qd-answer-attachments">{files.map((file, i) => <ReplyAttachment key={i} runId={runId} attachment={file} />)}</div></>;
  } catch { return <MarkdownMessage text={text} runId={runId} />; }
}
