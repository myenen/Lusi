import * as Primitive from '@radix-ui/react-tooltip';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';

export type TooltipSide = 'bottom' | 'right';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Primitive.Provider delayDuration={350}>{children}</Primitive.Provider>;
}

export function Tooltip({ label, side, children }: { label?: string; side: TooltipSide; children: ReactElement }) {
  const [container, setContainer] = useState<HTMLElement>();
  const attachTrigger = useCallback((trigger: HTMLElement | null) => {
    if (trigger) setContainer(trigger.closest<HTMLElement>('dialog, .workspace') ?? document.body);
  }, []);

  if (!label) return children;
  return <Primitive.Root>
    <Primitive.Trigger ref={attachTrigger} asChild>{children}</Primitive.Trigger>
    <Primitive.Portal container={container}>
      <Primitive.Content className="lusi-tooltip" side={side} sideOffset={8} collisionPadding={10} hideWhenDetached>
        {label}
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
