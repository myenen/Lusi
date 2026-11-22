import { isTauri } from '@tauri-apps/api/core';
import { Settings } from 'lucide-react';
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { IconButton, type Filter } from '../components/ui/Controls';
import { AccountSetup } from '../features/accounts/AccountSetup';
import {
  imapErrorMessage, inboxFolder, listConnectedAccounts, listConnectedFolders, loadConnectedInbox, readConnectedFolder,
  refreshConnectedInbox, switchConnectedAccount, updateConnectedMessage, updateConnectedMessages,
  type ConnectedAccount, type ConnectedInbox, type ImapHeader, type MessageAction, type MessageKey, type OpenedMessage,
} from '../features/accounts/imap-api';
import { Composer, emptyDraft, type ComposeMode, type Draft, type ResponseMode } from '../features/mail/Composer';
import { ConnectedMessageBody } from '../features/mail/ConnectedMessageBody';
import { connectedMessageId, connectedMessageRows, folderDisplayName } from '../features/mail/connected-mail';
import { MailList } from '../features/mail/MailList';
import { MessageReader } from '../features/mail/MessageReader';
import { Sidebar } from '../features/mail/Sidebar';
import { SidebarAccount } from '../features/mail/SidebarAccount';
import { useMailSounds } from '../features/mail/send-sound';
import { useOlderMessages } from '../features/mail/useOlderMessages';
import { SettingsDrawer } from '../features/settings/SettingsDrawer';
import { catalog, LocaleContext } from './i18n';
import { PaneDivider } from './PaneDivider';
import { ThemeSelect } from './ThemeSelect';
import { defaultThemeId, resolveThemeId, useColorScheme } from './themes';
import { useUiPreferences } from './ui-preferences';

const hasMacTitleBar = /\bMacintosh\b/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
const folderOrder = ['inbox', 'flagged', 'sent', 'drafts', 'archive', 'trash', 'junk', 'all', 'custom'];
const noDrafts: Record<string, Draft> = {};
const emptyHeaders: ImapHeader[] = [];

export function App() {
  const desktop = isTauri();
  const [inbox, setInbox] = useState<ConnectedInbox | null | undefined>(() => desktop ? undefined : null);
  const [startupAccountId, setStartupAccountId] = useState<number>();
  const [accountDrafts, setAccountDrafts] = useState<Record<number, Record<string, Draft>>>({});
  const [accountLoadFailed, setAccountLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const ui = useUiPreferences();
  const { preferences, locale, error, ready } = ui;
  const hasMailbox = Boolean(inbox);
  const appearance = hasMailbox ? preferences.theme : 'light';
  const themeId = hasMailbox ? resolveThemeId(preferences.themeId) : defaultThemeId;
  const colorScheme = useColorScheme(appearance);
  const labels = catalog[locale];

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    loadConnectedInbox().then(
      (loaded) => {
        if (!current) return;
        setStartupAccountId(loaded?.accountId);
        setInbox(loaded);
      },
      () => { if (current) setAccountLoadFailed(true); },
    );
    return () => { current = false; };
  }, [desktop, loadAttempt]);

  return (
    <LocaleContext value={locale}>
      <div className="workspace" data-theme={appearance} data-theme-id={themeId} data-color-scheme={colorScheme}
        data-window-chrome={hasMacTitleBar ? 'macos' : undefined}>
        {ready && accountLoadFailed && <main className="account-setup">
          {hasMacTitleBar && <div className="window-drag-area" data-tauri-drag-region="" aria-hidden="true" />}
          <div className="account-setup-card glass-panel">
            <p role="alert">{labels.accountSetup.loadFailed}</p>
            <button className="compose-button" type="button" onClick={() => {
              setAccountLoadFailed(false);
              setLoadAttempt((attempt) => attempt + 1);
            }}>{labels.accountSetup.retry}</button>
          </div>
        </main>}
        {ready && inbox !== undefined && (inbox
          ? <MailboxWorkspace key={inbox.accountId} ui={ui} themeId={themeId} colorScheme={colorScheme}
            inbox={inbox} syncOnOpen={startupAccountId === inbox.accountId} onAccountChanged={(updated) => {
              setStartupAccountId(undefined);
              setInbox(updated);
            }}
            onRefresh={(update) => setInbox((current) => current?.accountId === inbox.accountId
              ? (typeof update === 'function' ? update(current) : update) : current)}
            drafts={accountDrafts[inbox.accountId] ?? noDrafts}
            setDrafts={(update) => setAccountDrafts((current) => ({
              ...current, [inbox.accountId]: update(current[inbox.accountId] ?? noDrafts),
            }))} />
          : <AccountSetup hasMacTitleBar={hasMacTitleBar} desktop={desktop}
            onConnected={setInbox} />)}
        {error && <p className="preference-error" role="status">{labels.preferenceErrors[error]}</p>}
      </div>
    </LocaleContext>
  );
}

