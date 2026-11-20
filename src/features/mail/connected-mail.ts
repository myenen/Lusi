import type { FolderKind, ImapHeader, MailFolder, MessageKey } from '../accounts/imap-api';
import type { useLabels } from '../../app/i18n';

export interface MessageRow {
  id: string;
  sender: string;
  address: string;
  subject: string;
  preview?: string;
  date: string;
  initials: string;
  tone: typeof avatarTones[number];
  unread: boolean;
}

type Labels = ReturnType<typeof useLabels>;
const folderLabelKeys: Record<Exclude<FolderKind, 'custom'>, keyof Labels['folders']> = {
  inbox: 'inbox', sent: 'sent', drafts: 'drafts', archive: 'archive', trash: 'trash',
  junk: 'junk', all: 'all', flagged: 'starred',
};

export function folderDisplayName(folder: MailFolder, labels: Labels) {
  return folder.kind === 'custom' ? folder.name : labels.folders[folderLabelKeys[folder.kind]];
}

export const connectedMessageId = ({ uidValidity, uid }: MessageKey) => `imap-${uidValidity}:${uid}` as const;
const avatarTones = ['violet', 'blue', 'teal', 'peach'] as const;

export function connectedMessageRows(headers: ImapHeader[], locale: string, labels: { unknownSender: string; untitled: string }): MessageRow[] {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  return headers.map((header) => connectedMessageRow(header, date, labels));
}

function connectedMessageRow(header: ImapHeader, date: Intl.DateTimeFormat, labels: { unknownSender: string; untitled: string }): MessageRow {
  const sender = header.sender || header.address || labels.unknownSender;
  const initials = sender.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase();
  return {
    id: connectedMessageId(header.key),
    sender,
    address: header.address,
    subject: header.subject || labels.untitled,
    preview: header.address !== sender ? header.address : undefined,
    date: header.sentAt === null ? '' : date.format(header.sentAt * 1000),
    initials,
    tone: avatarTones[(sender.codePointAt(0) ?? 0) % avatarTones.length],
    unread: header.unread,
  };
}
