import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Filter } from '../components/ui/Controls';
import { Composer } from '../features/mail/Composer';
import { demoAccounts, type DemoAccountId } from '../features/mail/demo-accounts';
import { draftMessage, emptyDraft, makeDraft, type ComposeTarget, type Draft, type SavedDraft } from '../features/mail/demo-compose';
import { bulkPatch, isInFolder, type BulkAction, type DemoMessage, type DemoMessagePatch, type Folder } from '../features/mail/demo-mail';
import { MailList } from '../features/mail/MailList';
import { MessageReader } from '../features/mail/MessageReader';
import { Sidebar } from '../features/mail/Sidebar';
import { useMailSounds } from '../features/mail/send-sound';
import { catalog, LocaleContext } from './i18n';
import { LanguageSelect } from './LanguageSelect';
import { PaneDivider } from './PaneDivider';
import { ThemePresetSelect } from './ThemePresetSelect';
import { ThemeSelect } from './ThemeSelect';
import { resolveThemeId, useColorScheme } from './themes';
import { useUiPreferences } from './ui-preferences';

const hasMacTitleBar = /\bMacintosh\b/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;

type MailboxState = {
  messagePatches: Partial<Record<DemoMessage['id'], DemoMessagePatch>>;
  drafts: SavedDraft[];
  sent: SavedDraft[];
};

const emptyMailbox: MailboxState = { messagePatches: {}, drafts: [], sent: [] };

