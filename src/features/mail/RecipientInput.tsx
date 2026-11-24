import { useEffect, useRef, useState, type RefObject } from 'react';
import { useLabels } from '../../app/i18n';
import { suggestRecipients, type RecipientSuggestion } from '../accounts/imap-api';

function tokenAt(value: string, caret: number) {
  const before = value.slice(0, caret);
  const start = Math.max(before.lastIndexOf(','), before.lastIndexOf(';')) + 1;
  const separator = value.slice(caret).search(/[,;]/);
  const end = separator < 0 ? value.length : caret + separator;
  return { start, end, query: value.slice(start, end).trim() };
}

export function RecipientInput({ accountId, id, inputRef, value, required, onChange }: {
  accountId: number;
  id: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const labels = useLabels();
  const ownRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownRef;
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [result, setResult] = useState<{ accountId: number; query: string; entries: RecipientSuggestion[] }>();
  const { start, end, query } = tokenAt(value, caret);
  const search = active && !dismissed && query.length >= 2 ? query : '';

  useEffect(() => {
    if (!search) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void suggestRecipients(accountId, search).then(
        (entries) => { if (current) setResult({ accountId, query: search, entries }); },
        () => {},
      );
    }, 150);
    return () => { current = false; window.clearTimeout(timer); };
  }, [accountId, search]);

  const existing = (value.slice(0, start) + ',' + value.slice(end)).toLowerCase().split(/[,;]/).map((item) => item.trim());
  const suggestions = search && result?.accountId === accountId && result.query === search ? result.entries
    .filter(({ address }) => address.toLowerCase() !== query.toLowerCase() && !existing.includes(address.toLowerCase())) : [];
  const open = suggestions.length > 0;
  const selected = highlight >= 0 && highlight < suggestions.length ? highlight : -1;
  const menuId = `${id}-suggestions`;

  function choose(address: string) {
    const prefix = start === 0 ? '' : value.slice(0, start) + ' ';
    const replacement = prefix + address;
    const next = replacement + (end === value.length ? ', ' : value.slice(end));
    const position = end === value.length ? next.length : replacement.length;
    setCaret(position);
    setDismissed(true);
    setHighlight(-1);
    onChange(next);
    requestAnimationFrame(() => input.current?.setSelectionRange(position, position));
  }

  return <div className="recipient-input">
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? menuId : undefined} aria-activedescendant={selected >= 0 ? `${menuId}-${selected}` : undefined}
      autoComplete="off" value={value} required={required} maxLength={8192}
      onFocus={(event) => { setActive(true); setCaret(event.currentTarget.selectionStart ?? value.length); setDismissed(false); }}
      onBlur={() => { setActive(false); setHighlight(-1); }}
      onSelect={(event) => {
        const position = event.currentTarget.selectionStart ?? value.length;
        if (position !== caret) setHighlight(-1);
        setCaret(position);
      }}
      onChange={(event) => {
        const input = event.currentTarget;
        setCaret(input.selectionStart ?? input.value.length);
        setDismissed(false);
        setHighlight(-1);
        onChange(input.value);
      }}
      onKeyDown={(event) => {
        if (!open || event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          setDismissed(true);
          setHighlight(-1);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const next = selected < 0 && delta < 0 ? suggestions.length - 1 : (selected + delta + suggestions.length) % suggestions.length;
          setHighlight(next);
          document.getElementById(`${menuId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
        } else if (event.key === 'Enter' && selected >= 0) {
          event.preventDefault();
          choose(suggestions[selected].address);
        }
      }} />
    {open && <ul id={menuId} role="listbox" aria-label={labels.recipientSuggestions} className="recipient-suggestions">
      {suggestions.map(({ name, address }, index) => <li key={address} id={`${menuId}-${index}`}
        role="option" aria-selected={selected === index} onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(address)}>
        {name && <strong>{name}</strong>}<span>{address}</span>
      </li>)}
    </ul>}
  </div>;
}
