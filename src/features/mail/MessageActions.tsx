import { Archive, Mail, MailOpen, RotateCcw, Star, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton, Toolbar } from '../../components/ui/Controls';
import type { TooltipSide } from '../../components/ui/Tooltip';
import type { MessageAction } from '../accounts/imap-api';
import type { MessageRow } from './connected-mail';

export interface MessageActionAvailability {
  canArchive: boolean;
  canTrash: boolean;
  inTrash: boolean;
}

export function MessageActions({ message, className, actionBusy, canArchive, canTrash, inTrash, onAction, showStar, children, tooltip }: MessageActionAvailability & {
  message: MessageRow;
  className: string;
  actionBusy: boolean;
  onAction: (action: MessageAction) => void;
  showStar?: boolean;
  tooltip?: TooltipSide;
  children?: ReactNode;
}) {
  const labels = useLabels();
  return <Toolbar label={labels.manageMessage} className={className}>
    {showStar && <IconButton tooltip={tooltip} label={message.starred ? labels.removeStar : labels.addStar} icon={Star}
      aria-pressed={message.starred} disabled={actionBusy} onClick={() => onAction(message.starred ? 'unstar' : 'star')} />}
    <IconButton tooltip={tooltip} label={message.unread ? labels.markRead : labels.markUnread} icon={message.unread ? MailOpen : Mail}
      disabled={actionBusy} onClick={() => onAction(message.unread ? 'read' : 'unread')} />
    {children}
    <IconButton tooltip={tooltip} label={labels.archiveMessage} icon={Archive} disabled={actionBusy || !canArchive} onClick={() => onAction('archive')} />
    {inTrash
      ? <IconButton tooltip={tooltip} label={labels.restoreMessage} icon={RotateCcw} disabled={actionBusy} onClick={() => onAction('restore')} />
      : <IconButton tooltip={tooltip} label={labels.moveToTrash} icon={Trash2} disabled={actionBusy || !canTrash} onClick={() => onAction('trash')} />}
  </Toolbar>;
}
