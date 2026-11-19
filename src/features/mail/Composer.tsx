import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import type { DemoMessage } from './demo-mail';
import type { ReplyMode } from './MessageReader';

export type ComposeTarget = { mode: 'new' } | { mode: ReplyMode; message: DemoMessage };
export interface Draft { to: string; cc: string; bcc: string; subject: string; body: string; }
export const emptyDraft: Draft = { to: '', cc: '', bcc: '', subject: '', body: '' };

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
  const labels = useLabels();
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
        <h2 id="composer-title">{labels.composeTitles[target.mode]}</h2>
        <IconButton label={labels.closeComposer} icon={X} onClick={onClose} />
      </header>
      <div className="composer-fields">
        <div className="composer-recipient">
          <label>{labels.to}<input ref={toRef} value={draft.to} onChange={(event) => change('to', event.target.value)} /></label>
          <button className="text-button" type="button" aria-expanded={showCopies} onClick={() => setShowCopies(!showCopies)}>{labels.copies}</button>
        </div>
        {showCopies && <>
          <label>{labels.cc}<input value={draft.cc} onChange={(event) => change('cc', event.target.value)} /></label>
          <label>{labels.bcc}<input value={draft.bcc} onChange={(event) => change('bcc', event.target.value)} /></label>
        </>}
        <label>{labels.subject}<input value={draft.subject} onChange={(event) => change('subject', event.target.value)} /></label>
        <textarea ref={bodyRef} aria-label={labels.messageBody} placeholder={labels.writeMessage} value={draft.body} onChange={(event) => change('body', event.target.value)} />
      </div>
      <footer className="composer-footer">
        <small>{labels.sendingUnavailable}</small>
        <button className="compose-button" type="button" disabled><Send size={16} aria-hidden="true" />{labels.send}</button>
      </footer>
    </dialog>
  );
}
