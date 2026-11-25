import { Archive, Inbox, ListChecks, Mail, MailOpen, Menu, Paperclip, RefreshCw, RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { Checkbox } from '../../components/ui/Checkbox';
import { IconButton, SegmentedFilter, Toolbar, type Filter } from '../../components/ui/Controls';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { SelectBox } from '../../components/ui/SelectBox';
import type { MessageAction } from '../accounts/imap-api';
import { MessageActions, type MessageActionAvailability } from './MessageActions';
import type { MessageRow } from './connected-mail';

interface SelectionRange {
  anchor: string;
  edge: string;
  original: ReadonlySet<string>;
  result: ReadonlySet<string>;
}

export function MailList({
  title, messages, selectedId, search, filter, searchRef, folderToggleRef, foldersOpen,
  oldestFirst, onSort, onSearch, onFilter, onSelect, onToggleFolders, divider, busy, refreshing, onRefresh, status,
  canArchive, canTrash, inTrash, onAction, selection, onSelectionChange, onBulkAction, older, searchStatus,
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
  searchStatus?: ReactNode;
  older?: { cursor: string; loading: boolean; error?: string; onLoad: () => void; searchResults?: boolean };
}) {
  const labels = useLabels();
  const selectionButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selectionRange = useRef<SelectionRange | undefined>(undefined);
  const loadMarker = useRef<HTMLLIElement>(null);
  const scrollAnchor = useRef<{ cursor: string; height: number; top: number } | undefined>(undefined);
  const cursor = older?.cursor;
  const autoPage = Boolean(older && !older.loading && !older.error && !busy && !foldersOpen && !search.trim() && filter === 'all');

  function loadMore() {
    if (!older || older.loading || busy) return;
    if (list.current) {
      scrollAnchor.current = { cursor: older.cursor, height: list.current.scrollHeight, top: list.current.scrollTop };
    }
    older.onLoad();
  }

  const onMarkerVisible = useEffectEvent(loadMore);
  useEffect(() => {
    const root = list.current;
    const marker = loadMarker.current;
    if (!autoPage || !root || !marker || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (root.clientHeight > 0 && entries.some((entry) => entry.isIntersecting)) onMarkerVisible();
    }, { root, rootMargin: '160px 0px' });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [autoPage, cursor, oldestFirst]);

  useLayoutEffect(() => {
    scrollAnchor.current = undefined;
    if (list.current) list.current.scrollTop = 0;
  }, [oldestFirst, search]);

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    if (!anchor || anchor.cursor === cursor || !list.current) return;
    const insertedAbove = oldestFirst && !older?.searchResults ? list.current.scrollHeight - anchor.height : 0;
    list.current.scrollTop = anchor.top + insertedAbove;
    scrollAnchor.current = undefined;
  }, [cursor, oldestFirst, older?.searchResults]);

  function rowControl(id: string) {
    const row = Array.from(list.current?.querySelectorAll<HTMLLIElement>('[data-message-id]') ?? [])
      .find((item) => item.dataset.messageId === id);
    return row?.querySelector<HTMLButtonElement | HTMLInputElement>('button.message-row, input[type="checkbox"]');
  }

  useLayoutEffect(() => {
    const range = selectionRange.current;
    if (range && range.result === selection) rowControl(range.edge)?.focus();
  }, [selection]);

  function selectRange(anchor: number, edge: number, original: ReadonlySet<string> = new Set()) {
    const next = new Set(original);
    for (const { id } of messages.slice(Math.min(anchor, edge), Math.max(anchor, edge) + 1)) next.add(id);
    selectionRange.current = { anchor: messages[anchor].id, edge: messages[edge].id, original, result: next };
    onSelectionChange(next);
  }

  function toggleMessage(id: string, checked?: boolean) {
    const next = new Set(selection ?? messages.filter((message) => message.id === selectedId).map((message) => message.id));
    if (checked ?? !next.has(id)) next.add(id);
    else next.delete(id);
    selectionRange.current = { anchor: id, edge: id, original: next, result: next };
    onSelectionChange(next);
  }

  function handleModifiedClick(event: MouseEvent<HTMLElement>, id: string) {
    if (event.defaultPrevented || event.altKey || (!event.shiftKey && !event.metaKey && !event.ctrlKey)) return false;
    event.preventDefault();
    if (busy) return true;

    if (event.shiftKey) {
      const previous = selectionRange.current;
      const active = previous && previous.result === selection ? previous : undefined;
      const edge = messages.findIndex((message) => message.id === id);
      const anchor = messages.findIndex((message) => message.id === (active?.anchor ?? selectedId));
      selectRange(anchor < 0 ? edge : anchor, edge, active?.original ?? selection);
    } else {
      toggleMessage(id);
    }
    return true;
  }

  function handleArrowKey(event: KeyboardEvent<HTMLElement>) {
    if (foldersOpen || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey
      || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !(event.target instanceof HTMLElement)) return;
    const target = event.target;
    const viewportFocused = target === list.current;
    const rowId = target.matches('button.message-row, input[type="checkbox"]')
      ? target.closest<HTMLLIElement>('[data-message-id]')?.dataset.messageId
      : viewportFocused ? selectedId : undefined;
    const rowIndex = messages.findIndex(({ id }) => id === rowId);
    if ((rowIndex < 0 && !viewportFocused) || !messages.length || (busy && (selection || event.shiftKey))) return;

    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const edge = rowIndex < 0 ? (delta > 0 ? 0 : messages.length - 1)
      : Math.max(0, Math.min(messages.length - 1, rowIndex + delta));
    if (!event.shiftKey) {
      rowControl(messages[edge].id)?.focus();
      return;
    }

    const previous = selectionRange.current;
    const active = previous && previous.result === selection && previous.edge === rowId ? previous : undefined;
    const anchor = messages.findIndex(({ id }) => id === active?.anchor);
    if (anchor >= 0 && edge === rowIndex) return;
    selectRange(anchor >= 0 ? anchor : Math.max(0, rowIndex), edge, anchor >= 0 ? active?.original : selection);
  }

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
  const pagination = older && <li ref={loadMarker} className="list-pagination">
    {older.error && <p role="alert">{older.error}</p>}
    {older.loading
      ? <p role="status">{older.searchResults ? labels.searchingMessages : labels.loadingOlderMessages}</p>
      : <button type="button" className="text-button" disabled={busy} onClick={loadMore}>
        {older.searchResults ? (older.error ? labels.retrySearch : labels.moreSearchResults)
          : (older.error ? labels.retryOlderMessages : labels.loadOlderMessages)}
      </button>}
  </li>;
  const emptyList = !busy && !status && !searchStatus && !older?.searchResults && <li className="list-empty">
    <Inbox size={26} aria-hidden="true" />
    <p role="status">{labels.noMessages}</p>
    {(search || filter !== 'all') && <button type="button" className="text-button" onClick={() => { onSearch(''); onFilter('all'); }}>{labels.clearFilters}</button>}
  </li>;

  return (
    <section id="message-pane" className="mail-list glass-panel" aria-label={labels.messages} inert={foldersOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') {
          handleArrowKey(event);
          return;
        }
        if (!selection || event.defaultPrevented) return;
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
          <input ref={searchRef} type="search" value={search} maxLength={256} onChange={(event) => onSearch(event.target.value)} placeholder={labels.searchPlaceholder} aria-label={labels.searchMessages} />
        </label>
        <SegmentedFilter value={filter} onChange={onFilter} />
        <div className="list-options">
          <SelectBox className="list-sort" label={labels.sortMessages} value={oldestFirst ? 'oldest' : 'newest'}
            options={[{ value: 'newest', label: labels.newestFirst }, { value: 'oldest', label: labels.oldestFirst }]}
            onChange={(value) => { selectionRange.current = undefined; onSort(value === 'oldest'); }} />
          <IconButton ref={selectionButton} label={labels.selectMessages} icon={ListChecks}
            aria-pressed={Boolean(selection)} disabled={!messages.length && !selection}
            onClick={() => onSelectionChange(selection ? undefined : new Set())} />
          <IconButton className="mail-list-refresh" label={labels.connectedInbox.refresh} icon={RefreshCw}
            disabled={busy || refreshing} aria-busy={refreshing} onClick={onRefresh} />
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
        {searchStatus}
      </header>
      <ScrollArea className="mail-list-scroll" label={labels.messages} viewportRef={list}>
        <ul className="message-list">
          {oldestFirst && !older?.searchResults && pagination}
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
            return <li key={message.id} className="message-list-item" data-message-id={message.id}>
              {selection ? (
                <label className="message-row message-row-selectable" data-unread={message.unread} data-bulk-selected={selection.has(message.id)}
                  onClick={(event) => handleModifiedClick(event, message.id)}>
                  <Checkbox aria-label={labels.selectMessage(message.subject)} aria-keyshortcuts="ArrowDown ArrowUp Shift+ArrowDown Shift+ArrowUp" disabled={busy}
                    checked={selection.has(message.id)} onCheckedChange={(checked) => toggleMessage(message.id, checked)} />
                  {content}
                </label>
              ) : <>
                <button type="button" className="message-row" data-unread={message.unread} aria-current={message.id === selectedId ? 'true' : undefined}
                  aria-keyshortcuts="ArrowDown ArrowUp Shift+ArrowDown Shift+ArrowUp" onClick={(event) => {
                    if (handleModifiedClick(event, message.id)) return;
                    event.currentTarget.focus();
                    onSelect(message.id, event.currentTarget);
                  }}>
                  <span className="unread-dot" aria-hidden="true" />
                  {content}
                </button>
                <MessageActions message={message} className="message-row-actions" actionBusy={busy}
                  canArchive={canArchive} canTrash={canTrash} inTrash={inTrash} onAction={(action) => onAction(message.id, action)} />
              </>}
            </li>;
          })}
          {!messages.length && emptyList}
          {(!oldestFirst || older?.searchResults) && pagination}
        </ul>
      </ScrollArea>
      {divider}
    </section>
  );
}
