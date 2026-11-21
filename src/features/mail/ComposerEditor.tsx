import DOMPurify from 'dompurify';
import { Bold, Italic, List, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { useLabels } from '../../app/i18n';

export interface DraftEditor {
  html: string;
  source: boolean;
}

const formats = [
  ['bold', Bold],
  ['italic', Italic],
  ['underline', Underline],
  ['strikeThrough', Strikethrough],
  ['insertUnorderedList', List],
  ['insertOrderedList', ListOrdered],
] as const;

function safeMarkup(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'hr',
      'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strike', 'strong', 'sub', 'sup', 'u', 'ul'],
    ALLOWED_ATTR: ['href'],
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
  });
}

function markupFromText(text: string) {
  const container = document.createElement('div');
  for (const line of text.split(/\r?\n/)) {
    const block = document.createElement('div');
    if (line) block.textContent = line;
    else block.append(document.createElement('br'));
    container.append(block);
  }
  return text ? container.innerHTML : '';
}

export function ComposerEditor({ body, editor, disabled, onChange }: {
  body: string;
  editor?: DraftEditor;
  disabled: boolean;
  onChange: (editor: DraftEditor) => void;
}) {
  const labels = useLabels();
  const source = editor?.source ?? false;
  const region = useRef<HTMLDivElement>(null);
  const rich = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const focusOnSwitch = useRef(false);
  const [initialMarkup] = useState(() => editor?.html !== undefined ? safeMarkup(editor.html) : markupFromText(body));
  const markupOnMount = useRef(initialMarkup);

  useLayoutEffect(() => {
    if (rich.current) rich.current.innerHTML = markupOnMount.current;
    if (focusOnSwitch.current) {
      region.current?.querySelector<HTMLElement>('[data-compose-body]')?.focus();
      focusOnSwitch.current = false;
    }
  }, [source]);

  function switchMode(nextSource: boolean) {
    if (nextSource === source) return;
    const html = source ? safeMarkup(editor?.html ?? '') : rich.current?.innerHTML ?? initialMarkup;
    if (!nextSource) markupOnMount.current = html;
    selection.current = null;
    focusOnSwitch.current = true;
    onChange({ html, source: nextSource });
  }

  function updateRich() {
    if (rich.current) onChange({ html: rich.current.innerHTML, source: false });
  }

  function applyFormat(command: (typeof formats)[number][0]) {
    const element = rich.current;
    if (!element) return;
    const range = selection.current;
    element.focus();
    const current = document.getSelection();
    if (current && range && element.contains(range.commonAncestorContainer)) {
      current.removeAllRanges();
      current.addRange(range);
    }
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command);
    updateRich();
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = safeMarkup(event.clipboardData.getData('text/html'));
    if (html) document.execCommand('insertHTML', false, html);
    else document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    updateRich();
  }

  return <div className="composer-editor" ref={region}>
    <div className="composer-editor-tools">
      <div className="composer-editor-modes" role="group" aria-label={labels.editorMode}>
        <button type="button" aria-pressed={!source} onClick={() => switchMode(false)}>{labels.richText}</button>
        <button type="button" aria-pressed={source} onClick={() => switchMode(true)}>{labels.htmlSource}</button>
      </div>
      {!source && <div className="composer-editor-formats" role="group" aria-label={labels.editorFormatting}>
        {formats.map(([command, Icon]) => <button key={command} type="button" title={labels.formats[command]}
          aria-label={labels.formats[command]} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(command)}>
          <Icon size={16} aria-hidden="true" />
        </button>)}
      </div>}
    </div>
    {source
      ? <textarea data-compose-body aria-label={labels.htmlSourceBody} value={editor?.html ?? ''}
          spellCheck={false} onChange={(event) => onChange({ html: event.target.value, source: true })} />
      : <div data-compose-body ref={rich} className="composer-rich-body" role="textbox" tabIndex={0}
          aria-label={labels.messageBody} aria-multiline="true" aria-disabled={disabled}
          aria-placeholder={labels.writeMessage} data-placeholder={labels.writeMessage}
          contentEditable={!disabled} onInput={updateRich} onPaste={paste}
          onDrop={(event) => event.preventDefault()} onClick={(event) => {
            if ((event.target as Element).closest('a')) event.preventDefault();
          }} onFocus={() => { selection.current = null; }} onBlur={() => {
            const current = document.getSelection();
            if (!current?.rangeCount) return;
            const range = current.getRangeAt(0);
            if (rich.current?.contains(range.commonAncestorContainer)) selection.current = range.cloneRange();
          }} />}
  </div>;
}
