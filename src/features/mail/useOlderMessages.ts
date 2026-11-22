import { useRef, useState } from 'react';
import { readOlderConnectedMessages, type ImapHeader, type MessageKey } from '../accounts/imap-api';

interface Pages {
  folder?: string;
  headers: ImapHeader[];
  nextBefore?: MessageKey | null;
  loading: boolean;
  error?: unknown;
}

const emptyPages: Pages = { headers: [], loading: false };

export function useOlderMessages(accountId: number, folder: string, firstBefore?: MessageKey) {
  const [pages, setPages] = useState(emptyPages);
  const request = useRef<{ active: boolean; folder: string } | undefined>(undefined);
  const nextBefore = pages.nextBefore === undefined ? firstBefore : pages.nextBefore;

  function reset(source?: string) {
    if (request.current && (!source || request.current.folder === source)) {
      request.current.active = false;
      request.current = undefined;
    }
    setPages((current) => !source || current.folder === source ? emptyPages : current);
  }

  async function load() {
    if (!nextBefore || nextBefore.uid <= 1 || request.current) return;
    const operation = { active: true, folder };
    request.current = operation;
    setPages((current) => ({ ...current, folder, loading: true, error: undefined }));
    try {
      const result = await readOlderConnectedMessages(accountId, folder, nextBefore);
      if (!operation.active) return;
      setPages((current) => ({
        folder,
        headers: [...current.headers, ...result.headers],
        nextBefore: result.nextBefore,
        loading: false,
      }));
    } catch (error) {
      if (operation.active) setPages((current) => ({ ...current, loading: false, error: error ?? 'unknown' }));
    } finally {
      if (request.current === operation) request.current = undefined;
    }
  }

  function patch(source: string, update: (headers: ImapHeader[]) => ImapHeader[]) {
    setPages((current) => current.folder === source ? { ...current, headers: update(current.headers) } : current);
  }

  return {
    ...pages,
    cursor: nextBefore && nextBefore.uid > 1 ? nextBefore : undefined,
    load, patch, reset,
  };
}
