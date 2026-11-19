import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function revealPreferences(name = 'Preferences') {
  fireEvent.pointerEnter(screen.getByRole('region', { name }));
}

describe('sample mailbox', () => {
  it.each([
    { reducedMotion: false, panes: ['sidebar', 'mail-list', 'reader'] },
    { reducedMotion: false, panes: ['mail-list', 'reader'] },
    { reducedMotion: true, panes: ['sidebar', 'mail-list', 'reader'] },
  ])('uses the same reveal at startup and for theme changes ($reducedMotion, $panes)', ({ reducedMotion, panes }) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: no-preference)' && !reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const starts: [string, number, KeyframeAnimationOptions['duration']][] = [];
    const cancel = vi.fn();
    const animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      expect(keyframes.map(({ maskPosition }) => maskPosition)).toEqual(['50% 100%', '50% 0%']);
      expect(keyframes.map(({ filter }) => filter)).toEqual(['blur(6px)', 'blur(0px)']);
      starts.push([this.classList[0], options.delay ?? 0, options.duration]);
      return { cancel };
    };
    const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const visibleRects = [new DOMRect()];
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return (panes.includes(this.classList[0]) ? visibleRects : []) as unknown as DOMRectList;
    });

    try {
      render(<App />);
      const startup = starts.slice();
      expect(startup.map(([pane]) => pane)).toEqual(reducedMotion ? [] : panes);
      startup.forEach(([, delay, duration], index) => {
        expect(duration).toBeGreaterThan(0);
        if (index === 0) expect(delay).toBe(0);
        else expect(delay).toBeGreaterThan(startup[index - 1][1]);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
      expect(starts).toEqual(startup);

      const light = screen.getByRole<HTMLInputElement>('radio', { name: 'Light' });
      fireEvent.click(light);
      expect(light.checked).toBe(true);
      expect(starts).toEqual(startup);

      revealPreferences();
      fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'flat' } });
      expect(starts).toEqual([...startup, ...startup]);
      expect(cancel).toHaveBeenCalledTimes(startup.length);

      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      expect(starts).toEqual([...startup, ...startup, ...startup]);
      expect(cancel).toHaveBeenCalledTimes(startup.length * 2);
    } finally {
      if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
      else Reflect.deleteProperty(Element.prototype, 'animate');
    }
  });

  it('selects a message and displays its plain text', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /notes from our design review/i }));

    const reader = screen.getByRole('main', { name: 'Message reader' });
    expect(within(reader).getByRole('heading', { name: 'Notes from our design review' })).toBeTruthy();
    expect(within(reader).getByText(/decisions from this morning/)).toBeTruthy();
  });

  it('filters messages within the current folder and clears search when switching folders', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'weekend' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Weekend plans' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('heading', { name: 'Travel itinerary' })).toBeTruthy();
    expect((screen.getByRole<HTMLInputElement>('searchbox')).value).toBe('');
  });

  it('switches appearance directly between system, light, and dark', () => {
    render(<App />);
    const controls = within(screen.getByRole('group', { name: 'Appearance' }));
    const workspace = screen.getByRole('main').closest('[data-theme]');
    expect(controls.getByRole<HTMLInputElement>('radio', { name: 'System' }).checked).toBe(true);
    expect(workspace?.getAttribute('data-theme-id')).toBe('default');
    revealPreferences();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Theme' }).value).toBe('default');

    for (const theme of ['Light', 'Dark', 'System']) {
      const choice = controls.getByRole<HTMLInputElement>('radio', { name: theme });
      fireEvent.click(choice);
      expect(choice.checked).toBe(true);
      expect(workspace?.getAttribute('data-theme')).toBe(theme.toLowerCase());
      expect(workspace?.getAttribute('data-theme-id')).toBe('default');
      if (theme !== 'System') expect(workspace?.getAttribute('data-color-scheme')).toBe(theme.toLowerCase());
    }
  });

  it('switches theme layouts independently from appearance', () => {
    render(<App />);
    revealPreferences();
    const workspace = screen.getByRole('main').closest('[data-theme]');
    const theme = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Theme' });

    fireEvent.change(theme, { target: { value: 'flat' } });
    expect(workspace?.getAttribute('data-theme-id')).toBe('flat');
    expect(workspace?.getAttribute('data-theme')).toBe('system');

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(workspace?.getAttribute('data-theme-id')).toBe('flat');
    expect(workspace?.getAttribute('data-color-scheme')).toBe('dark');

    fireEvent.change(theme, { target: { value: 'default' } });
    expect(workspace?.getAttribute('data-theme-id')).toBe('default');
    expect(workspace?.getAttribute('data-color-scheme')).toBe('dark');
  });

  it('uses the system language and switches the interface and sample mail together', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['tr-TR']);
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Gelen Kutusu' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Dolomitler saha notları' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('tr');

    revealPreferences('Tercihler');
    const language = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Dil' });
    expect(language.value).toBe('system');
    fireEvent.change(language, { target: { value: 'en' } });
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');

    fireEvent.change(language, { target: { value: 'system' } });
    expect(screen.getByRole('heading', { name: 'Gelen Kutusu' })).toBeTruthy();
  });

  it('falls back to English for an unsupported system language', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy();
    revealPreferences();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Language' }).value).toBe('system');
  });

  it('opens additional preferences on hover and closes after leaving, unless the pointer returns', () => {
    vi.useFakeTimers();
    render(<App />);
    const region = screen.getByRole('region', { name: 'Preferences' });
    expect(screen.queryByRole('combobox', { name: 'Theme' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'System' })).toBeTruthy();

    fireEvent.pointerEnter(region);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
    fireEvent.pointerLeave(region);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();

    fireEvent.pointerEnter(region);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();

    fireEvent.pointerLeave(region);
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByRole('combobox', { name: 'Theme' })).toBeNull();
  });

  it('reveals preferences on keyboard focus and returns focus when they close with Escape', () => {
    render(<App />);
    const system = screen.getByRole('radio', { name: 'System' });
    act(() => system.focus());
    const theme = screen.getByRole('combobox', { name: 'Theme' });
    act(() => theme.focus());
    fireEvent.keyDown(theme, { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Theme' })).toBeNull();
    expect(document.activeElement).toBe(system);
  });

  it('moves focus into the narrow reader and restores it on return', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<App />);

    const message = screen.getByRole('button', { name: /notes from our design review/i });
    fireEvent.click(message);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Notes from our design review' }));

    fireEvent.click(screen.getByRole('button', { name: 'Back to messages' }));
    expect(document.activeElement).toBe(message);
  });

  it('filters unread and starred messages and exposes the selected filter', () => {
    render(<App />);
    const filters = screen.getByRole('group', { name: 'Filter messages' });
    const starred = within(filters).getByRole('button', { name: 'Starred' });
    fireEvent.click(starred);
    expect(starred.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(within(filters).getByRole('button', { name: 'Unread' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('resizes the message list by keyboard within its supported bounds', () => {
    render(<App />);
    const separator = screen.getByRole('separator', { name: 'Resize message list' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('356');
    fireEvent.keyDown(separator, { key: 'Home' });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('290');
  });

  it('collapses and expands the sidebar while keeping folder actions available', () => {
    render(<App />);
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }));

    const expand = within(sidebar).getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    const archive = within(sidebar).getByRole('button', { name: 'Archive' });
    expect(archive.getAttribute('title')).toBe('Archive');
    fireEvent.click(archive);
    expect(screen.getByRole('heading', { name: 'Travel itinerary' })).toBeTruthy();

    fireEvent.click(expand);
    expect(within(sidebar).getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-expanded')).toBe('true');
  });
});
