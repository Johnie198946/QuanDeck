import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** A view of the same discussion panel; native modal semantics keep the document inert. */
export function DirectionDiscussionDrawer({ open, onClose, trigger, children }: {
  open: boolean; onClose: () => void; trigger: RefObject<HTMLButtonElement | null>; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => {
      node.close();
      const target = previous?.isConnected && previous.getClientRects().length ? previous : trigger.current;
      target?.focus();
    };
  }, [open, trigger]);
  return createPortal(<dialog ref={dialog} id="direction-discussion" className="qd-direction-drawer" aria-label="讨论与版本"
    onCancel={event => { if (event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}
    onKeyDown={event => {
      if (event.key !== 'Tab' || (event.target as HTMLElement).closest('dialog') !== event.currentTarget) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled),textarea:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')].filter(node => node.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <header className="qd-direction-drawer-head"><strong>讨论与版本</strong><button type="button" className="qd-btn ghost small" onClick={onClose} autoFocus>关闭讨论</button></header>
    {children}
  </dialog>, document.body);
}
