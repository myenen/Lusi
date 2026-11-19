import { Palette } from 'lucide-react';
import { useContext } from 'react';
import { catalog, LocaleContext } from './i18n';
import { PreferenceSelect } from './PreferenceSelect';
import { themePresets } from './themes';

export function ThemePresetSelect({ value, onChange, disabled }: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const locale = useContext(LocaleContext);
  if (themePresets.length < 2) return null;

  return (
    <PreferenceSelect
      label={catalog[locale].theme}
      icon={Palette}
      value={value}
      options={themePresets.map((preset) => ({ value: preset.id, label: preset.name[locale] }))}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
