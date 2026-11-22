import { useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react';

function measure(viewport: HTMLElement, track: HTMLElement) {
  const range = viewport.scrollHeight - viewport.clientHeight;
  const length = track.clientHeight;
  if (range <= 1 || viewport.clientHeight === 0 || length === 0) return;
  const size = Math.max(Math.min(28, length / 2), length * viewport.clientHeight / viewport.scrollHeight);
  return { range, size, travel: length - size };
}

export function ScrollArea({ children, className, contentClassName = '', label, viewportRef }: {
  children: ReactNode;
  className: string;
  contentClassName?: string;
  label: string;
  viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const innerViewport = useRef<HTMLDivElement>(null);
  const viewport = viewportRef ?? innerViewport;
  const content = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; offset: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const pane = viewport.current;
    const rail = track.current;
    const handle = thumb.current;
    if (!pane || !rail || !handle || !content.current) return;

    let frame = 0;
    function update() {
      frame = 0;
      if (!pane || !rail || !handle) return;
      const metrics = measure(pane, rail);
      rail.dataset.overflow = String(Boolean(metrics));
      pane.setAttribute('tabindex', metrics ? '0' : '-1');
      if (!metrics) return;
      const progress = Math.min(1, Math.max(0, pane.scrollTop / metrics.range));
      handle.style.height = `${metrics.size}px`;
      handle.style.transform = `translateY(${progress * metrics.travel}px)`;
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    update();
    pane.addEventListener('scroll', schedule, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(pane);
    resize?.observe(content.current);
    window.addEventListener('resize', schedule);
    return () => {
      resize?.disconnect();
      pane.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [viewport]);

  function move(event: PointerEvent<HTMLDivElement>, offset: number) {
    const pane = viewport.current;
    if (!pane) return;
    const rail = event.currentTarget;
    const metrics = measure(pane, rail);
    if (!metrics) return;
    const position = event.clientY - rail.getBoundingClientRect().top - offset;
    pane.scrollTo({ top: metrics.range * Math.min(1, Math.max(0, position / metrics.travel)) });
  }

  return <div className={`lusi-scroll-area ${className}`}>
    <div ref={viewport} className="lusi-scroll-viewport" role="group" aria-label={label} tabIndex={-1}>
      <div ref={content} className={`lusi-scroll-content ${contentClassName}`}>{children}</div>
    </div>
    <div ref={track} className="lusi-scroll-track" aria-hidden="true" onPointerDown={(event) => {
      const pane = viewport.current;
      const handle = thumb.current;
      if (!pane || !handle || event.button !== 0 || drag.current) return;
      const rail = event.currentTarget;
      const metrics = measure(pane, rail);
      if (!metrics) return;
      event.preventDefault();
      const overThumb = handle.contains(event.target as Node);
      const offset = overThumb ? event.clientY - handle.getBoundingClientRect().top : metrics.size / 2;
      drag.current = { pointer: event.pointerId, offset };
      rail.setPointerCapture(event.pointerId);
      rail.dataset.dragging = 'true';
      if (!overThumb) move(event, offset);
    }} onPointerMove={(event) => {
      const current = drag.current;
      if (current?.pointer === event.pointerId) move(event, current.offset);
    }} onLostPointerCapture={(event) => {
      if (drag.current?.pointer !== event.pointerId) return;
      drag.current = undefined;
      delete event.currentTarget.dataset.dragging;
    }}>
      <div ref={thumb} className="lusi-scroll-thumb" />
    </div>
  </div>;
}
