import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { useLabels } from './i18n';
import type { Appearance } from './themes';

const themes: { value: Appearance; icon: LucideIcon }[] = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
];

export function ThemeSelect({ theme, onChange, disabled }: { theme: Appearance; onChange: (theme: Appearance) => void; disabled: boolean }) {
  const groupName = useId();
  const labels = useLabels();

  return (
    <fieldset className="theme-picker" disabled={disabled}>
      <legend className="sr-only">{labels.appearance}</legend>
      {themes.map(({ value, icon: Icon }) => (
        <label key={value} className="theme-choice" title={labels.themes[value]}>
          <input
            className="sr-only"
            type="radio"
            name={groupName}
            value={value}
            checked={theme === value}
            onChange={() => onChange(value)}
          />
          <span className="theme-choice-face">
            <Icon size={17} aria-hidden="true" />
            <span className="sr-only">{labels.themes[value]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
