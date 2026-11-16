import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Popover } from '../ui/Popover';
import { Icon } from '../ui/Icon';

/** Keyboard counterpart to both drag directions. Existing executions are linked, never resent. */
export function SessionLinkMenu({ taskId }: { taskId: string }) {
  const { snap, linkWithFx } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const sessions = Object.values(snap.sessions).filter(s => s.taskId !== taskId && s.runtime?.purpose !== 'discussion' && !s.runtime?.workItemId);
  if (!sessions.length || snap.tasks[taskId]?.completion) return null;
  return <div style={{ position: 'relative' }}>
    <button type="button" className="qd-text-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}><Icon name="merge" size={14} />关联会话</button>
    <Popover open={open} onClose={() => setOpen(false)} label="选择已有会话" className="qd-target-menu" align="left">
      <div className="qd-menu-title">选择已有会话</div>
      {sessions.map(session => <button type="button" className="qd-menu-item" key={session.id} onClick={() => { setOpen(false); void linkWithFx(session.id, taskId); }}>
        <span className="qd-menu-item-main"><strong>{session.title}</strong><span>{session.taskId ? `当前任务：${snap.tasks[session.taskId]?.title ?? '原任务'}` : '未关联任务'}</span></span>
      </button>)}
    </Popover>
  </div>;
}
