import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScrollArea } from './ScrollArea';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('makes an overflowing pane keyboard reachable and keeps its draggable thumb in sync', () => {
  vi.useFakeTimers();
  const { container } = render(<ScrollArea className="test-pane" label="Messages">Mail content</ScrollArea>);
  const viewport = screen.getByRole('group', { name: 'Messages' });
  const track = container.querySelector<HTMLElement>('.lusi-scroll-track')!;
  const thumb = container.querySelector<HTMLElement>('.lusi-scroll-thumb')!;
  expect(viewport.tabIndex).toBe(-1);
  expect(track.dataset.overflow).toBe('false');

  Object.defineProperties(viewport, { clientHeight: { value: 200 }, scrollHeight: { value: 800 } });
  Object.defineProperty(viewport, 'scrollTo', { value: ({ top }: ScrollToOptions) => { viewport.scrollTop = top ?? 0; } });
  Object.defineProperties(track, { clientHeight: { value: 192 }, setPointerCapture: { value: vi.fn() } });
  fireEvent(window, new Event('resize'));
  act(() => vi.advanceTimersToNextFrame());
  expect(viewport.tabIndex).toBe(0);
  expect(track.dataset.overflow).toBe('true');
  expect(thumb.style.height).toBe('48px');

  fireEvent.pointerDown(thumb, { button: 0, pointerId: 1, clientY: 6 });
  fireEvent.pointerMove(track, { pointerId: 1, clientY: 78 });
  expect(viewport.scrollTop).toBe(300);
  fireEvent.scroll(viewport);
  act(() => vi.advanceTimersToNextFrame());
  expect(thumb.style.transform).toBe('translateY(72px)');
  fireEvent(track, new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
  expect(track.dataset.dragging).toBeUndefined();
});
