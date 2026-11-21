import { Archive, ArrowLeft, Forward, Mail, MailOpen, Reply, ReplyAll, RotateCcw, Star, Trash2 } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, Toolbar } from '../../components/ui/Controls';
import type { MessageAction } from '../accounts/imap-api';
import type { ResponseMode } from './Composer';
import type { MessageRow } from './connected-mail';

const responseActions = [
  { mode: 'reply', Icon: Reply },
  { mode: 'replyAll', Icon: ReplyAll },
  { mode: 'forward', Icon: Forward },
] as const;

export function MessageReader({ message, body, headingRef, inert, onBack, onAction, actionBusy, actionError, canArchive, canTrash, inTrash, onRespond, canRespond, canForward }: {
  message?: MessageRow;
  body?: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  inert: boolean;
  onBack: () => void;
  onAction: (action: MessageAction) => void;
  actionBusy: boolean;
  actionError?: string;
  canArchive: boolean;
  canTrash: boolean;
  inTrash: boolean;
  onRespond: (mode: ResponseMode, trigger: HTMLButtonElement) => void;
  canRespond: boolean;
  canForward: boolean;
}) {
  const labels = useLabels();
  return (
    <main className="reader" aria-label={labels.reader} inert={inert} tabIndex={-1}>
      <header className="reader-toolbar">
        <IconButton className="reader-back" label={labels.backToMessages} icon={ArrowLeft} onClick={onBack} />
        {message && <Toolbar label={labels.manageMessage} className="reader-actions">
          <IconButton label={message.starred ? labels.removeStar : labels.addStar} icon={Star}
            aria-pressed={Boolean(message.starred)} disabled={actionBusy} onClick={() => onAction(message.starred ? 'unstar' : 'star')} />
          <IconButton label={message.unread ? labels.markRead : labels.markUnread} icon={message.unread ? MailOpen : Mail}
            disabled={actionBusy} onClick={() => onAction(message.unread ? 'read' : 'unread')} />
          <IconButton label={labels.archiveMessage} icon={Archive} disabled={actionBusy || !canArchive} onClick={() => onAction('archive')} />
          {inTrash
            ? <IconButton label={labels.restoreMessage} icon={RotateCcw} disabled={actionBusy} onClick={() => onAction('restore')} />
            : <IconButton label={labels.moveToTrash} icon={Trash2} disabled={actionBusy || !canTrash} onClick={() => onAction('trash')} />}
        </Toolbar>}
      </header>
      {actionError && <p className="account-setup-error reader-action-error" role="alert">{actionError}</p>}
      {message ? (
        <div className="reader-scroll" key={message.id}>
          <article className="letter">
            <div className="letter-header">
              <div className="letter-title"><h2 ref={headingRef} tabIndex={-1}>{message.subject}</h2></div>
              <div className="letter-meta">
                <span className="avatar" data-tone={message.tone} aria-hidden="true">{message.initials}</span>
                <div className="sender">
                  <strong>{message.sender}</strong>
                  {message.address && message.address !== message.sender && <span className="sender-address">{message.address}</span>}
                </div>
                <span className="letter-date">{message.date}</span>
              </div>
            </div>
            <div className="letter-body">{body}</div>
          </article>
        </div>
      ) : <div className="reader-empty"><Mail size={32} aria-hidden="true" /><p>{labels.noSelection}</p></div>}
      {message && <footer className="reader-footer">
        <Toolbar label={labels.respond}>
          {responseActions.map(({ mode, Icon }) => <button key={mode} type="button" className="reply-button"
            disabled={mode === 'forward' ? !canForward : !canRespond} onClick={(event) => onRespond(mode, event.currentTarget)}>
            <Icon size={17} aria-hidden="true" />{labels.composeTitles[mode]}
          </button>)}
        </Toolbar>
      </footer>}
    </main>
  );
}
