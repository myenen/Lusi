import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import { SelectBox } from '../../components/ui/SelectBox';
import { checkImapSettings, connectGmailAccount, connectImapAccount, discoverImapSettings, imapErrorMessage, type ConnectedInbox, type DiscoveredImap } from './imap-api';

type SetupStep = 'email' | 'server' | 'password' | 'oauth';
const connectionFailures = new Set<unknown>(['network', 'tls', 'timeout', 'inbox', 'smtpTls', 'smtpUnavailable']);
const tls = { value: 'tls', label: 'SSL/TLS' } as const;
const starttls = { value: 'starttls', label: 'STARTTLS' } as const;

function discoveredUsername(host: string, settings?: { host: string; username?: string }) {
  return settings && settings.host.toLowerCase() === host.toLowerCase() ? settings.username?.trim() : undefined;
}

export function AccountSetup({ hasMacTitleBar, desktop, onConnected, onClose }: {
  hasMacTitleBar?: boolean;
  desktop: boolean;
  onConnected: (inbox: ConnectedInbox) => void;
  onClose?: () => void;
}) {
  const { accountSetup: labels, imapErrors } = useLabels();
  const [step, setStep] = useState<SetupStep>('email');
  const [email, setEmail] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [startTls, setStartTls] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpStartTls, setSmtpStartTls] = useState(true);
  const [discovery, setDiscovery] = useState<DiscoveredImap | null>();
  const discoveredSettings = useRef<DiscoveredImap | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const passwordBlocked = !desktop || (discovery?.needsConfirmation === true && !confirmed);

  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    panel.showModal();
    emailInput.current?.focus();
    return () => { if (panel.open) panel.close(); };
  }, []);

  useLayoutEffect(() => {
    if (step !== 'email') heading.current?.focus();
  }, [step]);

  function editPreviousStep() {
    setFailure(undefined);
    setDiscovery(undefined);
    setConfirmed(false);
    if (step === 'password') {
      setStep('server');
    } else {
      setStep('email');
      requestAnimationFrame(() => emailInput.current?.focus());
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || (step === 'oauth' && !desktop) || (step === 'password' && passwordBlocked)) return;
    pending.current = true;
    setBusy(true);
    setFailure(undefined);
    const username = discoveredUsername(host.trim(), discoveredSettings.current ?? undefined);
    const smtpUsername = discoveredUsername(smtpHost.trim(), discoveredSettings.current?.outgoing);
    const account = {
      email: email.trim(), host: host.trim(), port: Number(port),
      ...(startTls ? { startTls: true } : {}), ...(username ? { username } : {}),
    };
    const outgoing = {
      host: smtpHost.trim(), port: Number(smtpPort), startTls: smtpStartTls,
      ...(smtpUsername ? { username: smtpUsername } : {}),
    };
    try {
      if (step === 'oauth') {
        onConnected(await connectGmailAccount(account.email));
      } else if (step === 'password') {
        const input = passwordInput.current;
        if (!input?.value) return;
        const password = input.value;
        input.value = '';
        onConnected(await connectImapAccount(account, outgoing, password));
      } else if (step === 'server') {
        if (desktop) await checkImapSettings(account, outgoing);
        if (!discovery?.needsConfirmation || discovery.host !== account.host.toLowerCase()) {
          setDiscovery(undefined);
        }
        setStep('password');
      } else {
        const found = desktop ? await discoverImapSettings(account.email) : null;
        discoveredSettings.current = found;
        setDiscovery(found);
        setConfirmed(false);
        if (found) {
          setHost(found.host);
          setPort(String(found.port));
          setStartTls(found.startTls ?? false);
          if (found.outgoing) {
            setSmtpHost(found.outgoing.host);
            setSmtpPort(String(found.outgoing.port));
            setSmtpStartTls(found.outgoing.startTls ?? false);
          }
        }
        setStep(found?.oauthProvider ? 'oauth' : found?.outgoing ? 'password' : 'server');
      }
    } catch (error) {
      if (step === 'password' && discovery && connectionFailures.has(error)) {
        setDiscovery(undefined);
        setConfirmed(false);
        setStep('server');
      }
      setFailure(error ?? 'unknown');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const oauth = discovery?.oauthProvider ? labels.providers[discovery.oauthProvider] : undefined;
  const title = step === 'oauth' ? oauth?.title
    : step === 'email' ? labels.title : step === 'server' ? labels.connection : labels.authenticate;
  const description = step === 'email' ? labels.description : step === 'server'
    ? discovery && !discovery.outgoing ? labels.smtpFallback
      : desktop && discovery === null ? labels.discoveryFallback : labels.imapDescription
    : step === 'oauth' ? oauth?.description : discovery?.outgoing ? labels.discoveredServer : labels.passwordDescription;
  const status = busy ? { email: labels.discovering, server: undefined, password: labels.connecting, oauth: oauth?.waiting }[step] : undefined;
  const submitLabel = status ?? (step === 'oauth' ? oauth?.signIn : step === 'password' ? labels.connect : labels.continue);

  const content = (
      <section className="account-setup-card glass-panel" aria-labelledby={headingId} data-step={step}>
        <div className="account-setup-brand"><span className="brand-icon" aria-hidden="true" />Lusi
          {onClose && <IconButton className="account-setup-close" label={labels.close} icon={X} disabled={busy}
            onClick={() => { if (!pending.current) onClose(); }} />}
        </div>
        <header className="account-setup-heading">
          <h1 id={headingId} ref={heading} tabIndex={-1}>{title}</h1>
          <p>{description}</p>
        </header>
        <form className="account-setup-form" onSubmit={submit} aria-busy={busy}>
          {step !== 'email' && <div className="account-setup-review">
            <span>{email}</span>
            {(step === 'password' || step === 'oauth') && <>
              <span>IMAP · {host.trim()}:{port}{step === 'oauth' && ' (SSL/TLS)'}</span>
              <span>SMTP · {smtpHost.trim()}:{smtpPort} ({smtpStartTls ? 'STARTTLS' : 'SSL/TLS'})</span>
            </>}
            <button className="text-button" type="button" disabled={busy} onClick={editPreviousStep}>
              <ArrowLeft size={15} aria-hidden="true" />{step === 'password' ? labels.editServer : labels.edit}
            </button>
          </div>}
          {step === 'email' && <label>
            {labels.email}
            <input ref={emailInput} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
              required disabled={busy} value={email} onChange={(event) => {
                setEmail(event.target.value);
                setHost('');
                setPort('993');
                setStartTls(false);
                setSmtpHost('');
                setSmtpPort('587');
                setSmtpStartTls(true);
                discoveredSettings.current = null;
                setFailure(undefined);
              }} />
          </label>}
          {step === 'server' && <fieldset className="account-setup-fields" aria-label="IMAP" disabled={busy}>
            <label>{labels.host}
              <input type="text" placeholder="imap.example.com" autoCapitalize="none" spellCheck={false}
                required maxLength={253} value={host} onChange={(event) => setHost(event.target.value)} />
            </label>
            <label>{labels.port}
              <input type="number" min={1} max={65535} required value={port} onChange={(event) => setPort(event.target.value)} />
            </label>
            <div className="account-setup-field">
              <label htmlFor={`${headingId}-imap-security`}>{labels.security}</label>
              <SelectBox id={`${headingId}-imap-security`} label={labels.security} disabled={busy}
                options={[tls, starttls]} value={startTls ? 'starttls' : 'tls'} onChange={(value) => {
                const useStartTls = value === 'starttls';
                if ((!startTls && port === '993') || (startTls && port === '143')) setPort(useStartTls ? '143' : '993');
                setStartTls(useStartTls);
              }} />
            </div>
          </fieldset>}
          {step === 'server' && <fieldset className="account-setup-fields" aria-label="SMTP" disabled={busy}>
            <label>{labels.smtpHost}
              <input type="text" placeholder="smtp.example.com" autoCapitalize="none" spellCheck={false}
                required maxLength={253} value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} />
            </label>
            <label>{labels.smtpPort}
              <input type="number" min={1} max={65535} required value={smtpPort} onChange={(event) => {
                const nextPort = event.target.value;
                setSmtpPort(nextPort);
                if (nextPort === '465' || nextPort === '587') setSmtpStartTls(nextPort === '587');
              }} />
            </label>
            <div className="account-setup-field">
              <label htmlFor={`${headingId}-smtp-security`}>{labels.smtpSecurity}</label>
              <SelectBox id={`${headingId}-smtp-security`} label={labels.smtpSecurity} disabled={busy}
                options={[starttls, tls]} value={smtpStartTls ? 'starttls' : 'tls'} onChange={(value) => {
                const useStartTls = value === 'starttls';
                if ((smtpStartTls && smtpPort === '587') || (!smtpStartTls && smtpPort === '465')) {
                  setSmtpPort(useStartTls ? '587' : '465');
                }
                setSmtpStartTls(useStartTls);
              }} />
            </div>
          </fieldset>}
          {step === 'password' && <>
            {discovery?.needsConfirmation && <label className="account-setup-confirmation">
              <input type="checkbox" required checked={confirmed} disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)} />
              <span>{labels.confirmDiscoveredServer}</span>
            </label>}
            <label>{labels.password}
              <input ref={passwordInput} type="password" autoComplete="off" disabled={passwordBlocked || busy}
                required maxLength={1024} />
            </label>
          </>}
          {!desktop && step !== 'email' && <p className="account-setup-hint">{labels.desktopOnly}</p>}
          {failure !== undefined && <p className="account-setup-error" role="alert">{imapErrorMessage(failure, imapErrors)}</p>}
          <button className="compose-button" disabled={busy || (step === 'oauth' && !desktop) || (step === 'password' && passwordBlocked)} type="submit">
            {submitLabel} <ArrowRight size={17} aria-hidden="true" />
          </button>
        </form>
        {status && <span className="sr-only" role="status">{status}</span>}
      </section>
  );
  return onClose ? (
    <dialog className="composer account-setup-dialog" data-step={step} ref={dialog} aria-label={labels.addAccount}
      onCancel={(event) => { event.preventDefault(); if (!pending.current) onClose(); }}>
      {content}
    </dialog>
  ) : <main className="account-setup">
    {hasMacTitleBar && <div className="window-drag-area" data-tauri-drag-region="" aria-hidden="true" />}
    {content}
  </main>;
}
