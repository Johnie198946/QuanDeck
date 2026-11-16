import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DiscussionVisualBlock } from '../../data/discussionVisual';
import { redactRuntimeText } from '../../data/runtimePresentation';
import { BlockFeedback, type CanvasFeedback } from './BlockFeedback';
import { safeVisualUrl, VisualMap, DiscussionPhoto } from './VisualMedia';
import './discussion-canvas.css';

function VisualText({ text }: { text: string }) {
  return <div className="qd-visual-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={value => safeVisualUrl(value) ?? ''} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt }) => <span>{alt}</span> }}>{redactRuntimeText(text)}</ReactMarkdown></div>;
}
function Sources({ sources }: { sources?: { label: string; url: string }[] }) {
  const safe = (sources ?? []).filter(source => safeVisualUrl(source.url));
  return safe.length > 0 ? <div className="qd-visual-source"><span>来源</span>{safe.map((source, index) => <a key={`${source.url}:${index}`} href={safeVisualUrl(source.url)} target="_blank" rel="noreferrer">{source.label || new URL(source.url).hostname} ↗</a>)}</div> : null;
}
function Facts({ facts }: { facts?: { label: string; value: string }[] }) {
  return facts?.length ? <dl className="qd-visual-facts">{facts.map((fact, i) => <div key={i}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null;
}
const kinds = { photo: '场景参考', map: '地点与路线', comparison: '比较方向', fact: '关键要点' };
export function DiscussionCanvas({ blocks, context, compact = false }: { blocks: DiscussionVisualBlock[]; context?: CanvasFeedback; compact?: boolean }) {
  if (!blocks.length) return null;
  return <div className={`qd-discussion-canvas${compact ? ' is-compact' : ''}`} aria-label="图文讨论方案">
    {blocks.map(block => <section className={`qd-visual-block kind-${block.kind}`} key={`${context?.binding.conclusionId ?? ''}:${block.id}:${block.hash}`} data-visual-block={block.id}>
      <header className="qd-visual-block-header"><h3>{block.title}</h3><span>{kinds[block.kind]}</span></header>
      {block.kind === 'photo' && block.image && <DiscussionPhoto image={block.image} blockId={block.id} binding={context?.binding} sourceUrl={block.sources[0]?.url} />}
      {block.body && <VisualText text={block.body} />}
      {block.kind === 'map' && block.map && <VisualMap {...block.map} />}
      {block.kind === 'fact' && <Facts facts={block.facts} />}
      {block.kind === 'comparison' && <div className="qd-visual-options">{(block.options ?? []).map(option => {
        const chosen = context?.feedback?.filter(item => item.blockId === block.id && item.optionId === option.id).at(-1)?.action === 'prefer';
        return <article className={`qd-visual-option${chosen ? ' is-preferred' : ''}`} key={option.id} data-visual-option={option.id}>
          {option.image && <DiscussionPhoto image={option.image} blockId={block.id} optionId={option.id} binding={context?.binding} sourceUrl={option.sources?.[0]?.url || block.sources[0]?.url} />}
          <div className="qd-visual-option-content"><h4>{option.title}</h4>{option.body && <VisualText text={option.body} />}<Facts facts={option.facts} /><Sources sources={option.sources} /><BlockFeedback block={block} optionId={option.id} title={option.title} context={context} /></div>
        </article>;
      })}</div>}
      <Sources sources={block.sources} />
      {block.kind !== 'comparison' && <BlockFeedback block={block} title={block.title} context={context} />}
    </section>)}
  </div>;
}
