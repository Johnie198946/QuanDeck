import { useEffect, useId, useRef } from 'react';
export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onClose }: { title: string; text: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="qd-discussion-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2></header>
    <p className="qd-dialog-description">{text}</p>
    <footer><button type="button" className="qd-btn ghost" onClick={onClose}>取消</button><button type="button" className="qd-btn primary" onClick={onConfirm}>{confirmLabel}</button></footer>
  </dialog>;
}
