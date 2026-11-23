import { ArrowLeft, Clock3, Menu, Paperclip, Trash2 } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { LocaleContext, useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { cancelScheduledMessage, imapErrorMessage, listScheduledMessages, onScheduledChanged, readScheduledMessage, type ScheduledItem } from '../accounts/imap-api';
import { MessageBody } from './MessageBody';

export function ScheduledMail({ foldersOpen, onToggleFolders, folderToggleRef, onPaneChange, divider, themeId, colorScheme }: {
  foldersOpen: boolean;
  onToggleFolders: () => void;
  folderToggleRef: Ref<HTMLButtonElement>;
  onPaneChange: (pane: 'list' | 'reader') => void;
  divider: ReactNode;
  themeId: string;
  colorScheme: 'light' | 'dark';
}) {
  const labels = useLabels();
  const locale = useContext(LocaleContext);
  const [result, setResult] = useState<ScheduledItem[] | 'error'>();
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const [pending, setPending] = useState<number>();
  const [error, setError] = useState<unknown>();
  const heading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const items = Array.isArray(result) ? result : [];
  const selected = items.find(({ id }) => id === selectedId);
  const canCancel = selected?.state === 'queued' || selected?.state === 'retrying';
  const action = canCancel ? labels.cancelScheduled : labels.removeScheduled;
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time>;
  };

  function openItem(id: number, trigger: HTMLButtonElement) {
    setSelectedId(id);
    setError(undefined);
    selectedButton.current = trigger;
    onPaneChange('reader');
    if (window.matchMedia?.('(max-width: 46rem)').matches) {
      requestAnimationFrame(() => detailHeading.current?.focus());
    }
  }

  function back() {
    onPaneChange('list');
    requestAnimationFrame(() => {
      if (selectedButton.current?.isConnected) selectedButton.current.focus();
      else heading.current?.focus();
    });
  }

  useEffect(() => {
    let active = true;
    let revision = 0;
    function load() {
      if (!active) return;
      const request = ++revision;
      void listScheduledMessages().then(
        (items) => { if (active && request === revision) setResult(items); },
        () => { if (active && request === revision) setResult('error'); },
      );
    }
    const registration = onScheduledChanged(load);
    void registration.then(load, load);
    return () => {
      active = false;
      void registration.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [reload]);

  async function remove(id: number) {
    if (pending !== undefined) return;
    setPending(id);
    setError(undefined);
    try {
      await cancelScheduledMessage(id);
      setSelectedId(undefined);
      onPaneChange('list');
      requestAnimationFrame(() => heading.current?.focus());
    } catch (failure) {
      setError(failure ?? 'unknown');
    } finally {
      setPending(undefined);
      setReload((value) => value + 1);
    }
  }

  return <>
    <section className="mail-list glass-panel" aria-labelledby="scheduled-heading" inert={foldersOpen}>
      <header className="list-header">
        <div className="list-title-row">
          <IconButton ref={folderToggleRef} className="folders-toggle" label={labels.toggleFolders} icon={Menu}
            aria-controls="sidebar" aria-expanded={foldersOpen} onClick={onToggleFolders} />
          <h1 id="scheduled-heading" ref={heading} tabIndex={-1}>{labels.scheduledTitle}</h1>
          {Array.isArray(result) && <span className="message-count">{labels.messageCount(items.length)}</span>}
        </div>
        {result === undefined && <p className="mailbox-status" role="status">{labels.connectedInbox.refreshing}</p>}
        {result === 'error' && <p className="account-setup-error" role="alert">
          {labels.scheduledLoadFailed}{' '}<button type="button" className="text-button" onClick={() => setReload((value) => value + 1)}>
            {labels.accountSetup.retry}
          </button>
        </p>}
      </header>
      <ScrollArea className="mail-list-scroll" label={labels.scheduledTitle}>
        <ul className="message-list">
          {Array.isArray(result) && items.length === 0 && <li className="list-empty">
            <Clock3 size={26} aria-hidden="true" /><p>{labels.scheduledEmpty}</p>
          </li>}
          {items.map((item) => <li className="message-list-item" key={item.id}>
            <button type="button" className="message-row" aria-current={item.id === selected?.id ? 'true' : undefined}
              disabled={pending !== undefined} onClick={(event) => openItem(item.id, event.currentTarget)}>
              <span className="unread-dot" aria-hidden="true" />
              <span className="avatar" data-tone="blue" aria-hidden="true"><Clock3 size={17} /></span>
              <span className="message-row-main">
                <span className="message-sender">{item.from}</span>
                <span className="message-subject">{item.subject || labels.untitled}</span>
                <span className="message-snippet">{item.state === 'queued' ? item.recipients : labels.scheduledStates[item.state]}</span>
              </span>
              <span className="message-row-meta">{formatTime(item.scheduledAt)}</span>
            </button>
          </li>)}
        </ul>
      </ScrollArea>
      {divider}
    </section>
    <main className="reader" aria-label={labels.reader} inert={foldersOpen}>
      <header className="reader-toolbar">
        <IconButton className="reader-back" label={labels.backToMessages} icon={ArrowLeft} onClick={back} />
        {selected && selected.state !== 'sending' && <IconButton label={action} icon={Trash2} tooltip="bottom"
          disabled={pending !== undefined} onClick={() => void remove(selected.id)} />}
      </header>
      {error !== undefined && <p className="account-setup-error reader-action-error" role="alert">{imapErrorMessage(error, labels.imapErrors)}</p>}
      {selected ? <ScrollArea className="reader-scroll" label={labels.reader} key={selected.id}>
        <article className="letter">
          <div className="letter-header">
            <div className="letter-title"><h2 ref={detailHeading} tabIndex={-1}>{selected.subject || labels.untitled}</h2></div>
            <div className="letter-meta">
              <span className="avatar" data-tone="blue" aria-hidden="true"><Clock3 size={20} /></span>
              <div className="sender"><strong>{selected.from}</strong></div>
            </div>
          </div>
          <div className="letter-body scheduled-details">
            <dl>
              <div><dt>{labels.scheduledTo}</dt><dd>{selected.recipients}</dd></div>
              <div><dt>{labels.scheduleDate}</dt><dd>{formatTime(selected.scheduledAt)}</dd></div>
            </dl>
            <p className="scheduled-status" role="status">{labels.scheduledStates[selected.state]}</p>
            <p className="scheduled-hint">{labels.scheduledHint}</p>
          </div>
          <div className="letter-body scheduled-preview">
            <ScheduledBody id={selected.id} themeId={themeId} colorScheme={colorScheme} />
          </div>
        </article>
      </ScrollArea> : <div className="reader-empty"><Clock3 size={32} aria-hidden="true" /><p>{labels.noSelection}</p></div>}
    </main>
  </>;
}

function ScheduledBody({ id, themeId, colorScheme }: {
  id: number;
  themeId: string;
  colorScheme: 'light' | 'dark';
}) {
  const labels = useLabels();
  const [content, setContent] = useState<Awaited<ReturnType<typeof readScheduledMessage>> | { error: unknown }>();
  useEffect(() => {
    let active = true;
    void readScheduledMessage(id).then(
      (message) => { if (active) setContent(message); },
      (error: unknown) => { if (active) setContent({ error }); },
    );
    return () => { active = false; };
  }, [id]);
  if (!content) return <p role="status">{labels.connectedInbox.reading}</p>;
  if ('error' in content) return <p role="alert" className="account-setup-error">{imapErrorMessage(content.error, labels.imapErrors)}</p>;
  return <>
    {content.attachmentNames.length > 0 && <ul className="attachments" aria-label={labels.attachments}>
      {content.attachmentNames.map((name, index) => <li className="attachment-chip" key={`${index}:${name}`}>
        <Paperclip size={16} aria-hidden="true" /><span>{name}</span>
      </li>)}
    </ul>}
    <MessageBody body={content.body} html={content.html} themeId={themeId} colorScheme={colorScheme} />
  </>;
}
