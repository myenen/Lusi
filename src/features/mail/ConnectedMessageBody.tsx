import { useEffect, useEffectEvent, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { imapErrorMessage, readConnectedMessage, type MessageKey, type OpenedMessage } from '../accounts/imap-api';
import { MessageBody } from './MessageBody';
import { MessageSummary } from './MessageSummary';
import { MessageAttachments } from './MessageAttachments';

export function ConnectedMessageBody({ accountId, folder, messageKey: { uidValidity, uid }, unread, onSeen, onOpened, themeId, colorScheme }: {
  accountId: number;
  folder: string;
  messageKey: MessageKey;
  unread: boolean;
  onSeen: (folder: string, key: MessageKey) => void;
  onOpened: (message: OpenedMessage) => void;
  themeId: string;
  colorScheme: 'light' | 'dark';
}) {
  const labels = useLabels();
  const [reading, setReading] = useState<OpenedMessage | { error: unknown }>();
  const markSeen = useEffectEvent(onSeen);
  const recordOpened = useEffectEvent(onOpened);
  const loadMessage = useEffectEvent((key: MessageKey) => readConnectedMessage(accountId, folder, key, unread));

  useEffect(() => {
    let active = true;
    loadMessage({ uidValidity, uid }).then(
      (message) => {
        if (!active) return;
        setReading(message);
        recordOpened(message);
        if (message.seen) markSeen(folder, { uidValidity, uid });
      },
      (error: unknown) => { if (active) setReading({ error }); },
    );
    return () => { active = false; };
  }, [accountId, folder, uidValidity, uid]);

  if (!reading) return <p role="status">{labels.connectedInbox.reading}</p>;
  if ('error' in reading) return <p role="alert" className="account-setup-error">{imapErrorMessage(reading.error, labels.imapErrors)}</p>;
  return <>
    {reading.seenError && <p role="status" className="account-setup-error">{labels.connectedInbox.seenFailed}</p>}
    {reading.summary?.points?.length ? <MessageSummary summary={reading.summary} /> : null}
    {reading.attachments?.length ? <MessageAttachments attachments={reading.attachments} accountId={accountId}
      folder={folder} messageKey={{ uidValidity, uid }} /> : null}
    {reading.bodyTruncated && <p className="mailbox-status" role="status">{labels.bodyTruncated}</p>}
    <MessageBody body={reading.body} html={reading.html?.content} themeId={themeId} colorScheme={colorScheme} />
  </>;
}
