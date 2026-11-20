import { UserRound } from 'lucide-react';
import { useLabels } from '../../app/i18n';

export function ConnectedAccount({ email, inSettings = false }: { email: string; inSettings?: boolean }) {
  const labels = useLabels();

  return (
    <div className={inSettings ? 'settings-account' : 'account'} data-static="" title={email}>
      <span className="account-icon" aria-hidden="true">
        <UserRound size={19} />
      </span>
      <div className={inSettings ? 'account-copy' : 'account-copy sidebar-copy'}>
        <strong>{labels.connectedInbox.account}</strong><small>{email}</small>
      </div>
    </div>
  );
}
