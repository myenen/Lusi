import { Languages } from 'lucide-react';
import { useLabels, type LanguagePreference } from './i18n';
import { SelectBox } from '../components/ui/SelectBox';

export function LanguageSelect({ value, onChange, disabled }: {
  value: LanguagePreference;
  onChange: (value: LanguagePreference) => void;
  disabled: boolean;
}) {
  const labels = useLabels();

  return (
    <SelectBox<LanguagePreference>
      className="preference-select"
      label={labels.language}
      icon={Languages}
      value={value}
      options={[
        { value: 'system', label: labels.themes.system },
        { value: 'tr', label: 'Türkçe', lang: 'tr' },
        { value: 'en', label: 'English', lang: 'en' },
      ]}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
