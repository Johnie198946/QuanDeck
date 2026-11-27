export interface ScheduleProgress {
  id: string;
  at: string;
  text: string;
}

export function isScheduleProgress(value: unknown): value is ScheduleProgress {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ScheduleProgress>;
  return typeof entry.id === 'string' && !!entry.id && typeof entry.at === 'string' &&
    Number.isFinite(Date.parse(entry.at)) && typeof entry.text === 'string' && !!entry.text.trim();
}

/** A retry with the same ID should keep the first timestamp. */
export function appendScheduleProgress(target: { progress?: ScheduleProgress[] }, id: string, text: string) {
  if (typeof id !== 'string' || !id.trim() || id.length > 100) throw new Error('记录标识无效');
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 2000) throw new Error('请填写 1 到 2000 字的进展');
  const value = text.trim();
  const existing = target.progress?.find(row => row.id === id);
  if (existing) {
    if (existing.text !== value) throw new Error('这条记录已保存，请重新添加');
    return;
  }
  (target.progress ??= []).push({ id, text: value, at: new Date().toISOString() });
}
