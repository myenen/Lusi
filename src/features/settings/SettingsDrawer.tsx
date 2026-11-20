import { BriefcaseBusiness, Settings2, UserRound, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useLabels } from '../../app/i18n';
import { LanguageSelect } from '../../app/LanguageSelect';
import { ThemePresetSelect } from '../../app/ThemePresetSelect';
import { ThemeSelect } from '../../app/ThemeSelect';
import type { Preferences } from '../../app/ui-preferences';
import { IconButton } from '../../components/ui/Controls';
import { demoAccounts, type DemoAccountId } from '../mail/demo-accounts';

export function SettingsDrawer({ accountId, onSelectAccount, preferences, themeId, onUpdate, onClose }: {
  accountId: DemoAccountId;
  onSelectAccount: (id: DemoAccountId) => void;
  preferences: Preferences;
  themeId: string;
  onUpdate: (patch: Partial<Preferences>) => void;
  onClose: () => void;
}) {
  const labels = useLabels();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    closeButton.current?.focus();
    return () => { if (panel?.open) panel.close(); };
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog id="settings-drawer" className="settings-drawer" ref={dialog} aria-labelledby="settings-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="settings-panel">
        <header className="settings-header">
          <h2 id="settings-title">{labels.settings}</h2>
          <IconButton ref={closeButton} label={labels.closeSettings} icon={X} onClick={close} />
        </header>
        <div className="settings-body">
          <fieldset className="settings-section">
            <legend><UserRound size={17} aria-hidden="true" />{labels.accountCenter}</legend>
            <div className="settings-accounts">
              {Object.entries(demoAccounts).map(([id, account]) => {
                const AccountIcon = id === 'work' ? BriefcaseBusiness : UserRound;
                return <label key={id} className="settings-account">
                  <span className="account-icon"><AccountIcon size={17} aria-hidden="true" /></span>
                  <span className="account-copy">
                    <strong>{labels[account.nameKey]}</strong>
                    <small>{account.address}</small>
                  </span>
                  <input type="radio" name="settings-account" checked={id === accountId}
                    onChange={() => onSelectAccount(id as DemoAccountId)} />
                </label>;
              })}
            </div>
          </fieldset>
          <section className="settings-section" aria-labelledby="system-settings-title">
            <h3 id="system-settings-title"><Settings2 size={17} aria-hidden="true" />{labels.systemSettings}</h3>
            <div className="settings-system">
              <p className="settings-appearance-label" aria-hidden="true">{labels.appearance}</p>
              <ThemeSelect theme={preferences.theme} onChange={(theme) => onUpdate({ theme })} disabled={false} />
              <ThemePresetSelect value={themeId} onChange={(themeId) => onUpdate({ themeId })} disabled={false} />
              <LanguageSelect value={preferences.language} onChange={(language) => onUpdate({ language })} disabled={false} />
            </div>
          </section>
        </div>
      </div>
    </dialog>
  );
}
