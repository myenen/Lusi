import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, Inbox, Mail, Menu, Search, Star } from 'lucide-react';
import { demoMessages, type Folder } from '../features/mail/demo-mail';
import { ThemeSelect, type Theme } from './ThemeSelect';

const folders = [
  { id: 'inbox', label: 'Inbox', Icon: Inbox },
  { id: 'starred', label: 'Starred', Icon: Star },
  { id: 'archive', label: 'Archive', Icon: Archive },
] as const;

const unreadCount = demoMessages.filter(({ unread, archived }) => unread && !archived).length;

export function App() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [theme, setTheme] = useState<Theme>('system');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [mobilePane, setMobilePane] = useState<'list' | 'reader'>('list');
  const [showFolders, setShowFolders] = useState(false);
  const messageTrigger = useRef<HTMLButtonElement>(null);
  const readerHeading = useRef<HTMLHeadingElement>(null);
  const folderLabel = folders.find(({ id }) => id === folder)?.label;
  const search = query.trim().toLowerCase();
  const messages = demoMessages.filter((message) => {
    const inFolder = { inbox: !message.archived, starred: message.starred, archive: message.archived }[folder];
    return inFolder && [message.sender, message.subject, ...message.body].some((part) => part.toLowerCase().includes(search));
  });
  const selected = messages.find(({ id }) => id === selectedId) ?? messages[0];

  useEffect(() => {
    if (!messageTrigger.current || !window.matchMedia?.('(max-width: 45rem)').matches) return;

    if (mobilePane === 'reader') readerHeading.current?.focus();
    else messageTrigger.current.focus();
  }, [mobilePane]);

  return (
    <div className="mail-shell" data-theme={theme} data-pane={mobilePane}>
      <aside className="sidebar" data-open={showFolders}>
        <div className="brand"><span className="brand-icon"><Mail size={19} /></span>Minimal Mail</div>
        <div className="account"><span className="account-icon">D</span><div><strong>Demo account</strong><small>Sample messages</small></div></div>
        <nav aria-label="Mail folders">
          {folders.map(({ id, label, Icon }) => (
            <button key={id} type="button" aria-current={id === folder ? 'page' : undefined} onClick={() => {
              setFolder(id);
              setSelectedId(undefined);
              setQuery('');
              setMobilePane('list');
              setShowFolders(false);
            }}>
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
              {id === 'inbox' && <span className="folder-count" aria-label={unreadCount + ' unread'}>{unreadCount}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto"><ThemeSelect theme={theme} onChange={setTheme} /></div>
      </aside>

      <section className="mail-list" aria-label="Messages">
        <header>
          <div className="flex items-center gap-2">
            <button type="button" className="icon-button folders-toggle" aria-label="Toggle folders" aria-expanded={showFolders} onClick={() => setShowFolders(!showFolders)}>
              <Menu size={20} />
            </button>
            <h1>{folderLabel}</h1>
          </div>
          <label className="search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" aria-label="Search messages" />
          </label>
        </header>
        <ul className="message-list">
          {messages.map((message) => (
            <li key={message.id}>
              <button type="button" className="message-row" aria-current={message.id === selected?.id ? 'true' : undefined} onClick={(event) => {
                messageTrigger.current = event.currentTarget;
                setSelectedId(message.id);
                setMobilePane('reader');
              }}>
                <span className="message-row-top">
                  <strong>{message.sender}</strong>
                  <span>{message.date}</span>
                </span>
                <span className="message-row-subject">
                  {message.unread && <span className="unread-dot" aria-label="Unread" />}
                  <span>{message.subject}</span>
                  {message.starred && <Star className="star" size={13} aria-label="Starred" />}
                </span>
                <span className="snippet">{message.body[0]}</span>
              </button>
            </li>
          ))}
        </ul>
        {messages.length === 0 && <p className="list-empty" role="status">No messages found.</p>}
      </section>

      <main className="reader" aria-label="Message reader">
        <header className="reader-toolbar">
          <button type="button" className="icon-button reader-back" aria-label="Back to messages" onClick={() => setMobilePane('list')}>
            <ArrowLeft size={20} />
          </button>
        </header>
        {selected ? (
          <article className="letter" key={selected.id}>
            <h2 ref={readerHeading} tabIndex={-1}>{selected.subject}</h2>
            <div className="letter-meta">
              <span className="avatar" data-tone={selected.tone} aria-hidden="true">{selected.initials}</span>
              <div className="min-w-0"><strong>{selected.sender}</strong><small>{selected.address}</small></div>
              <span className="letter-date">{selected.date}</span>
            </div>
            <div className="letter-body">
              {selected.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </article>
        ) : (
          <div className="reader-empty"><Mail size={30} aria-hidden="true" /><p>No message to display</p></div>
        )}
      </main>
    </div>
  );
}
