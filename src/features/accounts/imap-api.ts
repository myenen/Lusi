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
  oauthProvider?: 'gmail';
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
  hasAttachments?: boolean;
}

export interface ConnectedInbox {
  accountId: number;
  email: string;
  headers: ImapHeader[];
  canSend: boolean;
  oauthProvider?: 'gmail';
}

export interface ConnectedAccount {
  id: number;
  email: string;
}

export interface OpenedMessage {
  body: string | null;
  bodyTruncated?: boolean;
  attachments?: MailAttachment[];
  html?: { content: string } | null;
  summary: MessageSummary | null;
  seen: boolean;
  seenError: string | null;
  reply?: { to: string[]; cc: string[]; thread: ReplyThread | null } | null;
}

export interface MailAttachment {
  part: number[];
  name: string | null;
  isImage: boolean;
  canOpen: boolean;
}

export type AttachmentDownloadResult = 'saved' | 'opened' | 'openFailed';

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
export const listConnectedAccounts = () => invoke<ConnectedAccount[]>('list_connected_accounts');
export const switchConnectedAccount = (accountId: number) => invoke<ConnectedInbox>('switch_connected_account', { accountId });
export const discoverImapSettings = (email: string) => invoke<DiscoveredImap | null>('discover_imap_settings', { email });
export const checkImapSettings = (account: ImapAccount, outgoing: SmtpSettings) => invoke<void>('check_imap_settings', { account, outgoing });
export const connectImapAccount = (account: ImapAccount, outgoing: SmtpSettings, password: string) =>
  invoke<ConnectedInbox>('connect_imap_account', { account, outgoing, password });

export const connectGmailAccount = (email: string, reconnectAccountId?: number) =>
  invoke<ConnectedInbox>('connect_gmail_account', { email, ...(reconnectAccountId !== undefined && { reconnectAccountId }) });
export const refreshConnectedInbox = (accountId: number) => invoke<ConnectedInbox>('refresh_connected_inbox', { accountId });
export const listConnectedFolders = (accountId: number) => invoke<MailFolder[]>('list_connected_folders', { accountId });
export const readConnectedFolder = (accountId: number, folder: string) => invoke<ImapHeader[]>('read_connected_folder', { accountId, folder });
export const readConnectedMessage = (accountId: number, folder: string, key: MessageKey) =>
  invoke<OpenedMessage>('read_connected_message', { accountId, folder, key });
export const downloadConnectedAttachment = (accountId: number, folder: string, key: MessageKey, part: number[]) =>
  invoke<AttachmentDownloadResult>('download_connected_attachment', { accountId, folder, key, part });
export const openConnectedAttachment = (accountId: number, folder: string, key: MessageKey, part: number[]) =>
  invoke<void>('open_connected_attachment', { accountId, folder, key, part });
export const sendConnectedMessage = (accountId: number, message: OutgoingMessage) => invoke<void>('send_connected_message', { accountId, message });
export const updateConnectedMessage = (accountId: number, folder: string, key: MessageKey, action: MessageAction) =>
  invoke<void>('update_connected_message', { accountId, folder, key, action });
export const updateConnectedMessages = (accountId: number, folder: string, keys: MessageKey[], action: MessageAction) =>
  invoke<{ updated: MessageKey[]; error: string | null }>('update_connected_messages', { accountId, folder, keys, action });

export function imapErrorMessage(error: unknown, messages: Record<string, string> & { unknown: string }) {
  return typeof error === 'string' && Object.hasOwn(messages, error) ? messages[error] : messages.unknown;
}
