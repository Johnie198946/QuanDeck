import { dayBounds, timeInZone } from '../../data/timeline';

export function ganttDayAxis(date: string, zone: string) {
  const [start, end] = dayBounds(date, zone);
  const hours: number[] = [];
  for (let at = start; at < end; at += 3600000) hours.push(at);
  return { start, end, hours, zone, position: (at: number) => (at - start) / (end - start) * 100 };
}
type Axis = ReturnType<typeof ganttDayAxis>;

export function DayAxisHeader({axis, now}: {axis: Axis; now: number}) {
  return <div className="qht-day-header">{axis.hours.map((time, index) =>
    <time key={time} dateTime={new Date(time).toISOString()} style={{left:axis.position(time)+'%'}} title={timeInZone(time,axis.zone)}>
      {index % 3 === 0 && timeInZone(time,axis.zone)}
    </time>)}
    {now >= axis.start && now < axis.end && <span className="qht-now" style={{left:axis.position(now)+'%'}}>现在</span>}
  </div>;
}

type BandType = 'planned' | 'window' | 'deadline' | 'calendar';
interface BandProps {
  type: BandType; left: number; right: number; text: string; description: string;
  state?: string; onOpen?: () => void; action?: string;
}

/** Percentages describe the real interval. Text for a narrow band sits next to it without lengthening the bar. */
export function GanttBand({type, left, right, text, description, state, onOpen, action}: BandProps) {
  if (right < 0 || left > 100 || (right <= 0 || left >= 100) && right !== left) return null;
  const begin = Math.max(0, left), end = Math.min(100, right);
  const instant = right === left;
  const tight = !instant && end - begin < 12;
  const content = <span className="qgt-band-text">{text}</span>;
  const props = {
    className: 'qgt-band', 'data-type':type, 'data-state':state, 'data-instant':instant || undefined,
    'data-tight':tight || undefined, 'data-align-end':(instant ? end >= 50 : tight && end > 83) || undefined,
    'data-cut-left':left < 0 || undefined, 'data-cut-right':right > 100 || undefined,
    style: {left:begin+'%', width:instant ? undefined : (end-begin)+'%'},
    title:description,
  };
  return onOpen
    ? <button {...props} type="button" aria-label={action || description} onClick={onOpen}>{content}</button>
    : <span {...props} aria-label={description}>{content}</span>;
}

export function DayTrack({axis, at, until, availableAt, state, dateOnly, defaultDeadline, now, onOpen, title, originalAt, closed}: {
  axis: Axis; at?: number; until?: number; availableAt?: number; state?: string; dateOnly?: string; closed?: boolean;
  now: number; onOpen?: () => void; title?: string; originalAt?: number; defaultDeadline?: boolean;
}) {
  const scheduled = at !== undefined && until !== undefined && until > at;
  const available = at !== undefined && availableAt !== undefined && availableAt < at && !scheduled;
  const start = available ? availableAt! : at;
  const end = scheduled ? until! : at;
  const time = (t: number) => timeInZone(t,axis.zone);
  const range = at === undefined ? '' : scheduled ? time(at)+' – '+(until! >= axis.end ? '24:00' : time(until!)) : time(at);
  const label = scheduled ? range : (closed ? '完成 ' : '截止 ')+range;
  const detail = available ? (closed ? '从创建到实际完成' : '可办窗口从记录创建到本次截止') : scheduled ? '已排时段' : closed ? '实际完成' : '仅有截止时间';
  const original = originalAt !== undefined ? '，原定 '+new Date(originalAt).toLocaleString('zh-CN',{timeZone:axis.zone}) : '';
  return <span className="qhg-track qht-day-track">
    {now >= axis.start && now < axis.end && <i className="qhg-today" aria-hidden="true" style={{left:axis.position(now)+'%'}}/>}
    {start !== undefined && end !== undefined && <GanttBand type={scheduled?'planned':available?'window':'deadline'}
      left={axis.position(start)} right={axis.position(end)} text={label} description={title+' · '+detail+' · '+label+original}
      action={'打开日程 '+title+' '+range} state={state} onOpen={onOpen}/>}
    {defaultDeadline && <GanttBand type="deadline" left={100} right={100} text="默认截止 24:00" state={state} onOpen={onOpen}
      description={title+' · 未设截止日期，默认创建当天 24:00 截止'}/>}
    {dateOnly && <GanttBand type="calendar" left={0} right={100} text={dateOnly} state={state} onOpen={onOpen}
      description={title+' · '+dateOnly} />}
  </span>;
}
