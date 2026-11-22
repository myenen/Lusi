import { Archive, FilePenLine, Folder, Inbox, Mail, PanelLeftClose, PanelLeftOpen, PenLine, Send, ShieldAlert, Star, Trash2, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import { ScrollArea } from '../../components/ui/ScrollArea';
import type { FolderKind, MailFolder } from '../accounts/imap-api';
import { folderDisplayName } from './connected-mail';

const folderIcons: Record<FolderKind, LucideIcon> = {
  inbox: Inbox, sent: Send, drafts: FilePenLine, archive: Archive, trash: Trash2,
  junk: ShieldAlert, all: Mail, flagged: Star, custom: Folder,
};

export function Sidebar({ folder, folders, inboxUnread, open, collapsed, account, onToggle, onClose, onSelect, onCompose, canSend, appearance, divider, status }: {
  folder: string;
  folders: MailFolder[];
  inboxUnread: number;
  open: boolean;
  collapsed: boolean;
  account: ReactNode;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (folder: string) => void;
  onCompose: (trigger: HTMLButtonElement) => void;
  canSend: boolean;
  appearance: ReactNode;
  divider: ReactNode;
  status?: ReactNode;
}) {
  const labels = useLabels();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) close.current?.focus(); }, [open]);
  const tooltips = collapsed && !open;
  const customFolders = folders.filter((entry) => entry.kind === 'custom');

  function folderButton(entry: MailFolder) {
    const label = folderDisplayName(entry, labels);
    const Icon = folderIcons[entry.kind];
    return <button key={entry.id} type="button" className="folder-link" data-folder={entry.kind}
      title={tooltips || entry.kind === 'custom' ? label : undefined} aria-current={entry.id === folder ? 'page' : undefined}
      onClick={() => onSelect(entry.id)}>
      <Icon size={17} aria-hidden="true" />
      <span className="sidebar-copy folder-name">{label}</span>
      {entry.kind === 'inbox' && inboxUnread > 0 && <span className="folder-count sidebar-copy" aria-label={labels.unreadCount(inboxUnread)}>{inboxUnread}</span>}
    </button>;
  }

  return (
    <aside id="sidebar" className="sidebar glass-panel" data-open={open} data-collapsed={collapsed} aria-label={labels.sidebar} role={open ? 'dialog' : undefined} aria-modal={open || undefined}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')].filter((control) => (
          control.tabIndex >= 0 && !control.matches(':disabled, input[type="radio"]:not(:checked)')
          && !control.closest('[inert]') && control.getClientRects().length > 0
        ));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }}>
      <ScrollArea className="sidebar-scroll" contentClassName="sidebar-scroll-content" label={labels.sidebar}>
        <div className="brand">
          <span className="brand-icon" aria-hidden="true" /><span className="sidebar-copy">Lusi</span>
          <IconButton
            className="sidebar-collapse"
            label={collapsed ? labels.expandSidebar : labels.collapseSidebar}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            aria-controls="sidebar"
            aria-expanded={!collapsed}
            onClick={onToggle}
          />
          {open && <IconButton ref={close} className="drawer-close" label={labels.closeFolders} icon={X} onClick={onClose} />}
        </div>
        <button type="button" className="compose-button" aria-label={labels.compose}
          title={canSend ? labels.compose : labels.imapErrors.noSmtp} disabled={!canSend}
          onClick={(event) => onCompose(event.currentTarget)}>
          <PenLine size={18} aria-hidden="true" /><span className="sidebar-copy">{labels.compose}</span>
        </button>
        <nav className="mailboxes" aria-label={labels.mailFolders}>
          {folders.filter((entry) => entry.kind !== 'custom').map(folderButton)}
          {customFolders.length > 0 && <section className="mailboxes" aria-labelledby="custom-folders-heading">
            <h2 className="folder-heading" id="custom-folders-heading"><span className="sidebar-copy">{labels.folderHeading}</span></h2>
            {customFolders.map(folderButton)}
          </section>}
        </nav>
        {status}
      </ScrollArea>
      <div className="sidebar-bottom">
        {account}
        {appearance}
      </div>
      {divider}
    </aside>
  );
}
