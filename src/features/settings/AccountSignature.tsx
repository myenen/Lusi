import { useId, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { saveAccountSignature } from '../accounts/imap-api';

export function AccountSignature({ accountId, signature, disabled, onSaved }: {
  accountId: number;
  signature: string;
  disabled: boolean;
  onSaved: (signature: string) => void;
}) {
  const labels = useLabels();
  const id = useId();
  const [value, setValue] = useState(signature);
  const [status, setStatus] = useState<'saving' | 'saved' | 'error'>();

  return <form className="account-signature" onSubmit={async (event) => {
    event.preventDefault();
    if (disabled || status === 'saving' || value === signature) return;
    setStatus('saving');
    try {
      const saved = await saveAccountSignature(accountId, value);
      setValue(saved);
      onSaved(saved);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }}>
    <label htmlFor={id}>{labels.accountSignature}</label>
    <textarea id={id} rows={3} maxLength={2000} value={value} disabled={disabled || status === 'saving'}
      onChange={(event) => { setValue(event.currentTarget.value); setStatus(undefined); }} />
    <div className="account-signature-actions">
      <button className="text-button" type="submit" disabled={disabled || value === signature || status === 'saving'}>
        {status === 'saving' ? labels.savingSignature : labels.saveSignature}
      </button>
      {status === 'saved' && <span role="status">{labels.signatureSaved}</span>}
      {status === 'error' && <span role="alert">{labels.signatureFailed}</span>}
    </div>
  </form>;
}
