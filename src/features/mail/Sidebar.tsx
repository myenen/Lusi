import { Archive, FilePenLine, Folder, Inbox, Mail, PanelLeftClose, PanelLeftOpen, Send, ShieldAlert, Star, Trash2, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import type { FolderKind, MailFolder } from '../accounts/imap-api';
import { folderDisplayName } from './connected-mail';

const folderIcons: Record<FolderKind, LucideIcon> = {
  inbox: Inbox, sent: Send, drafts: FilePenLine, archive: Archive, trash: Trash2,
  junk: ShieldAlert, all: Mail, flagged: Star, custom: Folder,
};

export function Sidebar({ folder, folders, inboxUnread, open, collapsed, account, onToggle, onClose, onSelect, appearance, divider, status }: {
  folder: string;
  folders: MailFolder[];
  inboxUnread: number;
  open: boolean;
  collapsed: boolean;
  account: ReactNode;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (folder: string) => void;
  appearance: ReactNode;
  divider: ReactNode;
  status?: ReactNode;
}) {
  const labels = useLabels();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) close.current?.focus(); }, [open]);
  const tooltips = collapsed && !open;

  return (
    <aside id="sidebar" className="sidebar glass-panel" data-open={open} data-collapsed={collapsed} aria-label={labels.sidebar} role={open ? 'dialog' : undefined} aria-modal={open || undefined}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select')].filter((control) => (
          control.tabIndex >= 0 && !control.matches(':disabled, input[type="radio"]:not(:checked)')
          && !control.closest('[inert]') && control.getClientRects().length > 0
        ));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="sidebar-scroll">
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
        <nav className="mailboxes" aria-label={labels.mailFolders}>
          {folders.map((entry) => {
            const label = folderDisplayName(entry, labels);
            const Icon = folderIcons[entry.kind];
            return <button key={entry.id} type="button" className="folder-link" data-folder={entry.kind}
              title={tooltips || entry.kind === 'custom' ? label : undefined} aria-current={entry.id === folder ? 'page' : undefined}
              onClick={() => onSelect(entry.id)}>
              <Icon size={17} aria-hidden="true" />
              <span className="sidebar-copy folder-name">{label}</span>
              {entry.kind === 'inbox' && inboxUnread > 0 && <span className="folder-count sidebar-copy" aria-label={labels.unreadCount(inboxUnread)}>{inboxUnread}</span>}
            </button>;
          })}
        </nav>
        {status}
      </div>
      <div className="sidebar-bottom">
        {account}
        {appearance}
      </div>
      {divider}
    </aside>
  );
}
