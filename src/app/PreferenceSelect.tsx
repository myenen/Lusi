import { ChevronDown, type LucideIcon } from 'lucide-react';

export function PreferenceSelect<Value extends string>({ label, value, icon: Icon, options, onChange, disabled, className }: {
  label: string;
  value: Value;
  icon: LucideIcon;
  options: readonly { value: Value; label: string; lang?: string }[];
  onChange: (value: Value) => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <label className={className ? `preference-select ${className}` : 'preference-select'} title={label}>
      <Icon size={17} aria-hidden="true" />
      <span className="sidebar-copy">{label}</span>
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const choice = options.find((option) => option.value === event.target.value);
          if (choice) onChange(choice.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} lang={option.lang}>{option.label}</option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" className="preference-select-chevron" />
    </label>
  );
}
