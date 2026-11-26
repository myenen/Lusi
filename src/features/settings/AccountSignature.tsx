import { ImagePlus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { saveAccountSignature } from '../accounts/imap-api';
import { markupFromText, safeMarkup } from '../mail/compose-html';

export interface SignatureSetting {
  value: string;
  isHtml: boolean;
}

const imageTypes = ['image/png', 'image/jpeg', 'image/gif'];
const maxImageSize = 256 * 1024;
const maxHtmlSize = 750_000;

function imageMarkup(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new TypeError('Invalid image data'));
        return;
      }
      const image = document.createElement('img');
      image.src = reader.result;
      image.alt = file.name.replace(/\.[^.]+$/, '');
      image.width = 160;
      const block = document.createElement('div');
      block.append(image);
      resolve(block.outerHTML);
    };
    reader.readAsDataURL(file);
  });
}

export function AccountSignature({ accountId, signature, disabled, onSaved }: {
  accountId: number;
  signature: SignatureSetting;
  disabled: boolean;
  onSaved: (signature: SignatureSetting) => void;
}) {
  const labels = useLabels();
  const fileInput = useRef<HTMLInputElement>(null);
  const [plain, setPlain] = useState(signature.isHtml ? '' : signature.value);
  const [html, setHtml] = useState<string | undefined>(signature.isHtml ? signature.value : undefined);
  const [isHtml, setIsHtml] = useState(signature.isHtml);
  const [status, setStatus] = useState<'saving' | 'saved' | 'error' | 'loading-image' | 'image-error'>();
  const value = isHtml ? html ?? '' : plain;
  const changed = value !== signature.value || isHtml !== signature.isHtml;
  const busy = disabled || status === 'saving' || status === 'loading-image';
  const preview = useMemo(() => isHtml && value && safeMarkup(value, true), [isHtml, value]);

  function chooseFormat(next: boolean) {
    if (next && html === undefined) setHtml(markupFromText(plain));
    setIsHtml(next);
    setStatus(undefined);
  }

  async function addImage(file: File) {
    if (!imageTypes.includes(file.type) || file.size === 0 || file.size > maxImageSize) {
      setStatus('image-error');
      return;
    }
    setStatus('loading-image');
    try {
      const next = (isHtml ? html ?? '' : markupFromText(plain)) + '\n' + await imageMarkup(file);
      if (new TextEncoder().encode(next).length > maxHtmlSize) {
        setStatus('image-error');
        return;
      }
      setHtml(next);
      setIsHtml(true);
      setStatus(undefined);
    } catch {
      setStatus('image-error');
    }
  }

  return <form className="account-signature" onSubmit={async (event) => {
    event.preventDefault();
    if (busy || !changed) return;
    setStatus('saving');
    try {
      const saved = await saveAccountSignature(accountId, value, isHtml);
      if (isHtml) setHtml(saved);
      else setPlain(saved);
      onSaved({ value: saved, isHtml });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }}>
    <div className="composer-editor-modes" role="group" aria-label={labels.signatureFormat}>
      <button type="button" aria-pressed={!isHtml} disabled={busy} onClick={() => chooseFormat(false)}>{labels.signaturePlain}</button>
      <button type="button" aria-pressed={isHtml} disabled={busy} onClick={() => chooseFormat(true)}>{labels.htmlSource}</button>
    </div>
    <textarea aria-label={labels.accountSignature} rows={isHtml ? 4 : 3} wrap={isHtml ? 'off' : 'soft'} maxLength={isHtml ? maxHtmlSize : 2000}
      value={value} disabled={busy} onChange={(event) => {
        if (isHtml) setHtml(event.currentTarget.value);
        else setPlain(event.currentTarget.value);
        setStatus(undefined);
      }} />
    {preview && <div className="account-signature-preview" role="region" aria-label={labels.signaturePreview}
      dangerouslySetInnerHTML={{ __html: preview }} />}
    <input ref={fileInput} type="file" accept={imageTypes.join(',')} hidden disabled={busy} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void addImage(file);
    }} />
    <div className="account-signature-actions">
      <button className="text-button account-signature-image" type="button" disabled={busy}
        onClick={() => fileInput.current?.click()}><ImagePlus size={16} aria-hidden="true" />{labels.signatureAddImage}</button>
      <button className="text-button" type="submit" disabled={busy || !changed}>
        {status === 'saving' ? labels.savingSignature : labels.saveSignature}
      </button>
      {status === 'saved' && <span role="status">{labels.signatureSaved}</span>}
      {status === 'error' && <span role="alert">{labels.signatureFailed}</span>}
      {status === 'image-error' && <span role="alert">{labels.signatureImageError}</span>}
    </div>
  </form>;
}
