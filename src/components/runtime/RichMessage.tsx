import { redactRuntimeText } from '../../data/runtimePresentation';
import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseDiscussionResponse, type DiscussionAttachment } from '../../data/discussionPresentation';
import { AttachmentPreview, InlineAttachmentPreview } from './AttachmentPreview';
import { DiscussionChart } from './DiscussionChart';
import { DiscussionCanvas } from '../discussion/DiscussionCanvas';
import type { CanvasFeedback } from '../discussion/BlockFeedback';
import type { DiscussionVisualBlock } from '../../data/discussionVisual';

const external = (value: string) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
const localFile = (value: string) => {
  if (/^file:/i.test(value)) { try { const url = new URL(value); return !url.hostname || url.hostname === 'localhost'; } catch { return false; } }
  return !!value && !value.startsWith('#') && !/^[a-z][\w+.-]*:/i.test(value) && !value.startsWith('//') || /^[a-z]:[\\/]/i.test(value);
};
const linkName = (children: ReactNode): string => Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child) ? linkName(child.props.children) : String(child)).join('');
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
    a: ({ href, children }) => href && external(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : href && localFile(href) ? <InlineAttachmentPreview key={`${runId}:${href}`} runId={runId} attachment={{ path: href, name: linkName(children) || '本地附件' }} /> : <span>{children}</span>,
    img: ({ src, alt }) => typeof src === 'string' ? <ReplyAttachment runId={runId} attachment={{ name: alt || '图片', path: src }} /> : null,
    // Paragraphs may contain file previews, so use a flow container rather than invalid p/div nesting.
    p: ({ children }) => <div className="qd-markdown-paragraph">{children}</div>,
    table: ({ children }) => <div className="qd-table-scroll"><table>{children}</table></div>,
  }}>{redactRuntimeText(text)}</ReactMarkdown></div>;
}
export function RichMessage({ text, runId, compactDecisions = false, visualBlocks, visualFeedback }: { text: string; runId: string; compactDecisions?: boolean; visualBlocks?: DiscussionVisualBlock[]; visualFeedback?: CanvasFeedback }) {
  const reply = parseDiscussionResponse(redactRuntimeText(text)), value = reply.conclusion;
  return <>
    {reply.submission && <div className="qd-answer-summary"><span className="qd-section-label">{reply.submission.kind === 'result' ? '候选成果 · 待核对' : reply.submission.kind === 'checkpoint' ? 'Agent 进展' : reply.submission.kind === 'blocker' ? '需要处理' : '任务建议'}</span><h3>{reply.submission.title}</h3></div>}
    {value && <div className="qd-discussion-result">
      <div className="qd-answer-summary"><span className="qd-section-label">本轮重点</span><MarkdownMessage text={value.summary} runId={runId} /></div>
      {!compactDecisions && !!value.proposals.length && <details className="qd-answer-section"><summary>方案要点 · {value.proposals.length}</summary><ul>{value.proposals.map((item, index) => <li key={index}><MarkdownMessage text={item} runId={runId} /></li>)}</ul></details>}
      {!compactDecisions && !!value.questions.length && <section className="qd-answer-section"><h3>影响下一步的信息</h3><ol>{value.questions.map((item, index) => <li key={index}><MarkdownMessage text={item} runId={runId} /></li>)}</ol></section>}
      {compactDecisions && <p className="qd-answer-decision-hint">需要你决定的内容已集中在「补充信息」，这里保留本轮重点。</p>}
      {visualBlocks && <DiscussionCanvas blocks={visualBlocks} context={visualFeedback} />}
      {!visualBlocks?.length && !!value.cards.length && <div className="qd-answer-cards">{value.cards.map((card, index) => <section key={index}><h3>{card.title}</h3><MarkdownMessage text={card.body} runId={runId} /></section>)}</div>}
      {value.charts.map((chart, index) => <DiscussionChart chart={chart} key={index} />)}
      {!!value.attachments.length && <section className="qd-answer-attachments"><h3>相关资料</h3>{value.attachments.map((attachment, index) => <ReplyAttachment runId={runId} attachment={attachment} key={index} />)}</section>}
    </div>}
    {!value && visualBlocks && <DiscussionCanvas blocks={visualBlocks} context={visualFeedback} />}
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
