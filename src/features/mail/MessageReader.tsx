import { Archive, ArrowDownToLine, ArrowLeft, ChevronDown, FileText, Forward, Image, Mail, Reply, ReplyAll, Star, Trash2 } from 'lucide-react';
import type { RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, Toolbar } from '../../components/ui/Controls';
import type { DemoAttachment, DemoMessage } from './demo-mail';

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

export function MessageReader({ message, headingRef, inert, onBack, onReply }: {
  message?: DemoMessage;
  headingRef: RefObject<HTMLHeadingElement | null>;
  inert: boolean;
  onBack: () => void;
  onReply: (mode: ReplyMode, message: DemoMessage) => void;
}) {
  const labels = useLabels();
  return (
    <main className="reader" aria-label={labels.reader} inert={inert}>
      <header className="reader-toolbar">
        <IconButton className="reader-back" label={labels.backToMessages} icon={ArrowLeft} onClick={onBack} />
        {message && (
          <Toolbar label={labels.manageMessage}>
            <IconButton label={labels.archiveMessage} title={labels.archiveUnavailable} icon={Archive} disabled />
            <IconButton label={labels.deleteMessage} title={labels.deleteUnavailable} icon={Trash2} disabled />
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
