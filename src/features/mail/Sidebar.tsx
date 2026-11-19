import { Archive, FilePenLine, FolderClosed, Inbox, PenLine, Send, Star, Trash2, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../../components/ui/Controls';
import { demoMessages, isInFolder, type Folder } from './demo-mail';

interface FolderEntry { id: Folder; label: string; icon: LucideIcon; count?: 'unread' | 'all'; }

const mailboxes: FolderEntry[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, count: 'unread' },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FilePenLine, count: 'all' },
  { id: 'trash', label: 'Trash', icon: Trash2 },
  { id: 'archive', label: 'Archive', icon: Archive },
];

const labels: FolderEntry[] = [
  { id: 'work', label: 'Work', icon: FolderClosed, count: 'unread' },
  { id: 'personal', label: 'Personal', icon: FolderClosed },
  { id: 'projects', label: 'Projects', icon: FolderClosed },
  { id: 'travel', label: 'Travel', icon: FolderClosed },
];

export function folderName(folder: Folder) {
  return [...mailboxes, ...labels].find(({ id }) => id === folder)?.label ?? 'Inbox';
}

function FolderLinks({ entries, selected, onSelect }: { entries: FolderEntry[]; selected: Folder; onSelect: (folder: Folder) => void }) {
  return entries.map(({ id, label, icon: Icon, count }) => {
    const total = count ? demoMessages.filter((message) => isInFolder(message, id) && (count === 'all' || message.unread)).length : 0;
    const countLabel = count === 'unread' ? 'unread' : total === 1 ? 'message' : 'messages';

    return (
      <button key={id} type="button" className="folder-link" aria-current={id === selected ? 'page' : undefined} onClick={() => onSelect(id)}>
        <Icon size={17} aria-hidden="true" />
        <span>{label}</span>
        {total > 0 && <span className="folder-count" aria-label={`${total} ${countLabel}`}>{total}</span>}
      </button>
    );
  });
}

export function Sidebar({ folder, open, onClose, onSelect, onCompose, appearance, divider }: {
  folder: Folder;
  open: boolean;
  onClose: () => void;
  onSelect: (folder: Folder) => void;
  onCompose: () => void;
  appearance: ReactNode;
  divider: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) close.current?.focus(); }, [open]);

  return (
    <aside id="sidebar" className="sidebar glass-panel" data-open={open} aria-label="Sidebar" role={open ? 'dialog' : undefined} aria-modal={open || undefined}>
      <div className="sidebar-scroll">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true" />Lusi
          {open && <IconButton ref={close} className="drawer-close" label="Close folders" icon={X} onClick={onClose} />}
        </div>
        <button type="button" className="compose-button" onClick={onCompose}><PenLine size={17} aria-hidden="true" />Compose</button>
        <nav className="mailboxes" aria-label="Mail folders">
          <FolderLinks entries={mailboxes} selected={folder} onSelect={onSelect} />
          <h2 className="folder-heading">Folders</h2>
          <FolderLinks entries={labels} selected={folder} onSelect={onSelect} />
        </nav>
      </div>
      <div className="sidebar-bottom">
        <div className="account">
          <span className="account-icon" aria-hidden="true">D</span>
          <div><strong>Demo account</strong><small>Sample mailbox</small></div>
        </div>
        {appearance}
      </div>
      {divider}
    </aside>
  );
}
