import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

export function SelectBox<Value extends string>({
  id, label, value, options, onChange, disabled, icon: Icon, className = '', triggerContent, side,
}: {
  id?: string;
  label: string;
  value: Value;
  options: readonly { value: Value; label: string; lang?: string }[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  icon?: LucideIcon;
  className?: string;
  triggerContent?: ReactNode;
  side?: 'top' | 'bottom';
}) {
  const [container, setContainer] = useState<HTMLElement>();
  const attachTrigger = useCallback((trigger: HTMLButtonElement | null) => {
    if (trigger) setContainer(trigger.closest<HTMLElement>('dialog, .workspace') ?? document.body);
  }, []);

  return <Select.Root disabled={disabled} value={value} onValueChange={(next) => {
    const option = options.find((option) => option.value === next);
    if (option) onChange(option.value);
  }}>
    <Select.Trigger id={id} ref={attachTrigger} className={`lusi-select ${className}`} aria-label={label}>
      {triggerContent ?? (Icon && <><Icon size={17} aria-hidden="true" /><span className="sidebar-copy">{label}</span></>)}
      <span className={triggerContent ? 'sr-only' : 'lusi-select-value'}><Select.Value /></span>
      <Select.Icon className="lusi-select-chevron" asChild><ChevronDown size={14} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={container}>
      <Select.Content className="lusi-select-menu" position="popper" align="start" side={side} sideOffset={5} collisionPadding={8}
        collisionBoundary={container instanceof HTMLDialogElement ? container : undefined}>
        <Select.Viewport className="lusi-select-options">
          {options.map((option) => (
            <Select.Item className="lusi-select-option" key={option.value} value={option.value} textValue={option.label}>
              <Select.ItemText><span lang={option.lang}>{option.label}</span></Select.ItemText>
              <Select.ItemIndicator asChild><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
