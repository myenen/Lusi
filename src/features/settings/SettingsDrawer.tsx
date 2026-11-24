import { Bell, Check, Plus, Settings2, UserRound, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { LanguageSelect } from '../../app/LanguageSelect';
import { ThemePresetSelect } from '../../app/ThemePresetSelect';
import { ThemeSelect } from '../../app/ThemeSelect';
import type { Preferences } from '../../app/ui-preferences';
import { Checkbox } from '../../components/ui/Checkbox';
import { IconButton } from '../../components/ui/Controls';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { AccountSignature } from './AccountSignature';
import { AccountSetup } from '../accounts/AccountSetup';
import { connectGmailAccount, imapErrorMessage, type ConnectedAccount, type ConnectedInbox } from '../accounts/imap-api';

export function SettingsDrawer({ accountId, signature, onSignatureSaved, connectedEmail, accounts, accountsLoadFailed, preferences, themeId, onUpdate, onClose, onAccountChanged, onAccountSwitch, onGoogleReconnected }: {
  accountId: number;
  signature: string;
  onSignatureSaved: (signature: string) => void;
  connectedEmail: string;
  accounts: ConnectedAccount[];
  accountsLoadFailed: boolean;
  preferences: Preferences;
  themeId: string;
  onUpdate: (patch: Partial<Preferences>) => void;
  onClose: () => void;
  onAccountChanged: (inbox: ConnectedInbox) => void;
  onAccountSwitch: (id: number) => Promise<void>;
  onGoogleReconnected?: (inbox: ConnectedInbox) => void;
}) {
  const labels = useLabels();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const accountPending = useRef(false);
  const [accountOperation, setAccountOperation] = useState<'switch' | 'reconnect'>();
  const [addingAccount, setAddingAccount] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const [accountError, setAccountError] = useState<unknown>();

  useLayoutEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    closeButton.current?.focus();
    return () => { if (panel?.open) panel.close(); };
  }, []);

  function close() {
    if (accountPending.current || addingAccount) return;
    dialog.current?.close();
    onClose();
  }

  async function runAccountOperation(operation: 'switch' | 'reconnect', task: () => Promise<void>) {
    if (accountPending.current || addingAccount) return;
    accountPending.current = true;
    setAccountOperation(operation);
    setReconnected(false);
    setAccountError(undefined);
    try {
      await task();
    } catch (error) {
      setAccountError(error ?? 'unknown');
    } finally {
      accountPending.current = false;
      setAccountOperation(undefined);
    }
  }

  return <>
    <dialog id="settings-drawer" className="settings-drawer" ref={dialog} aria-labelledby="settings-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="settings-panel">
        <header className="settings-header">
          <h2 id="settings-title">{labels.settings}</h2>
          <IconButton ref={closeButton} label={labels.closeSettings} icon={X} onClick={close} disabled={Boolean(accountOperation)} />
        </header>
        <ScrollArea className="settings-scroll" contentClassName="settings-body" label={labels.settings}>
          <section className="settings-section" aria-labelledby="account-center-title">
            <header className="settings-section-heading">
              <h3 id="account-center-title"><UserRound size={17} aria-hidden="true" />{labels.accountCenter}</h3>
              <IconButton ref={addButton} className="settings-add-account" label={labels.accountSetup.addAccount}
                icon={Plus} aria-haspopup="dialog" disabled={Boolean(accountOperation)} onClick={() => setAddingAccount(true)} />
            </header>
            <div className="settings-accounts">
              <div className="settings-account-list" role="group" aria-label={labels.selectAccount}>
                {accounts.map(({ id, email }) => (
                  <button key={id} type="button" className="settings-account" aria-pressed={id === accountId}
                    disabled={Boolean(accountOperation)} onClick={() => {
                      if (id !== accountId) void runAccountOperation('switch', () => onAccountSwitch(id));
                    }}>
                    <span className="account-icon" aria-hidden="true"><UserRound size={19} /></span>
                    <span className="account-copy"><strong>{email}</strong>
                      {id === accountId && <small>{labels.activeAccount}</small>}</span>
                    {id === accountId && <Check size={16} className="settings-account-check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              {accountsLoadFailed && <p className="account-setup-hint" role="status">{labels.accountsLoadFailed}</p>}
              {accountOperation === 'switch' && <p className="account-setup-hint" role="status">{labels.switchingAccount}</p>}
              {onGoogleReconnected && <button type="button" className="text-button"
                onClick={() => void runAccountOperation('reconnect', async () => {
                  onGoogleReconnected(await connectGmailAccount(connectedEmail, accountId));
                  setReconnected(true);
                })} disabled={Boolean(accountOperation)}>
                {accountOperation === 'reconnect' ? labels.accountSetup.providers.gmail.waiting : labels.googleReconnect}
              </button>}
              {reconnected && <p role="status" className="account-setup-hint">{labels.googleReconnected}</p>}
              {accountError !== undefined && <p role="alert" className="account-setup-error">
                {imapErrorMessage(accountError, labels.imapErrors)}
              </p>}
            </div>
            <AccountSignature signature={signature} accountId={accountId} onSaved={onSignatureSaved} disabled={Boolean(accountOperation)} />
          </section>
          <section className="settings-section" aria-labelledby="system-settings-title">
            <h3 id="system-settings-title"><Settings2 size={17} aria-hidden="true" />{labels.systemSettings}</h3>
            <div className="settings-system">
              <p className="settings-appearance-label" aria-hidden="true">{labels.appearance}</p>
              <ThemeSelect theme={preferences.theme} onChange={(theme) => onUpdate({ theme })} disabled={false} />
              <ThemePresetSelect value={themeId} onChange={(themeId) => onUpdate({ themeId })} disabled={false} />
              <LanguageSelect value={preferences.language} onChange={(language) => onUpdate({ language })} disabled={false} />
              <label className="background-setting">
                <Checkbox checked={preferences.keepRunningOnClose}
                  onCheckedChange={(keepRunningOnClose) => onUpdate({ keepRunningOnClose })} />
                {labels.keepRunningOnClose}
              </label>
            </div>
          </section>
          <section className="settings-section" aria-labelledby="notification-settings-title">
            <h3 id="notification-settings-title"><Bell size={17} aria-hidden="true" />{labels.notifications}</h3>
            <div className="settings-system notification-settings">
              <label>
                <Checkbox checked={preferences.mailNotifications}
                  onCheckedChange={(mailNotifications) => onUpdate({ mailNotifications })} />
                {labels.notifyNewMail}
              </label>
              <label>
                <Checkbox checked={preferences.notificationDetails} disabled={!preferences.mailNotifications}
                  onCheckedChange={(notificationDetails) => onUpdate({ notificationDetails })} />
                {labels.showNotificationDetails}
              </label>
            </div>
          </section>
        </ScrollArea>
      </div>
    </dialog>
    {addingAccount && <AccountSetup desktop onConnected={onAccountChanged} onClose={() => {
      setAddingAccount(false);
      requestAnimationFrame(() => addButton.current?.focus());
    }} />}
  </>;
}
