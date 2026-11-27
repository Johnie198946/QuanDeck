// Resolve calendar days in the device's local timezone. Only durations are elapsed milliseconds.
const HOUR = 3_600_000;
const RANGE_UNIT = /^\s*(?:分钟|小时|公斤|[个家件份本位人名次天周年月秒种条项张组套桶箱台层页册行款段笔场支只枝斤米克字点时折倍元块成篇章批辆户轮%]|kg\b|km\b)/i;
const DAYS: Record<string, number> = { 前天: -2, 昨天: -1, 昨日: -1, 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 };

function chineseNumber(text: string) {
  const digit = (char: string) => '〇一二三四五六七八九'.indexOf(char.replace('零', '〇').replace('两', '二'));
  if (!/[十百]/.test(text)) return [...text].map(digit).join('');
  let value = 0, current = 0;
  for (const char of text) {
    if (char === '十' || char === '百') {
      value += (current || 1) * (char === '十' ? 10 : 100);
      current = 0;
    } else current = digit(char);
  }
  return String(value + current);
}

export const normalizeTimeText = (text: string) => text.normalize('NFKC')
  .replace(/(?:周|星期|礼拜)[一二三四五六日天]/g, weekday => weekday + ' ')
  .replace(/([〇零一二两三四五六七八九十百]+)(?=\s*(?:个?(?:半)?(?:小时|钟头)|年|月|日|号|点|时|刻|分|天|周))/g, chineseNumber)
  .replace(/([点时])([〇零一二两三四五六七八九十]+)(?=前|后|整|完成|开会|交付|提交|截止|[，。\s]|$)/g, (_, unit, minute: string) => unit + chineseNumber(minute));

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function calendarDay(text: string, now: Date) {
  const absoluteDates = /(?<![\d./-])(?:(\d{4})\s*(?:年|[-/])\s*)?(\d{1,2})\s*(月|[-/])\s*(\d{1,2})(?![\d/-])(?:\s*([日号]))?/g;
  for (const match of text.matchAll(absoluteDates)) {
    const [, year, month, separator, day, suffix] = match;
    if (!year && separator !== '月' && !suffix) {
      const rest = text.slice(match.index! + match[0].length);
      // A bare number range followed by a unit is a count, duration, or time range.
      if (RANGE_UNIT.test(rest)) continue;
    }
    const result = new Date(year ? +year : now.getFullYear(), +month - 1, +day);
    if (result.getMonth() !== +month - 1 || result.getDate() !== +day) return null;
    if (!year && result < new Date(now.getFullYear(), now.getMonth(), now.getDate())) result.setFullYear(result.getFullYear() + 1);
    if (result.getMonth() === +month - 1 && result.getDate() === +day)
      return { date: result, cue: match[0].trim() };
    return null;
  }
  const monthDay = /(?<!\d)(本月|这个月|下个月|下月|上个月|上月)?(\d{1,2})\s*[号日]/.exec(text);
  if (monthDay) {
    const shift = monthDay[1]?.startsWith('下') ? 1 : monthDay[1]?.startsWith('上') ? -1 :
      !monthDay[1] && +monthDay[2] < now.getDate() ? 1 : 0;
    const date = new Date(now.getFullYear(), now.getMonth() + shift, +monthDay[2]);
    if (date.getDate() === +monthDay[2]) return { date, cue: monthDay[0] };
    return null;
  }
  const monthEnd = /(下个?月|本月|这个月|月)(?:底|末)/.exec(text);
  if (monthEnd) return { date: new Date(now.getFullYear(), now.getMonth() + (monthEnd[1].startsWith('下') ? 2 : 1), 0), cue: monthEnd[0] };
  const relative = /大后天|后天|明[天日]|今[天日]|昨[天日]|前天|[今明昨][早晚]/.exec(text);
  if (relative) {
    const cue = relative[0];
    const offset = DAYS[cue] ?? ({ 今: 0, 明: 1, 昨: -1 }[cue[0]] ?? 0);
    return { date: addDays(now, offset), cue };
  }
  const week = /(下下|上上|下|本|这|上)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天末1-7])/.exec(text);
  if (week) {
    const weekday = '一二三四五六日'.indexOf(week[2].replace('天', '日').replace('末', '六'));
    let offset = (weekday === -1 ? Number(week[2]) - 1 : weekday) - (now.getDay() + 6) % 7;
    if (week[1]) offset += ({ 下下: 2, 上上: -2, 下: 1, 本: 0, 这: 0, 上: -1 }[week[1]] ?? 0) * 7;
    else if (offset < 0) offset += 7;
    return { date: addDays(now, offset), cue: week[0] };
  }
  const later = /(\d+)\s*天(?:以?后|内)/.exec(text);
  if (later) {
    const date = addDays(now, +later[1]);
    if (Number.isFinite(date.getTime())) return { date, cue: later[0] };
  }
}