function MailboxWorkspace({ ui, themeId, colorScheme, inbox, syncOnOpen, onAccountChanged, onRefresh, drafts, setDrafts }: {
  ui: ReturnType<typeof useUiPreferences>;
  themeId: string;
  colorScheme: 'light' | 'dark';
  inbox: ConnectedInbox;
  syncOnOpen: boolean;
  onAccountChanged: (inbox: ConnectedInbox) => void;
  onRefresh: Dispatch<SetStateAction<ConnectedInbox>>;
  drafts: Record<string, Draft>;
  setDrafts: (update: (current: Record<string, Draft>) => Record<string, Draft>) => void;
}) {
  const { preferences, locale, update } = ui;
  const labels = catalog[locale];
  const accountId = inbox.accountId;
  const [accounts, setAccounts] = useState<ConnectedAccount[]>();
  const [accountsLoadFailed, setAccountsLoadFailed] = useState(false);
  const [accountsAttempt, setAccountsAttempt] = useState(0);
  const [quickSwitching, setQuickSwitching] = useState(false);
  const [folders, setFolders] = useState([inboxFolder]);
  const [folder, setFolder] = useState(inboxFolder.id);
  const [folderError, setFolderError] = useState<unknown>();
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersAttempt, setFoldersAttempt] = useState(0);
  const [folderResult, setFolderResult] = useState<{ folder: string; headers: ImapHeader[]; before?: MessageKey } | { folder: string; error: unknown }>();
  const [folderAttempt, setFolderAttempt] = useState(0);
  const [folderRefreshing, setFolderRefreshing] = useState(false);
  const [readerAttempt, setReaderAttempt] = useState(0);
  const [inboxRefreshing, setInboxRefreshing] = useState(false);
  const [startupSyncing, setStartupSyncing] = useState(syncOnOpen);
  const startupRequest = useRef<Promise<ConnectedInbox>>(undefined);
  const [inboxBefore, setInboxBefore] = useState(() => inbox.headers.at(-1)?.key);
  const [inboxError, setInboxError] = useState<unknown>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [selection, setSelection] = useState<Set<string>>();
  const [mobilePane, setMobilePane] = useState<'list' | 'reader'>('list');
  const [showFolders, setShowFolders] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composer, setComposer] = useState<{ id: string; mode: ComposeMode }>();
  const [opened, setOpened] = useState<{ id: string; message: OpenedMessage }>();
  const [notice, setNotice] = useState<'sent' | 'archive' | 'trash' | 'restore' | { count: number } | { switchError: unknown }>();
  const [flight, setFlight] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<{ folder: string; source: 'list' | 'reader'; error: unknown }>();
  const pendingAction = useRef(false);
  const composeTrigger = useRef<HTMLElement>(null);
  const sounds = useMailSounds();
  const mailShell = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const folderToggle = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const messageTrigger = useRef<HTMLButtonElement>(null);
  const readerHeading = useRef<HTMLHeadingElement>(null);

  const savedAccounts = accounts ?? [{ id: accountId, email: inbox.email }];
  const isInbox = folder === inboxFolder.id;
  const result = folderResult?.folder === folder ? folderResult : undefined;
  const folderPage = result && 'headers' in result ? result : undefined;
  const baseHeaders = isInbox ? inbox.headers : folderPage?.headers ?? emptyHeaders;
  const older = useOlderMessages(accountId, folder, isInbox ? inboxBefore : folderPage?.before);
  const headers = useMemo(() => [...baseHeaders, ...older.headers], [baseHeaders, older.headers]);
  const busy = isInbox ? startupSyncing || inboxRefreshing : !result;
  const failure = isInbox ? inboxError : result && 'error' in result ? result.error : undefined;
  const searchText = query.trim();
  const needle = searchText.toLocaleLowerCase(locale);
  const rows = useMemo(() => connectedMessageRows(headers, locale, { unknownSender: labels.connectedInbox.unknownSender, untitled: labels.untitled }),
    [headers, labels, locale]);
  const messages = rows.filter((message) => (filter === 'all' || message.unread) && (
      message.address.toLowerCase().includes(searchText.toLowerCase())
      || [message.sender, message.subject].some((value) => value.toLocaleLowerCase(locale).includes(needle))
    ));
  if (oldestFirst) messages.reverse();
  const selected = rows.find(({ id }) => id === selectedId);
  const selectedHeader = headers.find(({ key }) => connectedMessageId(key) === selected?.id);
  const messageId = JSON.stringify([folder, selected?.id]);
  const openedMessage = opened?.id === messageId ? opened.message : undefined;
  const canRespond = inbox.canSend && Boolean(openedMessage?.reply?.to.length);
  const canForward = inbox.canSend && Boolean(openedMessage);
  const visiblePane = selected ? mobilePane : 'list';
  const currentFolder = folders.find(({ id }) => id === folder);
  const hasOtherFolder = (kind: 'archive' | 'trash') => folders.some((entry) => entry.kind === kind && entry.id !== folder);
  const inTrash = currentFolder?.kind === 'trash';
  const canArchive = !inTrash && hasOtherFolder('archive');
  const canTrash = hasOtherFolder('trash');
  const switchFailed = typeof notice === 'object' && 'switchError' in notice;
  const noticeText = typeof notice === 'object'
    ? 'count' in notice ? labels.bulkUpdated(notice.count) : imapErrorMessage(notice.switchError, labels.imapErrors) :
    notice === 'sent' ? labels.messageSent : notice === 'archive' ? labels.messageArchived :
    notice === 'trash' ? labels.messageTrashed : notice === 'restore' ? labels.messageRestored : undefined;

  useEffect(() => {
    let current = true;
    listConnectedAccounts().then(
      (result) => { if (current) setAccounts(result); },
      () => { if (current) setAccountsLoadFailed(true); },
    );
    return () => { current = false; };
  }, [accountsAttempt]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), switchFailed ? 7000 : 3600);
    return () => window.clearTimeout(timer);
  }, [notice, switchFailed]);

  useEffect(() => {
    let current = true;
    listConnectedFolders(accountId).then((result) => {
      if (!current) return;
      const list = result.some(({ id }) => id === inboxFolder.id) ? result : [inboxFolder, ...result];
      setFolders(list.sort((first, second) => folderOrder.indexOf(first.kind) - folderOrder.indexOf(second.kind)
        || first.name.localeCompare(second.name)));
      setFoldersLoading(false);
    }, (error: unknown) => {
      if (!current) return;
      setFolderError(error ?? 'unknown');
      setFoldersLoading(false);
    });
    return () => { current = false; };
  }, [accountId, foldersAttempt]);

  useEffect(() => {
    if (isInbox) return;
    let current = true;
    readConnectedFolder(accountId, folder).then(
      (headers) => { if (current) setFolderResult({ folder, headers, before: headers.at(-1)?.key }); },
      (error: unknown) => { if (current) setFolderResult({ folder, error: error ?? 'unknown' }); },
    ).finally(() => { if (current) setFolderRefreshing(false); });
    return () => { current = false; };
  }, [accountId, folder, folderAttempt, isInbox]);

  function replaceInbox(updated: ConnectedInbox) {
    setInboxBefore(updated.headers.at(-1)?.key);
    onRefresh(updated);
  }

  const applyStartupSnapshot = useEffectEvent((updated: ConnectedInbox) => {
    older.reset(inboxFolder.id);
    replaceInbox(updated);
    if (isInbox) setSelection((current) => current && new Set(
      updated.headers.map(({ key }) => connectedMessageId(key)).filter((id) => current.has(id)),
    ));
  });

  useEffect(() => {
    if (!syncOnOpen) return;
    let current = true;
    // React may replay effects on startup. Reuse the same IMAP request.
    startupRequest.current ??= refreshConnectedInbox(accountId);
    void startupRequest.current.then(
      (updated) => { if (current) applyStartupSnapshot(updated); },
      (error: unknown) => { if (current) setInboxError(error ?? 'unknown'); },
    ).finally(() => {
      if (!current) return;
      startupRequest.current = undefined;
      setStartupSyncing(false);
    });
    return () => { current = false; };
  }, [accountId, syncOnOpen]);

  function refresh() {
    if (busy || pendingAction.current) return;
    if (selection) setSelection(new Set());
    setActionError(undefined);
    if (!foldersLoading) {
      setFolderError(undefined);
      setFoldersLoading(true);
      setFoldersAttempt((attempt) => attempt + 1);
    }
    if (!isInbox) {
      older.reset();
      setFolderRefreshing(true);
      setFolderResult(undefined);
      setFolderAttempt((attempt) => attempt + 1);
      return;
    }
    setInboxRefreshing(true);
    setInboxError(undefined);
    void refreshConnectedInbox(accountId).then((updated) => {
      // An unrelated folder may have started paging while Inbox refreshed.
      older.reset(inboxFolder.id);
      replaceInbox(updated);
    }, (error: unknown) => setInboxError(error ?? 'unknown'))
      .finally(() => setInboxRefreshing(false));
  }

  function applyHeaderActions(source: string, keys: MessageKey[], action: MessageAction) {
    const updatedIds = new Set(keys.map(connectedMessageId));
    const updateHeaders = (headers: ImapHeader[]) => headers.flatMap((header) => {
      if (!updatedIds.has(connectedMessageId(header.key))) return [header];
      switch (action) {
        case 'read': return [{ ...header, unread: false }];
        case 'unread': return [{ ...header, unread: true }];
        case 'star': return [{ ...header, starred: true }];
        case 'unstar': return [{ ...header, starred: false }];
        default: return [];
      }
    });
    patchHeaders(source, updateHeaders);
  }

  function patchHeaders(source: string, updateHeaders: (headers: ImapHeader[]) => ImapHeader[]) {
    older.patch(source, updateHeaders);
    if (source === inboxFolder.id) {
      onRefresh((current) => ({ ...current, headers: updateHeaders(current.headers) }));
    } else {
      setFolderResult((current) => current?.folder === source && 'headers' in current
        ? { ...current, headers: updateHeaders(current.headers) } : current);
    }
  }

  async function handleAction(action: MessageAction, source: 'list' | 'reader', key?: MessageKey) {
    if (pendingAction.current || busy || (!key && !selection)) return;
    const selectedIds = new Set(messages.filter((message) => selection?.has(message.id)
      && (action !== 'read' || message.unread) && (action !== 'unread' || !message.unread)).map(({ id }) => id));
    const keys = key ? [key] : headers.filter((header) => selectedIds.has(connectedMessageId(header.key))).map((header) => header.key);
    if (!keys.length) return;
    const isMove = action === 'archive' || action === 'trash' || action === 'restore';
    pendingAction.current = true;
    setActionBusy(true);
    setActionError(undefined);
    if (action === 'archive' || action === 'trash') sounds.prepare();
    try {
      let updated = keys;
      if (key) {
        await updateConnectedMessage(accountId, folder, key, action);
      } else {
        const result = await updateConnectedMessages(accountId, folder, keys, action);
        updated = result.updated;
        if (result.error) setActionError({ folder, source, error: result.error });
      }
      if (!updated.length) return;
      applyHeaderActions(folder, updated, action);
      if (!key) {
        const updatedIds = new Set<string>(updated.map(connectedMessageId));
        setSelection((current) => current && current === selection ? new Set([...current].filter((id) => !updatedIds.has(id))) : current);
        setNotice({ count: updated.length });
      } else if (isMove) {
        setNotice(action);
      }
      if (isMove) {
        if (action === 'archive' || action === 'trash') void sounds.play(action);
        if (action === 'restore') {
          await refreshConnectedInbox(accountId).then(replaceInbox, (error: unknown) => setInboxError(error ?? 'unknown'));
        }
      }
    } catch (error) {
      setActionError({ folder, source, error: error ?? 'unknown' });
    } finally {
      pendingAction.current = false;
      setActionBusy(false);
    }
  }

  function closeComposer() {
    setComposer(undefined);
    requestAnimationFrame(() => {
      const trigger = composeTrigger.current;
      if (trigger?.getClientRects().length) trigger.focus();
      else (folderToggle.current?.getClientRects().length ? folderToggle.current : searchInput.current)?.focus();
    });
  }

  function respond(mode: ResponseMode, trigger: HTMLButtonElement) {
    if (!selected || !selectedHeader || !openedMessage || (mode === 'forward' ? !canForward : !canRespond)) return;
    const id = JSON.stringify([messageId, mode]);
    const forward = mode === 'forward';
    const originalSubject = selectedHeader.subject;
    const prefix = forward ? 'Fwd:' : 'Re:';
    const hasPrefix = forward ? /^(?:fw|fwd):\s*/i.test(originalSubject) : /^re:\s*/i.test(originalSubject);
    const subject = hasPrefix ? originalSubject : `${prefix} ${originalSubject}`.trimEnd();
    const sender = selected.address && selected.address !== selected.sender
      ? `${selected.sender} <${selected.address}>` : selected.sender;
    const originalBody = openedMessage.body?.slice(0, 200_000) ?? '';
    const intro = forward ? labels.forwardedMessage : labels.originalMessage;
    const original = `— ${intro} —\n${labels.from}: ${sender}\n${labels.subject}: ${originalSubject}\n\n${originalBody}`;
    const reply = openedMessage.reply;
    setDrafts((current) => current[id] ? current : {
      ...current,
      [id]: {
        ...emptyDraft,
        to: forward ? '' : reply?.to.join(', ') ?? '',
        cc: mode === 'replyAll' ? reply?.cc.join(', ') ?? '' : '',
        subject: Array.from(subject).slice(0, 240).join(''),
        body: `\n\n${forward ? original : original.split('\n').map((line) => `> ${line}`).join('\n')}`,
        replyThread: forward ? undefined : reply?.thread ?? undefined,
      },
    });
    composeTrigger.current = trigger;
    setComposer({ id, mode });
  }

  useLayoutEffect(() => {
    const shell = mailShell.current;
    const motion = window.matchMedia?.('(prefers-reduced-motion: no-preference)');
    if (!shell?.animate || !motion?.matches) return;

    const visiblePanes = Array.from(shell.querySelectorAll<HTMLElement>(':scope > :is(.sidebar, .mail-list, .reader)'))
      .filter((pane) => pane.getClientRects().length > 0);
    const revealMask = {
      maskImage: 'linear-gradient(to bottom, black 45%, transparent 55%)',
      maskRepeat: 'no-repeat',
      maskSize: '100% 225%',
    };
    const animations = visiblePanes.map((pane, index) => pane.animate(
      [
        { ...revealMask, maskPosition: '50% 100%', filter: 'blur(6px)' },
        { ...revealMask, maskPosition: '50% 0%', filter: 'blur(0px)' },
      ],
      { duration: 450, delay: index * 125, easing: 'ease-out', fill: 'backwards' },
    ));
    const cancel = () => animations.forEach((animation) => animation.cancel());
    motion.addEventListener('change', cancel);
    return () => {
      motion.removeEventListener('change', cancel);
      cancel();
    };
  }, [themeId, colorScheme]);


  useEffect(() => {
    if (!messageTrigger.current || !window.matchMedia?.('(max-width: 46rem)').matches) return;
    if (visiblePane === 'reader') readerHeading.current?.focus();
    else if (messageTrigger.current.isConnected) messageTrigger.current.focus();
    else searchInput.current?.focus();
  }, [visiblePane]);

  useEffect(() => {
    if (!showFolders) return;
    const compact = window.matchMedia('(max-width: 64rem)');
    const closeOnExpand = () => { if (!compact.matches) setShowFolders(false); };
    compact.addEventListener('change', closeOnExpand);
    return () => compact.removeEventListener('change', closeOnExpand);
  }, [showFolders]);

  function closeFolders() {
    setShowFolders(false);
    requestAnimationFrame(() => folderToggle.current?.focus());
  }

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || settingsOpen || composer || document.activeElement?.closest('.mail-print-dialog')) return;
      if (showFolders && event.key === 'Escape') {
        event.preventDefault();
        closeFolders();
      } else if (!event.repeat && inbox.canSend && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === 'n') {
        event.preventDefault();
        composeTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setShowFolders(false);
        setComposer({ id: 'new', mode: 'new' });
      } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === 'k') {
        event.preventDefault();
        if (showFolders) closeFolders();
        setMobilePane('list');
        requestAnimationFrame(() => searchInput.current?.focus());
      }
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [composer, inbox.canSend, settingsOpen, showFolders]);

  async function switchAccount(id: number) {
    if (id !== accountId) onAccountChanged(await switchConnectedAccount(id));
  }

  async function quickSwitchAccount(id: number) {
    if (quickSwitching || id === accountId) return;
    setNotice(undefined);
    setQuickSwitching(true);
    try {
      await switchAccount(id);
    } catch (error) {
      setNotice({ switchError: error ?? 'unknown' });
    } finally {
      setQuickSwitching(false);
    }
  }

  function chooseFolder(next: string) {
    if (next !== folder) {
      older.reset();
      setActionError(undefined);
      setFolderRefreshing(false);
      setFolderResult(undefined);
      setFolder(next);
      setSelectedId(undefined);
      setSelection(undefined);
      setQuery('');
      setFilter('all');
    }
    setMobilePane('list');
    if (showFolders) closeFolders();
  }

  return (
    <>
      <div ref={mailShell} className="mail-shell" data-pane={visiblePane} data-sidebar-collapsed={preferences.sidebarCollapsed} style={{
        '--sidebar-width': `${preferences.sidebarWidth}px`,
        '--list-width': `${preferences.listWidth}px`,
      } as CSSProperties}>
        {hasMacTitleBar && <div className="window-drag-area" data-tauri-drag-region="" aria-hidden="true" />}
        {showFolders && <div className="drawer-backdrop" onClick={closeFolders} />}
        <Sidebar folder={folder} folders={folders} inboxUnread={inbox.headers.filter(({ unread }) => unread).length}
          open={showFolders} collapsed={preferences.sidebarCollapsed} account={
            <SidebarAccount accountId={accountId} email={inbox.email} accounts={savedAccounts}
              disabled={quickSwitching || actionBusy} onSwitch={(id) => void quickSwitchAccount(id)} />
          }
          onToggle={() => update({ sidebarCollapsed: !preferences.sidebarCollapsed })}
          onClose={closeFolders} onSelect={chooseFolder}
          canSend={inbox.canSend} onCompose={(trigger) => {
            composeTrigger.current = trigger;
            setShowFolders(false);
            setComposer({ id: 'new', mode: 'new' });
          }}
          status={foldersLoading ? <p className="mailbox-status sidebar-copy" role="status">{labels.connectedInbox.loadingFolders}</p> :
            folderError !== undefined && <p className="mailbox-status sidebar-copy" role="alert">{imapErrorMessage(folderError, labels.imapErrors)}</p>}
          appearance={<ThemeSelect theme={preferences.theme} onChange={(theme) => update({ theme })} disabled={false} />}
          divider={<PaneDivider pane="sidebarWidth" width={preferences.sidebarWidth} disabled={false} onResize={(sidebarWidth, save) => update({ sidebarWidth }, save)} />}
        />
        <MailList key={`list:${folder}`} title={currentFolder ? folderDisplayName(currentFolder, labels) : folder} messages={messages} selectedId={selected?.id}
          search={query} filter={filter} searchRef={searchInput} folderToggleRef={folderToggle} foldersOpen={showFolders}
          oldestFirst={oldestFirst} onSort={setOldestFirst}
          onSearch={(value) => { setQuery(value); if (selection) setSelection(new Set()); }}
          onFilter={(value) => { setFilter(value); if (value !== filter && selection) setSelection(new Set()); }}
          selection={selection} onSelectionChange={setSelection} onBulkAction={(action) => void handleAction(action, 'list')}
          onToggleFolders={() => setShowFolders(!showFolders)}
          onSelect={(id, trigger) => {
            messageTrigger.current = trigger; setSelectedId(id); setMobilePane('reader');
          }}
          canArchive={canArchive} canTrash={canTrash} inTrash={inTrash}
          onAction={(id, action) => {
            const header = headers.find(({ key }) => connectedMessageId(key) === id);
            if (header) void handleAction(action, 'list', header.key);
          }}
          busy={busy || actionBusy} refreshing={isInbox ? startupSyncing || inboxRefreshing : folderRefreshing} onRefresh={refresh}
          older={older.cursor && !(isInbox && startupSyncing) && failure === undefined ? {
            cursor: connectedMessageId(older.cursor), loading: older.loading, onLoad: () => { if (!busy && !pendingAction.current) void older.load(); },
            error: older.error === undefined ? undefined : imapErrorMessage(older.error, labels.imapErrors),
          } : undefined}
          status={busy ? <p className="mailbox-status" role="status">{labels.connectedInbox.refreshing}</p> :
            failure !== undefined ? <p className="account-setup-error" role="alert">{imapErrorMessage(failure, labels.imapErrors)}</p> :
              actionError?.folder === folder && actionError.source === 'list' &&
                <p className="account-setup-error" role="alert">{imapErrorMessage(actionError.error, labels.imapErrors)}</p>}
          divider={<PaneDivider pane="listWidth" width={preferences.listWidth} disabled={false} onResize={(listWidth, save) => update({ listWidth }, save)} />}
        />
        <MessageReader key={`reader:${folder}`} message={selected} opened={openedMessage} headingRef={readerHeading} inert={showFolders} onBack={() => setMobilePane('list')}
          onRespond={respond} canRespond={canRespond} canForward={canForward}
          onAction={(action) => { if (selectedHeader) void handleAction(action, 'reader', selectedHeader.key); }} actionBusy={actionBusy || busy}
          actionError={actionError?.folder === folder && actionError.source === 'reader' ? imapErrorMessage(actionError.error, labels.imapErrors) : undefined}
          canArchive={canArchive} canTrash={canTrash} inTrash={inTrash}
          body={selectedHeader && <ConnectedMessageBody key={`${connectedMessageId(selectedHeader.key)}:${readerAttempt}`} accountId={accountId} folder={folder} messageKey={selectedHeader.key}
            unread={selectedHeader.unread} themeId={themeId} colorScheme={colorScheme}
            onOpened={(message) => {
              setOpened({ id: messageId, message });
              if (message.attachments?.length && !selectedHeader.hasAttachments) {
                patchHeaders(folder, (current) => current.map((header) => connectedMessageId(header.key) === selected?.id
                  ? { ...header, hasAttachments: true } : header));
              }
            }}
            onSeen={(source, key) => applyHeaderActions(source, [key], 'read')} />} />
        <IconButton ref={settingsTrigger} className="settings-trigger" label={labels.settings} icon={Settings}
          aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls={settingsOpen ? 'settings-drawer' : undefined}
          disabled={showFolders || quickSwitching} onClick={() => {
            if (accountsLoadFailed) {
              setAccountsLoadFailed(false);
              setAccountsAttempt((attempt) => attempt + 1);
            }
            setSettingsOpen(true);
          }} />
      </div>
      {settingsOpen && <SettingsDrawer accountId={accountId} connectedEmail={inbox.email} preferences={preferences} themeId={themeId} onUpdate={update} onAccountChanged={onAccountChanged}
        accounts={savedAccounts} accountsLoadFailed={accountsLoadFailed} onAccountSwitch={switchAccount}
        onGoogleReconnected={inbox.oauthProvider === 'gmail' ? (updated) => {
          older.reset();
          replaceInbox(updated);
          setInboxError(undefined);
          setFoldersAttempt((attempt) => attempt + 1);
          setFolderAttempt((attempt) => attempt + 1);
          setReaderAttempt((attempt) => attempt + 1);
        } : undefined}
        onClose={() => { setSettingsOpen(false); settingsTrigger.current?.focus(); }} />}
      {composer && <Composer key={composer.id} accountId={accountId} mode={composer.mode} draft={drafts[composer.id] ?? emptyDraft}
        onChange={(draft) => setDrafts((current) => ({ ...current, [composer.id]: draft }))}
        onClose={closeComposer} onSendStart={sounds.prepare}
        onSent={() => {
          setDrafts((current) => {
            const next = { ...current };
            delete next[composer.id];
            return next;
          });
          closeComposer();
          setNotice('sent');
          setFlight((value) => value + 1);
          void sounds.play('send');
        }} />}
      {(quickSwitching || noticeText) && <div className="mail-notice" role={switchFailed ? 'alert' : 'status'}>
        {quickSwitching ? labels.switchingAccount : noticeText}
      </div>}
      {flight > 0 && <span key={flight} className="send-bird" aria-hidden="true" />}
    </>
  );
}
