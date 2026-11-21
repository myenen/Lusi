import { ArrowDownToLine, FileText, Image, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import { downloadConnectedAttachment, imapErrorMessage, openConnectedAttachment, type AttachmentDownloadResult, type MailAttachment, type MessageKey } from '../accounts/imap-api';

export function MessageAttachments({ attachments, accountId, folder, messageKey }: {
  attachments: MailAttachment[];
  accountId: number;
  folder: string;
  messageKey: MessageKey;
}) {
  const labels = useLabels();
  const id = useId();
  const [pending, setPending] = useState<{ part: string; action: 'open' | 'save' }>();
  const [error, setError] = useState<string>();
  const [saveResult, setSaveResult] = useState<AttachmentDownloadResult>();

  async function handleAttachment(attachment: MailAttachment, action: 'open' | 'save') {
    setError(undefined);
    setSaveResult(undefined);
    setPending({ part: attachment.part.join('.'), action });
    try {
      if (action === 'open') {
        await openConnectedAttachment(accountId, folder, messageKey, attachment.part);
      } else {
        setSaveResult(await downloadConnectedAttachment(accountId, folder, messageKey, attachment.part));
      }
    } catch (failure) {
      setError(imapErrorMessage(failure, {
        ...labels.imapErrors, unknown: action === 'open' ? labels.imapErrors.attachmentOpen : labels.downloadFailed,
      }));
    } finally {
      setPending(undefined);
    }
  }

  return <section className="message-attachments" aria-label={labels.attachments} aria-busy={Boolean(pending)}>
    <ul className="attachments">
      {attachments.map((attachment) => {
        const part = attachment.part.join('.');
        const openId = `${id}-${part}`;
        const name = attachment.name ?? `${labels.attachmentFile} ${part}`;
        const Icon = attachment.isImage ? Image : FileText;
        const content = <>
          <span className="attachment-icon" data-type={attachment.isImage ? 'image' : 'file'}><Icon size={18} aria-hidden="true" /></span>
          <span className="attachment-meta"><strong title={name}>{name}</strong></span>
        </>;
        return <li className="attachment-chip" key={part}>
          {attachment.canOpen ? <label className="attachment-link" htmlFor={openId}>{content}</label>
            : <span className="attachment-link" title={labels.imapErrors.attachmentOpenUnsupported}>{content}</span>}
          {attachment.canOpen && <IconButton id={openId} label={labels.openAttachment(name)} icon={Search}
            disabled={Boolean(pending)} aria-busy={pending?.part === part && pending.action === 'open'}
            onClick={() => void handleAttachment(attachment, 'open')} />}
          <IconButton label={attachment.canOpen ? labels.downloadAndOpenAttachment(name) : labels.download(name)} icon={ArrowDownToLine}
            disabled={Boolean(pending)} aria-busy={pending?.part === part && pending.action === 'save'}
            onClick={() => void handleAttachment(attachment, 'save')} />
        </li>;
      })}
    </ul>
    {pending && <p className="mailbox-status" role="status">{pending.action === 'open' ? labels.openingAttachment : labels.downloadingAttachment}</p>}
    {saveResult && <p className={saveResult === 'openFailed' ? 'account-setup-error' : 'mailbox-status'} role={saveResult === 'openFailed' ? 'alert' : 'status'}>
      {saveResult === 'opened' ? labels.attachmentSavedAndOpened :
        saveResult === 'openFailed' ? labels.attachmentSavedButNotOpened : labels.attachmentSaved}
    </p>}
    {error && <p className="account-setup-error" role="alert">{error}</p>}
  </section>;
}
