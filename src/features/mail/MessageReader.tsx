import { ArrowLeft, Forward, Mail, Printer, Reply, ReplyAll } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, Toolbar } from '../../components/ui/Controls';
import { ScrollArea } from '../../components/ui/ScrollArea';
import type { MessageAction, OpenedMessage } from '../accounts/imap-api';
import type { ResponseMode } from './Composer';
import { MessageActions, type MessageActionAvailability } from './MessageActions';
import { MessagePrintPreview } from './MessagePrintPreview';
import type { MessageRow } from './connected-mail';

const responseActions = [
  { mode: 'reply', Icon: Reply },
  { mode: 'replyAll', Icon: ReplyAll },
  { mode: 'forward', Icon: Forward },
] as const;

export function MessageReader({ message, opened, body, headingRef, inert, onBack, onAction, actionBusy, actionError, canArchive, canTrash, inTrash, onRespond, canRespond, canForward }: MessageActionAvailability & {
  message?: MessageRow;
  opened?: OpenedMessage;
  body?: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  inert: boolean;
  onBack: () => void;
  onAction: (action: MessageAction) => void;
  actionBusy: boolean;
  actionError?: string;
  onRespond: (mode: ResponseMode, trigger: HTMLButtonElement) => void;
  canRespond: boolean;
  canForward: boolean;
}) {
  const labels = useLabels();
  const printTrigger = useRef<HTMLButtonElement>(null);
  const [printPreview, setPrintPreview] = useState<{ message: MessageRow; opened: OpenedMessage }>();
  return (
    <>
    <main className="reader" aria-label={labels.reader} inert={inert} tabIndex={-1}>
      <header className="reader-toolbar">
        <IconButton className="reader-back" label={labels.backToMessages} icon={ArrowLeft} onClick={onBack} />
        {message && <MessageActions message={message} className="reader-actions" showStar tooltip="bottom" actionBusy={actionBusy}
          canArchive={canArchive} canTrash={canTrash} inTrash={inTrash} onAction={onAction}>
          <IconButton ref={printTrigger} icon={Printer} tooltip="bottom" label={labels.printPreview} aria-haspopup="dialog"
            disabled={!opened} onClick={() => { if (opened) setPrintPreview({ message, opened }); }} />
        </MessageActions>}
      </header>
      {actionError && <p className="account-setup-error reader-action-error" role="alert">{actionError}</p>}
      {message ? (
        <ScrollArea className="reader-scroll" label={labels.reader} key={message.id}>
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
        </ScrollArea>
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
    {printPreview && <MessagePrintPreview {...printPreview} onClose={() => {
      setPrintPreview(undefined);
      printTrigger.current?.focus();
    }} />}
    </>
  );
}
