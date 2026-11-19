import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, SunMoon } from 'lucide-react';

export type Theme = 'system' | 'light' | 'dark';

const themes: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeSelect({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return (
    <Select.Root
      value={theme}
      onValueChange={(value) => {
        const selectedTheme = themes.find((item) => item.value === value);
        if (selectedTheme) onChange(selectedTheme.value);
      }}
    >
      <Select.Trigger className="theme-trigger" aria-label="Appearance">
        <SunMoon size={17} aria-hidden="true" />
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
