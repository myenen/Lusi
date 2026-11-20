import { Archive, ArrowDownToLine, ArrowLeft, ChevronDown, Clock, FileText, Forward, Image, Mail, MailOpen, Reply, ReplyAll, RotateCcw, Sparkles, Star, Trash2 } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, Toolbar } from '../../components/ui/Controls';
import { demoAddress, type DemoAttachment, type DemoMessage, type DemoMessagePatch } from './demo-mail';
import type { ReplyMode } from './demo-compose';
import { AttachmentPreview, downloadAttachment } from './AttachmentPreview';

const replyActions = [
  { mode: 'reply', Icon: Reply },
  { mode: 'replyAll', Icon: ReplyAll },
  { mode: 'forward', Icon: Forward },
] as const;

function MessageSummary({ summary, summaryPreview }: Pick<DemoMessage, 'summary' | 'summaryPreview'>) {
  const labels = useLabels();
  const [loading, setLoading] = useState(summaryPreview === 'loading');
  useEffect(() => {
    if (summaryPreview !== 'loading') return;
    const timer = window.setTimeout(() => setLoading(false), 450);
    return () => window.clearTimeout(timer);
  }, [summaryPreview]);

  return (
    <details className="letter-summary" open={summaryPreview !== 'unavailable' && summaryPreview !== 'error'}>
      <summary>
        <Sparkles size={16} aria-hidden="true" />
        <span>{labels.smartSummary}</span>
        <span className="letter-summary-show" aria-hidden="true">{labels.showSummary}</span>
        <span className="letter-summary-hide" aria-hidden="true">{labels.hideSummary}</span>
      </summary>
      <p role={loading ? 'status' : undefined}>{loading ? labels.summaryLoading : summary ?? (summaryPreview === 'error' ? labels.summaryFailed : labels.summaryUnavailable)}</p>
    </details>
  );
}

function AttachmentChip({ attachment, onPreview, onDownload }: { attachment: DemoAttachment; onPreview: () => void; onDownload: () => void }) {
  const labels = useLabels();
  const Icon = attachment.type === 'image' ? Image : FileText;
  const content = <>
      <span className="attachment-icon" data-type={attachment.type}><Icon size={20} aria-hidden="true" /></span>
      <span className="attachment-meta"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.size}</small></span>
  </>;
  return (
    <div className="attachment-chip">
      {attachment.type === 'file' ? <span className="attachment-link">{content}</span> : (
        <button className="attachment-link" aria-label={labels.previewAttachment(attachment.name)} type="button" onClick={onPreview}>{content}</button>
      )}
      <IconButton label={labels.download(attachment.name)} icon={ArrowDownToLine} onClick={onDownload} />
    </div>
  );
}

