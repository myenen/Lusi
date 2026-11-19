import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Filter } from '../components/ui/Controls';
import { Composer, emptyDraft, type ComposeTarget } from '../features/mail/Composer';
import { demoMessages, isInFolder, type DemoMessage, type DemoMessagePatch, type Folder } from '../features/mail/demo-mail';
import { turkishDemoMessages } from '../features/mail/demo-mail.tr';
import { MailList } from '../features/mail/MailList';
import { MessageReader } from '../features/mail/MessageReader';
import { Sidebar } from '../features/mail/Sidebar';
import { catalog, LocaleContext } from './i18n';
import { LanguageSelect } from './LanguageSelect';
import { PaneDivider } from './PaneDivider';
import { ThemePresetSelect } from './ThemePresetSelect';
import { ThemeSelect } from './ThemeSelect';
import { resolveThemeId, useColorScheme } from './themes';
import { useUiPreferences } from './ui-preferences';

const hasMacTitleBar = /\bMacintosh\b/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;

export function App() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [messagePatches, setMessagePatches] = useState<Partial<Record<DemoMessage['id'], DemoMessagePatch>>>({});
  const [mobilePane, setMobilePane] = useState<'list' | 'reader'>('list');
  const [showFolders, setShowFolders] = useState(false);
  const [compose, setCompose] = useState<ComposeTarget>();
  const [newDraft, setNewDraft] = useState(emptyDraft);
  const mailShell = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const folderToggle = useRef<HTMLButtonElement>(null);
  const messageTrigger = useRef<HTMLButtonElement>(null);
  const readerHeading = useRef<HTMLHeadingElement>(null);
  const { preferences, locale, update, error, ready } = useUiPreferences();
  const themeId = resolveThemeId(preferences.themeId);
  const colorScheme = useColorScheme(preferences.theme);
  const labels = catalog[locale];
  const queryText = query.trim();
  const needle = queryText.toLocaleLowerCase(locale);
  const mailbox = (locale === 'tr' ? turkishDemoMessages : demoMessages).map((message) => ({ ...message, ...messagePatches[message.id] }));
  const messages = mailbox.filter((message) => (
    isInFolder(message, folder)
    && (filter === 'all' || message[filter])
    && (message.address.toLowerCase().includes(queryText.toLowerCase())
      || [message.sender, message.subject, message.preview ?? '', ...message.body].some((part) => part.toLocaleLowerCase(locale).includes(needle)))
  ));
  const selected = messages.find(({ id }) => id === selectedId) ?? messages[0];

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
    const deadlines = Object.values(messagePatches).flatMap((patch) => patch.snoozedUntil ?? []);
    if (!deadlines.length) return;

    const timer = window.setTimeout(() => {
      const now = Date.now();
      setMessagePatches((current) => Object.fromEntries(Object.entries(current).map(([id, patch]) => [
        id, patch.snoozedUntil !== undefined && patch.snoozedUntil <= now ? { ...patch, snoozedUntil: undefined } : patch,
      ])));
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [messagePatches]);

  useEffect(() => {
    if (!messageTrigger.current || !window.matchMedia?.('(max-width: 46rem)').matches) return;
    if (mobilePane === 'reader') readerHeading.current?.focus();
    else messageTrigger.current.focus();
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
          setMobilePane('list');
          requestAnimationFrame(() => searchInput.current?.focus());
        } else if (event.key === 'n') {
          event.preventDefault();
          setCompose({ mode: 'new' });
        }
      }
    }

    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [compose, showFolders]);

  function chooseFolder(next: Folder) {
    setFolder(next);
    setSelectedId(undefined);
    setQuery('');
    setFilter('all');
    setMobilePane('list');
    if (showFolders) closeFolders();
  }

  function updateDemoMessage(id: DemoMessage['id'], patch: DemoMessagePatch, trigger: HTMLButtonElement) {
    const mayRemoveTrigger = patch.folder || 'snoozedUntil' in patch
      || (patch.unread === false && filter === 'unread')
      || (patch.starred === false && (filter === 'starred' || folder === 'starred'));
    if (mayRemoveTrigger && document.activeElement === trigger) {
      (trigger.closest('main') ?? searchInput.current)?.focus();
    }
    setMessagePatches((current) => ({
      ...current, [id]: { ...current[id], ...patch, ...(patch.folder ? { snoozedUntil: undefined } : {}) },
    }));
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
            onToggle={() => update({ sidebarCollapsed: !preferences.sidebarCollapsed })}
            onClose={closeFolders} onSelect={chooseFolder} onCompose={() => setCompose({ mode: 'new' })}
            appearance={<ThemeSelect theme={preferences.theme} onChange={(theme) => update({ theme })} disabled={!ready} />}
            controls={<>
              <ThemePresetSelect value={themeId} onChange={(themeId) => update({ themeId })} disabled={!ready} />
              <LanguageSelect value={preferences.language} onChange={(language) => update({ language })} disabled={!ready} />
            </>}
            divider={<PaneDivider pane="sidebarWidth" width={preferences.sidebarWidth} disabled={!ready} onResize={(sidebarWidth, save) => update({ sidebarWidth }, save)} />}
          />
          <MailList
            title={labels.folders[folder]} messages={messages} selectedId={selected?.id}
            search={query} filter={filter} searchRef={searchInput} folderToggleRef={folderToggle} foldersOpen={showFolders}
            onSearch={setQuery} onFilter={setFilter} onToggleFolders={() => setShowFolders(!showFolders)}
            onSelect={(id, trigger) => { messageTrigger.current = trigger; setSelectedId(id); setMobilePane('reader'); }}
            onUpdateMessage={updateDemoMessage}
            divider={<PaneDivider pane="listWidth" width={preferences.listWidth} disabled={!ready} onResize={(listWidth, save) => update({ listWidth }, save)} />}
          />
          <MessageReader message={selected} headingRef={readerHeading} inert={showFolders} onUpdateMessage={updateDemoMessage}
            onBack={() => setMobilePane('list')} onReply={(mode, message) => setCompose({ mode, message })} />
        </div>
        {error && <p className="preference-error" role="status">{labels.preferenceErrors[error]}</p>}
        {compose && <Composer target={compose} newDraft={newDraft} onDraftChange={setNewDraft} onClose={() => setCompose(undefined)} />}
      </div>
    </LocaleContext>
  );
}
