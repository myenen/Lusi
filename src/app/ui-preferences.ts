import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { resolveLocale, type LanguagePreference } from './i18n';
import { defaultThemeId, type Appearance } from './themes';

export type Pane = 'sidebarWidth' | 'listWidth';

export interface Preferences {
  theme: Appearance;
  themeId: string;
  language: LanguagePreference;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  listWidth: number;
}

export const paneLimits = {
  sidebarWidth: { min: 190, max: 272 },
  listWidth: { min: 290, max: 444 },
};

const defaults: Preferences = { theme: 'light', themeId: defaultThemeId, language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 };

interface LoadedPreferences { preferences: Preferences; systemLocale: string | null; }
type PreferenceError = 'load' | 'save';

function browserLocale() {
  return navigator.languages[0] ?? navigator.language;
}

export function useUiPreferences() {
  const [preferences, setPreferences] = useState(defaults);
  const [error, setError] = useState<PreferenceError>();
  const [systemLocale, setSystemLocale] = useState(browserLocale);
  const [ready, setReady] = useState(!isTauri());
  const current = useRef(defaults);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (!isTauri()) {
      const refreshLocale = () => setSystemLocale(browserLocale());
      window.addEventListener('languagechange', refreshLocale);
      return () => window.removeEventListener('languagechange', refreshLocale);
    }
    let active = true;
    invoke<LoadedPreferences>('load_ui_preferences').then(({ preferences: stored, systemLocale }) => {
      if (!active) return;
      current.current = stored;
      setPreferences(stored);
      if (systemLocale) setSystemLocale(systemLocale);
    }).catch(() => {
      if (active) setError('load');
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
        setError(undefined);
      } catch {
        setError('save');
      }
    });
  }

  return { preferences, locale: resolveLocale(preferences.language, systemLocale), update, error, ready };
}
