import { normalizeTimeText, noteTodoTime } from './noteTodoDue';

export type FollowupSource = { parentId: string; progressId: string; legacy?: true };
export type FollowupRequest = { id: string; text: string; dueAt: string; title: string; expectedAt?: number; existing?: {id:string; expectedAt:number} };

/** A follow-up without a stated time is proposed inside a daytime window and always previewed. */
function suggestedFollowup(now: Date, deadline?: number) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil((next.getMinutes() + 30) / 15) * 15);
  const beforeDue = (deadline ?? 0) - 3_600_000;
  if (beforeDue > +now && beforeDue < +next) next.setTime(beforeDue);
  if (next.getHours() >= 18) next.setDate(next.getDate() + 1);
  if (next.getHours() < 9 || next.getHours() >= 18) next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

export function followupRequest(id: string, text: string, now: Date, deadline?: number, writtenAt = now): FollowupRequest {
  const clauses = text.trim().split(/[，,。；;！!？?\n]+/).map(s => s.trim()).filter(Boolean);
  let title = text.trim();
  let dueAt = suggestedFollowup(now, deadline);
  // “10点已发，等回复” describes a past action. Only parse a clock belonging to a future action.
  for (let i = clauses.length - 1; i >= 0; i--) {
    if (/(?:已经|已于|已在|已(?:发|跟|催|问|收|拿|联系|处理)|刚刚|刚才|昨天|昨日|前天|过了|发过|问过)/.test(clauses[i])) continue;
    const parsed = noteTodoTime(clauses[i], writtenAt);
    if (!parsed.cue) continue;
    let start = i;
    if (i > 0 && noteTodoTime(clauses[i - 1], writtenAt).cue === clauses[i - 1]) start--;
    title = clauses.slice(start).join('，');
    const found = noteTodoTime(title, writtenAt);
    const target = new Date(found.dueAt);
    if (found.dateOnly) target.setHours(9, 0, 0, 0);
    if (+target > +now) dueAt = target.toISOString();
    break;
  }
  return {id, text: text.trim(), dueAt, title, ...(deadline !== undefined && {expectedAt:deadline})};
}

export function checkFollowupRequest(request: FollowupRequest) {
  if (!request || typeof request.id !== 'string' || !request.id.trim() || request.id.length > 100 ||
      typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000 ||
      typeof request.title !== 'string' || !request.title.trim() || request.title.length > 2000 ||
      !Number.isFinite(Date.parse(request.dueAt)) || !Number.isFinite(new Date(Date.parse(request.dueAt) + 3600000).getTime()))
    throw Error('请确认跟进时间和内容');
}

/** Follow every descendant once, including after import changes the stored row order. */
export function relatedScheduleIds(rows: {id: string; follows?: FollowupSource}[], roots: Iterable<string>) {
  const ids = new Set(roots);
  const children = new Map<string, string[]>();
  for (const row of rows) if (row.follows) {
    const list = children.get(row.follows.parentId) ?? [];
    list.push(row.id); children.set(row.follows.parentId, list);
  }
  for (const id of ids) for (const child of children.get(id) ?? []) ids.add(child);
  return ids;
}

export interface ScheduleProgress {
  id: string;
  at: string;
  text: string;
  /** Absent for legacy records that predate deadline intent detection. */
  scheduledFor?: string;
  keptTime?: true;
}

export function isScheduleProgress(value: unknown): value is ScheduleProgress {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ScheduleProgress>;
  return typeof entry.id === 'string' && !!entry.id && typeof entry.at === 'string' &&
    Number.isFinite(Date.parse(entry.at)) && typeof entry.text === 'string' && !!entry.text.trim() &&
    (entry.scheduledFor === undefined || typeof entry.scheduledFor === 'string' && Number.isFinite(Date.parse(entry.scheduledFor))) &&
    (entry.keptTime === undefined || entry.keptTime === true);
}

/** A retry with the same ID should keep the first timestamp. */
export function appendScheduleProgress(target: { progress?: ScheduleProgress[] }, id: string, text: string) {
  if (typeof id !== 'string' || !id.trim() || id.length > 100) throw new Error('记录标识无效');
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 2000) throw new Error('请填写 1 到 2000 字的进展');
  const value = text.trim();
  const existing = target.progress?.find(row => row.id === id);
  if (existing) {
    if (existing.text !== value) throw new Error('这条记录已保存，请重新添加');
    return existing;
  }
  const record: ScheduleProgress = {id, text:value, at:new Date().toISOString()};
  (target.progress ??= []).push(record);
  return record;
}

