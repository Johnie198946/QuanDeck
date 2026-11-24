import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onClose, busy = false, error, children, confirmDisabled = false, className }: { title: string; text: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean; error?: string; children?: ReactNode; confirmDisabled?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className={['qd-discussion-dialog', className].filter(Boolean).join(' ')} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2></header>
    <p className="qd-dialog-description">{text}</p>
    {children}
    {error && <p className="qd-delete-error" role="alert">{error}</p>}
    <footer><button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>取消</button><button type="button" className="qd-btn primary" disabled={busy || confirmDisabled} onClick={onConfirm}>{confirmLabel}</button></footer>
  </dialog>;
}
