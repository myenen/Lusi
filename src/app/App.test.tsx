import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const dialogPrototype = HTMLDialogElement.prototype;
const originalDialogMethods = Object.getOwnPropertyDescriptors(dialogPrototype);
const dialogMethods = ['showModal', 'close'] as const;

beforeEach(() => {
  Object.defineProperties(dialogPrototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
});

afterEach(() => {
  cleanup();
  for (const method of dialogMethods) {
    const descriptor = originalDialogMethods[method];
    if (descriptor) Object.defineProperty(dialogPrototype, method, descriptor);
    else Reflect.deleteProperty(dialogPrototype, method);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function openSettings(name = 'Settings') {
  const trigger = screen.getByRole('button', { name });
  fireEvent.click(trigger);
  return screen.getByRole('dialog', { name });
}

describe('account setup', () => {
  it('starts in light Liquid Glass even on a dark system', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { unmount } = render(<App />);
    const setup = screen.getByRole('heading', { name: 'Set up your email' });
    const workspace = setup.closest('.workspace');
    expect(workspace?.getAttribute('data-color-scheme')).toBe('light');
    expect(workspace?.getAttribute('data-theme-id')).toBe('default');
    expect(screen.queryByRole('heading', { name: 'Inbox' })).toBeNull();
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(screen.queryByRole('button', { name: /demo inbox/i })).toBeNull();
    unmount();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Set up your email' })).toBeTruthy();
  });

  it('uses only an email address on the first screen and leaves credentials disabled in the browser', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['tr-TR']);
    render(<App />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    const email = screen.getByLabelText<HTMLInputElement>('E-posta adresi');
    expect(email.checkValidity()).toBe(false);
    fireEvent.change(email, { target: { value: 'mail@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Devam et' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Posta kutunu bağla' }));
    expect(screen.getByText('mail@example.test')).toBeTruthy();
    expect(screen.queryByLabelText('Şifre veya uygulama şifresi')).toBeNull();
    fireEvent.change(screen.getByLabelText('IMAP sunucusu'), { target: { value: 'imap.example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Devam et' }));
    expect(screen.getByLabelText<HTMLInputElement>('Şifre veya uygulama şifresi').disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Hesabı bağla' }).disabled).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Gelen Kutusu' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sunucu ayarlarını düzenle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hesap bilgilerini düzenle' }));
    expect(screen.getByLabelText<HTMLInputElement>('E-posta adresi').value).toBe('mail@example.test');
  });

  it('connects through desktop commands, reads text on demand and reopens the saved inbox', async () => {
    const key = { uidValidity: 20, uid: 17 };
    const inbox = { email: 'mail@example.test', headers: [
      { key, sender: 'Sample sender', address: 'sender@example.test', subject: 'Real inbox example', sentAt: null, unread: true },
    ] };
    let connected = false;
    const invoke = vi.fn(async (command: string) => {
      switch (command) {
        case 'load_ui_preferences':
          return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
        case 'load_connected_inbox': return connected ? inbox : null;
        case 'list_connected_folders': return [];
        case 'discover_imap_settings': return null;
        case 'check_imap_settings': return undefined;
        case 'connect_imap_account': connected = true; return inbox;
        case 'read_connected_message': return '<img src="https://example.test/pixel"> Hello.';
        case 'refresh_connected_inbox': throw 'network';
        default: throw new Error('Unexpected Tauri command');
      }
    });
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    const first = render(<App />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: inbox.email } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('IMAP server'), { target: { value: 'imap.example.test' } });
    expect(invoke).toHaveBeenCalledWith('discover_imap_settings', { email: inbox.email }, undefined);
    expect(screen.getByText(/couldn’t find your IMAP settings/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('Password or app password'), { target: { value: 'fixture-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    expect(invoke).toHaveBeenCalledWith('connect_imap_account', {
      account: { email: inbox.email, host: 'imap.example.test', port: 993 }, password: 'fixture-only',
    }, undefined);
    await screen.findByRole('button', { name: /Real inbox example/ });
    const sidebar = within(screen.getByRole('complementary', { name: 'Sidebar' }));
    const list = within(screen.getByRole('region', { name: 'Messages' }));
    const reader = within(screen.getByRole('main', { name: 'Message reader' }));
    expect(sidebar.getByText(inbox.email)).toBeTruthy();
    expect(sidebar.queryByRole('button', { name: 'Compose' })).toBeNull();
    expect(list.queryByRole('button', { name: 'Select messages' })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('read_connected_message', { folder: 'INBOX', key }, undefined);
    fireEvent.change(list.getByRole('searchbox'), { target: { value: 'unrelated' } });
    expect(list.queryByRole('button', { name: /Real inbox example/ })).toBeNull();
    fireEvent.change(list.getByRole('searchbox'), { target: { value: 'sample sender' } });
    expect(list.getByRole('button', { name: /Real inbox example/ })).toBeTruthy();
    fireEvent.click(list.getByRole('button', { name: /Real inbox example/ }));
    expect(await screen.findByText(/Hello\./)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(reader.queryByRole('button', { name: 'Archive message' })).toBeNull();
    expect(invoke).toHaveBeenCalledWith('read_connected_message', { folder: 'INBOX', key }, undefined);
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    const settings = within(openSettings());
    expect(settings.getByText(inbox.email)).toBeTruthy();
    expect(settings.queryByText('Work demo')).toBeNull();
    fireEvent.click(settings.getByRole('button', { name: 'Close settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Real inbox example/ })).toBeTruthy();
    first.unmount();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
  });

  it.each([false, true])('uses discovered TLS settings and falls back after a connection error (confirmation %s)', async (needsConfirmation) => {
    const host = needsConfirmation ? 'imap.host.example' : 'imap.example.test';
    const invoke = vi.fn(async (command: string) => {
      switch (command) {
        case 'load_ui_preferences':
          return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
        case 'load_connected_inbox': return null;
        case 'discover_imap_settings': return { host, port: 1993, needsConfirmation };
        case 'connect_imap_account': throw 'tls';
        default: throw new Error('Unexpected Tauri command');
      }
    });
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'mail@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const password = await screen.findByLabelText<HTMLInputElement>('Password or app password');
    expect(screen.getByText(`${host}:1993`)).toBeTruthy();
    expect(screen.queryByLabelText('IMAP server')).toBeNull();
    expect(password.disabled).toBe(needsConfirmation);
    if (needsConfirmation) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Connect account' }).disabled).toBe(true);
      fireEvent.click(screen.getByRole('checkbox', { name: /verified the hostname and port/ }));
    }
    expect(password.disabled).toBe(false);
    fireEvent.change(password, { target: { value: 'fixture-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('IMAP server').value).toBe(host);
    expect(screen.getByLabelText<HTMLInputElement>('TLS port').value).toBe('1993');
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
  });
});

const fixtureKey = { uidValidity: 20, uid: 17 };
const fixtureHeader = { key: fixtureKey, sender: 'Sample sender', address: 'sender@example.test', subject: 'Inbox message', sentAt: null, unread: true };

function mockMailbox() {
  const invoke = vi.fn(async (command: string, args: { folder?: string }): Promise<unknown> => {
    switch (command) {
      case 'load_ui_preferences':
        return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
      case 'load_connected_inbox':
      case 'refresh_connected_inbox':
        return { email: 'mail@example.test', headers: [fixtureHeader] };
      case 'list_connected_folders':
        return [
          { id: 'INBOX', name: 'Inbox', kind: 'inbox' },
          { id: 'INBOX.Outgoing', name: 'INBOX.Outgoing', kind: 'sent' },
          { id: 'INBOX.Arşiv', name: 'INBOX.Arşiv', kind: 'archive' },
          { id: 'INBOX.İş', name: 'INBOX.İş', kind: 'custom' },
        ];
      case 'read_connected_folder': return [{ ...fixtureHeader, subject: args.folder === 'INBOX.Outgoing' ? 'Sent message' : 'Archived message' }];
      case 'read_connected_message': return args.folder === 'INBOX.Outgoing' ? 'Sent body' : 'Inbox body';
      default: throw new Error('Unexpected Tauri command');
    }
  });
  vi.stubGlobal('isTauri', true);
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  return invoke;
}

describe('connected mailbox', () => {
  it('reveals the sidebar, list and reader on startup', async () => {
    mockMailbox();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: no-preference)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    const panes: string[] = [];
    const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value(this: Element) { panes.push(this.classList[0]); return { cancel: vi.fn() }; },
    });
    try {
      render(<App />);
      await screen.findByRole('heading', { name: 'Inbox' });
      expect(panes).toEqual(['sidebar', 'mail-list', 'reader']);
    } finally {
      if (animate) Object.defineProperty(Element.prototype, 'animate', animate);
      else Reflect.deleteProperty(Element.prototype, 'animate');
    }
  });

  it('shows the server folders and scopes the opened message to its folder', async () => {
    const invoke = mockMailbox();
    render(<App />);
    const nav = within(await screen.findByRole('navigation', { name: 'Mail folders' }));
    expect(await nav.findByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(nav.getByRole('button', { name: 'INBOX.İş' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Inbox message/ }));
    expect(await screen.findByText('Inbox body')).toBeTruthy();
    fireEvent.click(nav.getByRole('button', { name: 'Sent' }));
    fireEvent.click(await screen.findByRole('button', { name: /Sent message/ }));
    expect(await screen.findByText('Sent body')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('read_connected_folder', { folder: 'INBOX.Outgoing' }, undefined);
    expect(invoke).toHaveBeenCalledWith('read_connected_message', { folder: 'INBOX.Outgoing', key: fixtureKey }, undefined);
    expect(screen.queryByText('Inbox body')).toBeNull();
    fireEvent.click(nav.getByRole('button', { name: /^Inbox/ }));
    expect(screen.getByRole('button', { name: /Inbox message/ })).toBeTruthy();
  });

  it('keeps appearance synchronized and restores settings focus on dismissal', async () => {
    mockMailbox();
    render(<App />);
    const sidebar = within(await screen.findByRole('complementary', { name: 'Sidebar' }));
    fireEvent.click(sidebar.getByRole('radio', { name: 'Dark' }));
    const settingsTrigger = screen.getByRole('button', { name: 'Settings' });
    const settings = within(openSettings());
    expect(settings.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);
    expect(settings.getByText('mail@example.test')).toBeTruthy();
    fireEvent.click(settings.getByRole('radio', { name: 'Light' }));
    fireEvent.click(settings.getByRole('button', { name: 'Close settings' }));
    expect(document.activeElement).toBe(settingsTrigger);
    expect(sidebar.getByRole<HTMLInputElement>('radio', { name: 'Light' }).checked).toBe(true);
  });

  it('ignores a late response from the previously selected folder', async () => {
    const invoke = mockMailbox();
    const implementation = invoke.getMockImplementation()!;
    let finishSent: ((headers: typeof fixtureHeader[]) => void) | undefined;
    invoke.mockImplementation((command, args) => command === 'read_connected_folder' && args.folder === 'INBOX.Outgoing'
      ? new Promise((resolve) => { finishSent = resolve; })
      : implementation(command, args));
    render(<App />);
    const nav = within(await screen.findByRole('navigation', { name: 'Mail folders' }));
    fireEvent.click(await nav.findByRole('button', { name: 'Sent' }));
    fireEvent.click(nav.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('button', { name: /Archived message/ })).toBeTruthy();
    await act(async () => finishSent?.([{ ...fixtureHeader, subject: 'Late sent message' }]));
    expect(screen.queryByRole('button', { name: /Late sent message/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Archived message/ })).toBeTruthy();
  });

  it('keeps the folder navigation available when the sidebar is collapsed', async () => {
    mockMailbox();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    const folders = within(screen.getByRole('navigation', { name: 'Mail folders' }));
    expect(await folders.findByRole('button', { name: 'Sent' })).toBeTruthy();
  });

  it('moves focus into a message in a narrow window and restores it on return', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    mockMailbox();
    render(<App />);
    const message = await screen.findByRole('button', { name: /Inbox message/ });
    fireEvent.click(message);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Inbox message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to messages' }));
    expect(document.activeElement).toBe(message);
  });
});
