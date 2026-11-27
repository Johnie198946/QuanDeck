import { useRef, useState } from 'react';
import { Icon } from '../ui/Icon';

type FilePicker = (options: {
  id: string;
  startIn: 'downloads';
  multiple: boolean;
}) => Promise<{ getFile(): Promise<File> }[]>;

export function ScheduleFilePicker({ disabled, onFiles }: {
  disabled?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState('');

  async function choose() {
    if (disabled || pending.current) return;
    setError('');
    const picker = (window as Window & { showOpenFilePicker?: FilePicker }).showOpenFilePicker;
    if (!picker || fallback) { input.current?.click(); return; }
    pending.current = true;
    setOpening(true);
    try {
      // Open within the user's click. The OS remembers this picker's folder separately.
      const handles = await picker.call(window, { id: 'quandeck-agenda-files', startIn: 'downloads', multiple: true });
      await onFiles(await Promise.all(handles.map(handle => handle.getFile())));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (cause instanceof DOMException && ['NotAllowedError', 'SecurityError', 'NotSupportedError'].includes(cause.name)) {
        setFallback(true);
        setError('请再点一次「选择文件」，使用系统选择器。');
      } else setError(cause instanceof Error ? cause.message : '文件未能添加，请重试。');
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }

  async function add(files: File[]) {
    if (!files.length || disabled || pending.current) return;
    pending.current = true;
    setError('');
    try { await onFiles(files); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '文件未能添加，请重试。'); }
    finally { pending.current = false; }
  }

  return <div className="qh-file-picker" data-dragging={dragging || undefined}
    onDragOver={event => { if (!disabled && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); setDragging(false); void add(Array.from(event.dataTransfer.files)); }}>
    <button type="button" className="qd-btn" onClick={() => void choose()} disabled={disabled || opening}>
      <Icon name="attachment" size={14}/>{opening ? '正在选择…' : '选择文件'}
    </button>
    <small>或把材料拖到这里</small>
    <input ref={input} aria-label="添加材料文件" type="file" hidden disabled={disabled} multiple
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void add(files); }}/>
    {error && <span role="alert">{error}</span>}
  </div>;
}
