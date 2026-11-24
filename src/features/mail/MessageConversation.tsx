import { ChevronDown, MessagesSquare } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useLabels } from '../../app/i18n';
import { readConversation, type Conversation, type ConversationEntry, type ImapHeader, type MessageKey, type OpenedMessage } from '../accounts/imap-api';
import type { ResponseMode } from './Composer';
import { ConnectedMessageBody } from './ConnectedMessageBody';
import { connectedMessageId, connectedMessageRows, folderDisplayName } from './connected-mail';

export type ConversationResponse = (mode: ResponseMode, trigger: HTMLButtonElement, folder: string, header: ImapHeader, opened: OpenedMessage) => void;
export type ConversationSeen = (folder: string, key: MessageKey) => void;

export function MessageConversation({ accountId, folder, messageKey, body, locale, themeId, colorScheme, onSeen, onRespond }: {
  accountId: number;
  folder: string;
  messageKey: MessageKey;
  body: ReactNode;
  locale: string;
  themeId: string;
  colorScheme: 'light' | 'dark';
  onSeen: ConversationSeen;
  onRespond?: ConversationResponse;
}) {
  const labels = useLabels();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<Conversation>();
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);

  async function load() {
    if (pending.current) return;
    pending.current = true;
    setFailed(false);
    try {
      setResult(await readConversation(accountId, folder, messageKey));
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
    }
  }

  const entries = expanded ? result?.entries ?? [] : [];
  const selectedId = connectedMessageId(messageKey);
  const anchor = entries.findIndex((entry) => entry.folder.id === folder && connectedMessageId(entry.header.key) === selectedId);
  const before = anchor < 0 ? [] : entries.slice(0, anchor);
  const after = anchor < 0 ? [] : entries.slice(anchor + 1);
  function markSeen(source: string, key: MessageKey) {
    onSeen(source, key);
    setResult((current) => current && {
      ...current,
      entries: current.entries.map((entry) => entry.folder.id === source && connectedMessageId(entry.header.key) === connectedMessageId(key)
        ? { ...entry, header: { ...entry.header, unread: false } } : entry),
    });
  }

  const renderEntry = (entry: ConversationEntry) => <ConversationMessage
    key={JSON.stringify([entry.folder.id, connectedMessageId(entry.header.key)])} entry={entry}
    accountId={accountId} locale={locale} themeId={themeId} colorScheme={colorScheme} onSeen={markSeen} onRespond={onRespond} />;
  return <>
    <button type="button" className="conversation-toggle text-button" aria-controls={id} aria-expanded={expanded}
      onClick={() => {
        setExpanded(!expanded);
        if (!expanded && !result) void load();
      }}>
      <MessagesSquare size={16} aria-hidden="true" />{labels.conversation}
      <ChevronDown size={14} aria-hidden="true" className="conversation-chevron" />
    </button>
    <div id={id} className={anchor >= 0 ? 'message-conversation-panel conversation-entries' : 'message-conversation-panel'}>
      {expanded && (failed ? <div className="conversation-status" role="status">
        {labels.conversationUnavailable} <button type="button" className="text-button" onClick={() => void load()}>{labels.accountSetup.retry}</button>
      </div> : !result ? <p className="conversation-status" role="status">{labels.loadingConversation}</p>
        : !entries.length ? <p className="conversation-status" role="status">{labels.noConversation}</p> : null)}
      {expanded && result?.limited && <p className="conversation-status" role="status">{labels.conversationLimited}</p>}
      {before.map(renderEntry)}
      <div key="current-message" className={anchor >= 0 ? 'conversation-entry conversation-current' : 'conversation-anchor'}>
        {anchor >= 0 && <header><ConversationMetadata entry={entries[anchor]} locale={locale} /></header>}
        <div className="letter-body">{body}</div>
      </div>
      {after.map(renderEntry)}
    </div>
  </>;
}

function ConversationMetadata({ entry: { folder, header }, locale }: { entry: ConversationEntry; locale: string }) {
  const labels = useLabels();
  const row = connectedMessageRows([header], locale, {
    unknownSender: labels.connectedInbox.unknownSender, untitled: labels.untitled,
  })[0];
  return <span className="conversation-message-meta">
    <span className="avatar" data-tone={row.tone} aria-hidden="true">{row.initials}</span>
    <span><strong>{row.sender}</strong><small>{row.subject}</small></span>
    <small className="conversation-message-date">{folderDisplayName(folder, labels)}{row.date && ` · ${row.date}`}</small>
  </span>;
}

function ConversationMessage({ entry, accountId, locale, themeId, colorScheme, onSeen, onRespond }: {
  entry: ConversationEntry;
  accountId: number;
  locale: string;
  themeId: string;
  colorScheme: 'light' | 'dark';
  onSeen: ConversationSeen;
  onRespond?: ConversationResponse;
}) {
  const labels = useLabels();
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState<OpenedMessage>();
  const { folder, header } = entry;
  return <details className="conversation-entry" onToggle={(event) => {
    if (event.currentTarget.open) setExpanded(true);
  }}>
    <summary><ConversationMetadata entry={entry} locale={locale} /><ChevronDown size={14} aria-hidden="true" className="conversation-chevron" /></summary>
    {expanded && <div className="letter-body">
      <ConnectedMessageBody accountId={accountId} folder={folder.id} messageKey={header.key} unread={header.unread}
        themeId={themeId} colorScheme={colorScheme} onSeen={onSeen} onOpened={setOpened} />
      {opened && onRespond && <div className="conversation-response">
        {(['reply', 'replyAll', 'forward'] as const).map((mode) => <button type="button" className="text-button" key={mode}
          disabled={mode !== 'forward' && !opened.reply?.to.length}
          onClick={(event) => onRespond(mode, event.currentTarget, folder.id, header, opened)}>
          {labels.composeTitles[mode]}
        </button>)}
      </div>}
    </div>}
  </details>;
}
