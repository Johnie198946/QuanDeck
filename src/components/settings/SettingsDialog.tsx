import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { SettingsPage } from './SettingsPage';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); trigger?.focus(); };
  }, []);

  return createPortal(<dialog ref={dialog} className="qd-settings-dialog" aria-labelledby="qd-settings-title" onCancel={event => {
    // React events from a nested native dialog also travel through its portal parent.
    if (event.target !== event.currentTarget) return;
    event.preventDefault(); onClose();
  }} onKeyDown={event => {
    // Let an inline popover dismiss itself before Escape closes the settings dialog.
    if (event.key === 'Escape' && event.currentTarget.querySelector('[role="dialog"]')) event.preventDefault();
  }} onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }} onClick={event => { if (backdropPress.current && event.target === event.currentTarget) onClose(); backdropPress.current = false; }}>
    <header className="qd-settings-dialog-header"><h1 id="qd-settings-title">我的设置</h1><button type="button" autoFocus className="qd-icon-btn" aria-label="关闭我的设置" onClick={onClose}><Icon name="close" size={19} /></button></header>
    <SettingsPage embedded />
  </dialog>, document.body);
}
