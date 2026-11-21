import { Inbox, Menu, RefreshCw, Search, Star } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, SegmentedFilter, type Filter } from '../../components/ui/Controls';
import type { MessageRow } from './connected-mail';

export function MailList({
  title, messages, selectedId, search, filter, searchRef, folderToggleRef, foldersOpen,
  oldestFirst, onSort, onSearch, onFilter, onSelect, onToggleFolders, divider, busy, onRefresh, status,
}: {
  title: string;
  messages: MessageRow[];
  selectedId?: string;
  search: string;
  filter: Filter;
  searchRef: RefObject<HTMLInputElement | null>;
  folderToggleRef: RefObject<HTMLButtonElement | null>;
  foldersOpen: boolean;
  oldestFirst: boolean;
  onSort: (oldestFirst: boolean) => void;
  onSearch: (value: string) => void;
  onFilter: (filter: Filter) => void;
  onSelect: (id: string, trigger: HTMLButtonElement) => void;
  onToggleFolders: () => void;
  divider: ReactNode;
  busy: boolean;
  onRefresh: () => void;
  status?: ReactNode;
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
        <div className="list-options">
          <select aria-label={labels.sortMessages} value={oldestFirst ? 'oldest' : 'newest'} onChange={(event) => onSort(event.target.value === 'oldest')}>
            <option value="newest">{labels.newestFirst}</option>
            <option value="oldest">{labels.oldestFirst}</option>
          </select>
          <IconButton label={labels.connectedInbox.refresh} icon={RefreshCw} disabled={busy} onClick={onRefresh} />
        </div>
        {status}
      </header>
      {messages.length ? <ul className="message-list">
        {messages.map((message) => (
          <li key={message.id} className="message-list-item">
            <button type="button" className="message-row" data-unread={message.unread} aria-current={message.id === selectedId ? 'true' : undefined} onClick={(event) => onSelect(message.id, event.currentTarget)}>
              <span className="unread-dot" aria-hidden="true" />
              {message.unread && <span className="sr-only">{labels.filters.unread}</span>}
              <span className="avatar" data-tone={message.tone} aria-hidden="true">{message.initials}</span>
              <span className="message-row-main">
                <span className="message-sender">{message.sender}</span>
                <span className="message-subject">{message.subject}</span>
                <span className="message-snippet">{message.preview}</span>
              </span>
              <span className="message-row-meta">{message.date}
                {message.starred && <Star className="message-star" size={14} aria-label={labels.filters.starred} />}
              </span>
            </button>
          </li>
        ))}
      </ul> : !busy && !status && <div className="list-empty" role="status">
        <Inbox size={26} aria-hidden="true" />
        <p>{labels.noMessages}</p>
        {(search || filter !== 'all') && <button type="button" className="text-button" onClick={() => { onSearch(''); onFilter('all'); }}>{labels.clearFilters}</button>}
      </div>}
      {divider}
    </section>
  );
}
