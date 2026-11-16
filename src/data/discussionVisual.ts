/** Structured discussion content. It is sourced evidence, never plan approval. */
export interface DiscussionVisualSource { label: string; url: string }
export interface DiscussionVisualImage { url?: string; attachmentId?: string; alt: string; caption?: string }
export interface DiscussionVisualFact { label: string; value: string }
export interface DiscussionVisualOption { id: string; title: string; body?: string; image?: DiscussionVisualImage; facts: DiscussionVisualFact[]; sources?: DiscussionVisualSource[] }
export interface DiscussionVisualBlock {
  id: string; hash: string; kind: 'photo' | 'map' | 'comparison' | 'fact'; title: string; body?: string;
  sources: DiscussionVisualSource[]; image?: DiscussionVisualImage;
  map?: { embedUrl?: string; url: string; label: string };
  options?: DiscussionVisualOption[]; facts?: DiscussionVisualFact[];
}
export interface DiscussionFeedbackBinding { projectId: string; taskId: string; planId: string; conclusionId: string; sourceMessageId?: string; draftVersion: number }
export interface DiscussionFeedbackInput {
  binding: DiscussionFeedbackBinding; feedbackId: string; blockId: string; blockHash: string; optionId?: string;
  action: 'prefer' | 'reject' | 'request_change' | 'comment'; text: string;
}
export interface DiscussionBlockFeedback extends DiscussionFeedbackInput { recordedAt: string; delivery: 'pending' | 'sent' | 'failed'; error?: string }
export interface DiscussionVisualReceipt { conclusionId: string; sourceMessageId?: string; planId: string; taskId: string; recordedAt: string; blocks: DiscussionVisualBlock[] }
export type DiscussionFeedbackResult = { ok: boolean; message?: string; data?: { feedback: DiscussionBlockFeedback } };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, limit = 4000) => typeof v === 'string' ? v.trim().slice(0, limit) : '';
export function discussionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return;
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch { /* Not a public source. */ }
}
export function discussionMapEmbed(value: unknown): string | undefined {
  const safe = discussionUrl(value); if (!safe) return;
  const u = new URL(safe);
  if (['www.google.com', 'maps.google.com'].includes(u.hostname) && (/^\/maps\/embed(?:\/|$)/.test(u.pathname) || u.pathname === '/maps' && u.searchParams.get('output') === 'embed')) return safe;
}
export function visualHash(value: unknown): string {
  const input = JSON.stringify(value); let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
const sources = (v: unknown): DiscussionVisualSource[] => Array.isArray(v) ? v.filter(object).flatMap(s => {
  const url = discussionUrl(s.url); return url ? [{ label: text(s.label, 160) || new URL(url).hostname, url }] : [];
}).slice(0, 12) : [];
const facts = (v: unknown): DiscussionVisualFact[] => Array.isArray(v) ? v.filter(object).flatMap(f => text(f.label) && text(f.value) ? [{ label: text(f.label, 120), value: text(f.value, 500) }] : []).slice(0, 12) : [];
function picture(value: unknown): DiscussionVisualImage | undefined {
  if (!object(value)) return;
  const url = discussionUrl(value.url), attachmentId = text(value.attachmentId, 200), alt = text(value.alt, 400);
  if ((!url && !attachmentId) || !alt) return;
  return { ...(url ? { url } : {}), ...(attachmentId ? { attachmentId } : {}), alt, ...(text(value.caption) ? { caption: text(value.caption, 800) } : {}) };
}
/** Invalid/unsourced media are omitted, never replaced with invented pictures or maps. */
export function readDiscussionVisualBlocks(value: unknown): DiscussionVisualBlock[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value.slice(0, 16).flatMap((v, i) => {
    if (!object(v) || !['photo','map','comparison','fact'].includes(String(v.kind)) || !text(v.title)) return [];
    const block: Omit<DiscussionVisualBlock, 'hash'> = { id: text(v.id, 160) || `visual-${i + 1}`, kind: v.kind as DiscussionVisualBlock['kind'], title: text(v.title, 240), sources: sources(v.sources), ...(text(v.body) ? { body: text(v.body) } : {}) };
    if (used.has(block.id)) return [];
    if (block.kind === 'photo') { block.image = picture(v.image); if (!block.image || block.image.url && !block.sources.length) return []; }
    if (block.kind === 'map') {
      if (!object(v.map)) return []; const url = discussionUrl(v.map.url); if (!url || !block.sources.length) return [];
      const embedUrl = discussionMapEmbed(v.map.embedUrl); block.map = { url, label: text(v.map.label, 240) || block.title, ...(embedUrl ? { embedUrl } : {}) };
    }
    if (block.kind === 'comparison') {
      if (!Array.isArray(v.options)) return []; const optionIds = new Set<string>();
      block.options = v.options.slice(0, 6).filter(object).flatMap((o, j) => {
        const id = text(o.id, 160) || `option-${j + 1}`; if (!text(o.title) || optionIds.has(id)) return []; optionIds.add(id);
        const source = sources(o.sources), img = picture(o.image);
        return [{ id, title: text(o.title, 240), ...(text(o.body) ? { body: text(o.body) } : {}), facts: facts(o.facts), sources: source, ...(img && (!img.url || source.length || block.sources.length) ? { image: img } : {}) }];
      });
      if (!block.options.length) return [];
    }
    if (block.kind === 'fact') { block.facts = facts(v.facts); if (!block.facts.length && !block.body) return []; }
    used.add(block.id); return [{ ...block, hash: visualHash(block) }];
  });
}
export const DISCUSSION_VISUAL_INSTRUCTIONS = '方案讨论可以图文并茂：当照片、路线或选项对比能帮助用户判断时，在结论添加 visualBlocks。结构为 [{id,kind:"photo"|"map"|"comparison"|"fact",title,body?,sources:[{label,url}]}]；photo 添加 image:{url或attachmentId,alt,caption?}；map 添加 map:{url:Google地图路线链接,embedUrl:可选Google官方嵌入链接,label}；comparison 添加 options:[{id,title,body?,image?,facts:[{label,value}],sources:[{label,url}]}]；fact 添加 facts:[{label,value}]。图片与地图引用真实查询来源，不编造路线、照片、营业状态或价格；没有可核实素材就用事实对比卡并说明待查。图片需附来源；不输出 HTML、脚本或 base64。用户点卡片反馈只作用于该卡片，不能当作批准整个方案或启动执行。方案阶段只定方向和执行逻辑，具体资料核查与制作拆入后续任务。';