export function MessageReader({ message, headingRef, inert, onUpdateMessage, onBack, onReply, onEditDraft }: {
  message?: DemoMessage;
  headingRef: RefObject<HTMLHeadingElement | null>;
  inert: boolean;
  onUpdateMessage: (id: DemoMessage['id'], patch: DemoMessagePatch, trigger: HTMLButtonElement) => void;
  onBack: () => void;
  onReply: (mode: ReplyMode, message: DemoMessage) => void;
  onEditDraft: (message: DemoMessage) => void;
}) {
  const labels = useLabels();
  const [preview, setPreview] = useState<DemoAttachment>();
  const [downloadError, setDownloadError] = useState<DemoMessage['id']>();
  return (
    <main className="reader" aria-label={labels.reader} inert={inert} tabIndex={-1}>
      <header className="reader-toolbar">
        <IconButton className="reader-back" label={labels.backToMessages} icon={ArrowLeft} onClick={onBack} />
        {message && (
          <Toolbar label={labels.manageMessage} className="reader-actions">
            <IconButton label={message.starred ? labels.removeStar : labels.addStar} icon={Star} aria-pressed={Boolean(message.starred)} onClick={(event) => onUpdateMessage(message.id, { starred: !message.starred }, event.currentTarget)} />
            <IconButton label={message.unread ? labels.markRead : labels.markUnread} icon={message.unread ? MailOpen : Mail} onClick={(event) => onUpdateMessage(message.id, { unread: !message.unread }, event.currentTarget)} />
            {message.folder === 'trash' || message.folder === 'drafts' || message.snoozedUntil !== undefined ? (
              <IconButton label={message.snoozedUntil === undefined ? labels.snoozeOptions : labels.endSnooze} icon={Clock} aria-pressed={message.snoozedUntil !== undefined}
                disabled={message.snoozedUntil === undefined} onClick={(event) => onUpdateMessage(message.id, { snoozedUntil: undefined }, event.currentTarget)} />
            ) : (
              <details className="snooze-control" key={message.id} onKeyDown={(event) => {
                if (event.key !== 'Escape' || !event.currentTarget.open) return;
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }}>
                <summary className="icon-button" title={labels.snoozeOptions} aria-label={labels.snoozeOptions}><Clock size={18} aria-hidden="true" /></summary>
                <div className="snooze-options">
                  <button type="button" className="text-button" onClick={(event) => onUpdateMessage(message.id, { snoozedUntil: Date.now() + 3_600_000 }, event.currentTarget)}>{labels.snoozeOneHour}</button>
                  <button type="button" className="text-button" onClick={(event) => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    tomorrow.setHours(9, 0, 0, 0);
                    onUpdateMessage(message.id, { snoozedUntil: tomorrow.getTime() }, event.currentTarget);
                  }}>{labels.snoozeMessage}</button>
                </div>
              </details>
            )}
            <IconButton label={labels.archiveMessage} icon={Archive} disabled={message.folder === 'archive' || message.folder === 'trash' || message.folder === 'drafts'} onClick={(event) => onUpdateMessage(message.id, { folder: 'archive' }, event.currentTarget)} />
            {message.folder === 'trash' ? (
              <IconButton label={labels.restoreMessage} icon={RotateCcw} onClick={(event) => onUpdateMessage(message.id, { folder: message.trashOrigin ?? 'inbox' }, event.currentTarget)} />
            ) : <IconButton label={labels.moveToTrash} icon={Trash2} onClick={(event) => onUpdateMessage(message.id, { folder: 'trash' }, event.currentTarget)} />}
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
                      <summary>{message.address === demoAddress ? labels.to : labels.toMe} <ChevronDown size={13} aria-hidden="true" /></summary>
                      <dl>
                        <div><dt>{labels.from}</dt><dd>{message.address}</dd></div>
                          <div><dt>{labels.to}</dt><dd>{message.to ?? (message.address === demoAddress ? '—' : demoAddress)}</dd></div>
                          {message.cc && <div><dt>{labels.cc}</dt><dd>{message.cc}</dd></div>}
                      </dl>
                    </details>
                  </div>
                  <span className="letter-date">{message.received ?? message.date}</span>
                </div>
              </div>
              {(message.summary || message.summaryPreview) && <MessageSummary summary={message.summary} summaryPreview={message.summaryPreview} />}
              <div className="letter-body">{message.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              {message.image && <button className="letter-image-button" type="button" onClick={() => {
                if (message.image) setPreview({ url: message.image.url, name: message.image.alt, type: 'image', size: '' });
              }}><img className="letter-image" src={message.image.url} alt={message.image.alt} /></button>}
              {!!message.attachments?.length && (
                <div className="attachments" aria-label={labels.attachments} role="group">
                  {message.attachments.map((attachment, index) => (
                    <AttachmentChip key={`${index}-${attachment.name}`} attachment={attachment} onPreview={() => setPreview(attachment)}
                      onDownload={() => {
                        setDownloadError(undefined);
                        void downloadAttachment(attachment).catch(() => setDownloadError(message.id));
                      }} />
                  ))}
                </div>
              )}
              {downloadError === message.id && <p className="composer-error" role="alert">{labels.downloadFailed}</p>}
            </article>
          </div>
          <footer className="reader-footer">
            {message.folder === 'drafts' ? <button className="reply-button" type="button" onClick={() => onEditDraft(message)}>{labels.composeTitles.edit}</button> : <Toolbar label={labels.respond}>
              {replyActions.map(({ mode, Icon }) => (
                <button key={mode} type="button" className="reply-button" onClick={() => onReply(mode, message)}>
                  <Icon size={18} aria-hidden="true" /><span>{labels.composeTitles[mode]}</span>
                </button>
              ))}
            </Toolbar>}
          </footer>
        </>
      ) : (
        <div className="reader-empty"><Mail size={32} aria-hidden="true" /><p>{labels.noSelection}</p></div>
      )}
      {preview && <AttachmentPreview attachment={preview} onClose={() => setPreview(undefined)} />}
    </main>
  );
}
