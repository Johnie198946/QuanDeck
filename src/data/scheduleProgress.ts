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
  correctsProgressId?: string;
}

export function isScheduleProgress(value: unknown): value is ScheduleProgress {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ScheduleProgress>;
  return typeof entry.id === 'string' && !!entry.id && typeof entry.at === 'string' &&
    Number.isFinite(Date.parse(entry.at)) && typeof entry.text === 'string' && !!entry.text.trim() &&
    (entry.scheduledFor === undefined || typeof entry.scheduledFor === 'string' && Number.isFinite(Date.parse(entry.scheduledFor))) &&
    (entry.keptTime === undefined || entry.keptTime === true) &&
    (entry.correctsProgressId === undefined || typeof entry.correctsProgressId === 'string');
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

// Keep the author's scheduling decision separate from the calendar/clock parser.
// Bare mentions of times in a progress report never imply permission to move the task.
export type ProgressTimeIntent =
  | {kind:'none'}
  | {kind:'move'; dueAt:string}
  | {kind:'clarify'; reason:string; choices:{label:string; dueAt:string}[]};

const noMove: ProgressTimeIntent = {kind:'none'};
const moveWord = /(?:改期|(?:重新|另行)安排|调整时间|调整日期|调整|改时间|改日程|挪动|推迟|推后|推延|延迟|顺延|后延|延后|延期|提前)(?:一下)?(?:安排)?(?:到|至|为|在|成)?|(?:改|调|移|挪|换|延|推)(?:到|至|为|在|成)|(?:往|向)(?:前提|前挪|前移|后推|后延|后移|后挪)|(?:定|放|排|安排)(?:在|到)|(?:截止(?:时间|日期)?|交付时间|交付日期|交稿时间)(?:定为|设为|调整为|是)/gu;
const durationMove = /^(?:推迟|推后|推延|延迟|顺延|后延|延后|延期|提前|[往向](?:前提|前挪|前移|后推|后延|后移|后挪))$/;
const followAction = /(?:再|继续)(?:催|问|确认|联系|跟进)|跟进时间|提醒我|催一下/;
const clockToken = /(?<!\d)\d{1,2}\s*(?::\d{2}|点(?!子|评|心|建议|要求)|时(?!间|候))/g;
const dayToken = /(?:[下本这上]+)?(?:个)?(?:周|星期|礼拜)[一二三四五六日天末1-7]|大后天|后天|明[天日早晚]|今[天日早晚]|昨[天日早晚]|前天|(?:\d{4}[-/年]\s*)?\d{1,2}\s*[-/月]\s*\d{1,2}[号日]?/g;
const displayTime = new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function clarify(reason:string, times:string[]=[], namePeriods = false):ProgressTimeIntent {
  const choices = [...new Set(times)].map(dueAt=>{
    const date = new Date(dueAt);
    const period = namePeriods ? (date.getHours() === 0 ? '（凌晨）' : '（中午）') : '';
    return {label:displayTime.format(date) + period,dueAt};
  });
  return {kind:'clarify',reason,choices};
}
function futureTime(target:Date, now:Date):ProgressTimeIntent {
  return Number.isFinite(+target) && +target > +now ? {kind:'move',dueAt:target.toISOString()} :
    clarify('这个时间已经过去或无效，请选择新的截止时间。');
}

// Durations bound to “延期/提前” are relative to the existing appointment.
// Days and weeks follow the local calendar, minutes and hours are elapsed time.
function shiftedDeadline(word:string, clause:string, now:Date, deadline?:number):ProgressTimeIntent | undefined {
  if (!durationMove.test(word)) return;
  const normalized = normalizeTimeText(clause);
  const piece = /^(?:\s*(\d+(?:\.\d+)?)\s*个?(半)?|\s*(半)个?)\s*(小时|钟头|分钟|刻钟|天|周)(?![以后内])/u.exec(normalized);
  if (!piece) return;
  const rest = normalized.slice(piece[0].length).trim();
  if (deadline === undefined || (rest && !/^(?:吧|了|再做|处理|完成|交付|提交|再交)$/.test(rest)))
    return clarify('请确认调整后的截止时间。');
  const magnitude = Number(piece[1] || 0) + (piece[2] || piece[3] ? 0.5 : 0);
  const delta = magnitude * (/提前|前提|前挪|前移/.test(word) ? -1 : 1);
  const date = new Date(deadline), unit = piece[4];
  if (unit === '天' || unit === '周') {
    if (!Number.isInteger(delta)) return clarify('请确认调整后的日期和时间。');
    date.setDate(date.getDate() + delta * (unit === '周' ? 7 : 1));
  } else date.setTime(+date + delta * (unit === '分钟' ? 60_000 : unit === '刻钟' ? 900_000 : 3_600_000));
  return futureTime(date,now);
}

function conflictingDates(text:string,now:Date) {
  const tokens = text.match(dayToken) ?? [];
  if (tokens.length < 2) return false;
  const bareWeekday = /^(?:周|星期|礼拜)[一二三四五六日天末1-7]$/;
  const anchor = noteTodoTime(tokens.find(token=>!bareWeekday.test(token)) ?? tokens[0]!,now);
  const anchorDay = new Date(anchor.dueAt);
  return tokens.some(token=>{
    const parsed = noteTodoTime(token,now);
    if (!anchor.cue || anchor.invalid || !parsed.cue || parsed.invalid) return true;
    const date = new Date(parsed.dueAt);
    return bareWeekday.test(token) ? date.getDay() !== anchorDay.getDay() : date.toDateString() !== anchorDay.toDateString();
  });
}

function targetTime(expression:string, now:Date, deadline?:number):ProgressTimeIntent {
  const normalized = normalizeTimeText(expression);
  if ((normalized.match(clockToken)?.length ?? 0) > 1 || conflictingDates(normalized,now) ||
      /(?:[点时分号天]|\d:\d\d)\s*[-~～至到]\s*\d|左右|前后|有空|另行通知|待定|再定|[之以]间/.test(normalized))
    return clarify('这段话没有唯一的截止时间，请选定时间。');
  let parsed = noteTodoTime(expression,now);
  if (!parsed.cue || parsed.invalid) return clarify('请确认新的日期和时间。');
  if (parsed.clockOnly) {
    // Inherit the date only for a genuine clock edit. Calendar windows and
    // event-relative days may leave a clock as the sole *recognized* token.
    const clockIndex = normalized.indexOf(parsed.cue);
    const prefix = normalized.slice(0,clockIndex).trim();
    const suffix = normalized.slice(clockIndex + parsed.cue.length);
    if (!/^(?:(?:我(?:们|这边)?|就|定在|在|于|最迟|最晚|具体|大约|之前的)\s*)*$/.test(prefix) ||
        /下[个周月年]|本[周月年]|月底|月初|节[前后]|假[期日]|次日|当天|过后|结束后|\b(?:next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(suffix))
      return clarify('已识别时刻，请再确定具体是哪一天。');
  }
  if (parsed.clockOnly && deadline !== undefined) {
    // On a future appointment “改到十点” edits that appointment's clock.
    // Overdue appointments use today's clock, just like the calendar's carried-over row.
    const day = new Date(Math.max(deadline,+now));
    day.setHours(0,0,0,0);
    parsed = noteTodoTime(expression,day);
  }
  if (parsed.alternativeDueAt) {
    const options = [parsed.dueAt,parsed.alternativeDueAt].filter(value=>Date.parse(value)>+now);
    const sameDay = new Date(parsed.dueAt).toDateString() === new Date(parsed.alternativeDueAt).toDateString();
    return sameDay ? clarify('这里的“12点”可能指中午或凌晨，请选一个。',options,true) :
      clarify('这个夜间时刻可能跨日，请确认是哪一天。',options);
  }
  const target = new Date(parsed.dueAt);
  if (parsed.dateOnly && deadline !== undefined) {
    const original = new Date(deadline);
    target.setHours(original.getHours(),original.getMinutes(),0,0);
  }
  return futureTime(target,now);
}

// With no move verb a future commitment is a suggestion; the user must confirm
// whether it changes this task or is simply part of their progress report.
function commitmentIntent(statement:string,now:Date,deadline?:number):ProgressTimeIntent {
  if (/昨天|昨日|刚[才刚]|已|[等让请](?:对方|他|她|他们|她们)|跟进|再确认|取消/.test(statement)) return noMove;
  const clauses = statement.split(/[,;。!\n]/).map(part=>part.trim()).filter(Boolean);
  const final = clauses.at(-1);
  if (!final || /[他她]|对方|预计|可能|大概|[没未不]/.test(final)) return noMove;
  const at = /^(?:我(?:们|这边)?(?:打算|计划|会|要|将)?\s*)?(?:最迟|最晚|在|于)?\s*(?:[今明后]|大后天|下|本|这|周|星期|礼拜|凌晨|清晨|早上|上午|中午|下午|晚上|傍晚|\d|[一二两三四五六七八九十]+[点时月])/;
  if (!at.test(final) || !/(?:前|之前|以前)?(?:完成|提交|交付|交稿|交材料|交报告|交)(?:吧|了|给你)?$/.test(final)) return noMove;
  if (!noteTodoTime(final,now).cue) return noMove;
  const intent = targetTime(final,now,deadline);
  return intent.kind === 'move' ? clarify('要把这次承诺的时间设为截止时间吗？',[intent.dueAt]) : intent;
}

export function progressTimeIntent(text:string, now:Date, deadline?:number):ProgressTimeIntent {
  let statement = text.normalize('NFKC').trim();
  if (!statement || /[?？]|是否|能否|要不要|能不能|如果|假如|考虑|建议|要不|再决定|暂不|取消改期|改期取消|按原(?:计划|时间)|维持原|照旧/.test(statement) ||
      /对方说|[他她]说|听说|[“「『"]/.test(statement)) return noMove;
  // Only a clearly signalled self-correction can supersede an earlier instruction.
  const correction = /[,;。\n]\s*(?:不对|更正(?:一下)?|说错了|最后确定|最终确定)(?:[,:，：]\s*)?/gu;
  const lastCorrection = [...statement.matchAll(correction)].at(-1);
  if (lastCorrection && statement.slice(0,lastCorrection.index).match(moveWord)) {
    const replacement = statement.slice(lastCorrection.index! + lastCorrection[0].length).trim();
    statement = [...replacement.matchAll(moveWord)].length ? replacement : '改到' + replacement;
  }
  if (/(?:别|不|没)(?:要|必|用|会|打算|需要)?(?:再)?(?:改|推迟|延|提前|调整|挪|移|顺延|调|往|安排)/.test(statement)) return noMove;
  if (/(?:日程|事项|安排|计划|任务|日期|时间)(?:仍然?|暂时|保持|继续|还是)?不变|(?:尚未|还没|未能)(?:最终)?(?:确认|确定)/.test(statement)) return noMove;
  const changes = [...statement.matchAll(moveWord)];
  if (changes.length > 1) return clarify('写到了多次调整，请确认最终时间。');
  const change = changes[0];
  if (!change) return commitmentIntent(statement,now,deadline);
  const lead = statement.slice(0,change.index).split(/[,;。!\n]/).at(-1) ?? '';
  if (/可能|也许|说不定|大概|商量|提议/.test(lead)) return noMove;
  // Scope refusal to the change verb, so “今天不能完成，改到明天” still works.
  if (/(?:不能|无法|没法|不可以|没办法|不允许|不方便|不得|不要|不想|不打算|不准备|不需要|不必|不应(?:该)?|不该|\b(?:cannot|can['’]t|do not|don['’]t))\s*(?:(?:再|直接|随便|擅自|真的|临时|先|轻易)\s*)*(?:把[^,;。!\n]{1,24})?$/.test(lead.toLowerCase())) return noMove;
  if (/^(?:改|换|调)(?:为|成)$/.test(change[0]) && /(?:标题|图标|文案|颜色|措辞|备注|正文|口号)\s*$/.test(lead)) return noMove;
  const oldPlan = /原先|昨天|原定|原本|原来|原打算|原计划|当时/.test(lead);
  if (oldPlan && !/(?:现在|实际|决定|最终|确定|从原|由原)/.test(lead)) return noMove;
  const tail = statement.slice(change.index! + change[0].length);
  if (/或|二选一|任选|也可以|也行|也可/.test(tail)) {
    const alternatives = tail.split(/或(?:者)?/).map(item=>item.trim());
    const parsed = alternatives.map(item=>noteTodoTime(item,now));
    // Only offer independently resolvable alternatives. “周一或周二下午” can
    // share the afternoon qualifier, so let the author supply its final clock.
    const comparable = alternatives.length === 2 && parsed.every(item=>item.cue && !item.invalid &&
      item.dateOnly === parsed[0].dateOnly && item.clockOnly === parsed[0].clockOnly);
    const candidates = comparable ? alternatives.map(item=>targetTime(item,now,deadline)) : [];
    return clarify('有多个备选时间，请选择本次截止时间。',
      candidates.every(item=>item.kind === 'move') ? candidates.flatMap(item=>item.kind === 'move' ? [item.dueAt] : []) : []);
  }
  const [raw, next] = tail.split(/[,;。!\n]/);
  let clause = raw.trim();
  // “改到周一，下午三点交” splits the date and time without changing the task.
  if (next && /^\s*(?:凌晨|午夜|早上|上午|中午|下午|傍晚|晚上|[0-9一二三四五六七八九十两]+[点时:])/.test(next) &&
      !/已经|刚刚|已于|[再已](?:确认|联系|催|问|发|跟进)/.test(next) && noteTodoTime(clause,now).dateOnly)
    clause += ' ' + next;
  if (followAction.test(clause) || /看看能否|可能|也许/.test(clause)) return noMove;
  if (/^(?:提前|延后)$/.test(change[0]) && /^(?:准备|寄存|预订|订购|核对|通知|联系|查阅|确认)/.test(clause)) return noMove;
  const shifted = shiftedDeadline(change[0],clause,now,deadline);
  if (shifted) return shifted;
  // “图标改成绿色” and “安排在会议室” are ordinary progress, not incomplete deadlines.
  const target = noteTodoTime(clause,now);
  if (!target.cue && !target.invalid) {
    // “可提前寄存行李” reports availability, while “这项延期” is an
    // unfinished scheduling instruction and should still offer a date field.
    if (durationMove.test(change[0]) && clause && !/^(?:一下|些|一点|一会儿?|了|吧|待定|再定|几[天周分钟小时])$/.test(clause)) return noMove;
    if (!/(?:改期|推[迟后延]|延[迟期后]|提前|顺延|截止|时间|改到)/.test(change[0])) return noMove;
  }
  return targetTime(clause,now,deadline);
}

/** Legacy callers can apply only an unambiguous future deadline. */
export function progressReschedule(text:string, now:Date, deadline?:number) {
  const intent = progressTimeIntent(text,now,deadline);
  return intent.kind === 'move' ? intent.dueAt : undefined;
}
export type ProgressMove = {dueAt: string; expectedAt: number; fromSaved?: true; correctsProgressId?: string};
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


export function checkProgressCorrection(history: ScheduleProgress[] | undefined, move: ProgressMove, currentDeadline: number, id: string) {
  if (move.correctsProgressId === undefined) return;
  const saved = history?.find(row => row.id === id);
  if (saved) {
    if (saved.correctsProgressId !== move.correctsProgressId || saved.scheduledFor !== move.dueAt)
      throw Error('这次更正已保存，请查看最新时间');
    return;
  }
  const latest = history?.at(-1);
  if (!latest?.scheduledFor || latest.id !== move.correctsProgressId || Date.parse(latest.scheduledFor) !== currentDeadline)
    throw Error('这条日程已有新进展或新时间，请核对后再更正');
}