const PERIOD = '凌晨|午夜|半夜|清晨|早晨|早上|上午|一早|正午|午间|中午|午后|下午|傍晚|深夜|夜间|夜里|晚上|[今明昨][早晚]';
const MERIDIEM = '[ap]\\.?m\\.?(?![a-z])';
const CLOCK_PERIOD = PERIOD + '|(?<![最提])早|(?<![最迟])晚';
const hourAndMinutes = String.raw`(?::\s*(\d+)|(?:点钟?|时(?!间|候))\s*(?:(半|[13]刻钟?)|(\d+)(?:分(?:钟)?)?)?|(?!\d)(?=\s*${MERIDIEM}))`;
const clockPattern = new RegExp(
  String.raw`(?<![\d第])(?:(${CLOCK_PERIOD})\s*)?(?:(${MERIDIEM})\s*)?(\d{1,2})\s*${hourAndMinutes}\s*(${MERIDIEM})?` +
  '(?![子评心滴水]|建议|意见|要求|区别|原因|好处|问题|注意事项)', 'i'
);
const shortClockPattern = new RegExp(
  String.raw`(?:(${CLOCK_PERIOD})|(${MERIDIEM}))\s*(\d{1,2}|[〇零一二两三四五六七八九十]+)(?=\s*(?:$|[，。；,;]|前|整|完成|开会|提交|交付))`, 'i'
);
const periodPattern = new RegExp('(?:下班|收工)(?:[以之]?前)?|午休|午饭|午餐|' + PERIOD);

