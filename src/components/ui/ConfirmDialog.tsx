import { useEffect, useId, useRef } from 'react';
export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onClose, busy = false, error }: { title: string; text: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="qd-discussion-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2></header>
    <p className="qd-dialog-description">{text}</p>
    {error && <p className="qd-delete-error" role="alert">{error}</p>}
    <footer><button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>取消</button><button type="button" className="qd-btn primary" disabled={busy} onClick={onConfirm}>{confirmLabel}</button></footer>
  </dialog>;
}
