import { Archive, Inbox, ListChecks, Mail, MailOpen, Menu, Paperclip, RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import { useRef, type ReactNode, type RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, SegmentedFilter, Toolbar, type Filter } from '../../components/ui/Controls';
import { bulkPatch, type BulkAction, type DemoMessage, type DemoMessagePatch } from './demo-mail';

function MailRow({ message, selected, checked, onCheck, onSelect, onUpdate }: {
  message: DemoMessage;
  selected: boolean;
  checked?: boolean;
  onCheck: () => void;
  onSelect: (trigger: HTMLButtonElement) => void;
  onUpdate: (patch: DemoMessagePatch, trigger: HTMLButtonElement) => void;
}) {
  const labels = useLabels();
  const content = <>
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
  </>;

  if (checked !== undefined) {
    return (
      <li className="message-list-item">
        <label className="message-row message-row-selectable" data-bulk-selected={checked} data-unread={Boolean(message.unread)}>
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={labels.selectMessage(message.subject)} />
          {content}
        </label>
      </li>
    );
  }

  return (
    <li className="message-list-item">
      <button type="button" className="message-row" data-unread={Boolean(message.unread)} aria-current={selected ? 'true' : undefined} onClick={(event) => onSelect(event.currentTarget)}>
        <span className="unread-dot" aria-hidden="true" />
        {content}
      </button>
      <Toolbar className="message-row-actions" label={`${labels.manageMessage} · ${message.subject}`}>
        {message.folder !== 'archive' && message.folder !== 'trash' && message.folder !== 'drafts' && (
          <IconButton label={labels.archiveMessage} icon={Archive} onClick={(event) => onUpdate({ folder: 'archive' }, event.currentTarget)} />
        )}
        <IconButton label={message.unread ? labels.markRead : labels.markUnread} icon={message.unread ? MailOpen : Mail} onClick={(event) => onUpdate({ unread: !message.unread }, event.currentTarget)} />
        {message.folder !== 'trash' && (
          <IconButton label={labels.moveToTrash} icon={Trash2} onClick={(event) => onUpdate({ folder: 'trash' }, event.currentTarget)} />
        )}
      </Toolbar>
    </li>
  );
}

export function MailList({
  title, messages, selectedId, search, filter, searchRef, folderToggleRef, foldersOpen, options, onOptionsChange, selection, onSelectionChange, onBulkAction, onSearch,
  onFilter, onSelect, onUpdateMessage, onToggleFolders, divider,
}: {
  title: string;
  messages: DemoMessage[];
  selectedId?: string;
  search: string;
  filter: Filter;
  searchRef: RefObject<HTMLInputElement | null>;
  folderToggleRef: RefObject<HTMLButtonElement | null>;
  foldersOpen: boolean;
  selection?: Set<DemoMessage['id']>;
  onSelectionChange: (selection: Set<DemoMessage['id']> | undefined) => void;
  onBulkAction: (action: BulkAction) => void;
  options: { allMail: boolean; oldestFirst: boolean; withAttachments: boolean };
  onOptionsChange: (options: { allMail: boolean; oldestFirst: boolean; withAttachments: boolean }) => void;
  onSearch: (value: string) => void;
  onFilter: (filter: Filter) => void;
  onSelect: (id: string, trigger: HTMLButtonElement) => void;
  onUpdateMessage: (id: DemoMessage['id'], patch: DemoMessagePatch, trigger: HTMLButtonElement) => void;
  onToggleFolders: () => void;
  divider: ReactNode;
}) {
  const labels = useLabels();
  const selectionButton = useRef<HTMLButtonElement>(null);
  const selectedMessages = messages.filter(({ id }) => selection?.has(id));
  const allSelected = messages.length > 0 && selectedMessages.length === messages.length;
  const actions = [
    { id: 'archive', label: labels.archiveMessage, icon: Archive },
    { id: 'read', label: labels.markRead, icon: MailOpen },
    { id: 'unread', label: labels.markUnread, icon: Mail },
    { id: 'trash', label: labels.moveToTrash, icon: Trash2 },
    { id: 'restore', label: labels.restoreMessage, icon: RotateCcw },
  ] as const;

  return (
    <section id="message-pane" className="mail-list glass-panel" aria-label={labels.messages} inert={foldersOpen} onKeyDown={(event) => {
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
          <select aria-label={labels.searchScope} value={options.allMail ? 'all' : 'folder'} onChange={(event) => onOptionsChange({ ...options, allMail: event.target.value === 'all' })}>
            <option value="folder">{labels.currentFolder}</option><option value="all">{labels.allMail}</option>
          </select>
          <select aria-label={labels.sortMessages} value={options.oldestFirst ? 'oldest' : 'newest'} onChange={(event) => onOptionsChange({ ...options, oldestFirst: event.target.value === 'oldest' })}>
            <option value="newest">{labels.newestFirst}</option><option value="oldest">{labels.oldestFirst}</option>
          </select>
          <IconButton label={labels.withAttachments} icon={Paperclip} aria-pressed={options.withAttachments} onClick={() => onOptionsChange({ ...options, withAttachments: !options.withAttachments })} />
          <IconButton ref={selectionButton} label={labels.selectMessages} icon={ListChecks} aria-pressed={Boolean(selection)}
            disabled={!messages.length && !selection} onClick={() => onSelectionChange(selection ? undefined : new Set())} />
        </div>
        {selection && <div className="bulk-selection">
          <div className="bulk-selection-heading">
            <span role="status">{labels.selectedCount(selectedMessages.length)}</span>
            <button className="text-button" type="button" disabled={!messages.length}
              onClick={() => onSelectionChange(allSelected ? new Set() : new Set(messages.map(({ id }) => id)))}>
              {allSelected ? labels.clearSelection : labels.selectVisible}
            </button>
          </div>
          <Toolbar label={labels.bulkActions} className="bulk-actions">
            {actions.filter(({ id }) => id !== 'restore' || messages.some((message) => message.folder === 'trash')).map(({ id, label, icon }) => (
              <IconButton key={id} label={label} icon={icon} disabled={!selectedMessages.some((message) => bulkPatch(message, id))}
                onClick={() => {
                  selectionButton.current?.focus();
                  onBulkAction(id);
                  requestAnimationFrame(() => { if (selectionButton.current?.disabled) searchRef.current?.focus(); });
                }} />
            ))}
          </Toolbar>
        </div>}
      </header>
      {messages.length ? (
        <ul className="message-list">
          {messages.map((message) => (
            <MailRow key={message.id} message={message} selected={message.id === selectedId} checked={selection?.has(message.id)}
              onCheck={() => {
                const next = new Set(selection);
                if (next.has(message.id)) next.delete(message.id);
                else next.add(message.id);
                onSelectionChange(next);
              }}
              onSelect={(trigger) => onSelect(message.id, trigger)} onUpdate={(patch, trigger) => onUpdateMessage(message.id, patch, trigger)} />
          ))}
        </ul>
      ) : (
        <div className="list-empty" role="status">
          <Inbox size={26} aria-hidden="true" />
          <p>{labels.noMessages}</p>
          {(search || filter !== 'all' || options.withAttachments) && <button type="button" className="text-button" onClick={() => { onSearch(''); onFilter('all'); onOptionsChange({ ...options, withAttachments: false }); }}>{labels.clearFilters}</button>}
        </div>
      )}
      {divider}
    </section>
  );
}
