import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { makeDraft } from '../features/mail/demo-compose';
import { demoMessages } from '../features/mail/demo-mail';

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

  it('shows sample summaries and keeps unavailable summaries collapsed', () => {
    render(<App />);
    const reader = within(screen.getByRole('main', { name: 'Message reader' }));
    expect(reader.getByText('Lusi Smart Summary').closest('details')?.open).toBe(true);
    expect(reader.getByText(/meet at the trailhead before sunrise/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /weekend plans/i }));
    expect(reader.getByText(/she’ll bring coffee/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /welcome to lusi/i }));
    expect(reader.getByText('Lusi Smart Summary').closest('details')?.open).toBe(false);
    expect(reader.getByText('There is no summary for this message.')).toBeTruthy();
  });

  it('reopens a draft with its attachments and moves it to Sent on a successful demo send', () => {
    vi.useFakeTimers();
    const prototype = HTMLDialogElement.prototype;
    const showModal = Object.getOwnPropertyDescriptor(prototype, 'showModal');
    const close = Object.getOwnPropertyDescriptor(prototype, 'close');
    Object.defineProperties(prototype, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
    });

    try {
      render(<App />);
      const openComposer = () => fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
      openComposer();
      const composer = () => within(screen.getByRole('dialog'));
      fireEvent.change(composer().getByLabelText('Subject'), { target: { value: 'Demo attachment test' } });
      const files = [new File(['notes'], 'notes.txt'), new File(['route'], 'route.txt')];
      fireEvent.change(composer().getByLabelText('Attach files'), { target: { files } });
      expect(within(composer().getByRole('list', { name: 'Attachments' })).getAllByRole('listitem')).toHaveLength(2);
      fireEvent.click(composer().getByRole('button', { name: 'Remove notes.txt' }));
      expect(document.activeElement).toBe(composer().getByRole('button', { name: 'Attach files' }));
      fireEvent.click(composer().getByRole('button', { name: 'Close composer' }));
      fireEvent.click(screen.getByRole('button', { name: /^Drafts/ }));
      fireEvent.click(screen.getByRole('button', { name: /demo attachment test/i }));
      expect(composer().queryByText('notes.txt')).toBeNull();
      expect(composer().getByText('route.txt')).toBeTruthy();
      fireEvent.click(composer().getByRole('button', { name: 'Send' }));
      expect(composer().getByRole('alert').textContent).toMatch(/valid recipient/);
      fireEvent.change(composer().getByLabelText('To'), { target: { value: 'fail@example.test' } });
      fireEvent.click(composer().getByRole('button', { name: 'Send' }));
      expect(composer().getByRole('status').textContent).toMatch(/Sending/);
      act(() => vi.advanceTimersByTime(450));
      expect(composer().getByRole('alert').textContent).toMatch(/failed/);
      fireEvent.change(composer().getByLabelText('To'), { target: { value: 'friend@example.test' } });
      fireEvent.click(composer().getByRole('button', { name: 'Send' }));
      act(() => vi.advanceTimersByTime(450));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: /demo attachment test/i })).toBeNull();
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Mail folders' })).getByRole('button', { name: 'Sent' }));
      const sent = screen.getByRole('button', { name: /demo attachment test/i });
      fireEvent.click(sent);
      expect(screen.getByText('route.txt')).toBeTruthy();
    } finally {
      cleanup();
      if (showModal) Object.defineProperty(prototype, 'showModal', showModal);
      else Reflect.deleteProperty(prototype, 'showModal');
      if (close) Object.defineProperty(prototype, 'close', close);
      else Reflect.deleteProperty(prototype, 'close');
    }
  });

  it('updates the sample mailbox from row actions without opening another message', () => {
    render(<App />);
    const actions = within(screen.getByRole('group', { name: 'Manage message · Weekend plans' }));
    const inbox = screen.getByRole('button', { name: /^Inbox/ });
    fireEvent.click(actions.getByRole('button', { name: 'Mark as read' }));
    expect(actions.getByRole('button', { name: 'Mark as unread' })).toBeTruthy();
    expect(within(inbox).getByLabelText('3 unread')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Dolomites field notes' })).toBeTruthy();

    const archive = actions.getByRole('button', { name: 'Archive message' });
    act(() => archive.focus());
    fireEvent.click(archive);
    expect(screen.queryByRole('button', { name: /weekend plans/i })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const archived = within(screen.getByRole('group', { name: 'Manage message · Weekend plans' }));
    expect(archived.getByRole('button', { name: 'Mark as unread' })).toBeTruthy();
    fireEvent.click(archived.getByRole('button', { name: 'Move to Trash' }));

    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    const trashed = within(screen.getByRole('group', { name: 'Manage message · Weekend plans' }));
    expect(trashed.getByRole('button', { name: 'Mark as unread' })).toBeTruthy();
    expect(trashed.queryByRole('button', { name: 'Move to Trash' })).toBeNull();
  });

  it('shares reader actions with the mailbox', () => {
    render(<App />);
    const toolbar = within(screen.getByRole('group', { name: 'Manage message' }));
    expect(toolbar.getByLabelText('Snooze message')).toBeTruthy();

    fireEvent.click(toolbar.getByRole('button', { name: 'Add star' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Mark as read' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Archive message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /dolomites field notes/i }));
    expect(toolbar.getByRole('button', { name: 'Remove star' }).getAttribute('aria-pressed')).toBe('true');
    expect(toolbar.getByRole('button', { name: 'Mark as unread' })).toBeTruthy();
    fireEvent.click(toolbar.getByRole('button', { name: 'Move to Trash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(screen.getByRole('button', { name: /dolomites field notes/i })).toBeTruthy();
    fireEvent.click(toolbar.getByRole('button', { name: 'Restore message' }));
    expect(screen.queryByRole('button', { name: /dolomites field notes/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: /dolomites field notes/i })).toBeTruthy();
  });

  it('returns snoozed messages early on request or at 09:00 the next day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 18));
    render(<App />);
    const toolbar = () => within(screen.getByRole('group', { name: 'Manage message' }));
    const snooze = () => {
      const control = toolbar().getByLabelText('Snooze message');
      control.closest('details')!.open = true;
      fireEvent.click(toolbar().getByRole('button', { name: 'Snooze until tomorrow at 09:00' }));
    };
    const fieldNotes = () => screen.queryByRole('button', { name: /dolomites field notes/i });
    snooze();
    expect(fieldNotes()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Snoozed/ }));
    expect(fieldNotes()).toBeTruthy();
    fireEvent.click(toolbar().getByRole('button', { name: 'End snooze' }));
    expect(fieldNotes()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Inbox/ }));
    expect(fieldNotes()).toBeTruthy();
    snooze();
    act(() => vi.advanceTimersByTime(15 * 60 * 60 * 1000 - 1));
    expect(fieldNotes()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(fieldNotes()).toBeTruthy();
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

  it('searches across folders, sorts results, and filters messages with files', () => {
    render(<App />);
    const list = within(screen.getByRole('region', { name: 'Messages' }));
    fireEvent.change(list.getByRole('combobox', { name: 'Search scope' }), { target: { value: 'all' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Train tickets' } });
    expect(list.getByRole('button', { name: /travel itinerary/i })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.change(list.getByRole('combobox', { name: 'Sort messages' }), { target: { value: 'oldest' } });
    expect(list.getAllByRole('listitem')[0].textContent).toMatch(/old meeting invitation/i);
    fireEvent.click(list.getByRole('button', { name: 'Has attachments' }));
    expect(list.getAllByRole('listitem')).toHaveLength(1);
    expect(list.getByRole('button', { name: /dolomites field notes/i })).toBeTruthy();
  });

  it('uses distinct recipients for Reply all and keeps originals attached when forwarding', () => {
    const message = demoMessages[0];
    const reply = makeDraft({ mode: 'reply', message });
    const replyAll = makeDraft({ mode: 'replyAll', message });
    const forwarded = makeDraft({ mode: 'forward', message });
    expect(reply.to).toBe(message.address);
    expect(replyAll.to).toBe('mona@example.com, ayla@example.com');
    expect(replyAll.cc).toBe('sam@example.com');
    expect(forwarded.attachments).toHaveLength(2);
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
    expect(separator.getAttribute('aria-valuenow')).toBe('380');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('388');
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
