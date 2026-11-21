import { UserRound } from 'lucide-react';
import { useLabels } from '../../app/i18n';
import { SelectBox } from '../../components/ui/SelectBox';
import type { ConnectedAccount } from '../accounts/imap-api';

export function SidebarAccount({ accountId, email, accounts, disabled, onSwitch }: {
  accountId: number;
  email: string;
  accounts: ConnectedAccount[];
  disabled: boolean;
  onSwitch: (id: number) => void;
}) {
  const labels = useLabels();
  const card = <>
      <span className="account-icon" aria-hidden="true">
        <UserRound size={19} />
      </span>
      <span className="account-copy sidebar-copy">
        <strong>{labels.connectedInbox.account}</strong><small>{email}</small>
      </span>
  </>;

  if (accounts.length < 2) return <div className="account" data-static="" title={email}>{card}</div>;

  return <SelectBox className="account account-switcher" side="top" label={`${labels.selectAccount} · ${email}`}
    value={String(accountId)} options={accounts.map((account) => ({ value: String(account.id), label: account.email }))}
    triggerContent={card} disabled={disabled} onChange={(id) => onSwitch(Number(id))} />;
}
