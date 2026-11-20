import { BriefcaseBusiness, ChevronDown, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLabels } from '../../app/i18n';
import { demoAccounts, type DemoAccountId } from './demo-accounts';

const closeDelay = 1500;

export function SidebarPreferences({ accountId, onSelectAccount, appearance, children }: {
  accountId: DemoAccountId;
  onSelectAccount: (accountId: DemoAccountId) => void;
  appearance: ReactNode;
  children: ReactNode;
}) {
  const labels = useLabels();
  const account = demoAccounts[accountId];
  const AccountIcon = accountId === 'work' ? BriefcaseBusiness : UserRound;
  const [expanded, setExpanded] = useState(false);
  const section = useRef<HTMLElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function reveal() {
    window.clearTimeout(closeTimer.current);
    setExpanded(true);
  }

  function scheduleClose() {
    window.clearTimeout(closeTimer.current);
    if (hovering.current) return;

    closeTimer.current = window.setTimeout(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && section.current?.contains(focused)) {
        if (focused.matches(':focus-visible')) return;
        if (focused instanceof HTMLSelectElement) {
          if (!window.CSS?.supports('selector(select:open)') || focused.matches(':open')) return;
          focused.blur();
        }
      }
      setExpanded(false);
    }, closeDelay);
  }

  return (
    <section
      ref={section}
      className="sidebar-bottom"
      aria-label={labels.preferences}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        hovering.current = true;
        reveal();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'touch') return;
        hovering.current = false;
        scheduleClose();
      }}
      onPointerUp={(event) => { if (event.pointerType === 'touch') reveal(); }}
      onFocusCapture={reveal}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose();
      }}
      onChangeCapture={scheduleClose}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded) return;
        event.stopPropagation();
        if (details.current?.contains(document.activeElement)) {
          section.current?.querySelector<HTMLInputElement>('.theme-picker input:checked')?.focus();
        }
        window.clearTimeout(closeTimer.current);
        setExpanded(false);
      }}
    >
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
      <div className="sidebar-controls">
        {appearance}
        <div ref={details} className="sidebar-preferences" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
          <div className="sidebar-preferences-content">{children}</div>
        </div>
      </div>
    </section>
  );
}