function clockTime(text: string) {
  // “下午 3” and “PM 3” may omit the clock unit at the end of a phrase.
  const clock = clockPattern.exec(text) ?? shortClockPattern.exec(text);
  if (clock) {
    const [, period = '', prefix, rawHour, mm, fraction, minutes, suffix] = clock;
    const h = /^\d+$/.test(rawHour) ? rawHour : chineseNumber(rawHour);
    let hour = +h;
    const minute = fraction ? (fraction === '半' ? 30 : parseInt(fraction) * 15) : Number(mm ?? minutes ?? 0);
    if ((mm ?? minutes ?? '').length > 2 || hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
    const meridiem = (suffix || prefix)?.[0].toLowerCase();
    const evening = /深夜|夜里|夜间|晚/.test(period);
    const morning = /早|清晨|上午/.test(period);
    if (morning && hour > 12) return null;
    let alternateHour: number | undefined;
    if (meridiem) {
      if (hour < 1 || hour > 12 || (prefix && suffix && prefix[0].toLowerCase() !== suffix[0].toLowerCase())) return null;
      hour = hour % 12 + (meridiem === 'p' ? 12 : 0);
    } else if (evening && (hour === 12 || hour === 0)) {
      hour = 24; // Monday night at twelve is the start of Tuesday.
    } else if (evening && hour >= 1 && hour <= 4) {
      // “周一夜里两点” can refer to the beginning of Monday or the following night.
      alternateHour = hour;
      hour += 24;
    } else if (evening || /下午|午后/.test(period) || (/中午|正午|午间/.test(period) && hour < 11)) {
      if (hour < 12) hour += 12;
    } else if (/凌晨|午夜|半夜/.test(period) && hour === 12) {
      hour = 0;
    } else if (morning && hour === 12) {
      alternateHour = 0; // “上午十二点” is used for both noon and the start of the day.
    }
    return { hour, minute, alternateHour, ambiguous: !period && !meridiem && mm === undefined && hour > 0 && hour < 12, cue: clock[0].trim() };
  }
  // An unfinished digital clock must not degrade to a period-only or date-only deadline.
  if (/(?<![\d:])\d+\s*[:：]/.test(text)) return null;
  const period = periodPattern.exec(text);
  if (period) {
    const cue = period[0];
    const hour = /下班|收工|傍晚/.test(cue) ? 18 : /午休|中午|正午|午间|午饭|午餐/.test(cue) ? 12 : /下午|午后/.test(cue) ? 15 :
      /晚|夜间|夜里|深夜/.test(cue) ? 20 : /午夜|凌晨|半夜/.test(cue) ? 0 : 9;
    return { hour, minute: 0, cue };
  }
}

interface NoteTodoTime {
  dueAt: string;
  cue: string;
  dateOnly?: boolean;
  clockOnly?: true;
  alternativeDueAt?: string;
  invalid?: true;
}

export function noteTodoTime(input: string, now: Date): NoteTodoTime {
  const normalized = normalizeTimeText(input.replace(/https?:\/\/[^\s，。；！？]+/gi, ' '));
  const clauses = normalized.split(/[，,。；;！？!?\n]/);
  const deadline = clauses.find(clause => /截止|最迟|最晚|不晚于|(?:下班|[点时分半刻日号天0-9])\s*(?:[以之]前|前(?!往))/.test(clause));
  const text = deadline ?? normalized;
  const duration = /(?:(\d+(?:\.\d+)?)\s*(?:个)?(半)?\s*(小时|钟头|分钟)|半\s*(?:个)?\s*(小时|钟头))\s*(?:之?内|[以之]?后)/.exec(text);
  if (duration) {
    const count = duration[1] ? Number(duration[1]) + (duration[2] ? 0.5 : 0) : 0.5;
    const milliseconds = count * (duration[3] === '分钟' ? 60_000 : HOUR);
    const date = new Date(now.getTime() + milliseconds);
    if (Number.isFinite(date.getTime())) return { dueAt: date.toISOString(), cue: duration[0] };
  }
  const localDay = calendarDay(text, now);
  const day = localDay === undefined && deadline ? calendarDay(normalized, now) : localDay;
  const clock = clockTime(text);
  if (day === null || clock === null) return { dueAt: new Date(now.getTime() + 8 * HOUR).toISOString(), cue:'', invalid:true };
  if (!day && !clock) return { dueAt: new Date(now.getTime() + 8 * HOUR).toISOString(), cue: '' };
  const anchor = day?.date ?? now;
  const result = new Date(anchor);
  // A date without an hour stays available until the end of that local day.
  result.setHours(clock?.hour ?? 23, clock?.minute ?? 59, 0, 0);
  if (clock?.ambiguous && (day ? clock.hour < 7 : result < now)) result.setHours(clock.hour + 12);
  if (!day && result < now) {
    result.setDate(result.getDate() + 1);
    if (clock?.ambiguous) result.setHours(clock.hour);
  }
  let alternativeDueAt: string | undefined;
  if (clock?.alternateHour !== undefined) {
    const other = new Date(anchor);
    other.setHours(clock.alternateHour,clock.minute,0,0);
    if (!day && other < now) other.setDate(other.getDate()+1);
    alternativeDueAt = other.toISOString();
  }
  return { dueAt: result.toISOString(), dateOnly: !!day && !clock, ...(!day && clock && {clockOnly:true as const}), alternativeDueAt, cue: [day?.cue, clock?.cue].filter(Boolean).join('|') };
}

export function resolveNoteTodoDue(text: string, now = new Date()): string {
  return noteTodoTime(text, now).dueAt;
}
