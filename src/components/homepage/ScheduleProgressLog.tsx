import { useId, useRef, useState } from 'react';
import type { ScheduleProgress } from '../../data/scheduleProgress';
import { Icon } from '../ui/Icon';

const stamp = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function ScheduleProgressLog({ records = [], submit }: {
  records?: ScheduleProgress[];
  submit: (id: string, text: string) => Promise<void>;
}) {
  const formId = useId(), historyId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<{id: string; text: string} | undefined>(undefined);
  const [editing, setEditing] = useState(false), [history, setHistory] = useState(false);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latest = records.at(-1);

  async function save() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError('');
    if (!request.current || request.current.text !== text.trim()) request.current = {id:crypto.randomUUID(), text:text.trim()};
    try {
      await submit(request.current.id, request.current.text);
      setText(''); setEditing(false); request.current = undefined; trigger.current?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '进展未能保存，请重试'); }
    finally { setBusy(false); }
  }

  return <div className="qh-log">
    {latest && !history && <div className="qh-log-latest">
      <time dateTime={latest.at}>{stamp.format(new Date(latest.at))}</time>
      <p title={latest.text}>{latest.text}</p>
    </div>}
    <div className="qh-log-actions">
      <button type="button" ref={trigger} aria-controls={formId} aria-expanded={editing} onClick={() => setEditing(!editing)}>
        <Icon name="pencil" size={12}/>写进展
      </button>
      {latest && <button type="button" aria-controls={historyId} aria-expanded={history} onClick={() => setHistory(!history)}>
        全部 {records.length} 条<Icon name="chevron-down" size={12}/>
      </button>}
    </div>
    {editing && <form id={formId} className="qh-log-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <textarea autoFocus aria-label="进展内容" placeholder="写下做到哪了，或下一步要做什么…" maxLength={2000}
        rows={2} value={text} disabled={busy} onChange={event => setText(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault(); void save();
          }
        }}/>
      <div>{error && <small role="alert">{error}</small>}
        <button type="button" disabled={busy} onClick={() => { setEditing(false); trigger.current?.focus(); }}>收起</button>
        <button type="submit" disabled={!text.trim() || busy}>{busy ? '保存中…' : '保存进展'}</button>
      </div>
    </form>}
    {history && latest && <ol id={historyId} className="qh-log-history" aria-label="进展记录">{[...records].reverse().map(record =>
      <li key={record.id}><time dateTime={record.at}>{stamp.format(new Date(record.at))}</time><p>{record.text}</p></li>
    )}</ol>}
  </div>;
}
