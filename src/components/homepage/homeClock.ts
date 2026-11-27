import { useEffect, useState } from 'react';

export function useHomeClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function sync() {
      clearTimeout(timer);
      const date = new Date();
      setNow(date);
      timer = setTimeout(sync, 60_000 - (date.getTime() % 60_000));
    }
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { clearTimeout(timer); window.removeEventListener('focus',sync); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return now;
}
