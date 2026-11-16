import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { nextDate } from '../../data/timeline';
import { Icon } from '../ui/Icon';
import './schedule-layout.css';

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 1 && parsed.toISOString().slice(0, 10) === value;
}

function usePicker() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [placement, setPlacement] = useState({ above: false, right: false });
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const anchor = root.current.getBoundingClientRect();
    const surface = root.current.closest('dialog')?.getBoundingClientRect();
    const panel = root.current.querySelector<HTMLElement>('[data-schedule-picker]');
    if (!panel) return;
    const bottom = Math.min(window.innerHeight, surface?.bottom ?? window.innerHeight) - 12;
    const top = Math.max(0, surface?.top ?? 0) + 12;
    const right = Math.min(window.innerWidth, surface?.right ?? window.innerWidth) - 12;
    setPlacement({ above: bottom - anchor.bottom < panel.offsetHeight + 8 && anchor.top - top > bottom - anchor.bottom, right: anchor.left + panel.offsetWidth > right });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => { setOpen(false); input.current?.focus(); };
  return { open, setOpen, root, input, id, close, placement: `${placement.above ? 'opens-above' : ''} ${placement.right ? 'align-right' : ''}` };
}

/** App-owned picker: Electron and browsers get the same calendar, with editable native fields. */
export function ScheduleDateField({ value, onChange, label, disabled = false, today }: {
  value: string; onChange: (date: string) => void; label: string; disabled?: boolean; today: string;
}) {
  const p = usePicker();
  const valid = validDate(value) ? value : validDate(today) ? today : new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(valid.slice(0, 7));
  const show = () => { setMonth(valid.slice(0, 7)); p.setOpen(true); };
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const dates = Array.from({ length: 42 }, (_, i) => { const day = new Date(first); day.setUTCDate(i - offset + 1); return day.getUTCFullYear() >= 1 && day.getUTCFullYear() <= 9999 ? day.toISOString().slice(0, 10) : null; });
  const shift = (by: number) => { const d = new Date(first); d.setUTCMonth(d.getUTCMonth() + by); if (d.getUTCFullYear() >= 1 && d.getUTCFullYear() <= 9999) setMonth(d.toISOString().slice(0, 7)); };
  const choose = (date: string) => { onChange(date); p.close(); };
  return <div ref={p.root} className={`qd-picker-field ${p.placement}`} onKeyDown={e => { if (e.key === 'Escape' && p.open) { e.preventDefault(); e.stopPropagation(); p.close(); } }}>
    <div className="qd-picker-control">
      <input ref={p.input} type="date" min="0001-01-01" max="9999-12-31" aria-label={label} value={value} required disabled={disabled} onChange={e => onChange(e.target.value)} onClick={e => { e.preventDefault(); show(); }}/>
      <button type="button" className="qd-icon-btn" aria-label={`打开${label}选择器`} aria-expanded={p.open} aria-controls={p.id} disabled={disabled} onClick={() => p.open ? p.close() : show()}><Icon name="calendar" size={16}/></button>
    </div>
    {p.open && <div id={p.id} className="qd-calendar-picker" data-schedule-picker role="group" aria-label={`${label}选择器`}>
      <div className="qd-calendar-month"><button type="button" className="qd-icon-btn" aria-label="上个月" disabled={month === '0001-01'} onClick={() => shift(-1)}><Icon name="chevron-left" size={16}/></button><strong aria-live="polite">{year} 年 {monthNumber} 月</strong><button type="button" className="qd-icon-btn" aria-label="下个月" disabled={month === '9999-12'} onClick={() => shift(1)}><Icon name="chevron-right" size={16}/></button></div>
      <div className="qd-calendar-days">{['一','二','三','四','五','六','日'].map(day => <span key={day} aria-hidden="true">{day}</span>)}{dates.map((date, index) => date ? <button type="button" key={date} aria-label={date} aria-pressed={date === value} className={`${date.slice(0,7) !== month ? 'is-outside' : ''} ${date === today ? 'is-today' : ''}`} onClick={() => choose(date)}>{Number(date.slice(-2))}</button> : <span key={`empty-${index}`}/>)}</div>
      <div className="qd-picker-shortcuts"><button type="button" onClick={() => choose(today)}>今天</button><button type="button" onClick={() => choose(nextDate(today, 1))}>明天</button><button type="button" onClick={p.close}>收起</button></div>
    </div>}
  </div>;
}

export function ScheduleTimeField({ value, onChange, label, disabled = false }: {
  value: string; onChange: (time: string) => void; label: string; disabled?: boolean;
}) {
  const p = usePicker();
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (p.open && selected.current?.parentElement) selected.current.parentElement.scrollTop = selected.current.offsetTop - 64; }, [p.open]);
  const nearest = Math.min(47, Math.floor((Number(value.slice(0,2)) * 60 + Number(value.slice(3,5))) / 30));
  return <div ref={p.root} className={`qd-picker-field ${p.placement}`} onKeyDown={e => { if (e.key === 'Escape' && p.open) { e.preventDefault(); e.stopPropagation(); p.close(); } }}>
    <div className="qd-picker-control">
      <input ref={p.input} type="time" aria-label={label} value={value} required disabled={disabled} onChange={e => onChange(e.target.value)} onClick={e => { e.preventDefault(); p.setOpen(true); }}/>
      <button type="button" className="qd-icon-btn" aria-label={`打开${label}选择器`} aria-expanded={p.open} aria-controls={p.id} disabled={disabled} onClick={() => p.open ? p.close() : p.setOpen(true)}><Icon name="clock" size={16}/></button>
    </div>
    {p.open && <div id={p.id} className="qd-time-picker" data-schedule-picker role="group" aria-label={`${label}选择器`}><p>选择时间，也可在输入框精确填写</p><div>{Array.from({ length: 48 }, (_, i) => { const time = `${String(Math.floor(i/2)).padStart(2,'0')}:${i%2 ? '30' : '00'}`; return <button key={time} ref={i === nearest ? selected : undefined} type="button" aria-pressed={time === value} onClick={() => { onChange(time); p.close(); }}>{time}</button>; })}</div><button type="button" className="qd-picker-done" onClick={p.close}>收起</button></div>}
  </div>;
}
