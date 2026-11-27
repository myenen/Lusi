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
  const request = useRef<{ active: boolean; folder: string; patches: ((headers: ImapHeader[]) => ImapHeader[])[] } | undefined>(undefined);
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
    const operation = { active: true, folder, patches: [] as ((headers: ImapHeader[]) => ImapHeader[])[] };
    request.current = operation;
    setPages((current) => ({ ...current, folder, loading: true, error: undefined }));
    try {
      const result = await readOlderConnectedMessages(accountId, folder, nextBefore);
      if (!operation.active) return;
      const headers = operation.patches.reduce((rows, apply) => apply(rows), result.headers);
      setPages((current) => ({
        folder,
        headers: [...current.headers, ...headers],
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
    if (request.current?.folder === source) request.current.patches.push(update);
    setPages((current) => current.folder === source ? { ...current, headers: update(current.headers) } : current);
  }

  return {
    ...pages,
    cursor: nextBefore && nextBefore.uid > 1 ? nextBefore : undefined,
    load, patch, reset,
  };
}
