import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';

type CheckboxProps = Omit<ComponentProps<'input'>, 'type' | 'checked' | 'defaultChecked' | 'onChange' | 'children'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function Checkbox({ onCheckedChange, ...props }: CheckboxProps) {
  return (
    <span className="lusi-checkbox">
      <input {...props} type="checkbox" onChange={(event) => onCheckedChange(event.currentTarget.checked)} />
      <span className="lusi-checkbox-face" aria-hidden="true">
        <Check size={13} strokeWidth={2.6} />
      </span>
    </span>
  );
}
