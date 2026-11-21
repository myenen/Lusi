import { useContext, useEffect, useEffectEvent, useState } from 'react';
import { LocaleContext, useLabels } from '../../app/i18n';
import { imapErrorMessage, readConnectedMessage, type MessageKey, type OpenedMessage } from '../accounts/imap-api';
import { HtmlMessageFrame } from './HtmlMessageFrame';
import { MessageSummary } from './MessageSummary';

export function ConnectedMessageBody({ folder, messageKey: { uidValidity, uid }, onSeen, onOpened, themeId, colorScheme }: {
  folder: string;
  messageKey: MessageKey;
  onSeen: (folder: string, key: MessageKey) => void;
  onOpened: (message: OpenedMessage) => void;
  themeId: string;
  colorScheme: 'light' | 'dark';
}) {
  const labels = useLabels();
  const language = useContext(LocaleContext);
  const [reading, setReading] = useState<OpenedMessage | { error: unknown }>();
  const [showPlain, setShowPlain] = useState(false);
  const markSeen = useEffectEvent(onSeen);
  const recordOpened = useEffectEvent(onOpened);

  useEffect(() => {
    let active = true;
    readConnectedMessage(folder, { uidValidity, uid }).then(
      (message) => {
        if (!active) return;
        setReading(message);
        recordOpened(message);
        if (message.seen) markSeen(folder, { uidValidity, uid });
      },
      (error: unknown) => { if (active) setReading({ error }); },
    );
    return () => { active = false; };
  }, [folder, uidValidity, uid]);

  if (!reading) return <p role="status">{labels.connectedInbox.reading}</p>;
  if ('error' in reading) return <p role="alert" className="account-setup-error">{imapErrorMessage(reading.error, labels.imapErrors)}</p>;
  const html = reading.html;
  return <>
    {reading.seenError && <p role="status" className="account-setup-error">{labels.connectedInbox.seenFailed}</p>}
    {reading.summary?.points?.length ? <MessageSummary summary={reading.summary} /> : null}
    {html && reading.body && <div className="message-html-controls">
      <button type="button" className="text-button" onClick={() => setShowPlain(!showPlain)}>
        {showPlain ? labels.connectedInbox.showHtml : labels.connectedInbox.showPlain}
      </button>
    </div>}
    {html && !showPlain
      ? <HtmlMessageFrame content={html.content}
          title={labels.connectedInbox.htmlMessage} language={language}
          themeId={themeId} colorScheme={colorScheme} />
      : <p>{reading.body || labels.connectedInbox.noBody}</p>}
  </>;
}
