import { FileText, Paperclip, Send, X } from 'lucide-react';
import { Fragment, useContext, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LocaleContext, useLabels, type Locale } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import { splitAddresses, type Draft, type SavedDraft } from './demo-compose';
import type { DemoAttachment } from './demo-mail';

function formatFileSize(bytes: number, locale: Locale) {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes >= 1024 ** 2) return `${number.format(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${number.format(bytes / 1024)} KiB`;
  return `${number.format(bytes)} B`;
}

export function Composer({ entry, onDraftChange, onSendStart, onSend, onClose }: {
  entry: SavedDraft;
  onDraftChange: (draft: Draft) => void;
  onSendStart: () => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const { target, draft } = entry;
  const labels = useLabels();
  const locale = useContext(LocaleContext);
  const [showCopies, setShowCopies] = useState(Boolean(draft.cc || draft.bcc));
  const [sendState, setSendState] = useState<'idle' | 'invalid' | 'sending' | 'failed'>('idle');
  const fieldId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const attachButton = useRef<HTMLButtonElement>(null);
  const sendTimer = useRef<number | undefined>(undefined);
  const sending = sendState === 'sending';
  const headerFields = showCopies ? ['to', 'cc', 'bcc', 'subject'] as const : ['to', 'subject'] as const;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    if (target.mode === 'reply' || target.mode === 'replyAll') bodyRef.current?.focus();
    else toRef.current?.focus();
    return () => { dialog?.close(); window.clearTimeout(sendTimer.current); };
  }, [target.mode]);

  function change<Field extends keyof Draft>(field: Field, value: Draft[Field]) {
    if (sendState !== 'idle') setSendState('idle');
    onDraftChange({ ...draft, [field]: value });
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendTimer.current !== undefined) return;
    const to = splitAddresses(draft.to);
    const recipients = [...to, ...splitAddresses(draft.cc), ...splitAddresses(draft.bcc)];
    if (!to.length || recipients.some((address) => !/^[^\s@<>]+@[^\s@]+\.[^\s@]+$/.test(address))) {
      setSendState('invalid');
      return;
    }
    onSendStart();
    setSendState('sending');
    sendTimer.current = window.setTimeout(() => {
      sendTimer.current = undefined;
      if (recipients.some((address) => address.toLowerCase() === 'fail@example.test')) {
        setSendState('failed');
      } else {
        onSend();
      }
    }, 450);
  }

  return (
    <dialog ref={dialogRef} className="composer" aria-labelledby="composer-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="composer-header">
        <h2 id="composer-title">{labels.composeTitles[target.mode]}</h2>
        <IconButton label={labels.closeComposer} icon={X} onClick={onClose} />
      </header>
      <form onSubmit={send}>
        <fieldset className="composer-fields" disabled={sending}>
          <div className="composer-headers">
            {headerFields.map((field) => {
              const id = `${fieldId}-${field}`;
              const input = <input id={id} ref={field === 'to' ? toRef : undefined} value={draft[field]} onChange={(event) => change(field, event.target.value)} />;
              return (
                <Fragment key={field}>
                  <label htmlFor={id}>{labels[field]}</label>
                  {field === 'to' ? (
                    <div className="composer-recipient">
                      {input}
                      <button className="text-button" type="button" aria-expanded={showCopies} onClick={() => setShowCopies(!showCopies)}>{labels.copies}</button>
                    </div>
                  ) : input}
                </Fragment>
              );
            })}
          </div>
          <textarea ref={bodyRef} aria-label={labels.messageBody} placeholder={labels.writeMessage} value={draft.body} onChange={(event) => change('body', event.target.value)} />
          {draft.attachments.length > 0 && (
            <ul className="composer-attachments" aria-label={labels.attachments}>
              {draft.attachments.map((attachment, index) => (
                <li className="composer-attachment" key={`${index}-${attachment.name}`}>
                  <FileText size={17} aria-hidden="true" />
                  <span className="attachment-meta"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.size}</small></span>
                  <IconButton label={labels.removeAttachment(attachment.name)} icon={X} onClick={() => {
                    attachButton.current?.focus();
                    change('attachments', draft.attachments.filter((_, position) => position !== index));
                  }} />
                </li>
              ))}
            </ul>
          )}
          {(sendState === 'invalid' || sendState === 'failed') && <p className="composer-error" role="alert">{sendState === 'invalid' ? labels.invalidRecipients : labels.demoSendFailed}</p>}
        </fieldset>
        <footer className="composer-footer">
          <input ref={filesRef} type="file" multiple hidden aria-label={labels.attachFiles} onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            const attachments = files.map<DemoAttachment>((file) => ({
              file, name: file.name, size: formatFileSize(file.size, locale),
              type: /^(image\/(jpeg|png|webp|gif|avif))$/.test(file.type) ? 'image' : file.type === 'text/plain' ? 'text' : 'file',
            }));
            if (attachments.length) change('attachments', [...draft.attachments, ...attachments]);
          }} />
          <button ref={attachButton} className="composer-attach" disabled={sending} type="button" onClick={() => filesRef.current?.click()}>
            <Paperclip size={16} aria-hidden="true" />{labels.attachFiles}
          </button>
          <small role="status">{sending ? labels.demoSending : labels.demoSendHint}</small>
          <button className="compose-button" type="submit" disabled={sending}><Send size={16} aria-hidden="true" />{labels.send}</button>
        </footer>
      </form>
    </dialog>
  );
}