/** Only move the current appointment for a single, explicit change of deadline. */
export function progressReschedule(text: string, now: Date, deadline?: number) {
  const move = /(?:改期(?:到|至|为|在)?|改(?:到|至|成|为|在)|挪(?:到|至)|移(?:到|至)|推迟(?:到|至)?|推延(?:到|至)?|顺延(?:到|至)?|延(?:期(?:到|至|为)?|至|后(?:到|至)?)|提前(?:到|至)?|重新安排(?:到|在)|调整(?:为|至|到)|(?:截止(?:时间|日期)?|交付时间)(?:定在|设为|改在|放在)|(?:调|挪)期[至到])/g;
  const changes = [...text.matchAll(move)];
  const uncertain = /[?？]|是否|能否|要不要|能不能|如果|假如|或|考虑|建议|要不|再决定|暂不/;
  const negated = /(?:别|不|没)(?:要|必|用|会|打算)?(?:再)?(?:改|推迟|延|提前|调整|挪|移|顺延)/;
  const withdrawn = /取消改期|改期取消|按原(?:计划|时间)|维持原|照旧/;
  const quoted = /原本|原来|原打算|原计划|当时|对方说|他说|她说|听说|[“「『"]/;
  if (changes.length !== 1 || uncertain.test(text) || negated.test(text) || withdrawn.test(text) || quoted.test(text)) return;
  const change = changes[0];
  const lead = text.slice(0,change.index).split(/[，,。；;！!\n]/).at(-1) ?? '';
  if (/可能|也许|说不定|大概|商量|提议|原先|昨天/.test(lead)) return;
  const clause = text.slice(change.index! + change[0].length).split(/[，,。；;！!\n]/,1)[0];
  if (/再(?:催|问|确认|联系|跟进)|跟进时间|看看能否|听说|可能|也许/.test(clause)) return;
  // “延期两天” counts from the appointment; “改到两天后” counts from when the author wrote the update.
  if (deadline !== undefined && /^(?:推迟|推延|顺延|延后|延期|提前)$/.test(change[0])) {
    const offset = /^\s*(\d+(?:\.\d+)?|半)\s*(?:个)?(小时|分钟|周|天)(?![以后内])/.exec(normalizeTimeText(clause));
    if (offset) {
      const n = offset[1] === '半' ? 0.5 : Number(offset[1]);
      const delta = change[0] === '提前' ? -n : n;
      const target = new Date(deadline);
      if (offset[2] === '天' || offset[2] === '周') {
        if (!Number.isInteger(n)) return;
        target.setDate(target.getDate() + delta * (offset[2] === '周' ? 7 : 1));
      } else target.setTime(+target + delta * (offset[2] === '小时' ? 3_600_000 : 60_000));
      if (+target > +now) return target.toISOString();
      return;
    }
  }
  const parsed = noteTodoTime(clause, now);
  if (!parsed.cue) return;
  const target = new Date(parsed.dueAt);
  if (parsed.dateOnly && deadline !== undefined) {
    const original = new Date(deadline);
    target.setHours(original.getHours(), original.getMinutes(), 0, 0);
  }
  if (+target > +now) return target.toISOString();
}
export type ProgressMove = {dueAt: string; expectedAt: number; fromSaved?: true};
export type ClosingProgress = {id: string; text: string};

export function checkProgressMove(move: ProgressMove, originalAt: number) {
  if (!move || !Number.isFinite(Date.parse(move.dueAt)) || Date.parse(move.dueAt) < Date.now() - 60000)
    throw Error('请选择未来的时间');
  if (move.expectedAt !== originalAt) throw Error('这条日程的时间刚有更新，请核对后再保存。');
}

export function checkExistingFollowup(request: FollowupRequest, id: string, at: number, completed: boolean) {
  if (!request.existing || request.existing.id !== id || request.existing.expectedAt !== at || request.expectedAt === undefined)
    throw Error('跟进时间已变化，请重新打开');
  if (completed) throw Error('这条跟进已完成');
}

export function checkFollowupTarget(request: FollowupRequest, originalAt: number, completed: boolean) {
  if (request.expectedAt !== undefined) {
    if (completed) throw Error('这条日程已完成');
    if (request.expectedAt !== originalAt) throw Error('原事项时间已变化，请重新选择跟进时间');
    if (Date.parse(request.dueAt) <= Date.now()) throw Error('请选择未来的跟进时间');
  }
}
