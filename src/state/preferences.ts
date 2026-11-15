import { useEffect, useState } from 'react';
const key = 'quandeck.preferences.v1';
export interface Preferences { name: string; compact: boolean; reduceMotion: boolean }
const defaults: Preferences = { name: '我的工作台', compact: false, reduceMotion: false };
function read(): Preferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return defaults; }
}
export function usePreferences() {
  const [preferences, setPreferences] = useState(read);
  useEffect(() => {
    const update = () => setPreferences(read());
    window.addEventListener('quandeck:preferences', update);
    return () => window.removeEventListener('quandeck:preferences', update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.density = preferences.compact ? 'compact' : 'comfortable';
    document.documentElement.dataset.motion = preferences.reduceMotion ? 'reduced' : 'system';
  }, [preferences]);
  function update(patch: Partial<Preferences>) {
    const next = { ...read(), ...patch };
    localStorage.setItem(key, JSON.stringify(next));
    setPreferences(next);
    window.dispatchEvent(new Event('quandeck:preferences'));
  }
  return { preferences, update };
}
