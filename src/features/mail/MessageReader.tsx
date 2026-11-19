import { Archive, ArrowDownToLine, ArrowLeft, ChevronDown, Clock, FileText, Forward, Image, Mail, MailOpen, Reply, ReplyAll, Sparkles, Star, Trash2 } from 'lucide-react';
import type { RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, Toolbar } from '../../components/ui/Controls';
import type { DemoAttachment, DemoMessage, DemoMessagePatch } from './demo-mail';

export type ReplyMode = 'reply' | 'replyAll' | 'forward';

const replyActions = [
  { mode: 'reply', Icon: Reply },
  { mode: 'replyAll', Icon: ReplyAll },
  { mode: 'forward', Icon: Forward },
] as const;

function AttachmentChip({ attachment }: { attachment: DemoAttachment }) {
  const labels = useLabels();
  const Icon = attachment.type === 'image' ? Image : FileText;
  return (
    <a className="attachment-chip" href={attachment.url} download={attachment.name} aria-label={labels.download(attachment.name)}>
      <span className="attachment-icon" data-type={attachment.type}><Icon size={20} aria-hidden="true" /></span>
      <span className="attachment-meta"><strong>{attachment.name}</strong><small>{attachment.size}</small></span>
      <ArrowDownToLine size={17} aria-hidden="true" />
    </a>
  );
}

export function MessageReader({ message, headingRef, inert, onUpdateMessage, onBack, onReply }: {
  message?: DemoMessage;
  headingRef: RefObject<HTMLHeadingElement | null>;
  inert: boolean;
  onUpdateMessage: (id: DemoMessage['id'], patch: DemoMessagePatch, trigger: HTMLButtonElement) => void;
  onBack: () => void;
  onReply: (mode: ReplyMode, message: DemoMessage) => void;
}) {
  const labels = useLabels();
  return (
    <main className="reader" aria-label={labels.reader} inert={inert} tabIndex={-1}>
      <header className="reader-toolbar">
        <IconButton className="reader-back" label={labels.backToMessages} icon={ArrowLeft} onClick={onBack} />
        {message && (
          <Toolbar label={labels.manageMessage} className="reader-actions">
            <IconButton label={message.starred ? labels.removeStar : labels.addStar} icon={Star} aria-pressed={Boolean(message.starred)} onClick={(event) => onUpdateMessage(message.id, { starred: !message.starred }, event.currentTarget)} />
            <IconButton label={message.unread ? labels.markRead : labels.markUnread} icon={message.unread ? MailOpen : Mail} onClick={(event) => onUpdateMessage(message.id, { unread: !message.unread }, event.currentTarget)} />
            <IconButton label={message.snoozedUntil === undefined ? labels.snoozeMessage : labels.endSnooze} icon={Clock} aria-pressed={message.snoozedUntil !== undefined}
              disabled={message.folder === 'trash' || message.folder === 'drafts'} onClick={(event) => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(9, 0, 0, 0);
                onUpdateMessage(message.id, { snoozedUntil: message.snoozedUntil === undefined ? tomorrow.getTime() : undefined }, event.currentTarget);
              }} />
            <IconButton label={labels.archiveMessage} icon={Archive} disabled={message.folder === 'archive' || message.folder === 'trash' || message.folder === 'drafts'} onClick={(event) => onUpdateMessage(message.id, { folder: 'archive' }, event.currentTarget)} />
            <IconButton label={labels.moveToTrash} icon={Trash2} disabled={message.folder === 'trash'} onClick={(event) => onUpdateMessage(message.id, { folder: 'trash' }, event.currentTarget)} />
          </Toolbar>
        )}
      </header>
      {message ? (
        <>
          <div className="reader-scroll" key={message.id}>
            <article className="letter">
              <div className="letter-header">
                <div className="letter-title">
                  <h2 ref={headingRef} tabIndex={-1}>{message.subject}</h2>
                  {message.starred && <><Star className="star" size={21} aria-hidden="true" /><span className="sr-only">{labels.filters.starred}</span></>}
                </div>
                <div className="letter-meta">
                  <span className="avatar" data-tone={message.tone} aria-hidden="true">{message.initials}</span>
                  <div className="sender">
                    <strong>{message.sender}</strong>
                    <details className="recipient-details">
                      <summary>{labels.toMe} <ChevronDown size={13} aria-hidden="true" /></summary>
                      <dl>
                        <div><dt>{labels.from}</dt><dd>{message.address}</dd></div>
                        <div><dt>{labels.to}</dt><dd>demo@example.com</dd></div>
                      </dl>
                    </details>
                  </div>
                  <span className="letter-date">{message.received ?? message.date}</span>
                </div>
              </div>
              {message.summary && (
                <details className="letter-summary" open>
                  <summary>
                    <Sparkles size={16} aria-hidden="true" />
                    <span>{labels.smartSummary}</span>
                    <span className="letter-summary-show" aria-hidden="true">{labels.showSummary}</span>
                    <span className="letter-summary-hide" aria-hidden="true">{labels.hideSummary}</span>
                  </summary>
                  <p>{message.summary}</p>
                </details>
              )}
              <div className="letter-body">{message.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              {message.image && <img className="letter-image" src={message.image.url} alt={message.image.alt} />}
              {message.attachments && (
                <div className="attachments" aria-label={labels.attachments} role="group">
                  {message.attachments.map((attachment) => <AttachmentChip key={attachment.name} attachment={attachment} />)}
                </div>
              )}
            </article>
          </div>
          <footer className="reader-footer">
            <Toolbar label={labels.respond}>
              {replyActions.map(({ mode, Icon }) => (
                <button key={mode} type="button" className="reply-button" onClick={() => onReply(mode, message)}>
                  <Icon size={18} aria-hidden="true" /><span>{labels.composeTitles[mode]}</span>
                </button>
              ))}
            </Toolbar>
          </footer>
        </>
      ) : (
        <div className="reader-empty"><Mail size={32} aria-hidden="true" /><p>{labels.noSelection}</p></div>
      )}
    </main>
  );
}
