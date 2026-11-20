import { invoke } from '@tauri-apps/api/core';

export interface ImapAccount {
  email: string;
  host: string;
  port: number;
}

export interface DiscoveredImap extends Pick<ImapAccount, 'host' | 'port'> {
  needsConfirmation: boolean;
}

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
}

export interface ConnectedInbox {
  email: string;
  headers: ImapHeader[];
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
export const checkImapSettings = (account: ImapAccount) => invoke<void>('check_imap_settings', { account });
export const connectImapAccount = (account: ImapAccount, password: string) =>
  invoke<ConnectedInbox>('connect_imap_account', { account, password });
export const refreshConnectedInbox = () => invoke<ConnectedInbox>('refresh_connected_inbox');
export const listConnectedFolders = () => invoke<MailFolder[]>('list_connected_folders');
export const readConnectedFolder = (folder: string) => invoke<ImapHeader[]>('read_connected_folder', { folder });
export const readConnectedMessage = (folder: string, key: MessageKey) =>
  invoke<string | null>('read_connected_message', { folder, key });

export function imapErrorMessage(error: unknown, messages: Record<string, string> & { unknown: string }) {
  return typeof error === 'string' && Object.hasOwn(messages, error) ? messages[error] : messages.unknown;
}
