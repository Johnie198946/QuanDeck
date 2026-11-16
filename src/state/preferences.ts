import { useEffect, useState } from 'react';
import { desktopHost } from '../integration/desktop';
const key = 'quandeck.preferences.v1';
export type LogDensity = 'brief'|'standard'|'detailed';
export interface Preferences { name: string; compact: boolean; reduceMotion: boolean; logDensity: LogDensity; notifications: boolean }
const defaults: Preferences = { name: '我的工作台', compact: false, reduceMotion: false, logDensity:'brief', notifications:true };
function read(): Preferences {
  try { const value={ ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') };if(!['brief','standard','detailed'].includes(value.logDensity))value.logDensity='brief';return value; } catch { return defaults; }
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
    void desktopHost()?.savePreference(key, JSON.stringify(next)).catch(error => window.dispatchEvent(new CustomEvent('quandeck:storage-error', { detail: error instanceof Error ? error.message : '设置未保存到本地文件' })));
    setPreferences(next);
    window.dispatchEvent(new Event('quandeck:preferences'));
  }
  return { preferences, update };
}
