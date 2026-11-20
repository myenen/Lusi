import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLabels } from '../../app/i18n';
import { IconButton } from '../../components/ui/Controls';
import type { DemoAttachment } from './demo-mail';

export async function loadAttachment(attachment: DemoAttachment) {
  if (attachment.file) return attachment.file;
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error('Could not load attachment');
  return response.blob();
}

export async function downloadAttachment(attachment: DemoAttachment) {
  const file = await loadAttachment(attachment);
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AttachmentPreview({ attachment, onClose }: {
  attachment: DemoAttachment;
  onClose: () => void;
}) {
  const labels = useLabels();
  const dialog = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<{ text: string; truncated: boolean } | { url: string } | 'error'>();
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void loadAttachment(attachment).then(async (file) => {
      if (!active) return;
      if (attachment.type === 'image') {
        objectUrl = URL.createObjectURL(file);
        setContent({ url: objectUrl });
      } else {
        const limit = 128 * 1024;
        const text = await file.slice(0, limit).text();
        if (active) setContent({ text, truncated: file.size > limit });
      }
    }).catch(() => { if (active) setContent('error'); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);

  return (
    <dialog className="composer attachment-preview" ref={dialog} aria-labelledby="attachment-preview-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="composer-header">
        <h2 id="attachment-preview-title">{attachment.name}</h2>
        <IconButton label={labels.closePreview} icon={X} onClick={onClose} />
      </header>
      <div className="attachment-preview-content">
        {!content && <p role="status">{labels.loadingPreview}</p>}
        {content === 'error' && <p role="alert">{labels.previewFailed}</p>}
        {content && content !== 'error' && ('url' in content
          ? <img src={content.url} alt={attachment.name} onError={() => setContent('error')} />
          : <><pre>{content.text}</pre>{content.truncated && <p>{labels.previewTruncated}</p>}</>)}
      </div>
      <footer className="composer-footer">
        <button className="composer-attach" type="button" onClick={() => {
          setDownloadError(false);
          void downloadAttachment(attachment).catch(() => setDownloadError(true));
        }}><Download size={16} aria-hidden="true" />{labels.download(attachment.name)}</button>
        {downloadError && <small role="alert">{labels.downloadFailed}</small>}
      </footer>
    </dialog>
  );
}
