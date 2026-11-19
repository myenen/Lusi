import { Inbox, Menu, Search, Star } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, SegmentedFilter, type Filter } from '../../components/ui/Controls';
import type { DemoMessage } from './demo-mail';

function MailRow({ message, selected, onSelect }: {
  message: DemoMessage;
  selected: boolean;
  onSelect: (trigger: HTMLButtonElement) => void;
}) {
  const labels = useLabels();
  return (
    <li>
      <button type="button" className="message-row" data-unread={Boolean(message.unread)} aria-current={selected ? 'true' : undefined} onClick={(event) => onSelect(event.currentTarget)}>
        <span className="unread-dot" aria-hidden="true" />
        {message.unread && <span className="sr-only">{labels.filters.unread}</span>}
        <span className="avatar" data-tone={message.tone} aria-hidden="true">{message.initials}</span>
        <span className="message-row-main">
          <span className="message-sender">{message.sender}</span>
          <span className="message-subject">{message.subject}</span>
          <span className="message-snippet">{message.preview ?? message.body[0]}</span>
        </span>
        <span className="message-row-meta">
          <span>{message.date}</span>
          {message.starred && <><Star className="star" size={15} aria-hidden="true" /><span className="sr-only">{labels.filters.starred}</span></>}
        </span>
      </button>
    </li>
  );
}

export function MailList({
  title, messages, selectedId, search, filter, searchRef, folderToggleRef, foldersOpen, onSearch,
  onFilter, onSelect, onToggleFolders, divider,
}: {
  title: string;
  messages: DemoMessage[];
  selectedId?: string;
  search: string;
  filter: Filter;
  searchRef: RefObject<HTMLInputElement | null>;
  folderToggleRef: RefObject<HTMLButtonElement | null>;
  foldersOpen: boolean;
  onSearch: (value: string) => void;
  onFilter: (filter: Filter) => void;
  onSelect: (id: string, trigger: HTMLButtonElement) => void;
  onToggleFolders: () => void;
  divider: ReactNode;
}) {
  const labels = useLabels();
  return (
    <section id="message-pane" className="mail-list glass-panel" aria-label={labels.messages} inert={foldersOpen}>
      <header className="list-header">
        <div className="list-title-row">
          <IconButton ref={folderToggleRef} className="folders-toggle" label={labels.toggleFolders} icon={Menu} aria-controls="sidebar" aria-expanded={foldersOpen} onClick={onToggleFolders} />
          <h1>{title}</h1>
          <span className="message-count">{labels.messageCount(messages.length)}</span>
        </div>
        <label className="search">
          <Search size={17} aria-hidden="true" />
          <input ref={searchRef} type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={labels.searchPlaceholder} aria-label={labels.searchMessages} />
        </label>
        <SegmentedFilter value={filter} onChange={onFilter} />
      </header>
      {messages.length ? (
        <ul className="message-list">
          {messages.map((message) => (
            <MailRow key={message.id} message={message} selected={message.id === selectedId} onSelect={(trigger) => onSelect(message.id, trigger)} />
          ))}
        </ul>
      ) : (
        <div className="list-empty" role="status">
          <Inbox size={26} aria-hidden="true" />
          <p>{labels.noMessages}</p>
          {(search || filter !== 'all') && <button type="button" className="text-button" onClick={() => { onSearch(''); onFilter('all'); }}>{labels.clearFilters}</button>}
        </div>
      )}
      {divider}
    </section>
  );
}
