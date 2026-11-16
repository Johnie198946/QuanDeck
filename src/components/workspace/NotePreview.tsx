import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { rootPlanOf } from '../../data/ideaEngine';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

/** A preview of the user's actual plan. It does not invent itinerary details or output. */
export function NotePreview({ taskId }: { taskId: string }) {
  const { snap, patchWorkspace } = useWorkdeck();
  const ref = useRef<HTMLDialogElement>(null);
  const plan = rootPlanOf(snap, taskId);
  useEffect(() => { const trigger = document.activeElement as HTMLElement | null; const node = ref.current; node?.showModal(); return () => { node?.close(); trigger?.focus(); }; }, []);
  if (!plan) return null;
  const doc = plan.adopted?.doc ?? plan.draft;
  const sections = doc.sections.filter(section => section.lines.some(line => line.text.trim()));
  return createPortal(<dialog ref={ref} className="qd-note qd-plan-preview-dialog" aria-label="方案笔记预览" onCancel={event => { event.preventDefault(); patchWorkspace({note:false}); }}>
    <header className="qd-note-head"><div><span className="qd-tag">{plan.adopted ? `已采用 · v${plan.adopted.version}` : '方案草稿'}</span><h2>{snap.tasks[taskId]?.title ?? plan.title}</h2></div><button type="button" autoFocus className="qd-icon-btn" aria-label="关闭笔记预览" onClick={() => patchWorkspace({note:false})}><Icon name="close" size={17} /></button></header>
    {sections.length ? sections.map(section => <section key={section.id}><h3>{section.title}</h3><ul>{section.lines.filter(line => line.text.trim()).map(line => <li key={line.id}>{line.text}</li>)}</ul></section>) : <p className="qd-muted">方法内容尚未记录。</p>}
    <footer className="qd-note-foot"><button type="button" className="qd-btn ghost" onClick={() => patchWorkspace({note:false,view:'results'})}>查看任务成果<Icon name="arrow-right" size={15}/></button></footer>
  </dialog>, document.body);
}
