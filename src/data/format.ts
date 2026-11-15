export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number) {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function formatDuration(minutes: number | null | undefined) {
  if (minutes == null) return "未提供";
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h${String(r).padStart(2, "0")}m` : `${h}h`;
}

export function span(start: string, end: string) {
  return toMinutes(end) - toMinutes(start);
}

/** token 缺失时明确“未提供”，绝不写 0 */
export function formatTokens(n: number | null | undefined) {
  if (n == null) return "token 未提供";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M token`;
  if (n >= 1000) return `${Math.round(n / 1000)}k token`;
  return `${n} token`;
}

/** 原始回复末句；末句过短（如“确认后再继续。”）时向前补一句，保证脱离上下文也能看懂 */
export function lastSentence(text: string, min = 16) {
  const parts = text
    .split(/(?<=[。！？!?])/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return text;
  let out = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0 && out.length < min; i--) out = parts[i] + out;
  return out;
}
