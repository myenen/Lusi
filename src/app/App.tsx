import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Filter } from '../components/ui/Controls';
import { Composer, emptyDraft, type ComposeTarget } from '../features/mail/Composer';
import { demoMessages, isInFolder, type Folder } from '../features/mail/demo-mail';
import { MailList } from '../features/mail/MailList';
import { MessageReader } from '../features/mail/MessageReader';
import { folderName, Sidebar } from '../features/mail/Sidebar';
import { PaneDivider } from './PaneDivider';
import { ThemeSelect } from './ThemeSelect';
import { useUiPreferences } from './ui-preferences';

export function App() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [mobilePane, setMobilePane] = useState<'list' | 'reader'>('list');
  const [showFolders, setShowFolders] = useState(false);
  const [compose, setCompose] = useState<ComposeTarget>();
  const [newDraft, setNewDraft] = useState(emptyDraft);
  const searchInput = useRef<HTMLInputElement>(null);
  const folderToggle = useRef<HTMLButtonElement>(null);
  const messageTrigger = useRef<HTMLButtonElement>(null);
  const readerHeading = useRef<HTMLHeadingElement>(null);
  const { preferences, update, error, ready } = useUiPreferences();
  const needle = query.trim().toLowerCase();
  const messages = demoMessages.filter((message) => (
    isInFolder(message, folder)
    && (filter === 'all' || message[filter])
    && [message.sender, message.address, message.subject, message.preview ?? '', ...message.body].some((part) => part.toLowerCase().includes(needle))
  ));
  const selected = messages.find(({ id }) => id === selectedId) ?? messages[0];

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

  return (
    <div className="workspace" data-theme={preferences.theme}>
      <div className="mail-shell" data-pane={mobilePane} style={{
        '--sidebar-width': `${preferences.sidebarWidth}px`,
        '--list-width': `${preferences.listWidth}px`,
      } as CSSProperties}>
        {showFolders && <div className="drawer-backdrop" onClick={closeFolders} />}
        <Sidebar
          folder={folder} open={showFolders} onClose={closeFolders} onSelect={chooseFolder} onCompose={() => setCompose({ mode: 'new' })}
          appearance={<ThemeSelect theme={preferences.theme} onChange={(theme) => update({ theme })} disabled={!ready} />}
          divider={<PaneDivider pane="sidebarWidth" width={preferences.sidebarWidth} disabled={!ready} onResize={(sidebarWidth, save) => update({ sidebarWidth }, save)} />}
        />
        <MailList
          title={folderName(folder)} messages={messages} selectedId={selected?.id}
          search={query} filter={filter} searchRef={searchInput} folderToggleRef={folderToggle} foldersOpen={showFolders}
          onSearch={setQuery} onFilter={setFilter} onToggleFolders={() => setShowFolders(!showFolders)}
          onSelect={(id, trigger) => { messageTrigger.current = trigger; setSelectedId(id); setMobilePane('reader'); }}
          divider={<PaneDivider pane="listWidth" width={preferences.listWidth} disabled={!ready} onResize={(listWidth, save) => update({ listWidth }, save)} />}
        />
        <MessageReader message={selected} headingRef={readerHeading} inert={showFolders} onBack={() => setMobilePane('list')} onReply={(mode, message) => setCompose({ mode, message })} />
      </div>
      {error && <p className="preference-error" role="status">{error}</p>}
      {compose && <Composer target={compose} newDraft={newDraft} onDraftChange={setNewDraft} onClose={() => setCompose(undefined)} />}
    </div>
  );
}
