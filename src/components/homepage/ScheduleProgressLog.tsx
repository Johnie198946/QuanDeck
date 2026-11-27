import { useId, useRef, useState, type ReactNode } from 'react';
import { progressReschedule, type ProgressMove, followupRequest, type ScheduleProgress, type FollowupRequest } from '../../data/scheduleProgress';
import type { AgendaEntry } from '../../data/agendaSchedule';
import { hasOutcomeDraft } from '../../data/scheduleOutcomeDraft';
import { Icon } from '../ui/Icon';

function localMinute(iso: string) {
  const date = new Date(iso);
  return new Date(+date - date.getTimezoneOffset()*60_000).toISOString().slice(0,16);
}
const stamp = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const draftKey = (key: string) => 'quandeck.agenda-progress-draft.v1.' + key;
type Draft = {id: string; text: string; date: string; writtenAt?: number; override?: string};
export function progressDraft(key: string): Draft | undefined {
  try {
    const data = JSON.parse(localStorage.getItem(draftKey(key)) ?? 'null');
    if (data && typeof data.id === 'string' && typeof data.text === 'string' && typeof data.date === 'string' && data.text) return data;
  } catch { /* The current editor remains available when storage cannot be read. */ }
}

export function clearProgressDraft(key: string, id: string) {
  if (progressDraft(key)?.id === id) localStorage.removeItem(draftKey(key));
}

