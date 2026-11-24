import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { desktopHost } from '../../integration/desktop';
import type { DiscussionFeedbackBinding, DiscussionVisualImage } from '../../data/discussionVisual';

export function safeVisualUrl(value?: string) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function safeMapEmbed(value?: string) {
  const safe = safeVisualUrl(value); if (!safe) return undefined;
  const url = new URL(safe);
  return ['www.google.com', 'maps.google.com'].includes(url.hostname) && (/^\/maps\/embed(?:\/|$)/.test(url.pathname) || url.pathname === '/maps' && url.searchParams.get('output') === 'embed') ? safe : undefined;
}

export function VisualPhoto({ url: value, localUrl, alt, caption, sourceUrl }: { url?: string; localUrl?: string; alt: string; caption?: string; sourceUrl?: string }) {
  const url = localUrl || safeVisualUrl(value), source = safeVisualUrl(sourceUrl);
  const [consent, setConsent] = useState('');
  const [failed, setFailed] = useState(false), [expanded, setExpanded] = useState(false);
  useEffect(() => { setFailed(false); setExpanded(false); }, [url]);
  if (!url) return null;
  return <figure className="qd-visual-media">
    {!localUrl && consent !== url ? <button className="qd-visual-photo-load" type="button" onClick={() => setConsent(url)} aria-label={`加载图片：${alt}`}>加载图片 · {new URL(url).hostname}</button> : failed ? <div className="qd-visual-media-error" role="status"><span>这张图片暂时无法显示。</span><a href={source || url} target="_blank" rel="noreferrer">查看原始页面 ↗</a></div> : <button type="button" aria-label={`放大图片：${alt}`} onClick={() => setExpanded(true)}><img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></button>}
    {(caption || source) && <figcaption>{caption && <span>{caption}</span>}{source && <a href={source} target="_blank" rel="noreferrer">图片来源 ↗</a>}</figcaption>}
    {expanded && <PhotoDialog url={url} alt={alt} caption={caption} source={source} onClose={() => setExpanded(false)} />}
  </figure>;
}
function PhotoDialog({ url, alt, caption, source, onClose }: { url: string; alt: string; caption?: string; source?: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const element = dialog.current; element?.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
  return createPortal(<dialog ref={dialog} className="qd-visual-lightbox" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}><header><h2 id={titleId}>{alt}</h2><button type="button" aria-label="关闭图片" onClick={onClose}><Icon name="close" size={18} /></button></header><img src={url} alt={alt} referrerPolicy="no-referrer" />{(caption || source) && <p>{caption} {source && <a href={source} target="_blank" rel="noreferrer">查看图片来源 ↗</a>}</p>}</dialog>, document.body);
}
export function VisualMap({ url: value, embedUrl, label }: { url: string; embedUrl?: string; label: string }) {
  const url = safeVisualUrl(value), embed = safeMapEmbed(embedUrl);
  const google = url && ['www.google.com', 'maps.google.com'].includes(new URL(url).hostname);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [url, embed]);
  if (!url && !embed) return null;
  return <div className="qd-visual-map"><div className="qd-visual-map-summary"><div><strong>{label}</strong><small>{google ? 'Google Maps · 查看地点与路线' : '查看地图来源与路线'}</small></div><Icon name="pin" size={22} /></div>
    {expanded && embed && <iframe title={`地图：${label}`} src={embed} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />}
    <div className="qd-visual-map-actions">{embed && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起地图' : '在这里看地图'}<Icon name="pin" size={14} /></button>}{url && <a href={url} target="_blank" rel="noreferrer">打开路线<Icon name="external" size={14} /></a>}</div>
  </div>;
}

/** Local image bytes are resolved from a saved block reference, never a model-supplied path. */
export function DiscussionPhoto({ image, blockId, optionId, binding, sourceUrl }: { image: DiscussionVisualImage; blockId: string; optionId?: string; binding?: DiscussionFeedbackBinding; sourceUrl?: string }) {
  const [localUrl, setLocalUrl] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLocalUrl(''); setError('');
    if (image.url || !image.attachmentId) return;
    const host = desktopHost();
    if (!binding || !host?.previewDiscussionAttachment) { setError('此图片尚未同步到项目，可在源 Agent 中查看。'); return; }
    let active = true, objectUrl = '';
    host.previewDiscussionAttachment(binding.projectId, binding.planId, binding.conclusionId, blockId, optionId).then(data => {
      if (data.kind !== 'image') throw new Error('引用的附件不是图片。');
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(data.bytes)], { type: data.mime })); setLocalUrl(objectUrl);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '图片暂时无法读取。'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.url, image.attachmentId, binding?.projectId, binding?.planId, binding?.conclusionId, blockId, optionId, attempt]);
  if (error) return <div className="qd-visual-media-error" role="status"><span>{error}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>重试读取图片</button></div>;
  if (!image.url && !localUrl) return <p className="qd-visual-feedback-reason" role="status">正在读取图片…</p>;
  return <VisualPhoto url={image.url} localUrl={localUrl || undefined} alt={image.alt} caption={image.caption} sourceUrl={sourceUrl} />;
}
