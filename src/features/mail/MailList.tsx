import { Archive, Inbox, ListChecks, Mail, MailOpen, Menu, Paperclip, RefreshCw, RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import { useRef, type ReactNode, type RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, SegmentedFilter, Toolbar, type Filter } from '../../components/ui/Controls';
import { SelectBox } from '../../components/ui/SelectBox';
import type { MessageAction } from '../accounts/imap-api';
import { MessageActions, type MessageActionAvailability } from './MessageActions';
import type { MessageRow } from './connected-mail';

export function MailList({
  title, messages, selectedId, search, filter, searchRef, folderToggleRef, foldersOpen,
  oldestFirst, onSort, onSearch, onFilter, onSelect, onToggleFolders, divider, busy, refreshing, onRefresh, status,
  canArchive, canTrash, inTrash, onAction, selection, onSelectionChange, onBulkAction,
}: MessageActionAvailability & {
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
  onAction: (id: string, action: MessageAction) => void;
  selection?: ReadonlySet<string>;
  onSelectionChange: (selection: Set<string> | undefined) => void;
  onBulkAction: (action: MessageAction) => void;
  onToggleFolders: () => void;
  divider: ReactNode;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  status?: ReactNode;
}) {
  const labels = useLabels();
  const selectionButton = useRef<HTMLButtonElement>(null);
  const selectedMessages = messages.filter(({ id }) => selection?.has(id));
  const allSelected = messages.length > 0 && selectedMessages.length === messages.length;
  const bulkActions = [
    { action: 'read', label: labels.markRead, icon: MailOpen, enabled: selectedMessages.some(({ unread }) => unread) },
    { action: 'unread', label: labels.markUnread, icon: Mail, enabled: selectedMessages.some(({ unread }) => !unread) },
    { action: 'archive', label: labels.archiveMessage, icon: Archive, enabled: canArchive && selectedMessages.length > 0 },
    inTrash
      ? { action: 'restore' as const, label: labels.restoreMessage, icon: RotateCcw, enabled: selectedMessages.length > 0 }
      : { action: 'trash' as const, label: labels.moveToTrash, icon: Trash2, enabled: canTrash && selectedMessages.length > 0 },
  ] as const;

  return (
    <section id="message-pane" className="mail-list glass-panel" aria-label={labels.messages} inert={foldersOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !selection || event.defaultPrevented) return;
        event.preventDefault();
        onSelectionChange(undefined);
        selectionButton.current?.focus();
      }}>
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
          <SelectBox className="list-sort" label={labels.sortMessages} value={oldestFirst ? 'oldest' : 'newest'}
            options={[{ value: 'newest', label: labels.newestFirst }, { value: 'oldest', label: labels.oldestFirst }]}
            onChange={(value) => onSort(value === 'oldest')} />
          <IconButton ref={selectionButton} label={labels.selectMessages} icon={ListChecks}
            aria-pressed={Boolean(selection)} disabled={!messages.length && !selection}
            onClick={() => onSelectionChange(selection ? undefined : new Set())} />
          <IconButton className="mail-list-refresh" label={labels.connectedInbox.refresh} icon={RefreshCw}
            disabled={busy} aria-busy={refreshing} onClick={onRefresh} />
        </div>
        {selection && <div className="bulk-selection">
          <div className="bulk-selection-heading">
            <span role="status">{labels.selectedCount(selectedMessages.length)}</span>
            <button className="text-button" type="button" disabled={busy || !messages.length}
              onClick={() => onSelectionChange(allSelected ? new Set() : new Set(messages.map(({ id }) => id)))}>
              {allSelected ? labels.clearSelection : labels.selectVisible}
            </button>
          </div>
          <Toolbar label={labels.bulkActions} className="bulk-actions">
            {bulkActions.map(({ action, label, icon, enabled }) => (
              <IconButton key={action} label={label} icon={icon} disabled={busy || !enabled} onClick={() => {
                selectionButton.current?.focus();
                onBulkAction(action);
              }} />
            ))}
          </Toolbar>
        </div>}
        {status}
      </header>
      {messages.length ? <ul className="message-list">
        {messages.map((message) => {
          const content = <>
              {message.unread && <span className="sr-only">{labels.filters.unread}</span>}
              <span className="avatar" data-tone={message.tone} aria-hidden="true">{message.initials}</span>
              <span className="message-row-main">
                <span className="message-sender">{message.sender}</span>
                <span className="message-subject">{message.subject}</span>
                <span className="message-snippet">{message.preview}</span>
              </span>
              <span className="message-row-meta">{message.date}
                {(message.hasAttachments || message.starred) && <span className="message-row-indicators">
                  {message.hasAttachments && <span className="message-attachment" role="img" aria-label={labels.withAttachments} title={labels.withAttachments}>
                    <Paperclip size={13} aria-hidden="true" />
                  </span>}
                  {message.starred && <Star className="message-star" size={14} aria-label={labels.filters.starred} />}
                </span>}
              </span>
          </>;
          return <li key={message.id} className="message-list-item">
            {selection ? (
              <label className="message-row message-row-selectable" data-unread={message.unread} data-bulk-selected={selection.has(message.id)}>
                <input type="checkbox" aria-label={labels.selectMessage(message.subject)} disabled={busy}
                  checked={selection.has(message.id)} onChange={(event) => {
                    const next = new Set(selection);
                    if (event.target.checked) next.add(message.id);
                    else next.delete(message.id);
                    onSelectionChange(next);
                  }} />
                {content}
              </label>
            ) : <>
              <button type="button" className="message-row" data-unread={message.unread} aria-current={message.id === selectedId ? 'true' : undefined}
                onClick={(event) => onSelect(message.id, event.currentTarget)}>
                <span className="unread-dot" aria-hidden="true" />
                {content}
              </button>
              <MessageActions message={message} className="message-row-actions" actionBusy={busy}
                canArchive={canArchive} canTrash={canTrash} inTrash={inTrash} onAction={(action) => onAction(message.id, action)} />
            </>}
          </li>;
        })}
      </ul> : !busy && !status && <div className="list-empty" role="status">
        <Inbox size={26} aria-hidden="true" />
        <p>{labels.noMessages}</p>
        {(search || filter !== 'all') && <button type="button" className="text-button" onClick={() => { onSearch(''); onFilter('all'); }}>{labels.clearFilters}</button>}
      </div>}
      {divider}
    </section>
  );
}
