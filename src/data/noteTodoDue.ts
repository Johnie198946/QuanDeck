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

const normalize = (text: string) => text.normalize('NFKC')
  .replace(/(?:周|星期|礼拜)[一二三四五六日天]/g, weekday => weekday + ' ')
  .replace(/([〇零一二两三四五六七八九十百]+)(?=\s*(?:个?(?:半)?(?:小时|钟头)|年|月|日|号|点|时|刻|分|天|周))/g, chineseNumber)
  .replace(/([点时])([〇零一二两三四五六七八九十]+)(?=前|后|整|[，。\s]|$)/g, (_, unit, minute: string) => unit + chineseNumber(minute));

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
    if (!year && result < new Date(now.getFullYear(), now.getMonth(), now.getDate())) result.setFullYear(result.getFullYear() + 1);
    if (result.getMonth() === +month - 1 && result.getDate() === +day)
      return { date: result, cue: match[0].trim() };
  }
  const monthDay = /(本月|这个月|下个月|下月|上月)?(\d{1,2})\s*号/.exec(text);
  if (monthDay) {
    const shift = monthDay[1]?.startsWith('下') ? 1 : monthDay[1] === '上月' ? -1 :
      !monthDay[1] && +monthDay[2] < now.getDate() ? 1 : 0;
    const date = new Date(now.getFullYear(), now.getMonth() + shift, +monthDay[2]);
    if (date.getDate() === +monthDay[2]) return { date, cue: monthDay[0] };
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

function clockTime(text: string) {
  const clock = /(?<![\d第])(?:(凌晨|午夜|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜间|[今明昨][早晚])\s*)?(\d{1,2})\s*(?:(:)(\d{2})(?!\d)|(?:点钟?|时(?!间|候))\s*(?:(半|[13]刻钟?)|(\d{1,2})(?:分(?:钟)?)?)?)(?![子评心滴水]|建议|意见|要求|区别|原因|好处|问题|注意事项)/i.exec(text);
  if (clock) {
    const [, period, h, colon, mm, fraction, minutes] = clock;
    let hour = +h;
    const minute = fraction ? (fraction === '半' ? 30 : parseInt(fraction) * 15) : Number(mm ?? minutes ?? 0);
    if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return;
    if (period && /下午|傍晚|晚|夜间/.test(period) && hour < 12) hour += 12;
    if (period === '中午' && hour < 11) hour += 12;
    if (period && /凌晨|午夜|早|上午/.test(period) && hour === 12) hour = 0;
    return { hour, minute, ambiguous: !period && !colon && hour > 0 && hour < 12, cue: clock[0].trim() };
  }
  const period = /下班(?:以?前)?|午休|中午|午饭|午餐|午夜|凌晨|清晨|上午|早上|早晨|下午|傍晚|晚上|夜间|[今明昨][早晚]/.exec(text);
  if (period) {
    const cue = period[0];
    const hour = /下班|傍晚/.test(cue) ? 18 : /午休|中午|午饭|午餐/.test(cue) ? 12 : /下午/.test(cue) ? 15 :
      /晚|夜间/.test(cue) ? 20 : /午夜|凌晨/.test(cue) ? 0 : 9;
    return { hour, minute: 0, ambiguous: false, cue };
  }
}

export function noteTodoTime(input: string, now: Date) {
  const normalized = normalize(input.replace(/https?:\/\/[^\s，。；！？]+/gi, ' '));
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
  const day = calendarDay(text, now) ?? (deadline ? calendarDay(normalized, now) : undefined);
  const clock = clockTime(text);
  if (!day && !clock) return { dueAt: new Date(now.getTime() + 8 * HOUR).toISOString(), cue: '' };
  const result = new Date(day?.date ?? now);
  // A date without an hour stays available until the end of that local day.
  result.setHours(clock?.hour ?? 23, clock?.minute ?? 59, 0, 0);
  if (clock?.ambiguous && (day ? clock.hour < 7 : result < now)) result.setHours(clock.hour + 12);
  if (!day && result < now) {
    result.setDate(result.getDate() + 1);
    if (clock?.ambiguous) result.setHours(clock.hour);
  }
  return { dueAt: result.toISOString(), cue: [day?.cue, clock?.cue].filter(Boolean).join('|') };
}

export function resolveNoteTodoDue(text: string, now = new Date()): string {
  return noteTodoTime(text, now).dueAt;
}