export function ScheduleProgressLog({ entryKey, date, records = [], children, open, submit, follow, dueAt, deadline = dueAt, done, renderResult }: {
  entryKey: string; date: string; records?: ScheduleProgress[]; children: AgendaEntry[];
  open: (entry: AgendaEntry) => void;
  dueAt: number; deadline?: number; done: boolean;
  renderResult: (close: () => void, finish: () => void) => ReactNode;
  submit: (id: string, text: string, move?: ProgressMove) => Promise<void>;
  follow: (request: FollowupRequest) => Promise<void>;
}) {
  const formId = useId(), historyId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const completionDraft = hasOutcomeDraft(entryKey);
  const [initial] = useState(() => progressDraft(entryKey));
  const requestId = useRef(initial?.id);
  const [editing, setEditing] = useState(!!initial), [history, setHistory] = useState(false);
  const [text, setText] = useState(initial?.text ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false);
  const latest = records.at(-1);
  const [closing,setClosing] = useState(!!initial && completionDraft);
  const [changedAt,setChangedAt] = useState(() => new Date(initial?.writtenAt ?? Date.now()));
  const [override,setOverride] = useState<string | undefined>(initial?.override);
  const [planning,setPlanning] = useState<{request: FollowupRequest; previous?: ScheduleProgress; kind:'follow'|'move'}>();
  const proposed = done ? undefined : progressReschedule(text, changedAt, deadline);
  const moving = override === 'skip' || done ? undefined : override || proposed;
  function hideResult() {
    setClosing(false);
  }
  function finish() {
    hideResult(); setText(''); setEditing(false); requestId.current = undefined;
  }

  function chooseTime(value?: string) {
    setOverride(value);
    const draft = progressDraft(entryKey);
    if (draft) try { localStorage.setItem(draftKey(entryKey),JSON.stringify({...draft, override:value})); }
    catch { setError('改期选择未能暂存。'); }
  }
  function change(value: string) {
    requestId.current = crypto.randomUUID();
    setText(value); setError(''); setPlanning(undefined); setChangedAt(new Date()); setOverride(undefined);
    try {
      if (value) localStorage.setItem(draftKey(entryKey), JSON.stringify({id:requestId.current,text:value,date,writtenAt:Date.now()}));
      else localStorage.removeItem(draftKey(entryKey));
    } catch { setError('本机未能暂存草稿，请先保存进展再离开。'); }
  }
  async function save(usePreview = false) {
    const preview = usePreview ? planning : undefined;
    const previous = preview?.previous;
    const value = previous?.text ?? text.trim();
    if (locked.current || !value || (usePreview && !preview)) return;
    locked.current = true; setBusy(true); setError('');
    const id = preview?.request.id ?? (requestId.current ??= crypto.randomUUID());
    try {
      if (preview?.kind === 'follow') await follow(preview.request);
      else {
        const target = preview?.request.dueAt ?? moving;
        await submit(id, value, target ? {dueAt:target,expectedAt:preview?.request.expectedAt ?? dueAt,...(previous && {fromSaved:true})} : undefined);
      }
      setPlanning(undefined);
      if (!previous) {
        if (progressDraft(entryKey)?.id === id) localStorage.removeItem(draftKey(entryKey));
        setText(''); setEditing(false); requestId.current = undefined; trigger.current?.focus();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '进展未能保存，请重试'); }
    finally { locked.current = false; setBusy(false); }
  }
  function followButton(record?: ScheduleProgress) {
    const linked = record && children.find(child => child.progressId === record.id);
    const value = record?.text ?? text.trim();
    if (!value || (!record && (moving || closing))) return null;
    if (linked) return <><button type="button" className="qh-progress-link" onClick={() => open(linked)}>
      <Icon name="link" size={12}/>{linked.done ? '跟进已完成' : '查看跟进'}</button>
      {!linked.done && !done && linked.linkedId && record && <button type="button" className="qh-progress-link" disabled={busy} onClick={() => {
        setError('');
        setPlanning({kind:'follow',previous:record,request:{id:record.id,text:record.text,title:linked.title,
          dueAt:new Date(linked.at).toISOString(),expectedAt:dueAt,existing:{id:linked.linkedId!, expectedAt:linked.at}}});
      }}>调整跟进</button>}</>;
    if (record?.scheduledFor) return <span className="qh-progress-applied">已改至 {stamp.format(new Date(record.scheduledFor))}</span>;
    if (done) return null;
    const writtenAt = record ? new Date(record.at) : changedAt;
    const legacyMove = record && progressReschedule(value, writtenAt, deadline);
    if (legacyMove && (record?.keptTime || record?.id !== latest?.id || Date.parse(legacyMove) <= Date.now() || Date.parse(legacyMove) === deadline)) return null;
    return <button type="button" className="qh-progress-link" disabled={busy} onClick={() => {
      const id = record?.id ?? (requestId.current ??= crypto.randomUUID());
      const request = followupRequest(id,value,new Date(),dueAt,writtenAt);
      setError('');
      setPlanning({request:legacyMove ? {...request, dueAt:legacyMove} : request, previous:record,kind:legacyMove ? 'move':'follow'});
    }}><Icon name="calendar" size={12}/>{legacyMove ? '应用改期' : '待跟进'}</button>;
  }

  return <div className="qh-log">
    {latest && !history && <div className="qh-log-latest">
      <time dateTime={latest.at}>{stamp.format(new Date(latest.at))}</time>
      <p title={latest.text}>{latest.text}</p>{followButton(latest)}
    </div>}
    <div className="qh-log-actions">
      <button type="button" ref={trigger} aria-controls={formId} aria-expanded={editing} onClick={() => { setPlanning(undefined); setEditing(!editing); if (!editing && completionDraft) setClosing(true); }}>
        <Icon name="pencil" size={12}/>{completionDraft && !editing ? '继续写结果' : '写进展'}
      </button>
      {latest && <button type="button" aria-controls={historyId} aria-expanded={history} onClick={() => setHistory(!history)}>
        全部 {records.length} 条<Icon name="chevron-down" size={12}/>
      </button>}
    </div>
    {editing && <><form id={formId} className="qh-log-form" onSubmit={event => { event.preventDefault(); if (!closing) void save(false); }}>
      <textarea autoFocus={!initial} aria-label="进展内容" placeholder="写下做到哪了，或下一步要做什么…" maxLength={2000}
        rows={2} value={text} disabled={busy} onChange={event => change(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault(); if (!closing) void save(false);
          }
        }}/>
      {!closing && (proposed || moving) && <div className="qh-reschedule-preview">
        <label><input type="checkbox" checked={!!moving} onChange={e => chooseTime(e.target.checked ? undefined : 'skip')}/>更新本条日程</label>
        {moving && <input type="datetime-local" aria-label="调整后的截止时间" value={localMinute(moving)} onChange={e => {
          const at = new Date(e.target.value);
          if (Number.isFinite(+at)) chooseTime(at.toISOString());
        }}/>}
        {!moving && <span>仅保存进展</span>}
      </div>}
      <div>{!done && <label className="qh-mark-done"><input type="checkbox" checked={closing}
         onChange={e=>{ setPlanning(undefined); setClosing(e.target.checked); }}/>完成日程</label>}
        {followButton()}
        {!closing && !done && text.trim() && !proposed && !moving &&
          <button type="button" onClick={() => chooseTime(new Date(Math.max(dueAt,Date.now()+3600_000)).toISOString())}>调整时间</button>}
        <button type="button" disabled={busy} onClick={() => { setPlanning(undefined); setEditing(false); trigger.current?.focus(); }}>收起</button>
        {!closing && <button type="submit" disabled={!text.trim() || busy}>{busy ? '保存中…' : moving ? '保存进展并改期' : '保存进展'}</button>}
      </div>
    </form>{closing && renderResult(hideResult,finish)}</>}
    {planning && <form className="qh-follow-preview" aria-label={planning.kind === 'move' ? '确认改期' : '安排跟进'} onSubmit={event => { event.preventDefault(); void save(true); }}>
      <label>{planning.kind === 'move' ? '新的截止时间' : '下次跟进时间'}
        <input type="datetime-local" required value={planning.request.dueAt ? localMinute(planning.request.dueAt) : ''}
          min={localMinute(new Date(Date.now()+60000).toISOString())} onChange={event => {
            const at = new Date(event.target.value);
            setPlanning({...planning,request:{...planning.request,dueAt:Number.isFinite(+at) ? at.toISOString() : ''}});
          }}/>
      </label>
      {planning.kind === 'follow' && planning.request.dueAt && <small>原事项同步调整到 {stamp.format(new Date(Date.parse(planning.request.dueAt)+3600000))}</small>}
      <div><button type="button" disabled={busy} onClick={() => setPlanning(undefined)}>取消</button>
        <button type="submit" disabled={busy || !planning.request.dueAt}>{planning.kind === 'move' ? '确认改期' : planning.request.existing ? '保存跟进时间' : '创建跟进'}</button></div>
    </form>}
    {error && <small role="alert">{error}</small>}
    {history && latest && <ol id={historyId} className="qh-log-history" aria-label="进展记录">{[...records].reverse().map(record =>
      <li key={record.id}><time dateTime={record.at}>{stamp.format(new Date(record.at))}</time><p>{record.text}</p>{followButton(record)}</li>
    )}</ol>}
  </div>;
}
