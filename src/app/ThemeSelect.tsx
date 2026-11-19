import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, SunMoon } from 'lucide-react';

import type { Theme } from './ui-preferences';

const themes: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeSelect({ theme, onChange, disabled }: { theme: Theme; onChange: (theme: Theme) => void; disabled: boolean }) {
  return (
    <Select.Root
      value={theme}
      disabled={disabled}
      onValueChange={(value) => {
        const selectedTheme = themes.find((item) => item.value === value);
        if (selectedTheme) onChange(selectedTheme.value);
      }}
    >
      <Select.Trigger className="theme-trigger" aria-label="Appearance">
        <SunMoon size={17} aria-hidden="true" />
        <span className="theme-label">Appearance</span>
        <Select.Value />
        <Select.Icon><ChevronDown size={14} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="theme-menu" position="popper" side="top" sideOffset={8} data-theme={theme}>
          <Select.Viewport>
            {themes.map(({ value, label }) => (
              <Select.Item className="theme-option" key={value} value={value}>
                <Select.ItemText>{label}</Select.ItemText>
                <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
