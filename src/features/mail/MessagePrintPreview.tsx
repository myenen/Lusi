import { invoke, isTauri } from '@tauri-apps/api/core';
import { Printer, X } from 'lucide-react';
import { createElement, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import type { OpenedMessage } from '../accounts/imap-api';
import type { MessageRow } from './connected-mail';

const printTags = new Set([
  'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 's',
  'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const discardedTags = new Set(['iframe', 'math', 'noscript', 'object', 'script', 'style', 'svg', 'template']);

// Read in an inert template and rebuild static elements without sender styles or links.
function printableHtml(html: string): ReactNode[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  function toPrintNode(node: Node, key: string, depth: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element) || depth >= 64) return null;
    const tag = node.localName;
    if (discardedTags.has(tag)) return null;
    if (tag === 'img') {
      const src = node.getAttribute('src');
      return src && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)
        ? <img key={key} src={src} alt={node.getAttribute('alt') ?? ''} />
        : node.getAttribute('alt');
    }
    if (tag === 'br' || tag === 'hr') return createElement(tag, { key });
    const children = Array.from(node.childNodes, (child, index) => toPrintNode(child, `${key}.${index}`, depth + 1));
    if (!printTags.has(tag)) return children;
    if (tag === 'td' || tag === 'th') {
      const span = (attribute: string) => Math.min(50, Math.max(1, Number.parseInt(node.getAttribute(attribute) ?? '', 10) || 1));
      return createElement(tag, { key, colSpan: span('colspan'), rowSpan: span('rowspan') }, children);
    }
    return createElement(tag, { key }, children);
  }
  return Array.from(template.content.childNodes, (node, index) => toPrintNode(node, String(index), 0));
}

export function MessagePrintPreview({ message, opened, onClose }: {
  message: MessageRow;
  opened: OpenedMessage;
  onClose: () => void;
}) {
  const labels = useLabels();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [printing, setPrinting] = useState(false);
  const [failed, setFailed] = useState(false);
  const html = opened.html?.content;
  const richBody = useMemo(() => html ? printableHtml(html) : undefined, [html]);

  useLayoutEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    closeButton.current?.focus();
    return () => { if (panel?.open) panel.close(); };
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  async function print() {
    setFailed(false);
    setPrinting(true);
    try {
      if (isTauri()) await invoke('plugin:webview|print');
      else window.print();
    } catch {
      setFailed(true);
    } finally {
      setPrinting(false);
    }
  }

  const sheet = <article className="mail-print-sheet">
    <header className="mail-print-letter-heading">
      <h1>{message.subject}</h1>
      <dl>
        <div><dt>{labels.printSender}</dt><dd>{message.sender}
          {message.address && message.address !== message.sender && <> &lt;{message.address}&gt;</>}</dd></div>
        {message.date && <div><dt>{labels.printDate}</dt><dd>{message.date}</dd></div>}
      </dl>
    </header>
    {opened.bodyTruncated && <p className="mail-print-note">{labels.bodyTruncated}</p>}
    <div className="mail-print-body">
      {richBody ?? <p className="mail-print-plain">{opened.body || labels.connectedInbox.noBody}</p>}
    </div>
    {Boolean(opened.attachments?.length) && <section className="mail-print-filenames">
      <h2>{labels.attachments}</h2>
      <ul>{opened.attachments?.map((attachment) => {
        const part = attachment.part.join('.');
        return <li key={part}>{attachment.name ?? `${labels.attachmentFile} ${part}`}</li>;
      })}</ul>
    </section>}
  </article>;

  return <>
    <dialog ref={dialog} className="composer mail-print-dialog" aria-labelledby="mail-print-title"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="composer-header">
        <h2 id="mail-print-title">{labels.printPreview}</h2>
        <IconButton ref={closeButton} icon={X} label={labels.closePrintPreview} onClick={close} />
      </header>
      <div className="mail-print-scroll">{sheet}</div>
      <footer className="composer-footer">
        {failed && <p className="account-setup-error" role="alert">{labels.printFailed}</p>}
        <button type="button" className="compose-button" disabled={printing} onClick={() => void print()}>
          <Printer size={17} aria-hidden="true" />{labels.printMessage}
        </button>
      </footer>
    </dialog>
    {createPortal(<div className="mail-print-output" aria-hidden="true">{sheet}</div>, document.body)}
  </>;
}
