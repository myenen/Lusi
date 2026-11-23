import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { updateConnectedMessages, type MessageKey, type MessageSearchRequest } from '../features/accounts/imap-api';
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
    fireEvent.change(screen.getByLabelText('SMTP sunucusu'), { target: { value: 'smtp.example.test' } });
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
    const inbox = { accountId: 1, email: 'mail@example.test', headers: [
      { key, sender: 'Sample sender', address: 'sender@example.test', subject: 'Real inbox example', sentAt: null, unread: true },
    ] };
    let connected = false;
    const invoke = vi.fn(async (command: string) => {
      switch (command) {
        case 'load_ui_preferences':
          return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
        case 'load_connected_inbox': return connected ? inbox : null;
        case 'list_connected_accounts': return [{ id: inbox.accountId, email: inbox.email }];
        case 'list_connected_folders': return [];
        case 'discover_imap_settings': return null;
        case 'check_imap_settings': return undefined;
        case 'connect_imap_account': connected = true; return inbox;
        case 'read_connected_message': return { body: '<img src="https://example.test/pixel"> Hello.', seen: true, seenError: null };
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
    fireEvent.change(screen.getByLabelText('SMTP server'), { target: { value: 'smtp.example.test' } });
    expect(invoke).toHaveBeenCalledWith('discover_imap_settings', { email: inbox.email }, undefined);
    expect(screen.getByText(/couldn’t find your IMAP settings/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('Password or app password'), { target: { value: 'fixture-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    expect(invoke).toHaveBeenCalledWith('connect_imap_account', {
      account: { email: inbox.email, host: 'imap.example.test', port: 993 },
      outgoing: { host: 'smtp.example.test', port: 587, startTls: true }, password: 'fixture-only',
    }, undefined);
    await screen.findByRole('button', { name: /Real inbox example/ });
    const sidebar = within(screen.getByRole('complementary', { name: 'Sidebar' }));
    const list = within(screen.getByRole('region', { name: 'Messages' }));
    const reader = within(screen.getByRole('main', { name: 'Message reader' }));
    expect(sidebar.getByText(inbox.email)).toBeTruthy();
    expect(sidebar.getByRole<HTMLButtonElement>('button', { name: 'Compose' }).disabled).toBe(true);
    expect(list.getByRole('button', { name: 'Select messages' })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith('read_connected_message', { accountId: 1, folder: 'INBOX', key, unread: true }, undefined);
    fireEvent.change(list.getByRole('searchbox'), { target: { value: 'unrelated' } });
    expect(list.queryByRole('button', { name: /Real inbox example/ })).toBeNull();
    fireEvent.change(list.getByRole('searchbox'), { target: { value: 'sample sender' } });
    expect(list.getByRole('button', { name: /Real inbox example/ })).toBeTruthy();
    fireEvent.click(list.getByRole('button', { name: /Real inbox example/ }));
    expect(await screen.findByText(/Hello\./)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(reader.getByRole<HTMLButtonElement>('button', { name: 'Archive message' }).disabled).toBe(true);
    expect(invoke).toHaveBeenCalledWith('read_connected_message', { accountId: 1, folder: 'INBOX', key, unread: true }, undefined);
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

  it('uses Google sign-in for the Gmail preset and can reconnect the same account', async () => {
    const email = 'sample@googlemail.com';
    let signIns = 0;
    const invoke = vi.fn(async (command: string) => {
      switch (command) {
        case 'load_ui_preferences':
          return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
        case 'load_connected_inbox': return null;
        case 'discover_imap_settings': return {
          host: 'imap.gmail.com', port: 993, needsConfirmation: false,
          outgoing: { host: 'smtp.gmail.com', port: 465, startTls: false }, oauthProvider: 'gmail',
        };
        case 'connect_gmail_account':
          if (++signIns === 1) throw 'googleAccountMismatch';
          return { accountId: 1, email, headers: [], canSend: true, oauthProvider: 'gmail' };
        case 'list_connected_accounts': return [{ id: 1, email }];
        case 'list_connected_folders': return [{ id: 'INBOX', name: 'Inbox', kind: 'inbox' }];
        default: throw new Error('Unexpected Tauri command');
      }
    });
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Gmail settings found' })).toBeTruthy();
    expect(screen.getByText('IMAP · imap.gmail.com:993 (SSL/TLS)')).toBeTruthy();
    expect(screen.getByText('SMTP · smtp.gmail.com:465 (SSL/TLS)')).toBeTruthy();
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
    expect(screen.queryByLabelText('IMAP server')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect account' })).toBeNull();
    expect(invoke).toHaveBeenCalledWith('discover_imap_settings', { email }, undefined);
    expect(invoke).not.toHaveBeenCalledWith('connect_imap_account', expect.anything(), undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Edit account details' }));
    expect(screen.getByLabelText<HTMLInputElement>('Email address').value).toBe(email);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Choose the Google account that matches the Gmail address you entered.');
    expect(invoke).toHaveBeenCalledWith('connect_gmail_account', { email }, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await screen.findByRole('heading', { name: 'Inbox' });
    const settings = within(openSettings());
    fireEvent.click(settings.getByRole('button', { name: 'Reconnect with Google' }));
    expect(await settings.findByText('Gmail is connected again.')).toBeTruthy();
    expect(signIns).toBe(3);
  });

  it.each([false, true])('uses discovered TLS settings and falls back after a connection error (confirmation %s)', async (needsConfirmation) => {
    const host = needsConfirmation ? 'imap.host.example' : 'imap.example.test';
    const outgoing = { host: 'smtp.example.test', port: 465, startTls: false, username: 'outbox' };
    const invoke = vi.fn(async (command: string) => {
      switch (command) {
        case 'load_ui_preferences':
          return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
        case 'load_connected_inbox': return null;
        case 'discover_imap_settings': return { host, port: 1993, needsConfirmation, username: 'mail', startTls: true, outgoing };
        case 'connect_imap_account': throw 'smtpTls';
        default: throw new Error('Unexpected Tauri command');
      }
    });
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'mail@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const password = await screen.findByLabelText<HTMLInputElement>('Password or app password');
    expect(screen.getByText(`IMAP · ${host}:1993`)).toBeTruthy();
    expect(screen.getByText('SMTP · smtp.example.test:465 (SSL/TLS)')).toBeTruthy();
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
    expect(invoke).toHaveBeenCalledWith('connect_imap_account', {
      account: { email: 'mail@example.test', host, port: 1993, username: 'mail', startTls: true }, outgoing, password: 'fixture-only',
    }, undefined);
    expect(screen.getByLabelText<HTMLInputElement>('IMAP server').value).toBe(host);
    expect(screen.getByLabelText<HTMLInputElement>('IMAP port').value).toBe('1993');
    expect(screen.getByRole('combobox', { name: 'Connection security' }).textContent).toBe('STARTTLS');
    expect(screen.getByLabelText<HTMLInputElement>('SMTP server').value).toBe(outgoing.host);
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
  });

  it.each([false, true])('only keeps a discovered login for its original host (edited host %s)', async (editedHost) => {
    const invoke = vi.fn(async (command: string) => {
      switch (command) {
        case 'load_ui_preferences':
          return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
        case 'load_connected_inbox': return null;
        case 'discover_imap_settings':
          return { host: 'imap.provider.test', port: 993, needsConfirmation: true, username: 'mail' };
        case 'check_imap_settings': return undefined;
        default: throw new Error('Unexpected Tauri command');
      }
    });
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'mail@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const outgoing = await screen.findByLabelText('SMTP server');
    for (const protocol of ['IMAP', 'SMTP']) {
      const fields = within(screen.getByRole('group', { name: protocol }));
      expect(fields.getAllByRole('textbox')).toHaveLength(1);
      expect(fields.getByRole('spinbutton')).toBeTruthy();
      expect(fields.getByRole('combobox')).toBeTruthy();
    }
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
    const host = editedHost ? 'imap.manual.test' : 'imap.provider.test';
    if (editedHost) fireEvent.change(screen.getByLabelText('IMAP server'), { target: { value: host } });
    fireEvent.change(outgoing, { target: { value: 'smtp.example.test' } });
    fireEvent.change(screen.getByLabelText('SMTP port'), { target: { value: '465' } });
    expect(screen.getByRole('combobox', { name: 'SMTP security' }).textContent).toBe('SSL/TLS');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByLabelText<HTMLInputElement>('Password or app password')).disabled).toBe(!editedHost);
    expect(invoke).toHaveBeenCalledWith('check_imap_settings', {
      account: { email: 'mail@example.test', host, port: 993, ...(!editedHost && { username: 'mail' }) },
      outgoing: { host: 'smtp.example.test', port: 465, startTls: false },
    }, undefined);
  });
});

const fixtureKey = { uidValidity: 20, uid: 17 };
const fixtureHeader = { key: fixtureKey, sender: 'Sample sender', address: 'sender@example.test', subject: 'Inbox message', sentAt: null, unread: true, starred: false };

function mockMailbox() {
  const invoke = vi.fn(async (command: string, args: {
    folder?: string; accountId?: number; request?: MessageSearchRequest; event?: string; handler?: number;
  }): Promise<unknown> => {
    switch (command) {
      case 'load_ui_preferences':
        return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
      case 'load_connected_inbox':
      case 'refresh_connected_inbox':
        return { accountId: 1, email: 'mail@example.test', headers: [fixtureHeader], canSend: true };
      case 'list_connected_accounts': return [{ id: 1, email: 'mail@example.test' }];
      case 'list_connected_folders':
        return [
          { id: 'INBOX', name: 'Inbox', kind: 'inbox' },
          { id: 'INBOX.Outgoing', name: 'INBOX.Outgoing', kind: 'sent' },
          { id: 'INBOX.Arşiv', name: 'INBOX.Arşiv', kind: 'archive' },
          { id: 'INBOX.Trash', name: 'INBOX.Trash', kind: 'trash' },
          { id: 'INBOX.İş', name: 'INBOX.İş', kind: 'custom' },
        ];
      case 'read_connected_folder': return [{ ...fixtureHeader, subject: args.folder === 'INBOX.Outgoing' ? 'Sent message' : 'Archived message' }];
      case 'read_connected_message': return {
        body: args.folder === 'INBOX.Outgoing' ? 'Sent body' : 'Inbox body',
        reply: { to: ['reply@example.test'], cc: ['team@example.test'], thread: { inReplyTo: 'parent@example.test', references: ['first@example.test'] } },
        seen: true, seenError: null,
      };
      case 'send_connected_message':
      case 'save_ui_preferences':
      case 'update_connected_message': return undefined;
      default: throw new Error('Unexpected Tauri command');
    }
  });
  vi.stubGlobal('isTauri', true);
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  return invoke;
}

function mockMailEvents(invoke: ReturnType<typeof mockMailbox>) {
  type Callback = (event: { payload: unknown }) => void;
  const pending: Callback[] = [];
  const listeners = new Map<string, Callback>();
  const fallback = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'plugin:event|listen' && args.event && args.handler !== undefined) {
      listeners.set(args.event, pending[args.handler]);
      return args.handler;
    }
    if (command === 'plugin:event|unlisten') return;
    return fallback(command, args);
  });
  vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', {
    unregisterListener(event: string) { listeners.delete(event); },
  });
  vi.stubGlobal('__TAURI_INTERNALS__', {
    invoke,
    transformCallback(handler: Callback) { return pending.push(handler) - 1; },
  });
  return (event: string, payload: unknown) => listeners.get(event)?.({ payload });
}

describe('connected mailbox', () => {
  it('opens the Inbox, compose and settings through native tray actions', async () => {
    const receive = mockMailEvents(mockMailbox());
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sent' }));
    await screen.findByRole('button', { name: /Sent message/ });
    await act(async () => receive('desktop:menu-action', 'inbox'));
    expect(await screen.findByRole('button', { name: /Inbox message/ })).toBeTruthy();

    await act(async () => receive('desktop:menu-action', 'settings'));
    const settings = await screen.findByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(settings).getByRole('button', { name: 'Close settings' }));
    await act(async () => receive('desktop:menu-action', 'compose'));
    expect(await screen.findByRole('dialog', { name: 'New message' })).toBeTruthy();
  });

  it('defaults to background sync on close and saves the opt-out choice', async () => {
    const invoke = mockMailbox();
    render(<App />);
    await screen.findByRole('button', { name: /Inbox message/ });
    const closePreference = within(openSettings()).getByRole<HTMLInputElement>('checkbox', {
      name: 'Keep checking mail after closing the window',
    });
    expect(closePreference.checked).toBe(true);
    await act(async () => fireEvent.click(closePreference));
    expect(closePreference.checked).toBe(false);
    expect(invoke).toHaveBeenCalledWith('save_ui_preferences', {
      preferences: expect.objectContaining({ keepRunningOnClose: false }),
    }, undefined);
  });

  it('reflects background changes for the active inbox without mixing accounts', async () => {
    const receive = mockMailEvents(mockMailbox());
    render(<App />);
    await screen.findByRole('button', { name: /Inbox message/ });
    const incoming = { ...fixtureHeader, subject: 'Background delivery', key: { ...fixtureKey, uid: 55 } };
    await act(async () => receive('mail:inbox-changed', { accountId: 2, email: 'other@example.test', headers: [incoming], canSend: true }));
    expect(screen.queryByText(incoming.subject)).toBeNull();
    await act(async () => receive('mail:inbox-changed', { accountId: 1, email: 'mail@example.test', headers: [incoming], canSend: true }));
    expect(screen.getByRole('button', { name: /Background delivery/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Inbox message/ })).toBeNull();
  });

  it('opens a notification message outside the cached window in the correct account', async () => {
    const invoke = mockMailbox();
    const receive = mockMailEvents(invoke);
    render(<App />);
    await screen.findByRole('button', { name: /Inbox message/ });
    const header = { ...fixtureHeader, subject: 'Message from notification', key: { uidValidity: 5, uid: 9 } };
    await act(async () => receive('mail:notification-open', {
      inbox: { accountId: 2, email: 'other@example.test', headers: [], canSend: true },
      header,
    }));
    expect(await screen.findByRole('heading', { name: header.subject })).toBeTruthy();
    expect(await screen.findByText('Inbox body')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('read_connected_message', expect.objectContaining({
      accountId: 2, folder: 'INBOX', key: header.key,
    }), undefined);
  });

  it('opens a Windows notification queued before the app registered its listeners', async () => {
    const invoke = mockMailbox();
    const header = { ...fixtureHeader, subject: 'Queued notification message' };
    const fallback = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => command === 'take_notification_open'
      ? { inbox: { accountId: 2, email: 'other@example.test', headers: [header], canSend: true }, header }
      : fallback(command, args));
    mockMailEvents(invoke);
    render(<App />);
    expect(await screen.findByRole('heading', { name: header.subject })).toBeTruthy();
    expect(await screen.findByText('Inbox body')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('read_connected_message', expect.objectContaining({
      accountId: 2, folder: 'INBOX', key: header.key,
    }), undefined);
  });

  it('hides notification details by default and disables the details setting when notifications are off', async () => {
    mockMailbox();
    render(<App />);
    await screen.findByRole('button', { name: /Inbox message/ });
    const settings = within(openSettings());
    const enabled = settings.getByRole<HTMLInputElement>('checkbox', { name: 'Notify me about new mail' });
    const details = settings.getByRole<HTMLInputElement>('checkbox', { name: 'Show sender and subject in notifications' });
    expect(enabled.checked).toBe(true);
    expect(details.checked).toBe(false);
    fireEvent.click(enabled);
    expect(details.disabled).toBe(true);
  });
  it('finds messages beyond the loaded inbox and pages remote results', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    const first = { ...fixtureHeader, subject: 'Older invoice', key: { ...fixtureKey, uid: 10 } };
    const second = { ...first, subject: 'Earliest invoice', key: { ...fixtureKey, uid: 2 } };
    invoke.mockImplementation(async (command, args) => {
      if (command !== 'search_connected_messages') return fallback(command, args);
      return args.request?.cursor
        ? { headers: [second], nextCursor: null }
        : { headers: [first], nextCursor: first.key };
    });
    render(<App />);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'invoice' } });
    expect(await screen.findByRole('button', { name: /Older invoice/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Inbox message/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load more results' }));
    fireEvent.click(await screen.findByRole('button', { name: /Earliest invoice/ }));
    expect(await screen.findByText('Inbox body')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('search_connected_messages', {
      accountId: 1, folder: 'INBOX',
      request: { query: 'invoice', unreadOnly: false, oldestFirst: false, cursor: first.key },
    }, undefined);
  });

  it('keeps matching loaded senders visible when server search fails', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === 'search_connected_messages') throw 'network';
      return fallback(command, args);
    });
    render(<App />);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'sender@example.test' } });
    expect(await screen.findByText(/Server search is unavailable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Inbox message/ })).toBeTruthy();
  });

  it('limits each bulk action request to 50 and retains confirmed updates if the next batch fails', async () => {
    const keys = Array.from({ length: 51 }, (_, index) => ({ uidValidity: 20, uid: index + 1 }));
    const invoke = vi.fn(async (_command: string, args: { keys: MessageKey[] }) => {
      if (args.keys.length === 1) throw 'network';
      return { updated: args.keys, error: null };
    });
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    expect(await updateConnectedMessages(1, 'INBOX', keys, 'read')).toEqual({ updated: keys.slice(0, 50), error: 'network' });
    expect(invoke.mock.calls.map(([, args]) => args.keys.length)).toEqual([50, 1]);
  });

  it('retries loading older mail, opens it and clears pagination on refresh', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    const older = { ...fixtureHeader, key: { ...fixtureKey, uid: 11 }, subject: 'Older message' };
    let fail = true;
    invoke.mockImplementation(async (command, args) => {
      if (command === 'read_older_connected_messages') {
        if (fail) throw 'network';
        return { headers: [older], nextBefore: null };
      }
      return fallback(command, args);
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    const retry = await screen.findByRole('button', { name: 'Retry loading older messages' });
    fail = false;
    fireEvent.click(retry);
    fireEvent.click(await screen.findByRole('button', { name: /Older message/ }));
    expect(invoke).toHaveBeenCalledWith('read_older_connected_messages', { accountId: 1, folder: 'INBOX', before: fixtureKey }, undefined);
    expect(invoke).toHaveBeenCalledWith('read_connected_message', { accountId: 1, folder: 'INBOX', key: older.key, unread: true }, undefined);
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' })));
    expect(screen.queryByText('Older message')).toBeNull();
    expect(screen.getByRole('button', { name: 'Load older messages' })).toBeTruthy();
  });

  it('previews the selected message and requests printing only from the preview', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === 'read_connected_message') {
        return {
          body: null, seen: true, seenError: null,
          html: { content: '<p><strong>Printable body</strong> <a href="https://example.test">Link text</a></p><table><tbody><tr><td>Table value</td></tr></tbody></table><img src="https://example.test/track.gif"><script>hidden script</script>' },
          attachments: [{ part: [2], name: 'Report.pdf', isImage: false, canOpen: true }],
        };
      }
      if (command === 'plugin:webview|print') return undefined;
      return fallback(command, args);
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Inbox message/ }));
    const reader = within(screen.getByRole('main', { name: 'Message reader' }));
    await reader.findByTitle('HTML message content');
    const trigger = reader.getByRole('button', { name: 'Print preview' });
    fireEvent.click(trigger);

    const modal = within(screen.getByRole('dialog', { name: 'Print preview' }));
    expect(modal.getByRole('heading', { name: 'Inbox message' })).toBeTruthy();
    expect(modal.getByText('Printable body').tagName).toBe('STRONG');
    expect(modal.getByRole('cell', { name: 'Table value' })).toBeTruthy();
    expect(modal.getByText('Report.pdf')).toBeTruthy();
    expect(modal.queryByRole('link')).toBeNull();
    expect(modal.queryByText('hidden script')).toBeNull();
    expect(document.querySelector('.mail-print-output img')).toBeNull();
    expect(invoke.mock.calls.some(([command]) => command === 'plugin:webview|print')).toBe(false);

    await act(async () => fireEvent.click(modal.getByRole('button', { name: 'Print' })));
    expect(invoke).toHaveBeenCalledWith('plugin:webview|print', {}, undefined);
    fireEvent.click(modal.getByRole('button', { name: 'Close print preview' }));
    expect(screen.queryByRole('dialog', { name: 'Print preview' })).toBeNull();
    expect(document.querySelector('.mail-print-output')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('marks attachment rows, shows file names and requests only the chosen part', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    const filename = 'Yearly consolidated price list for academic publications.xls';
    invoke.mockImplementation(async (command, args) => {
      if (command === 'load_connected_inbox' || command === 'refresh_connected_inbox') {
        const plain = { ...fixtureHeader, key: { ...fixtureKey, uid: 18 }, subject: 'Plain message' };
        return { accountId: 1, email: 'mail@example.test', headers: [{ ...fixtureHeader, hasAttachments: true }, plain], canSend: true };
      }
      if (command === 'read_connected_message') {
        return { body: 'Example body', seen: true, seenError: null,
          attachments: [
            { part: [2, 1], name: filename, isImage: false, canOpen: true },
            { part: [3], name: 'Tools.exe', isImage: false, canOpen: false },
          ] };
      }
      if (command === 'open_connected_attachment') return undefined;
      if (command === 'download_connected_attachment') return 'openFailed';
      return fallback(command, args);
    });
    render(<App />);
    const row = await screen.findByRole('button', { name: /Inbox message/ });
    expect(within(row).getByRole('img', { name: 'Has attachments' })).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Plain message/ })).queryByRole('img', { name: 'Has attachments' })).toBeNull();
    expect(invoke.mock.calls.some(([command]) => command === 'download_connected_attachment')).toBe(false);
    fireEvent.click(row);
    const attachments = within(await screen.findByRole('region', { name: 'Attachments' }));
    const open = attachments.getByRole<HTMLButtonElement>('button', { name: `Open ${filename}` });
    const download = attachments.getByRole('button', { name: `Download and open ${filename}` });
    expect(open.classList.contains('icon-button') && download.classList.contains('icon-button')).toBe(true);
    expect(attachments.queryByRole('button', { name: 'Open Tools.exe' })).toBeNull();
    await act(async () => fireEvent.click(attachments.getByTitle(filename)));
    expect(invoke).toHaveBeenCalledWith('open_connected_attachment', {
      accountId: 1, folder: 'INBOX', key: fixtureKey, part: [2, 1],
    }, undefined);
    expect(invoke.mock.calls.some(([command]) => command === 'download_connected_attachment')).toBe(false);
    fireEvent.click(download);
    expect((await attachments.findByRole('alert')).textContent).toBe('Attachment saved to Downloads. The default app could not open it.');
    expect(invoke).toHaveBeenCalledWith('download_connected_attachment', {
      accountId: 1, folder: 'INBOX', key: fixtureKey, part: [2, 1],
    }, undefined);
  });

  it('offers quick account switching only when multiple accounts are saved', async () => {
    mockMailbox();
    render(<App />);
    await screen.findByText('mail@example.test');
    await act(async () => {});
    expect(screen.queryByRole('combobox', { name: /Switch account/ })).toBeNull();
  });

  it('switches from the sidebar and keeps the current mailbox when the switch fails', async () => {
    if (!HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
      onTestFinished(() => { Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); });
    }
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    const second = { id: 2, email: 'second@example.test' };
    let failSwitch = true;
    invoke.mockImplementation(async (command, args) => {
      if (command === 'list_connected_accounts') return [{ id: 1, email: 'mail@example.test' }, second];
      if (command === 'switch_connected_account') {
        if (failSwitch) throw 'storage';
        return { accountId: second.id, email: second.email, headers: [{ ...fixtureHeader, subject: 'Second mailbox' }], canSend: true };
      }
      return fallback(command, args);
    });
    render(<App />);
    const switcher = await screen.findByRole('combobox', { name: /Switch account.*mail@example.test/ });
    const chooseSecond = async () => {
      fireEvent.keyDown(switcher, { key: 'Enter' });
      fireEvent.keyDown(await screen.findByRole('option', { name: second.email }), { key: 'Enter' });
    };
    await chooseSecond();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Inbox message')).toBeTruthy();
    failSwitch = false;
    await chooseSecond();
    expect(await screen.findByText('Second mailbox')).toBeTruthy();
    expect(await screen.findByRole('combobox', { name: /Switch account.*second@example.test/ })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('switch_connected_account', { accountId: second.id }, undefined);
  });

  it('selects visible messages and keeps unconfirmed messages selected after a bulk action', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    const second = { ...fixtureHeader, key: { ...fixtureKey, uid: 18 }, subject: 'Project notes' };
    invoke.mockImplementation(async (command, args) => {
      if (command === 'load_connected_inbox' || command === 'refresh_connected_inbox') {
        return { accountId: 1, email: 'mail@example.test', headers: [fixtureHeader, second], canSend: true };
      }
      if (command === 'update_connected_messages') {
        return { updated: [fixtureKey], error: 'actionFailed' };
      }
      return fallback(command, args);
    });
    render(<App />);
    const toggle = await screen.findByRole('button', { name: 'Select messages' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Inbox message' }));
    expect(screen.getByText('1 selected')).toBeTruthy();

    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select all visible' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Project notes' }).checked).toBe(true);
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('0 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select all visible' }));
    const actions = within(screen.getByRole('group', { name: 'Bulk actions' }));
    fireEvent.click(actions.getByRole('button', { name: 'Archive message' }));

    expect(await screen.findByText('1 message updated.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The server did not confirm the change.');
    expect(screen.queryByRole('checkbox', { name: 'Select Inbox message' })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Project notes' }).checked).toBe(true);
    expect(invoke).toHaveBeenCalledWith('update_connected_messages', {
      accountId: 1, folder: 'INBOX', keys: [fixtureKey, second.key], action: 'archive',
    }, undefined);
    expect(invoke.mock.calls.some(([command]) => command === 'read_connected_message')).toBe(false);

    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('group', { name: 'Manage message' })).toBeTruthy();
  });

  it('runs list actions on the row without opening it or replacing the current reading selection', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    const second = { ...fixtureHeader, key: { ...fixtureKey, uid: 18 }, subject: 'Other inbox message' };
    invoke.mockImplementation((command, args) => command === 'load_connected_inbox' || command === 'refresh_connected_inbox'
      ? Promise.resolve({ accountId: 1, email: 'mail@example.test', headers: [fixtureHeader, second], canSend: true })
      : fallback(command, args));
    render(<App />);
    fireEvent.click(await screen.findByText('Inbox message', { exact: true }));
    const reader = within(screen.getByRole('main', { name: 'Message reader' }));
    expect(await reader.findByText('Inbox body')).toBeTruthy();
    const row = screen.getByText('Other inbox message', { exact: true }).closest('li')!;
    const rowActions = within(row);
    fireEvent.click(rowActions.getByRole('button', { name: 'Mark as read' }));
    expect(await rowActions.findByRole('button', { name: 'Mark as unread' })).toBeTruthy();
    fireEvent.click(rowActions.getByRole('button', { name: 'Archive message' }));
    expect(await screen.findByText('Message archived.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { accountId: 1, folder: 'INBOX', key: second.key, action: 'read' }, undefined);
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { accountId: 1, folder: 'INBOX', key: second.key, action: 'archive' }, undefined);
    expect(invoke).not.toHaveBeenCalledWith('read_connected_message', { accountId: 1, folder: 'INBOX', key: second.key, unread: true }, undefined);
    expect(reader.getByRole('heading', { name: 'Inbox message' })).toBeTruthy();
  });

  it.each([false, true])('shows the refresh spinner until the request settles (network error %s)', async (fails) => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    let finish: (() => void) | undefined;
    let refreshes = 0;
    invoke.mockImplementation((command, args) => command === 'refresh_connected_inbox' && refreshes++ > 0
      ? new Promise((resolve, reject) => {
        finish = () => { if (fails) reject('network'); else resolve(fallback(command, args)); };
      })
      : fallback(command, args));
    render(<App />);
    const refresh = await screen.findByRole<HTMLButtonElement>('button', { name: 'Refresh messages', busy: false });
    expect(refresh.getAttribute('aria-busy')).toBe('false');
    fireEvent.click(refresh);
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    expect(refresh.disabled).toBe(true);
    await act(async () => finish?.());
    expect(refresh.getAttribute('aria-busy')).toBe('false');
    expect(refresh.disabled).toBe(false);
    expect(Boolean(screen.queryByRole('alert'))).toBe(fails);
  });

  it.each([false, true])('reconciles the cached active inbox at startup and keeps it on connection failure (%s)', async (fails) => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    let finish: (() => void) | undefined;
    invoke.mockImplementation((command, args) => command === 'refresh_connected_inbox'
      ? new Promise((resolve, reject) => {
        finish = () => {
          if (fails) reject('network');
          else resolve({ accountId: 1, email: 'mail@example.test', headers: [], canSend: true });
        };
      })
      : fallback(command, args));
    render(<App />, { reactStrictMode: true });
    const cached = await screen.findByRole('button', { name: /Inbox message/ });
    const refresh = screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh messages' });
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    expect(cached.isConnected).toBe(true);
    expect(invoke.mock.calls.filter(([command]) => command === 'refresh_connected_inbox')).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('refresh_connected_inbox', { accountId: 1 }, undefined);
    await act(async () => finish?.());
    expect(refresh.getAttribute('aria-busy')).toBe('false');
    expect(cached.isConnected).toBe(fails);
    expect(Boolean(screen.queryByRole('alert'))).toBe(fails);
  });

  it('adds an account through a modal and switches mailboxes without mixing drafts or late inbox results', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    const first = { accountId: 1, email: 'mail@example.test', headers: [fixtureHeader], canSend: true };
    const second = {
      accountId: 2, email: 'second@gmail.com', canSend: true, oauthProvider: 'gmail',
      headers: [{ ...fixtureHeader, subject: 'Second inbox message' }],
    };
    let added = false;
    let finishRefresh: ((inbox: typeof second) => void) | undefined;
    invoke.mockImplementation(async (command, args) => {
      switch (command) {
        case 'list_connected_accounts': return [first, ...(added ? [second] : [])]
          .map(({ accountId, email }) => ({ id: accountId, email }));
        case 'discover_imap_settings': return {
          host: 'imap.gmail.com', port: 993, needsConfirmation: false,
          outgoing: { host: 'smtp.gmail.com', port: 465 }, oauthProvider: 'gmail',
        };
        case 'connect_gmail_account': added = true; return second;
        case 'switch_connected_account': return args.accountId === 1 ? first : second;
        case 'refresh_connected_inbox':
          if (args.accountId === 2) return new Promise((resolve) => { finishRefresh = resolve; });
          return first;
        default: return fallback(command, args);
      }
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    const draft = within(screen.getByRole('dialog', { name: 'New message' }));
    fireEvent.change(draft.getByLabelText('Subject'), { target: { value: 'First account draft' } });
    fireEvent.click(draft.getByRole('button', { name: 'Close composer' }));

    fireEvent.click(within(openSettings()).getByRole('button', { name: 'Add account' }));
    const modal = within(screen.getByRole('dialog', { name: 'Add account' }));
    fireEvent.change(modal.getByLabelText('Email address'), { target: { value: second.email } });
    fireEvent.click(modal.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await modal.findByRole('button', { name: 'Sign in with Google' }));
    fireEvent.click(await screen.findByRole('button', { name: /Second inbox message/ }));
    expect(invoke).toHaveBeenCalledWith('read_connected_message', { accountId: 2, folder: 'INBOX', key: fixtureKey, unread: true }, undefined);
    expect(screen.queryByRole('dialog', { name: 'Add account' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    const newDraft = within(screen.getByRole('dialog', { name: 'New message' }));
    expect(newDraft.getByLabelText<HTMLInputElement>('Subject').value).toBe('');
    fireEvent.click(newDraft.getByRole('button', { name: 'Close composer' }));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));
    const settings = within(openSettings());
    expect((await settings.findByRole('button', { name: /second@gmail.com/ })).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(settings.getByRole('button', { name: first.email }));
    await screen.findByRole('button', { name: /Inbox message/ });
    expect(invoke).toHaveBeenCalledWith('switch_connected_account', { accountId: 1 }, undefined);
    await act(async () => finishRefresh?.(second));
    expect(screen.queryByRole('button', { name: /Second inbox message/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    expect(screen.getByLabelText<HTMLInputElement>('Subject').value).toBe('First account draft');
  });

  it('uses the response footer to create scoped replies and forwards', async () => {
    const invoke = mockMailbox();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Inbox message/ }));
    expect(await screen.findByText('Inbox body')).toBeTruthy();
    const actions = within(screen.getByRole('group', { name: 'Respond to message' }));
    fireEvent.click(actions.getByRole('button', { name: /^Reply$/ }));
    const reply = within(screen.getByRole('dialog', { name: 'Reply' }));
    expect(reply.getByLabelText<HTMLInputElement>('To').value).toBe('reply@example.test');
    expect(reply.getByLabelText<HTMLInputElement>('Subject').value).toBe('Re: Inbox message');
    const replyBody = reply.getByRole('textbox', { name: 'Message body' });
    expect(replyBody.textContent).toContain('> Inbox body');
    replyBody.textContent = 'Kept reply draft';
    fireEvent.input(replyBody);
    fireEvent.click(reply.getByRole('button', { name: 'Close composer' }));

    fireEvent.click(actions.getByRole('button', { name: 'Forward' }));
    const forward = within(screen.getByRole('dialog', { name: 'Forward' }));
    expect(forward.getByLabelText<HTMLInputElement>('To').value).toBe('');
    expect(forward.getByLabelText<HTMLInputElement>('Subject').value).toBe('Fwd: Inbox message');
    expect(forward.getByRole('textbox', { name: 'Message body' }).textContent).toContain('Forwarded message');
    fireEvent.click(forward.getByRole('button', { name: 'Close composer' }));

    fireEvent.click(actions.getByRole('button', { name: /^Reply$/ }));
    const reopened = within(screen.getByRole('dialog', { name: 'Reply' }));
    expect(reopened.getByRole('textbox', { name: 'Message body' }).textContent).toBe('Kept reply draft');
    fireEvent.click(reopened.getByRole('button', { name: 'Close composer' }));

    fireEvent.click(actions.getByRole('button', { name: 'Reply all' }));
    const all = within(screen.getByRole('dialog', { name: 'Reply all' }));
    expect(all.getByLabelText<HTMLInputElement>('Cc').value).toBe('team@example.test');
    fireEvent.click(all.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Message accepted by the outgoing server.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('send_connected_message', {
      accountId: 1,
      message: expect.objectContaining({
        to: ['reply@example.test'], cc: ['team@example.test'], bcc: [],
        replyThread: { inReplyTo: 'parent@example.test', references: ['first@example.test'] },
      }),
    }, undefined);
  });

  it('retains a draft through resizing and clears it only after confirming discard', async () => {
    mockMailbox();
    const { container } = render(<App />);
    const compose = await screen.findByRole('button', { name: 'Compose' });
    fireEvent.click(compose);
    const panel = screen.getByRole('dialog', { name: 'New message' });
    const draft = within(panel);
    fireEvent.change(draft.getByLabelText('Subject'), { target: { value: 'Keep for later' } });
    fireEvent.click(draft.getByRole('button', { name: 'Expand composer' }));
    expect(panel.getAttribute('data-layout')).toBe('expanded');
    expect(container.querySelector('.composer-backdrop')).toBeTruthy();
    fireEvent.click(draft.getByRole('button', { name: 'Minimize composer' }));
    expect(container.querySelector('.composer-backdrop')).toBeNull();
    expect(draft.queryByRole('textbox', { name: 'Subject' })).toBeNull();
    fireEvent.click(compose);
    expect(container.querySelector('.composer-backdrop')).toBeTruthy();
    expect(draft.getByRole<HTMLInputElement>('textbox', { name: 'Subject' }).value).toBe('Keep for later');
    fireEvent.click(draft.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(draft.getByRole('button', { name: 'Keep draft' }));
    expect(draft.getByLabelText<HTMLInputElement>('Subject').value).toBe('Keep for later');
    fireEvent.click(draft.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(draft.getByRole('button', { name: 'Discard draft' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.composer-backdrop')).toBeNull();
    fireEvent.click(compose);
    expect(screen.getByLabelText<HTMLInputElement>('Subject').value).toBe('');
  });

  it('edits HTML source, restores the rich body and submits HTML', async () => {
    const invoke = mockMailbox();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    const composer = within(screen.getByRole('dialog', { name: 'New message' }));
    expect(composer.getByRole('button', { name: 'Rich text' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(composer.getByLabelText('To'), { target: { value: 'recipient@example.test' } });
    fireEvent.click(composer.getByRole('button', { name: 'HTML' }));
    fireEvent.change(composer.getByLabelText('HTML source'), {
      target: { value: '<p><strong>Hello</strong></p><img src="https://example.test/image"><script>Ignored</script>' },
    });
    fireEvent.click(composer.getByRole('button', { name: 'Rich text' }));
    const rich = composer.getByRole('textbox', { name: 'Message body' });
    expect(rich.innerHTML).toBe('<p><strong>Hello</strong></p>');
    fireEvent.click(composer.getByRole('button', { name: 'Send' }));
    await screen.findByText('Message accepted by the outgoing server.');
    expect(invoke).toHaveBeenCalledWith('send_connected_message', {
      accountId: 1,
      message: expect.objectContaining({ to: ['recipient@example.test'], html: '<p><strong>Hello</strong></p>' }),
    }, undefined);
  });

  it('isolates formatted mail, loads remote images automatically and offers plain text', async () => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) => command === 'read_connected_message'
      ? Promise.resolve({
        body: 'Plain alternative',
        summary: { points: [
          { kind: 'deadline', text: 'Please send the questions by Friday.' },
          { kind: 'keyPoint', text: 'The appointment is at 10:00.' },
        ] },
        html: {
          content: '<p>Formatted message<img alt="Logo" src="https://example.test/logo.png"></p>',
        },
        seen: true,
        seenError: null,
      })
      : fallback(command, args));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Inbox message/ }));
    const frame = await screen.findByTitle('HTML message content');
    const summary = screen.getByText('The appointment is at 10:00.');
    const summaryCard = summary.closest('details');
    expect(summaryCard?.open).toBe(true);
    expect(summaryCard?.textContent).toContain('Lusi Smart Summary');
    expect(summaryCard?.textContent).toContain('Deadline');
    expect(summaryCard?.textContent).toContain('Please send the questions by Friday.');
    expect(summaryCard?.nextElementSibling?.nextElementSibling).toBe(frame);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    const withImages = frame.getAttribute('srcdoc');
    expect(withImages).toContain('color-scheme:light;');
    expect(withImages).toContain('<body class="mail-theme">');
    expect(withImages).toContain('background-color: var(--mail-surface) !important;');
    expect(withImages).toContain('border-color: var(--mail-divider) !important;');
    expect(withImages).toContain('img-src data: https:;');
    expect(withImages).toContain('https://example.test/logo.png');
    const settings = within(openSettings());
    fireEvent.click(settings.getByRole('radio', { name: 'Dark' }));
    fireEvent.click(settings.getByRole('button', { name: 'Close settings' }));
    expect(frame.getAttribute('srcdoc')).toContain('color-scheme:dark;');
    expect(screen.queryByRole('button', { name: /remote images/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show plain text' }));
    expect(screen.getByText('Plain alternative')).toBeTruthy();
    expect(screen.getByText('The appointment is at 10:00.')).toBe(summary);
    expect(screen.queryByTitle('HTML message content')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show formatted message' }));
    expect(screen.getByTitle('HTML message content').getAttribute('srcdoc')).toContain('https://example.test/logo.png');
  });

  it('keeps the reader open when marking a message read removes it from the unread filter', async () => {
    const invoke = mockMailbox();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Unread$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Inbox message/ }));
    expect(await screen.findByText('Inbox body')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Inbox message/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Inbox message' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('main', { name: 'Message reader' })).getByRole('button', { name: 'Mark as unread' }));
    expect(await screen.findByRole('button', { name: /Inbox message/ })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { accountId: 1, folder: 'INBOX', key: fixtureKey, action: 'unread' }, undefined);
    fireEvent.click(within(screen.getByRole('main', { name: 'Message reader' })).getByRole('button', { name: 'Move to Trash' }));
    expect(await screen.findByText('Message moved to Trash.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { accountId: 1, folder: 'INBOX', key: fixtureKey, action: 'trash' }, undefined);
  });
  it.each(['saved', 'unavailable'] as const)('refreshes Sent after SMTP accepts a message and reports the copy status (%s)', async (copy) => {
    const invoke = mockMailbox();
    const fallback = invoke.getMockImplementation()!;
    let submitted = false;
    invoke.mockImplementation(async (command, args) => {
      if (command === 'send_connected_message') {
        submitted = true;
        return copy;
      }
      if (command === 'read_connected_folder' && args.folder === 'INBOX.Outgoing') {
        return submitted && copy === 'saved' ? [{ ...fixtureHeader, subject: 'Newly sent message' }] : [];
      }
      return fallback(command, args);
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    const composer = within(screen.getByRole('dialog', { name: 'New message' }));
    expect(container.querySelector('.composer-backdrop')).toBeTruthy();
    fireEvent.change(composer.getByLabelText('To'), { target: { value: 'recipient@example.test' } });
    fireEvent.click(composer.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(copy === 'saved'
      ? 'Message accepted by the outgoing server.'
      : 'Message sent. The server copy in Sent could not be confirmed.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'New message' })).toBeNull();
    expect(container.querySelector('.composer-backdrop')).toBeNull();
    if (copy === 'saved') expect(await screen.findByRole('button', { name: /Newly sent message/ })).toBeTruthy();
    expect(invoke.mock.calls.filter(([command]) => command === 'send_connected_message')).toHaveLength(1);
  });

  it('sends from the composer and uses IMAP actions for the selected message', async () => {
    const invoke = mockMailbox();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    const composer = within(screen.getByRole('dialog', { name: 'New message' }));
    fireEvent.change(composer.getByLabelText('To'), { target: { value: 'recipient@example.test' } });
    fireEvent.change(composer.getByLabelText('Subject'), { target: { value: 'Hello' } });
    const body = composer.getByRole('textbox', { name: 'Message body' });
    body.textContent = 'Live message';
    fireEvent.input(body);
    fireEvent.click(composer.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Message accepted by the outgoing server.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('send_connected_message', {
      accountId: 1,
      message: { to: ['recipient@example.test'], cc: [], bcc: [], subject: 'Hello', body: '', html: 'Live message', attachments: [] },
    }, undefined);
    fireEvent.click(screen.getByRole('button', { name: /Inbox message/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add star' }));
    expect(await screen.findByRole('button', { name: 'Remove star' })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { accountId: 1, folder: 'INBOX', key: fixtureKey, action: 'star' }, undefined);
    fireEvent.click(within(screen.getByRole('main', { name: 'Message reader' })).getByRole('button', { name: 'Archive message' }));
    expect(await screen.findByText('Message archived.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { accountId: 1, folder: 'INBOX', key: fixtureKey, action: 'archive' }, undefined);
    expect(screen.queryByRole('button', { name: /Inbox message/ })).toBeNull();
  });
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
    const custom = within(nav.getByRole('region', { name: 'Folders' }));
    expect(custom.getByRole('heading', { name: 'Folders' })).toBeTruthy();
    expect(custom.getByRole('button', { name: 'INBOX.İş' })).toBeTruthy();
    expect(custom.queryByRole('button', { name: 'Archive' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Inbox message/ }));
    expect(await screen.findByText('Inbox body')).toBeTruthy();
    fireEvent.click(nav.getByRole('button', { name: 'Sent' }));
    fireEvent.click(await screen.findByRole('button', { name: /Sent message/ }));
    expect(await screen.findByText('Sent body')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('read_connected_folder', { accountId: 1, folder: 'INBOX.Outgoing' }, undefined);
    expect(invoke).toHaveBeenCalledWith('read_connected_message', { accountId: 1, folder: 'INBOX.Outgoing', key: fixtureKey, unread: true }, undefined);
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
