import { useContext, useState } from 'react';
import { LocaleContext, useLabels } from '../../app/i18n';
import { HtmlMessageFrame } from './HtmlMessageFrame';

export function MessageBody({ body, html, themeId, colorScheme }: {
  body?: string | null;
  html?: string | null;
  themeId: string;
  colorScheme: 'light' | 'dark';
}) {
  const labels = useLabels();
  const language = useContext(LocaleContext);
  const [showPlain, setShowPlain] = useState(false);
  return <>
    {html && body && <div className="message-html-controls">
      <button type="button" className="text-button" onClick={() => setShowPlain(!showPlain)}>
        {showPlain ? labels.connectedInbox.showHtml : labels.connectedInbox.showPlain}
      </button>
    </div>}
    {html && !showPlain
      ? <HtmlMessageFrame content={html}
          title={labels.connectedInbox.htmlMessage} language={language}
          themeId={themeId} colorScheme={colorScheme} />
      : <p>{body || labels.connectedInbox.noBody}</p>}
  </>;
}
