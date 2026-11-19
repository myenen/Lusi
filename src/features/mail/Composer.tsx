import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/ui/Controls';
import type { DemoMessage } from './demo-mail';
import type { ReplyMode } from './MessageReader';

export type ComposeTarget = { mode: 'new' } | { mode: ReplyMode; message: DemoMessage };
export interface Draft { to: string; cc: string; bcc: string; subject: string; body: string; }
export const emptyDraft: Draft = { to: '', cc: '', bcc: '', subject: '', body: '' };

const titles: Record<ComposeTarget['mode'], string> = {
  new: 'New message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
};

function startingDraft(target: ComposeTarget, newDraft: Draft): Draft {
  if (target.mode === 'new') return newDraft;
  const { message, mode } = target;
  return {
    ...emptyDraft,
    to: mode === 'forward' ? '' : message.address,
    subject: `${mode === 'forward' ? 'Fwd: ' : 'Re: '}${message.subject}`,
    body: mode === 'forward' ? `\n\n${message.sender}\n${message.body.join('\n\n')}` : '',
  };
}

export function Composer({ target, newDraft, onDraftChange, onClose }: {
  target: ComposeTarget;
  newDraft: Draft;
  onDraftChange: (draft: Draft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => startingDraft(target, newDraft));
  const [showCopies, setShowCopies] = useState(Boolean(draft.cc || draft.bcc));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    if (target.mode === 'reply' || target.mode === 'replyAll') bodyRef.current?.focus();
    else toRef.current?.focus();
    return () => dialog?.close();
  }, [target.mode]);

  function change(field: keyof Draft, value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (target.mode === 'new') onDraftChange(next);
  }

  return (
    <dialog ref={dialogRef} className="composer" aria-labelledby="composer-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="composer-header">
        <h2 id="composer-title">{titles[target.mode]}</h2>
        <IconButton label="Close composer" icon={X} onClick={onClose} />
      </header>
      <div className="composer-fields">
        <div className="composer-recipient">
          <label>To<input ref={toRef} value={draft.to} onChange={(event) => change('to', event.target.value)} /></label>
          <button className="text-button" type="button" aria-expanded={showCopies} onClick={() => setShowCopies(!showCopies)}>Cc / Bcc</button>
        </div>
        {showCopies && <>
          <label>Cc<input value={draft.cc} onChange={(event) => change('cc', event.target.value)} /></label>
          <label>Bcc<input value={draft.bcc} onChange={(event) => change('bcc', event.target.value)} /></label>
        </>}
        <label>Subject<input value={draft.subject} onChange={(event) => change('subject', event.target.value)} /></label>
        <textarea ref={bodyRef} aria-label="Message body" placeholder="Write your message…" value={draft.body} onChange={(event) => change('body', event.target.value)} />
      </div>
      <footer className="composer-footer">
        <small>Sample mailbox. Sending is unavailable.</small>
        <button className="compose-button" type="button" disabled><Send size={16} aria-hidden="true" />Send</button>
      </footer>
    </dialog>
  );
}
