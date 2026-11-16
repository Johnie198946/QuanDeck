import { useEffect, useState } from 'react';

/** Redraw wall time only. A UI tick must never extend a persisted execution interval. */
export function useScheduleClock(active = true) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const update = () => setClock(Date.now());
    update();
    const timer = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [active]);
  return clock;
}
