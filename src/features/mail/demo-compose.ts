import { demoAddress, type DemoAttachment, type DemoMessage } from './demo-mail';

export type ReplyMode = 'reply' | 'replyAll' | 'forward';
export type ComposeTarget = { mode: 'new' } | { mode: ReplyMode | 'edit'; message: DemoMessage };

export interface Draft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: DemoAttachment[];
}

export interface SavedDraft {
  id: DemoMessage['id'];
  target: ComposeTarget;
  draft: Draft;
  updatedAt: number;
}

export const emptyDraft: Draft = { to: '', cc: '', bcc: '', subject: '', body: '', attachments: [] };

export function splitAddresses(value: string) {
  return value.split(/[,;]+/).map((address) => address.trim()).filter(Boolean);
}

export function makeDraft(target: ComposeTarget): Draft {
  if (target.mode === 'new') return emptyDraft;
  const { message, mode } = target;
  if (mode === 'edit') return {
    ...emptyDraft, to: message.to ?? '', cc: message.cc ?? '', subject: message.subject,
    body: message.body.join('\n\n'), attachments: message.attachments ?? [],
  };
  if (mode === 'forward') return {
    ...emptyDraft, subject: `Fwd: ${message.subject}`, body: `\n\n${message.sender} <${message.address}>\n${message.body.join('\n\n')}`,
    attachments: message.attachments ?? [],
  };

  const seen = new Set([demoAddress, message.address.toLowerCase()]);
  const otherRecipients = (value = '') => splitAddresses(value).filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const to = mode === 'replyAll' ? [message.address, ...otherRecipients(message.to)].join(', ') : message.address;
  const cc = mode === 'replyAll' ? otherRecipients(message.cc).join(', ') : '';
  return { ...emptyDraft, to, cc, subject: `Re: ${message.subject}` };
}

export function draftMessage({ id, draft, updatedAt }: SavedDraft, folder: 'sent' | 'drafts', sender: string, untitled: string, locale: string): DemoMessage {
  return {
    id, folder, sender, address: demoAddress, to: draft.to, cc: draft.cc, subject: draft.subject.trim() || untitled,
    body: draft.body.trim() ? draft.body.split(/\n\n+/) : [], date: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(updatedAt),
    sentAt: updatedAt, initials: 'D', tone: 'blue', attachments: draft.attachments,
  };
}
