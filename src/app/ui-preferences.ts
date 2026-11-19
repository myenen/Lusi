import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type Pane = 'sidebarWidth' | 'listWidth';

export interface Preferences {
  theme: Theme;
  sidebarWidth: number;
  listWidth: number;
}

export const paneLimits = {
  sidebarWidth: { min: 190, max: 272 },
  listWidth: { min: 290, max: 444 },
};

const defaults: Preferences = { theme: 'system', sidebarWidth: 222, listWidth: 348 };

export function useUiPreferences() {
  const [preferences, setPreferences] = useState(defaults);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(!isTauri());
  const current = useRef(defaults);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    invoke<Preferences>('load_ui_preferences').then((stored) => {
      if (!active) return;
      current.current = stored;
      setPreferences(stored);
    }).catch(() => {
      if (active) setError('Appearance preferences could not be loaded.');
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, []);

  function update(patch: Partial<Preferences>, persist = true) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setPreferences(next);

    if (!persist || !isTauri()) return;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        await invoke('save_ui_preferences', { preferences: next });
        setError('');
      } catch {
        setError('Appearance preferences could not be saved.');
      }
    });
  }

  return { preferences, update, error, ready };
}
