import { invoke } from '@tauri-apps/api/core';

export interface ImapAccount {
  email: string;
  host: string;
  port: number;
  username?: string;
  startTls?: boolean;
}

export interface DiscoveredImap extends Pick<ImapAccount, 'host' | 'port'> {
  needsConfirmation: boolean;
  username?: string;
  startTls?: boolean;
  outgoing?: SmtpSettings;
}

export type SmtpSettings = Omit<ImapAccount, 'email'>;

export interface MessageKey {
  uidValidity: number;
  uid: number;
}

export interface ImapHeader {
  key: MessageKey;
  sender: string;
  address: string;
  subject: string;
  sentAt: number | null;
  unread: boolean;
  starred: boolean;
}

export interface ConnectedInbox {
  email: string;
  headers: ImapHeader[];
  canSend: boolean;
}

export interface OpenedMessage {
  body: string | null;
  html?: { content: string } | null;
  summary: MessageSummary | null;
  seen: boolean;
  seenError: string | null;
  reply?: { to: string[]; cc: string[]; thread: ReplyThread | null } | null;
}

export interface MessageSummary {
  points: { kind: 'keyPoint' | 'action' | 'deadline'; text: string }[];
}

export interface ReplyThread {
  inReplyTo: string;
  references: string[];
}

export type MessageAction = 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash' | 'restore';

export interface OutgoingMessage {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html?: string;
  attachments: { name: string; data: string }[];
  replyThread?: ReplyThread;
}

export type FolderKind = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'junk' | 'all' | 'flagged' | 'custom';
export interface MailFolder {
  id: string;
  name: string;
  kind: FolderKind;
}

export const inboxFolder: MailFolder = { id: 'INBOX', name: 'INBOX', kind: 'inbox' };

export const loadConnectedInbox = () => invoke<ConnectedInbox | null>('load_connected_inbox');
export const discoverImapSettings = (email: string) => invoke<DiscoveredImap | null>('discover_imap_settings', { email });
export const checkImapSettings = (account: ImapAccount, outgoing: SmtpSettings) => invoke<void>('check_imap_settings', { account, outgoing });
export const connectImapAccount = (account: ImapAccount, outgoing: SmtpSettings, password: string) =>
  invoke<ConnectedInbox>('connect_imap_account', { account, outgoing, password });
export const refreshConnectedInbox = () => invoke<ConnectedInbox>('refresh_connected_inbox');
export const listConnectedFolders = () => invoke<MailFolder[]>('list_connected_folders');
export const readConnectedFolder = (folder: string) => invoke<ImapHeader[]>('read_connected_folder', { folder });
export const readConnectedMessage = (folder: string, key: MessageKey) =>
  invoke<OpenedMessage>('read_connected_message', { folder, key });
export const sendConnectedMessage = (message: OutgoingMessage) => invoke<void>('send_connected_message', { message });
export const updateConnectedMessage = (folder: string, key: MessageKey, action: MessageAction) =>
  invoke<void>('update_connected_message', { folder, key, action });

export function imapErrorMessage(error: unknown, messages: Record<string, string> & { unknown: string }) {
  return typeof error === 'string' && Object.hasOwn(messages, error) ? messages[error] : messages.unknown;
}
