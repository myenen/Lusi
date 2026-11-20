import { Archive, BriefcaseBusiness, Clock, FilePenLine, FolderKanban, Inbox, PanelLeftClose, PanelLeftOpen, PenLine, Plane, Send, Star, Trash2, UserRound, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import { isInFolder, type DemoMessage, type Folder } from './demo-mail';
import { SidebarPreferences } from './SidebarPreferences';

interface FolderEntry { id: Folder; icon: LucideIcon; count?: 'unread' | 'all'; }

const mailboxes: FolderEntry[] = [
  { id: 'inbox', icon: Inbox, count: 'unread' },
  { id: 'starred', icon: Star },
  { id: 'sent', icon: Send },
  { id: 'drafts', icon: FilePenLine, count: 'all' },
  { id: 'trash', icon: Trash2 },
  { id: 'archive', icon: Archive },
  { id: 'snoozed', icon: Clock, count: 'all' },
];

const customFolders: FolderEntry[] = [
  { id: 'work', icon: BriefcaseBusiness, count: 'unread' },
  { id: 'personal', icon: UserRound },
  { id: 'projects', icon: FolderKanban },
  { id: 'travel', icon: Plane },
];

function FolderLinks({ entries, messages, selected, tooltips, onSelect }: { entries: FolderEntry[]; messages: DemoMessage[]; selected: Folder; tooltips: boolean; onSelect: (folder: Folder) => void }) {
  const labels = useLabels();
  return entries.map(({ id, icon: Icon, count }) => {
    const label = labels.folders[id];
    const total = count ? messages.filter((message) => isInFolder(message, id) && (count === 'all' || message.unread)).length : 0;
    const countLabel = count === 'unread' ? labels.unreadCount(total) : labels.messageCount(total);

    return (
      <button key={id} type="button" className="folder-link" data-folder={id} title={tooltips ? label : undefined} aria-current={id === selected ? 'page' : undefined} onClick={() => onSelect(id)}>
        <Icon size={17} aria-hidden="true" />
        <span className="sidebar-copy">{label}</span>
        {total > 0 && <span className="folder-count sidebar-copy" aria-label={countLabel}>{total}</span>}
      </button>
    );
  });
}

export function Sidebar({ folder, messages, open, collapsed, canToggle, onToggle, onClose, onSelect, onCompose, appearance, controls, divider }: {
  folder: Folder;
  messages: DemoMessage[];
  open: boolean;
  collapsed: boolean;
  canToggle: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (folder: Folder) => void;
  onCompose: () => void;
  appearance: ReactNode;
  controls: ReactNode;
  divider: ReactNode;
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
            disabled={!canToggle}
            onClick={onToggle}
          />
          {open && <IconButton ref={close} className="drawer-close" label={labels.closeFolders} icon={X} onClick={onClose} />}
        </div>
        <button type="button" className="compose-button" title={tooltips ? labels.compose : undefined} onClick={onCompose}>
          <PenLine size={17} aria-hidden="true" /><span className="sidebar-copy">{labels.compose}</span>
        </button>
        <nav className="mailboxes" aria-label={labels.mailFolders}>
          <FolderLinks entries={mailboxes} messages={messages} selected={folder} tooltips={tooltips} onSelect={onSelect} />
          <h2 className="folder-heading"><span className="sidebar-copy">{labels.folderHeading}</span></h2>
          <FolderLinks entries={customFolders} messages={messages} selected={folder} tooltips={tooltips} onSelect={onSelect} />
        </nav>
      </div>
      <SidebarPreferences compact={tooltips} appearance={appearance}>
        {controls}
      </SidebarPreferences>
      {divider}
    </aside>
  );
}
