import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { desktopHost, type DesktopWindowState } from '../../integration/desktop';

const panels = '.qd-overview-header, .qd-portfolio-summary, .qd-project-lanes, .qd-portfolio-aside, .qd-overview-charts, .qd-overview-work, .qd-col-schedule, .qd-col-journal, .qd-col-rail, .qd-col-ws, .qd-gallery-head, .qd-output-overview, .qd-folio-shelf, .qd-folio';

/** Native maximize and browser fullscreen share layout; content keeps its natural aspect ratio. */
export function useWorkbenchDisplay(layoutKey: string, reduceMotion = false) {
  const root = useRef<HTMLDivElement>(null);
  const [native, setNative] = useState<DesktopWindowState>({ maximized: false, fullscreen: false });
  const [browserFull, setBrowserFull] = useState(!!document.fullscreenElement);
  const [wide, setWide] = useState(window.innerWidth >= 1600);
  const [busy, setBusy] = useState(false);
  const previousLayout = useRef(layoutKey);
  const previous = useRef(new Map<Element, DOMRect>());
  const animations = useRef<Animation[]>([]);
  const expanded = native.maximized || native.fullscreen || browserFull;

  useEffect(() => {
    const host = desktopHost();
    let alive = true;
    let receivedEvent = false;
    const unsubscribe = host?.onWindowState?.(state => { receivedEvent = true; if (alive) setNative(state); });
    void host?.getWindowState?.().then(state => { if (alive && !receivedEvent) setNative(state); }).catch(() => {});
    const size = window.matchMedia('(min-width: 1600px)');
    const resize = () => setWide(size.matches);
    const fullscreen = () => setBrowserFull(!!document.fullscreenElement);
    size.addEventListener('change', resize);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => { alive = false; unsubscribe?.(); size.removeEventListener('change', resize); document.removeEventListener('fullscreenchange', fullscreen); };
  }, []);

  useLayoutEffect(() => {
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    const elements = [...(root.current?.querySelectorAll<HTMLElement>(panels) ?? [])].filter(el => el.offsetWidth && el.offsetHeight);
    const next = new Map<Element, DOMRect>();
    const changedPage = previousLayout.current !== layoutKey;
    previousLayout.current = layoutKey;
    const reduced = reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    elements.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      next.set(el, rect);
      const before = previous.current.get(el);
      if (changedPage || reduced || !before || !el.animate) return;
      const dx = (before.left + before.width / 2) - (rect.left + rect.width / 2);
      const dy = (before.top + before.height / 2) - (rect.top + rect.height / 2);
      const scale = Math.max(.9, Math.min(1.06, before.width / rect.width, before.height / rect.height));
      animations.current.push(el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: .82, offset: 0 },
        { transform: `translate(${-dx * .018}px, ${-dy * .018}px) scale(1.012)`, opacity: 1, offset: .68 },
        { transform: 'scale(.998)', offset: .86 },
        { transform: 'none', opacity: 1, offset: 1 },
      ], { duration: 540, delay: Math.min(index, 4) * 38, easing: 'cubic-bezier(.2,.72,.25,1)' }));
    });
    previous.current = next;
    return () => animations.current.forEach(animation => animation.cancel());
  }, [expanded, native.fullscreen, native.maximized, browserFull, wide, layoutKey, reduceMotion]);

  const toggle = async () => {
    if (busy) return;
    // Capture the current arrangement before the native window begins resizing.
    previous.current = new Map([...(root.current?.querySelectorAll<HTMLElement>(panels) ?? [])].map(el => [el, el.getBoundingClientRect()]));
    setBusy(true);
    try {
      const host = desktopHost();
      if (host?.toggleFullscreen) await host.toggleFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } finally { setBusy(false); }
  };
  return { root, expanded, fullscreen: native.fullscreen || browserFull, wide, busy, toggle };
}
