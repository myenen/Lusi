import { useSyncExternalStore } from 'react';
import type { Locale } from './i18n';
import '../styles/themes/default.css';
import '../styles/themes/flat.css';

export type Appearance = 'system' | 'light' | 'dark';

interface ThemePreset {
  id: string;
  name: Record<Locale, string>;
}

export const defaultThemeId = 'default';

export const themePresets: readonly ThemePreset[] = [
  { id: defaultThemeId, name: { en: 'Liquid Glass', tr: 'Liquid Glass' } },
  { id: 'flat', name: { en: 'Flat', tr: 'Düz' } },
];

export function resolveThemeId(id: string | undefined): string {
  return themePresets.find((preset) => preset.id === id)?.id ?? defaultThemeId;
}

const darkPreference = '(prefers-color-scheme: dark)';

function subscribeToSystemAppearance(listener: () => void) {
  const query = window.matchMedia?.(darkPreference);
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}

function isSystemDark() {
  return window.matchMedia?.(darkPreference).matches ?? false;
}

export function useColorScheme(appearance: Appearance): 'light' | 'dark' {
  const systemDark = useSyncExternalStore(subscribeToSystemAppearance, isSystemDark);
  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
}
