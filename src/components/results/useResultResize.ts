import { useEffect, useRef } from 'react';

/** A short settling motion after a wider layout has actually been measured. */
export function useResultResize() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !globalThis.ResizeObserver) return;
    let previous = node.getBoundingClientRect().width;
    let timer: ReturnType<typeof setTimeout>;
    let animation: Animation | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width, delta = width - previous;
      previous = width;
      if (delta < 80 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        animation?.cancel();
        animation = node.animate([{ transform: 'scale(.988)' }, { transform: 'scale(1.003)', offset: .65 }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.22,.75,.25,1)' });
      }, 80);
    });
    observer.observe(node);
    return () => { observer.disconnect(); clearTimeout(timer); animation?.cancel(); };
  }, []);
  return ref;
}
