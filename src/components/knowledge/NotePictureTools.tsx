import { useEffect, useRef, useState, type RefObject } from 'react';
import { copyNoteImage, selectedNoteImage } from './noteClipboard';

export function NotePictureTools({root}: {root: RefObject<HTMLElement | null>}) {
  const button = useRef<HTMLButtonElement>(null);
  const [picture, setPicture] = useState<HTMLImageElement>();
  const [point, setPoint] = useState<{left: number; top: number}>();
  const [notice, setNotice] = useState('');
  const writing = useRef(false);

  async function copy(image: HTMLImageElement) {
    if (writing.current) return;
    writing.current = true;
    try {
      await copyNoteImage(image);
      setPicture(undefined); setPoint(undefined); setNotice('图片已复制');
    }
    catch (error) { setNotice(error instanceof Error ? error.message : '图片复制失败'); }
    finally { writing.current = false; }
  }

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let current: {image: HTMLImageElement; x: number; y: number} | undefined;
    function close() { current = undefined; setPicture(undefined); setPoint(undefined); }
    function place() {
      if (!current) return;
      const rect = current.image.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight || !current.image.isConnected) { close(); return; }
      setPoint({
        left: Math.max(4, Math.min(innerWidth - 84, rect.left + current.x)),
        top: Math.max(4, Math.min(innerHeight - 38, rect.top + current.y)),
      });
    }
    function show(event: MouseEvent) {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.dataset.noteImage) return;
      event.preventDefault();
      host!.focus({preventScroll:true});
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNode(image);
      selection?.removeAllRanges();
      selection?.addRange(range);
      setPicture(image); setNotice('');
      const rect = image.getBoundingClientRect();
      const rightClick = event.type === 'contextmenu';
      current = {
        image,
        x: rightClick ? event.clientX - rect.left : rect.width - 72,
        y: rightClick ? event.clientY - rect.top : rect.height >= 90 ? 4 : rect.height + 4,
      };
      place();
    }
    function onCopy(event: ClipboardEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') { close(); return; }
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'c') return;
      }
      const image = selectedNoteImage(host);
      if (image) { event.preventDefault(); void copy(image); }
    }
    function outside(event: Event) {
      if (!(event.target instanceof Node) || button.current?.contains(event.target)) return;
      close(); setNotice('');
    }
    host.addEventListener('click', show);
    host.addEventListener('contextmenu', show);
    host.addEventListener('keydown', onCopy);
    host.addEventListener('copy', onCopy);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      host.removeEventListener('click', show);
      host.removeEventListener('contextmenu', show);
      host.removeEventListener('keydown', onCopy);
      host.removeEventListener('copy', onCopy);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [root]);

  return <>
    {picture && point && <button type="button" ref={button} className="qn-copy-picture" style={point}
      title="复制原图（⌘C / Ctrl+C）" onMouseDown={event => event.preventDefault()}
      onClick={() => void copy(picture)}>复制图片</button>}
    {notice && <span role="status" className="qn-copy-notice">{notice}</span>}
  </>;
}
