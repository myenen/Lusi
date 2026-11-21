import { FileText, Paperclip, Send, X } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import { imapErrorMessage, sendConnectedMessage, type ReplyThread } from '../accounts/imap-api';
import { ComposerEditor, type DraftEditor } from './ComposerEditor';

export type ResponseMode = 'reply' | 'replyAll' | 'forward';
export type ComposeMode = 'new' | ResponseMode;

export interface Draft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  editor?: DraftEditor;
  files: File[];
  replyThread?: ReplyThread;
}

export const emptyDraft: Draft = { to: '', cc: '', bcc: '', subject: '', body: '', files: [] };
const splitAddresses = (list: string) => list.split(/[,;\n]/).map((address) => address.trim()).filter(Boolean);
const maxAttachmentBytes = 5 * 1024 * 1024;

async function encodeFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return { name: file.name, data: btoa(chunks.join('')) };
}

export function Composer({ accountId, draft, mode, onChange, onClose, onSendStart, onSent }: {
  accountId: number;
  draft: Draft;
  mode: ComposeMode;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSendStart: () => void;
  onSent: () => void;
}) {
  const labels = useLabels();
  const dialog = useRef<HTMLDialogElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const fieldId = useId();
  const [showCopies, setShowCopies] = useState(Boolean(draft.cc || draft.bcc));
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const fields = showCopies ? ['to', 'cc', 'bcc', 'subject'] as const : ['to', 'subject'] as const;

  useEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    if (mode === 'reply' || mode === 'replyAll') {
      const body = panel?.querySelector<HTMLElement>('[data-compose-body]');
      body?.focus();
      if (body instanceof HTMLTextAreaElement) body.setSelectionRange(0, 0);
      else if (body) {
        const caret = document.createRange();
        caret.selectNodeContents(body);
        caret.collapse(true);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(caret);
      }
    } else {
      toInput.current?.focus();
    }
    return () => panel?.close();
  }, [mode]);

  function change<Key extends keyof Draft>(field: Key, value: Draft[Key]) {
    setFailure(undefined);
    onChange({ ...draft, [field]: value });
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || failure === 'sendUncertain') return;
    const to = splitAddresses(draft.to);
    if (!to.length) {
      setFailure('invalidMessage');
      toInput.current?.focus();
      return;
    }
    pending.current = true;
    setSending(true);
    setFailure(undefined);
    onSendStart();
    try {
      const attachments = await Promise.all(draft.files.map(encodeFile));
      await sendConnectedMessage(accountId, {
        to, cc: splitAddresses(draft.cc), bcc: splitAddresses(draft.bcc),
        subject: draft.subject, body: draft.body, attachments,
        ...(draft.editor && { html: draft.editor.html }),
        ...(draft.replyThread && { replyThread: draft.replyThread }),
      });
      onSent();
    } catch (error) {
      setFailure(typeof error === 'string' ? error : 'unknown');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  return <dialog ref={dialog} className="composer" aria-labelledby={fieldId} onCancel={(event) => {
    event.preventDefault();
    if (!pending.current) onClose();
  }}>
    <header className="composer-header">
      <h2 id={fieldId}>{labels.composeTitles[mode]}</h2>
      <IconButton label={labels.closeComposer} icon={X} disabled={sending} onClick={onClose} />
    </header>
    <form onSubmit={send}>
      <fieldset className="composer-fields" disabled={sending}>
        <div className="composer-headers">{fields.map((field) => {
          const id = `${fieldId}-${field}`;
          const input = <input id={id} ref={field === 'to' ? toInput : undefined} value={draft[field]}
            required={field === 'to'} maxLength={field === 'subject' ? 300 : 8192}
            onChange={(event) => change(field, event.target.value)} />;
          return <Fragment key={field}>
            <label htmlFor={id}>{labels[field]}</label>
            {field === 'to' ? <div className="composer-recipient">
              {input}<button type="button" className="text-button" aria-expanded={showCopies}
                onClick={() => setShowCopies(!showCopies)}>{labels.copies}</button>
            </div> : input}
          </Fragment>;
        })}</div>
        <ComposerEditor body={draft.body} editor={draft.editor} disabled={sending}
          onChange={(editor) => change('editor', editor)} />
        {draft.files.length > 0 && <ul className="composer-attachments" aria-label={labels.attachments}>
          {draft.files.map((file, index) => <li className="composer-attachment" key={`${index}-${file.name}`}>
            <FileText size={17} aria-hidden="true" />
            <span className="attachment-meta"><strong title={file.name}>{file.name}</strong></span>
            <IconButton label={labels.removeAttachment(file.name)} icon={X}
              onClick={(event) => {
                event.currentTarget.closest('form')?.querySelector<HTMLButtonElement>('.composer-attach')?.focus();
                change('files', draft.files.filter((_, position) => index !== position));
              }} />
          </li>)}
        </ul>}
        {failure && <p className="composer-error" role="alert">{imapErrorMessage(failure, labels.imapErrors)}</p>}
      </fieldset>
      <footer className="composer-footer">
        <input ref={fileInput} type="file" hidden multiple onChange={(event) => {
          const files = [...draft.files, ...Array.from(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          if (files.length > 10 || files.reduce((total, file) => total + file.size, 0) > maxAttachmentBytes) {
            setFailure('attachmentLimit');
          } else {
            change('files', files);
          }
        }} />
        <button type="button" className="composer-attach" disabled={sending} onClick={() => fileInput.current?.click()}>
          <Paperclip size={16} aria-hidden="true" />{labels.attachFiles}
        </button>
        {sending && <small role="status">{labels.sendingMessage}</small>}
        <button className="compose-button" type="submit" disabled={sending || failure === 'sendUncertain'}>
          <Send size={16} aria-hidden="true" />{labels.send}
        </button>
      </footer>
    </form>
  </dialog>;
}
