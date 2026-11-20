import { ArrowLeft, Mail } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import type { MessageRow } from './connected-mail';

export function MessageReader({ message, body, headingRef, inert, onBack }: {
  message?: MessageRow;
  body?: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  inert: boolean;
  onBack: () => void;
}) {
  const labels = useLabels();
  return (
    <main className="reader" aria-label={labels.reader} inert={inert} tabIndex={-1}>
      <header className="reader-toolbar">
        <IconButton className="reader-back" label={labels.backToMessages} icon={ArrowLeft} onClick={onBack} />
      </header>
      {message ? (
        <div className="reader-scroll" key={message.id}>
          <article className="letter">
            <div className="letter-header">
              <div className="letter-title"><h2 ref={headingRef} tabIndex={-1}>{message.subject}</h2></div>
              <div className="letter-meta">
                <span className="avatar" data-tone={message.tone} aria-hidden="true">{message.initials}</span>
                <div className="sender">
                  <strong>{message.sender}</strong>
                  {message.address && message.address !== message.sender && <span className="sender-address">{message.address}</span>}
                </div>
                <span className="letter-date">{message.date}</span>
              </div>
            </div>
            <div className="letter-body">{body}</div>
          </article>
        </div>
      ) : <div className="reader-empty"><Mail size={32} aria-hidden="true" /><p>{labels.noSelection}</p></div>}
    </main>
  );
}
