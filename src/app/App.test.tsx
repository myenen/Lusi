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
    expect(list.queryByRole('button', { name: 'Select messages' })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('read_connected_message', { folder: 'INBOX', key }, undefined);
    fireEvent.change(list.getByRole('searchbox'), { target: { value: 'unrelated' } });
    expect(list.queryByRole('button', { name: /Real inbox example/ })).toBeNull();
    fireEvent.change(list.getByRole('searchbox'), { target: { value: 'sample sender' } });
    expect(list.getByRole('button', { name: /Real inbox example/ })).toBeTruthy();
    fireEvent.click(list.getByRole('button', { name: /Real inbox example/ }));
    expect(await screen.findByText(/Hello\./)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(reader.getByRole<HTMLButtonElement>('button', { name: 'Archive message' }).disabled).toBe(true);
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
    expect(screen.getByLabelText<HTMLInputElement>('TLS port').value).toBe('1993');
    expect(screen.getByLabelText<HTMLSelectElement>('Connection security').value).toBe('starttls');
    expect(screen.getByLabelText<HTMLInputElement>('SMTP server').value).toBe(outgoing.host);
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
  });

  it('keeps a discovered IMAP login while requesting missing SMTP settings', async () => {
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
    expect(screen.getByLabelText<HTMLInputElement>('IMAP username (optional)').value).toBe('mail');
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
    fireEvent.change(outgoing, { target: { value: 'smtp.example.test' } });
    fireEvent.change(screen.getByLabelText('SMTP port'), { target: { value: '465' } });
    expect(screen.getByLabelText<HTMLSelectElement>('SMTP security').value).toBe('tls');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByLabelText<HTMLInputElement>('Password or app password')).disabled).toBe(true);
    expect(invoke).toHaveBeenCalledWith('check_imap_settings', {
      account: { email: 'mail@example.test', host: 'imap.provider.test', port: 993, username: 'mail' },
      outgoing: { host: 'smtp.example.test', port: 465, startTls: false },
    }, undefined);
  });
});

const fixtureKey = { uidValidity: 20, uid: 17 };
const fixtureHeader = { key: fixtureKey, sender: 'Sample sender', address: 'sender@example.test', subject: 'Inbox message', sentAt: null, unread: true, starred: false };

function mockMailbox() {
  const invoke = vi.fn(async (command: string, args: { folder?: string }): Promise<unknown> => {
    switch (command) {
      case 'load_ui_preferences':
        return { systemLocale: 'en', preferences: { theme: 'light', themeId: 'default', language: 'system', sidebarCollapsed: false, sidebarWidth: 222, listWidth: 380 } };
      case 'load_connected_inbox':
      case 'refresh_connected_inbox':
        return { email: 'mail@example.test', headers: [fixtureHeader], canSend: true };
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
      case 'update_connected_message': return undefined;
      default: throw new Error('Unexpected Tauri command');
    }
  });
  vi.stubGlobal('isTauri', true);
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  return invoke;
}

describe('connected mailbox', () => {
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
      message: expect.objectContaining({
        to: ['reply@example.test'], cc: ['team@example.test'], bcc: [],
        replyThread: { inReplyTo: 'parent@example.test', references: ['first@example.test'] },
      }),
    }, undefined);
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
    fireEvent.click(screen.getByRole('button', { name: 'Mark as unread' }));
    expect(await screen.findByRole('button', { name: /Inbox message/ })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { folder: 'INBOX', key: fixtureKey, action: 'unread' }, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
    expect(await screen.findByText('Message moved to Trash.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { folder: 'INBOX', key: fixtureKey, action: 'trash' }, undefined);
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
      message: { to: ['recipient@example.test'], cc: [], bcc: [], subject: 'Hello', body: '', html: 'Live message', attachments: [] },
    }, undefined);
    fireEvent.click(screen.getByRole('button', { name: /Inbox message/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add star' }));
    expect(await screen.findByRole('button', { name: 'Remove star' })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { folder: 'INBOX', key: fixtureKey, action: 'star' }, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Archive message' }));
    expect(await screen.findByText('Message archived.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('update_connected_message', { folder: 'INBOX', key: fixtureKey, action: 'archive' }, undefined);
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
