import { BriefcaseBusiness, ChevronDown, UserRound } from 'lucide-react';
import { useLabels } from '../../app/i18n';
import { demoAccounts, type DemoAccountId } from './demo-accounts';

export function SidebarAccount({ accountId, onSelectAccount }: {
  accountId: DemoAccountId;
  onSelectAccount: (accountId: DemoAccountId) => void;
}) {
  const labels = useLabels();
  const account = demoAccounts[accountId];
  const AccountIcon = accountId === 'work' ? BriefcaseBusiness : UserRound;

  return (
    <div className="sidebar-bottom">
      <div className="account">
        <span className="account-icon" aria-hidden="true"><span className="sidebar-copy">{account.initials}</span><AccountIcon className="account-glyph" size={20} /></span>
        <div className="account-copy sidebar-copy" aria-hidden="true"><strong>{labels[account.nameKey]}</strong><small>{account.address}</small></div>
        <ChevronDown className="account-chevron" size={14} aria-hidden="true" />
        <select className="account-select" aria-label={labels.selectAccount} title={`${labels.selectAccount} · ${labels[account.nameKey]}`} value={accountId}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (Object.hasOwn(demoAccounts, next)) onSelectAccount(next as DemoAccountId);
          }}>
          {Object.entries(demoAccounts).map(([id, { nameKey }]) => <option key={id} value={id}>{labels[nameKey]}</option>)}
        </select>
      </div>
    </div>
  );
}
