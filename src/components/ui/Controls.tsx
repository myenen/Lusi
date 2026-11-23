import type { ComponentProps, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useLabels } from '../../app/i18n';
import { Tooltip, type TooltipSide } from './Tooltip';

type IconButtonProps = ComponentProps<'button'> & { label: string; icon: LucideIcon; tooltip?: TooltipSide };

export function IconButton({ label, icon: Icon, className = '', tooltip, title, ...props }: IconButtonProps) {
  const button = <button type="button" className={`icon-button ${className}`} aria-label={label}
    title={tooltip ? undefined : title ?? label} {...props}>
    <Icon size={18} aria-hidden="true" />
  </button>;
  return tooltip ? <Tooltip label={title ?? label} side={tooltip}>{button}</Tooltip> : button;
}

export function Toolbar({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div role="group" aria-label={label} className={`toolbar ${className}`}>{children}</div>;
}

export type Filter = 'all' | 'unread';

const filters: Filter[] = ['all', 'unread'];

export function SegmentedFilter({ value, onChange }: { value: Filter; onChange: (filter: Filter) => void }) {
  const labels = useLabels();
  return (
    <div className="segmented-filter" data-value={value} role="group" aria-label={labels.filterMessages}>
      {filters.map((id) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          {labels.filters[id]}
        </button>
      ))}
    </div>
  );
}
