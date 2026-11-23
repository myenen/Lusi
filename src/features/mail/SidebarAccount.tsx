import { UserRound } from 'lucide-react';
import { useLabels } from '../../app/i18n';
import { SelectBox } from '../../components/ui/SelectBox';
import { Tooltip } from '../../components/ui/Tooltip';
import type { ConnectedAccount } from '../accounts/imap-api';

export function SidebarAccount({ accountId, email, accounts, disabled, onSwitch, tooltip }: {
  accountId: number;
  email: string;
  accounts: ConnectedAccount[];
  disabled: boolean;
  tooltip: boolean;
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

  if (accounts.length < 2) return <Tooltip label={tooltip ? email : undefined} side="right">
    <div className="account" data-static="" title={tooltip ? undefined : email}>{card}</div>
  </Tooltip>;

  const label = `${labels.selectAccount} · ${email}`;
  const select = <SelectBox className="account account-switcher" side="top" label={label}
    value={String(accountId)} options={accounts.map((account) => ({ value: String(account.id), label: account.email }))}
    triggerContent={card} disabled={disabled} onChange={(id) => onSwitch(Number(id))} />;

  return tooltip ? <Tooltip label={label} side="right"><div>{select}</div></Tooltip> : select;
}
