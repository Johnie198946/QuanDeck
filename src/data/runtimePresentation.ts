import type { RuntimeRunView } from '../integration/desktop';
import type { DiscussionResponse } from './discussionPresentation';
import { executionProgress } from './executionProgress';
import type { SessionView } from './derive';
import type { Step } from './types';
import { isIdleDeliveryStatus } from './sessionDelivery';

export function runtimeDeliveryIdle(run: RuntimeRunView, pendingRequests: number) {
  return !!run.delivery && isIdleDeliveryStatus(run.status) && pendingRequests === 0 && run.health?.incident?.status !== 'open';
}

/** Credentials in dispatch context are never presentation data. */
export function redactRuntimeText(text: string): string {
  return text
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[已隐藏]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)["']?\s*[:=]\s*["']?)([^\s"',;}]+)/gi, '$1[已隐藏]')
    .replace(/([?&](?:token|key|secret|signature)=)[^\s&#"']+/gi, '$1[已隐藏]');
}

/** Keep adapter-added repair instructions out of the user's visible message. */
export function runtimeUserMessage(text: string): { text: string; context?: string } {
  const marker = '\n\nQuanDeck 上次交付未入库：';
  const index = text.indexOf(marker);
  if (index < 0 || !text.slice(index).includes('提交协议 quandeck.runtime.v1：')) return { text: redactRuntimeText(text) };
  return { text: redactRuntimeText(text.slice(0, index)), context: redactRuntimeText(text.slice(index + 2)) };
}

/** Acknowledged user statements only, never treat an Agent's suggestion as consent. */
export function pendingDiscussion(value: DiscussionResponse, events: RuntimeRunView['events']): DiscussionResponse {
  const normalize = (s: string) => s.replace(/[*_`]/g, '').replace(/\s+/g, '').replace(/[。；;]$/, '');
  const confirmed = new Set<string>();
  for (const event of events) {
    if (event.message?.role !== 'user') continue;
    const block = /我确认以下信息：\s*\n([\s\S]*?)(?=\n\n|$)/.exec(event.message.text)?.[1];
    for (const line of block?.split('\n') ?? []) if (/^\s*-\s+/.test(line)) confirmed.add(normalize(line.replace(/^\s*-\s+/, '')));
  }
  return { ...value, proposals: value.proposals.filter(p => !confirmed.has(normalize(p))) };
}

export function runtimeProgress(run: RuntimeRunView, now: number) {
  const events = run.events.filter(e => !e.targetSessionId || e.targetSessionId === run.sessionId);
  const steps = events.filter(e => e.step);
  const latestStepValue = steps.at(-1)?.step as Step | undefined;
  const latestStep = latestStepValue ? { ...latestStepValue, label: redactRuntimeText(latestStepValue.label || '') } : undefined;
  const lastPercent = [...events].reverse().find(e => typeof (e as {percent?:number}).percent === 'number') as { percent?: number } | undefined;
  const state = (run.status === 'done' ? 'archived' : run.status || 'unknown') as SessionView | 'queued';
  const progress = executionProgress(state, latestStep, lastPercent?.percent);
  const start = Date.parse(run.acceptedAt || events[0]?.at || '');
  const last = Date.parse(run.health?.lastActivityAt || events.at(-1)?.at || '');
  const active = ['running', 'queued'].includes(run.status || '');
  const end = active ? now : last;
  return {
    progress,
    elapsed: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : null,
    silent: Number.isFinite(last) ? Math.max(0, Math.floor((now - last) / 1000)) : null,
    recent: steps.slice(-3).map(e => ({ id: e.id, at: e.at, label: redactRuntimeText(e.step?.label || '正在处理') })),
    active,
  };
}
export function durationLabel(seconds: number) {
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