export function App() {
  const [accountId, setAccountId] = useState<DemoAccountId>('personal');
  const [mailboxes, setMailboxes] = useState(() => new Map<DemoAccountId, MailboxState>());
  const [folder, setFolder] = useState<Folder>('inbox');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [listOptions, setListOptions] = useState({ allMail: false, oldestFirst: false, withAttachments: false });
  const [selectedId, setSelectedId] = useState<string>();
  const [bulkSelection, setBulkSelection] = useState<Set<DemoMessage['id']>>();
  const [mobilePane, setMobilePane] = useState<'list' | 'reader'>('list');
  const [showFolders, setShowFolders] = useState(false);
  const [compose, setCompose] = useState<SavedDraft>();
  const nextMessage = useRef(0);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void; openSent?: boolean }>();
  const [sentFlight, setSentFlight] = useState<DemoMessage['id']>();
  const mailSounds = useMailSounds();
  const mailShell = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const folderToggle = useRef<HTMLButtonElement>(null);
  const messageTrigger = useRef<HTMLButtonElement>(null);
  const readerHeading = useRef<HTMLHeadingElement>(null);
  const { preferences, locale, update, error, ready } = useUiPreferences();
  const themeId = resolveThemeId(preferences.themeId);
  const colorScheme = useColorScheme(preferences.theme);
  const labels = catalog[locale];
  const account = demoAccounts[accountId];
  const identity = { name: labels[account.nameKey], address: account.address, initials: account.initials };
  const { messagePatches, drafts, sent } = mailboxes.get(accountId) ?? emptyMailbox;
  const queryText = query.trim();
  const needle = queryText.toLocaleLowerCase(locale);
  const draftRows = drafts.map((entry) => draftMessage(entry, 'drafts', identity, labels.untitled, locale));
  const sentRows = sent.map((entry) => draftMessage(entry, 'sent', identity, labels.untitled, locale));
  const fixtures = account.messages[locale]
    .filter(({ id }) => !draftRows.some((row) => row.id === id) && !sentRows.some((row) => row.id === id));
  const mailbox = [...sentRows, ...draftRows, ...fixtures].map((message) => ({ ...message, ...messagePatches[message.id] }));
  const messages = mailbox.filter((message) => (
    (listOptions.allMail || isInFolder(message, folder))
    && (filter === 'all' || message[filter])
    && (!listOptions.withAttachments || Boolean(message.attachments?.length))
    && (message.address.toLowerCase().includes(queryText.toLowerCase())
      || [message.sender, message.to ?? '', message.cc ?? '', message.subject, message.preview ?? '', ...message.body, ...(message.attachments ?? []).map(({ name }) => name)].some((part) => part.toLocaleLowerCase(locale).includes(needle)))
  )).sort((first, second) => ((second.sentAt ?? 0) - (first.sentAt ?? 0)) * (listOptions.oldestFirst ? -1 : 1));
  const selected = messages.find(({ id }) => id === selectedId) ?? messages[0];

  function updateMailbox(update: (current: MailboxState) => MailboxState) {
    setMailboxes((current) => new Map(current).set(accountId, update(current.get(accountId) ?? emptyMailbox)));
  }

  function openComposer(target: ComposeTarget) {
    let saved: SavedDraft | undefined;
    if (target.mode === 'edit') saved = drafts.find(({ id }) => id === target.message.id);
    else if (target.mode !== 'new') saved = drafts.find((entry) => entry.target.mode === target.mode
      && entry.target.message.id === target.message.id && messagePatches[entry.id]?.folder !== 'trash');
    setCompose(saved ?? {
      id: target.mode === 'edit' ? target.message.id : `demo-${++nextMessage.current}`,
      target, draft: makeDraft(target, account.address), updatedAt: Date.now(),
    });
  }

  function saveDraft(draft: Draft) {
    if (!compose) return;
    const entry = { ...compose, draft, updatedAt: Date.now() };
    setCompose(entry);
    updateMailbox((current) => ({ ...current, drafts: [entry, ...current.drafts.filter(({ id }) => id !== entry.id)] }));
  }

  function sendDraft() {
    if (!compose) return;
    const entry = { ...compose, updatedAt: Date.now() };
    updateMailbox((current) => ({
      sent: [entry, ...current.sent],
      drafts: current.drafts.filter(({ id }) => id !== entry.id),
      messagePatches: { ...current.messagePatches, [entry.id]: {} },
    }));
    closeComposer();
    setNotice({ text: labels.demoSent, openSent: true });
    setSentFlight(compose.id);
    void mailSounds.play('send').catch(() => {});
  }

  function closeComposer() {
    setCompose(undefined);
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const toggle = folderToggle.current;
      if (toggle?.getClientRects().length) toggle.focus();
      else searchInput.current?.focus();
    });
  }

  useLayoutEffect(() => {
    const shell = mailShell.current;
    const motion = window.matchMedia?.('(prefers-reduced-motion: no-preference)');
    if (!ready || !shell?.animate || !motion?.matches) return;

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
  }, [ready, themeId, colorScheme]);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  useEffect(() => {
    const deadlines = [...mailboxes.values()].flatMap(({ messagePatches }) =>
      Object.values(messagePatches).flatMap((patch) => patch?.snoozedUntil ?? []));
    if (!deadlines.length) return;

    const timer = window.setTimeout(() => {
      const now = Date.now();
      setMailboxes((current) => new Map([...current].map(([id, mailbox]) => [
        id, { ...mailbox, messagePatches: Object.fromEntries(Object.entries(mailbox.messagePatches).map(([messageId, patch]) => [
          messageId, patch?.snoozedUntil !== undefined && patch.snoozedUntil <= now ? { ...patch, snoozedUntil: undefined } : patch,
        ])) },
      ])));
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [mailboxes]);

  useEffect(() => {
    if (!messageTrigger.current || !window.matchMedia?.('(max-width: 46rem)').matches) return;
    if (mobilePane === 'reader') readerHeading.current?.focus();
    else if (messageTrigger.current.isConnected) messageTrigger.current.focus();
    else searchInput.current?.focus();
  }, [mobilePane]);

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
      if (compose) return;
      if (showFolders && event.key === 'Escape') {
        event.preventDefault();
        closeFolders();
      } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        if (event.key === 'k') {
          event.preventDefault();
          if (showFolders) closeFolders();
          setMobilePane('list');
          requestAnimationFrame(() => searchInput.current?.focus());
        } else if (event.key === 'n') {
          event.preventDefault();
          if (showFolders) setShowFolders(false);
          setCompose({ id: `demo-${++nextMessage.current}`, target: { mode: 'new' }, draft: emptyDraft, updatedAt: Date.now() });
        }
      }
    }

    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [compose, showFolders]);

  function chooseFolder(next: Folder) {
    setFolder(next);
    setSelectedId(undefined);
    setBulkSelection(undefined);
    setQuery('');
    setFilter('all');
    setListOptions((current) => ({ ...current, allMail: false, withAttachments: false }));
    setMobilePane('list');
    if (showFolders) closeFolders();
  }

  function chooseAccount(next: DemoAccountId) {
    if (next === accountId) return;
    setAccountId(next);
    messageTrigger.current = null;
    setNotice(undefined);
    setSentFlight(undefined);
    chooseFolder('inbox');
  }

  function applyMessageChanges(changes: { message: DemoMessage; patch: DemoMessagePatch }[], text?: string) {
    const updates = changes.map(({ message, patch }) => {
      const next: DemoMessagePatch = patch.folder ? {
        ...patch, snoozedUntil: undefined, trashOrigin: patch.folder === 'trash' ? message.folder : undefined,
      } : patch;
      const keys = Object.keys(next) as (keyof DemoMessagePatch)[];
      const undo = Object.fromEntries(keys.map((key) => [key, message[key]]));
      return { id: message.id, next, undo };
    });
    const apply = (direction: 'next' | 'undo') => updateMailbox((current) => {
      const updated = { ...current.messagePatches };
      for (const change of updates) updated[change.id] = { ...updated[change.id], ...change[direction] };
      return { ...current, messagePatches: updated };
    });
    apply('next');
    if (text) setNotice({ text, undo: () => apply('undo') });
    const move = changes.find(({ message, patch }) => message.folder !== 'trash' && (patch.folder === 'archive' || patch.folder === 'trash'))?.patch.folder;
    if (move === 'archive' || move === 'trash') {
      mailSounds.prepare();
      void mailSounds.play(move).catch(() => {});
    }
  }

  function applyBulkAction(action: BulkAction) {
    const changes = messages.flatMap((message) => {
      if (!bulkSelection?.has(message.id)) return [];
      const patch = bulkPatch(message, action);
      return patch ? [{ message, patch }] : [];
    });
    if (!changes.length) return;
    applyMessageChanges(changes, labels.bulkUpdated(changes.length));
    setBulkSelection(undefined);
  }

  function updateDemoMessage(id: DemoMessage['id'], patch: DemoMessagePatch, trigger: HTMLButtonElement) {
    const message = mailbox.find((row) => row.id === id);
    if (!message) return;
    const mayRemoveTrigger = patch.folder || 'snoozedUntil' in patch
      || (patch.unread === false && filter === 'unread')
      || (patch.starred === false && (filter === 'starred' || folder === 'starred'));
    if (mayRemoveTrigger && document.activeElement === trigger) {
      (trigger.closest('main') ?? searchInput.current)?.focus();
    }
    let text: string | undefined;
    if (patch.folder || 'snoozedUntil' in patch) {
      text = patch.snoozedUntil === undefined ? labels.snoozeEnded : labels.messageSnoozed;
      if (message.folder === 'trash') text = labels.messageRestored;
      else if (patch.folder === 'trash') text = labels.messageTrashed;
      else if (patch.folder === 'archive') text = labels.messageArchived;
    }
    applyMessageChanges([{ message, patch }], text);
  }

  return (
    <LocaleContext value={locale}>
      <div className="workspace" data-theme={preferences.theme} data-theme-id={themeId} data-color-scheme={colorScheme} data-window-chrome={hasMacTitleBar ? 'macos' : undefined}>
        <div ref={mailShell} className="mail-shell" data-pane={mobilePane} data-sidebar-collapsed={preferences.sidebarCollapsed} style={{
          visibility: ready ? undefined : 'hidden',
          '--sidebar-width': `${preferences.sidebarWidth}px`,
          '--list-width': `${preferences.listWidth}px`,
        } as CSSProperties}>
          {hasMacTitleBar && <div className="window-drag-area" data-tauri-drag-region="" aria-hidden="true" />}
          {showFolders && <div className="drawer-backdrop" onClick={closeFolders} />}
          <Sidebar
            folder={folder} messages={mailbox} open={showFolders} collapsed={preferences.sidebarCollapsed} canToggle={ready}
            accountId={accountId} onSelectAccount={chooseAccount}
            onToggle={() => update({ sidebarCollapsed: !preferences.sidebarCollapsed })}
            onClose={closeFolders} onSelect={chooseFolder} onCompose={() => { if (showFolders) setShowFolders(false); openComposer({ mode: 'new' }); }}
            appearance={<ThemeSelect theme={preferences.theme} onChange={(theme) => update({ theme })} disabled={!ready} />}
            controls={<>
              <ThemePresetSelect value={themeId} onChange={(themeId) => update({ themeId })} disabled={!ready} />
              <LanguageSelect value={preferences.language} onChange={(language) => update({ language })} disabled={!ready} />
            </>}
            divider={<PaneDivider pane="sidebarWidth" width={preferences.sidebarWidth} disabled={!ready} onResize={(sidebarWidth, save) => update({ sidebarWidth }, save)} />}
          />
          <MailList
            title={listOptions.allMail ? labels.allMail : labels.folders[folder]} messages={messages} selectedId={selected?.id}
            search={query} filter={filter} searchRef={searchInput} folderToggleRef={folderToggle} foldersOpen={showFolders}
            options={listOptions} onOptionsChange={(options) => {
              if (options.allMail !== listOptions.allMail || options.withAttachments !== listOptions.withAttachments) setBulkSelection(undefined);
              setListOptions(options);
            }}
            onSearch={(value) => { setBulkSelection(undefined); setQuery(value); }}
            onFilter={(value) => { if (value !== filter) setBulkSelection(undefined); setFilter(value); }} onToggleFolders={() => setShowFolders(!showFolders)}
            selection={bulkSelection} onSelectionChange={setBulkSelection} onBulkAction={applyBulkAction}
            onSelect={(id, trigger) => {
              const message = messages.find((row) => row.id === id);
              if (message?.folder === 'drafts') { openComposer({ mode: 'edit', message }); return; }
              messageTrigger.current = trigger; setSelectedId(id); setMobilePane('reader');
            }}
            onUpdateMessage={updateDemoMessage}
            divider={<PaneDivider pane="listWidth" width={preferences.listWidth} disabled={!ready} onResize={(listWidth, save) => update({ listWidth }, save)} />}
          />
          <MessageReader key={accountId} message={selected} accountAddress={account.address} headingRef={readerHeading} inert={showFolders} onUpdateMessage={updateDemoMessage}
            onBack={() => setMobilePane('list')} onReply={(mode, message) => openComposer({ mode, message })}
            onEditDraft={(message) => openComposer({ mode: 'edit', message })} />
        </div>
        {error && <p className="preference-error" role="status">{labels.preferenceErrors[error]}</p>}
        {notice && <div className="mail-notice" inert={showFolders}>
          <span role="status">{notice.text}</span>
          {notice.undo && <button className="text-button" type="button" onClick={() => { notice.undo?.(); setNotice(undefined); }}>{labels.undo}</button>}
          {notice.openSent && <button className="text-button" type="button" onClick={() => { chooseFolder('sent'); setNotice(undefined); }}>{labels.folders.sent}</button>}
          <button className="text-button" type="button" onClick={() => setNotice(undefined)}>{labels.dismissNotice}</button>
        </div>}
        {sentFlight && <div className="send-bird" key={sentFlight} aria-hidden="true" onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !event.pseudoElement) setSentFlight(undefined);
        }} />}
        {compose && <Composer key={compose.id} entry={compose} onDraftChange={saveDraft} onSendStart={mailSounds.prepare} onSend={sendDraft} onClose={closeComposer} />}
      </div>
    </LocaleContext>
  );
}
