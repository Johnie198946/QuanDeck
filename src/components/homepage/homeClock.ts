import { useEffect, useState } from 'react';

export function useHomeClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function sync() {
      clearTimeout(timer);
      const date = new Date();
      setNow(date);
      const nextHour = new Date(date);
      nextHour.setHours(date.getHours() + 1, 0, 0, 0);
      timer = setTimeout(sync, nextHour.getTime() - date.getTime());
    }
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return now;
}
