import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { briefDate, evidenceLabels } from './BriefTaskTrail';
import type { BriefEvidence } from './projectBriefs';

export function BriefEvidenceDialog({entry, onClose, onLocate}: {
  entry: BriefEvidence;
  onClose: () => void;
  onLocate: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const destination = entry.noteId ? '打开原笔记' : entry.taskId ? '打开关联任务' : '打开所属项目';
  return createPortal(<dialog ref={ref} className="qhb-dialog" aria-labelledby="qpb-evidence-title" onCancel={onClose}>
    <header><div><span className="qhb-context">{entry.projectName || '帮你记'} · {evidenceLabels[entry.kind]}</span>
      <h2 id="qpb-evidence-title">{entry.title}</h2><p>{briefDate(entry.at)}</p></div>
      <button type="button" className="qd-icon-btn" aria-label="关闭记录" onClick={onClose} autoFocus><Icon name="close" size={16}/></button></header>
    <div className="qhb-detail-body"><blockquote><p>{entry.text}</p></blockquote></div>
    <footer className="qhb-detail-actions"><button type="button" className="qp-btn" onClick={onLocate}>{destination}<Icon name="arrow-right" size={13}/></button></footer>
  </dialog>, document.body);
}
