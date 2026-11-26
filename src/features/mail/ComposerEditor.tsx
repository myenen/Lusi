import { AlignCenter, AlignLeft, AlignRight, Bold, CaseSensitive, Italic, Link2, List, ListOrdered,
  Palette, Redo2, Strikethrough, Type, Underline, Undo2, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { useLabels } from '../../app/i18n';
import { SelectBox } from '../../components/ui/SelectBox';
import { markupFromText, safeMarkup } from './compose-html';

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
  ['justifyLeft', AlignLeft],
  ['justifyCenter', AlignCenter],
  ['justifyRight', AlignRight],
] as const;

const typefaces = { sans: 'Arial', serif: 'Georgia', mono: 'Courier New' };
const sizes = { small: '2', normal: '3', large: '5' };
const colors = { standard: '#191c25', blue: '#3452ba', green: '#177752', red: '#b43150' };
export function ComposerEditor({ body, editor, disabled, showFormatting, onChange }: {
  body: string;
  editor?: DraftEditor;
  disabled: boolean;
  showFormatting: boolean;
  onChange: (editor: DraftEditor) => void;
}) {
  const labels = useLabels();
  const source = editor?.source ?? false;
  const region = useRef<HTMLDivElement>(null);
  const rich = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const focusOnSwitch = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const linkId = useId();
  const [editingLink, setEditingLink] = useState(false);
  const [linkAddress, setLinkAddress] = useState('');
  const [invalidLink, setInvalidLink] = useState(false);
  const [initialMarkup] = useState(() => editor?.html !== undefined ? safeMarkup(editor.html) : markupFromText(body));
  const markupOnMount = useRef(initialMarkup);

  useLayoutEffect(() => {
    if (rich.current) rich.current.innerHTML = markupOnMount.current;
    if (focusOnSwitch.current) {
      region.current?.querySelector<HTMLElement>('[data-compose-body]')?.focus();
      focusOnSwitch.current = false;
    }
  }, [source]);

  useLayoutEffect(() => {
    if (editingLink) linkInput.current?.focus();
  }, [editingLink]);

  function switchMode(nextSource: boolean) {
    if (nextSource === source) return;
    const html = source ? safeMarkup(editor?.html ?? '') : rich.current?.innerHTML ?? initialMarkup;
    if (!nextSource) markupOnMount.current = html;
    setEditingLink(false);
    selection.current = null;
    focusOnSwitch.current = true;
    onChange({ html, source: nextSource });
  }

  function updateRich() {
    if (rich.current) onChange({ html: rich.current.innerHTML, source: false });
  }

  function focusRich() {
    const element = rich.current;
    if (!element) return null;
    const range = selection.current;
    const focused = document.activeElement === element;
    element.focus();
    const current = document.getSelection();
    if (current && range && element.contains(range.commonAncestorContainer)) {
      current.removeAllRanges();
      current.addRange(range);
    } else if (current && !focused && !element.contains(current.anchorNode)) {
      const end = document.createRange();
      end.selectNodeContents(element);
      end.collapse(false);
      current.removeAllRanges();
      current.addRange(end);
    }
    return current;
  }

  function applyFormat(command: (typeof formats)[number][0] | 'undo' | 'redo' | 'fontName' | 'fontSize' | 'foreColor', value?: string) {
    if (disabled || !rich.current) return;
    focusRich();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command, false, value);
    updateRich();
  }

  function closeLink() {
    setEditingLink(false);
    linkButton.current?.focus();
  }

  function insertLink() {
    let url: URL;
    try {
      url = new URL(linkAddress.trim());
    } catch {
      setInvalidLink(true);
      return;
    }
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password || !url.pathname) {
      setInvalidLink(true);
      return;
    }
    const current = focusRich();
    if (!current) return;
    if (current.isCollapsed) {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = url.href;
      document.execCommand('insertHTML', false, link.outerHTML);
    } else {
      document.execCommand('createLink', false, url.href);
    }
    setEditingLink(false);
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
    {showFormatting && <div className="composer-editor-tools">
      {!source && <div className="composer-editor-formats" role="group" aria-label={labels.editorFormatting}>
        <button type="button" title={labels.undo} aria-label={labels.undo} onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyFormat('undo')}><Undo2 size={16} aria-hidden="true" /></button>
        <button type="button" title={labels.redo} aria-label={labels.redo} onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyFormat('redo')}><Redo2 size={16} aria-hidden="true" /></button>
        <SelectBox className="composer-format-select" label={labels.fontFamily} value="" side="top"
          triggerContent={<Type size={15} aria-hidden="true" />} disabled={disabled}
          options={Object.entries(labels.fontNames).map(([value, label]) => ({ value, label }))}
          onChange={(value) => applyFormat('fontName', typefaces[value as keyof typeof typefaces])} />
        <SelectBox className="composer-format-select" label={labels.fontSize} value="" side="top"
          triggerContent={<CaseSensitive size={17} aria-hidden="true" />} disabled={disabled}
          options={Object.entries(labels.textSizes).map(([value, label]) => ({ value, label }))}
          onChange={(value) => applyFormat('fontSize', sizes[value as keyof typeof sizes])} />
        <SelectBox className="composer-format-select" label={labels.textColor} value="" side="top"
          triggerContent={<Palette size={15} aria-hidden="true" />} disabled={disabled}
          options={Object.entries(labels.textColors).map(([value, label]) => ({ value, label }))}
          onChange={(value) => applyFormat('foreColor', colors[value as keyof typeof colors])} />
        {formats.map(([command, Icon]) => <button key={command} type="button" title={labels.formats[command]}
          aria-label={labels.formats[command]} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(command)}>
          <Icon size={16} aria-hidden="true" />
        </button>)}
        <button ref={linkButton} type="button" title={labels.insertLink} aria-label={labels.insertLink}
          aria-controls={linkId} aria-expanded={editingLink} onClick={() => {
            setEditingLink(!editingLink);
            setInvalidLink(false);
            setLinkAddress('');
          }}><Link2 size={16} aria-hidden="true" /></button>
      </div>}
      <div className="composer-editor-modes" role="group" aria-label={labels.editorMode}>
        <button type="button" aria-pressed={!source} onClick={() => switchMode(false)}>{labels.richText}</button>
        <button type="button" aria-pressed={source} onClick={() => switchMode(true)}>{labels.htmlSource}</button>
      </div>
      {editingLink && !source && <div id={linkId} className="composer-link-edit" role="group" aria-label={labels.insertLink}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === linkInput.current) {
            event.preventDefault();
            insertLink();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closeLink();
          }
        }}>
        <input ref={linkInput} value={linkAddress} placeholder="https://" aria-label={labels.linkAddress}
          aria-invalid={invalidLink} maxLength={2048} onChange={(event) => {
            setLinkAddress(event.currentTarget.value);
            setInvalidLink(false);
          }} />
        <button type="button" onClick={insertLink}>{labels.insertLink}</button>
        <button type="button" aria-label={labels.dismissNotice} onClick={closeLink}><X size={15} aria-hidden="true" /></button>
        {invalidLink && <small role="alert">{labels.invalidLink}</small>}
      </div>}
    </div>}
  </div>;
}
