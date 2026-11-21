import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLabels } from '../../app/i18n';
import { checkImapSettings, connectImapAccount, discoverImapSettings, imapErrorMessage, type ConnectedInbox, type DiscoveredImap } from './imap-api';

type SetupStep = 'email' | 'server' | 'password';
const connectionFailures = new Set<unknown>(['network', 'tls', 'timeout', 'inbox', 'smtpTls', 'smtpUnavailable']);

export function AccountSetup({ hasMacTitleBar, desktop, onConnected }: {
  hasMacTitleBar: boolean;
  desktop: boolean;
  onConnected: (inbox: ConnectedInbox) => void;
}) {
  const { accountSetup: labels, imapErrors } = useLabels();
  const [step, setStep] = useState<SetupStep>('email');
  const [email, setEmail] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [startTls, setStartTls] = useState(false);
  const [username, setUsername] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpStartTls, setSmtpStartTls] = useState(true);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [discovery, setDiscovery] = useState<DiscoveredImap | null>();
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordBlocked = !desktop || (discovery?.needsConfirmation === true && !confirmed);

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
    if (pending.current || (step === 'password' && passwordBlocked)) return;
    pending.current = true;
    setBusy(true);
    setFailure(undefined);
    const account = {
      email: email.trim(), host: host.trim(), port: Number(port),
      ...(startTls ? { startTls: true } : {}), ...(username.trim() ? { username: username.trim() } : {}),
    };
    const outgoing = {
      host: smtpHost.trim(), port: Number(smtpPort), startTls: smtpStartTls,
      ...(smtpUsername.trim() ? { username: smtpUsername.trim() } : {}),
    };
    try {
      if (step === 'password') {
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
        setDiscovery(found);
        setConfirmed(false);
        if (found) {
          setHost(found.host);
          setPort(String(found.port));
          setStartTls(found.startTls ?? false);
          setUsername(found.username ?? '');
          if (found.outgoing) {
            setSmtpHost(found.outgoing.host);
            setSmtpPort(String(found.outgoing.port));
            setSmtpStartTls(found.outgoing.startTls ?? false);
            setSmtpUsername(found.outgoing.username ?? '');
          }
        }
        setStep(found?.outgoing ? 'password' : 'server');
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

  const title = step === 'email' ? labels.title : step === 'server' ? labels.connection : labels.authenticate;
  const description = step === 'email' ? labels.description : step === 'server'
    ? discovery && !discovery.outgoing ? labels.smtpFallback
      : desktop && discovery === null ? labels.discoveryFallback : labels.imapDescription
    : discovery?.outgoing ? labels.discoveredServer : labels.passwordDescription;
  const status = busy ? { email: labels.discovering, server: undefined, password: labels.connecting }[step] : undefined;
  const submitLabel = status ?? (step === 'password' ? labels.connect : labels.continue);

  return (
    <main className="account-setup">
      {hasMacTitleBar && <div className="window-drag-area" data-tauri-drag-region="" aria-hidden="true" />}
      <section className="account-setup-card glass-panel" aria-labelledby="account-setup-title">
        <div className="account-setup-brand"><span className="brand-icon" aria-hidden="true" />Lusi</div>
        <header className="account-setup-heading">
          <h1 id="account-setup-title" ref={heading} tabIndex={-1}>{title}</h1>
          <p>{description}</p>
        </header>
        <form className="account-setup-form" onSubmit={submit} aria-busy={busy}>
          {step !== 'email' && <div className="account-setup-review">
            <span>{email}</span>
            {step === 'password' && <>
              <span>IMAP · {host.trim()}:{port}</span>
              <span>SMTP · {smtpHost.trim()}:{smtpPort} ({smtpStartTls ? 'STARTTLS' : 'SSL/TLS'})</span>
            </>}
            <button className="text-button" type="button" disabled={busy} onClick={editPreviousStep}>
              <ArrowLeft size={15} aria-hidden="true" />{step === 'server' ? labels.edit : labels.editServer}
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
                setUsername('');
                setSmtpHost('');
                setSmtpPort('587');
                setSmtpStartTls(true);
                setSmtpUsername('');
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
            <label>{labels.imapUsername}
              <input autoCapitalize="none" spellCheck={false} maxLength={254}
                value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>{labels.security}
              <select value={startTls ? 'starttls' : 'tls'} onChange={(event) => {
                const useStartTls = event.target.value === 'starttls';
                if ((!startTls && port === '993') || (startTls && port === '143')) setPort(useStartTls ? '143' : '993');
                setStartTls(useStartTls);
              }}>
                <option value="tls">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
              </select>
            </label>
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
            <label>{labels.smtpUsername}
              <input autoCapitalize="none" spellCheck={false} maxLength={254}
                value={smtpUsername} onChange={(event) => setSmtpUsername(event.target.value)} />
            </label>
            <label>{labels.smtpSecurity}
              <select value={smtpStartTls ? 'starttls' : 'tls'} onChange={(event) => {
                const useStartTls = event.target.value === 'starttls';
                if ((smtpStartTls && smtpPort === '587') || (!smtpStartTls && smtpPort === '465')) {
                  setSmtpPort(useStartTls ? '587' : '465');
                }
                setSmtpStartTls(useStartTls);
              }}>
                <option value="starttls">STARTTLS</option>
                <option value="tls">SSL/TLS</option>
              </select>
            </label>
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
          <button className="compose-button" disabled={busy || (step === 'password' && passwordBlocked)} type="submit">
            {submitLabel} <ArrowRight size={17} aria-hidden="true" />
          </button>
        </form>
        {status && <span className="sr-only" role="status">{status}</span>}
      </section>
    </main>
  );
}
