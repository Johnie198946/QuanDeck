import { sessionView, type SessionView } from './derive';
import type { Session, Step } from './types';

export interface ExecutionProgress {
  state: 'flowing' | 'paused' | 'stopped' | 'queued';
  mode: 'percent' | 'steps' | 'unknown';
  label: string;
  stage: string;
  amount: string;
  value?: number;
  total?: number;
}

/** Keep commands and tool identifiers in the source details, never in a status headline. */
export function executionStage(value?: string | null) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^(?:\/?(?:usr\/)?(?:bin\/)?(?:zsh|bash|sh)\b|(?:python\d*|node|npm|pnpm|npx|curl|git|rg|cat|ls|sed|exec_command|functions[./]|mcp__|mcp[./])\b)|^\/(?:bin|usr|tmp|private|Users)\//i.test(text)) return '正在运行任务工具';
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

/** Source facts only. A round reaching 100% is never interpreted as task acceptance. */
export function executionProgress(view: SessionView | 'queued', step?: Step | null, percent?: number | null): ExecutionProgress | null {
  if (view === 'archived' || view === 'cancelled') return null;
  const labels: Record<Exclude<SessionView, 'archived' | 'cancelled'> | 'queued', string> = {
    submitting: '正在发送任务', acknowledged: '已接收 · 等待执行', queued: '排队等待执行',
    running: '正在执行', waiting_reply: '等待你的回复', waiting_permission: '等待你的授权',
    paused: '已暂停', failed: '执行遇到问题', rejected: '任务未发送成功', unknown: '正在核对发送结果',
  };
  const state = view === 'running' || view === 'submitting' ? 'flowing'
    : view === 'failed' || view === 'rejected' ? 'stopped'
    : view === 'queued' || view === 'acknowledged' || view === 'unknown' ? 'queued' : 'paused';
  const validPercent = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100;
  const validSteps = Number.isInteger(step?.total) && step!.total! > 0
    && Number.isInteger(step?.completed) && step!.completed! >= 0 && step!.completed! <= step!.total!;
  const mode = validPercent ? 'percent' : validSteps ? 'steps' : 'unknown';
  const value = validPercent ? percent : validSteps ? step!.completed : undefined;
  const total = validPercent ? 100 : validSteps ? step!.total : undefined;
  const amount = mode === 'percent' ? `本轮 ${Math.round(value!)}%`
    : mode === 'steps' ? `本轮已完成 ${value}/${total} 步` : '';
  const stage = view === 'running' ? executionStage(step?.label) : '';
  return { state, mode, label: labels[view], stage, amount, value, total };
}

export function sessionProgress(session: Session) {
  return executionProgress(sessionView(session), session.step, session.percent);
}
