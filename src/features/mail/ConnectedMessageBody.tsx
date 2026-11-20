import { useEffect, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { imapErrorMessage, readConnectedMessage, type MessageKey } from '../accounts/imap-api';

export function ConnectedMessageBody({ folder, messageKey: { uidValidity, uid } }: { folder: string; messageKey: MessageKey }) {
  const labels = useLabels();
  const [reading, setReading] = useState<{ body: string | null } | { error: unknown }>();

  useEffect(() => {
    let active = true;
    readConnectedMessage(folder, { uidValidity, uid }).then(
      (body) => { if (active) setReading({ body }); },
      (error: unknown) => { if (active) setReading({ error }); },
    );
    return () => { active = false; };
  }, [folder, uidValidity, uid]);

  if (!reading) return <p role="status">{labels.connectedInbox.reading}</p>;
  if ('error' in reading) return <p role="alert" className="account-setup-error">{imapErrorMessage(reading.error, labels.imapErrors)}</p>;
  return <p>{reading.body || labels.connectedInbox.noBody}</p>;
}
