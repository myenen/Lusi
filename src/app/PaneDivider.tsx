import { useRef } from 'react';
import { useLabels } from './i18n';
import { paneLimits, type Pane } from './ui-preferences';

export function PaneDivider({ pane, width, onResize, disabled }: {
  pane: Pane;
  width: number;
  onResize: (width: number, persist: boolean) => void;
  disabled: boolean;
}) {
  const labels = useLabels();
  const drag = useRef<{ x: number; width: number; next: number; pointerId: number } | null>(null);
  const { min, max } = paneLimits[pane];
  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));

  return (
    <div
      className="pane-divider"
      tabIndex={disabled ? -1 : 0}
      role="separator"
      aria-label={pane === 'sidebarWidth' ? labels.resizeSidebar : labels.resizeMessageList}
      aria-controls={pane === 'sidebarWidth' ? 'sidebar' : 'message-pane'}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-disabled={disabled}
      onKeyDown={(event) => {
        if (disabled) return;
        const increments: Record<string, number> = { ArrowLeft: width - 8, ArrowRight: width + 8, Home: min, End: max };
        if (!Object.hasOwn(increments, event.key)) return;
        event.preventDefault();
        onResize(clamp(increments[event.key]), true);
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const actualWidth = event.currentTarget.parentElement?.getBoundingClientRect().width || width;
        drag.current = { x: event.clientX, width: actualWidth, next: width, pointerId: event.pointerId };
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const next = clamp(drag.current.width + event.clientX - drag.current.x);
        drag.current.next = next;
        onResize(next, false);
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        onResize(drag.current.next, true);
        drag.current = null;
      }}
    />
  );
}
