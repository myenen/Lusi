import { useEffect, useMemo, useRef, useState } from 'react';
import { searchConnectedMessages, type GmailCategory, type ImapHeader, type MessageSearchPage } from '../accounts/imap-api';

type SearchResult = Partial<MessageSearchPage> & {
  loadingMore?: boolean;
  error?: unknown;
};

export function useMessageSearch(
  accountId: number, folder: string, query: string, unreadOnly: boolean, oldestFirst: boolean, category?: GmailCategory,
) {
  const [attempt, setAttempt] = useState(0);
  const criteria = useMemo(() => ({ query, unreadOnly, oldestFirst, ...(category && { category }) }), [query, unreadOnly, oldestFirst, category]);
  const scope = useMemo(() => ({ accountId, folder, criteria, attempt }), [accountId, folder, criteria, attempt]);
  type SearchRun = {
    scope: typeof scope;
    result: SearchResult;
    request?: ((headers: ImapHeader[]) => ImapHeader[])[];
  };
  const current = useRef<SearchRun | undefined>(undefined);
  const [state, setState] = useState<{ scope: typeof scope; result: SearchResult }>();
  const active = Boolean(query || category);
  const currentResult = state?.scope === scope ? state.result : undefined;
  const previousCategory = category && state?.scope.accountId === accountId
    && state.scope.folder === folder && state.scope.criteria === criteria ? state.result.headers : undefined;
  const displayed = currentResult ?? (previousCategory && { headers: previousCategory });

  useEffect(() => {
    if (!active) return;
    const run: SearchRun = { scope, result: {} };
    current.current = run;
    const timer = window.setTimeout(async () => {
      run.request = [];
      try {
        const page = await searchConnectedMessages(accountId, folder, criteria);
        if (current.current !== run) return;
        const headers = run.request.reduce((rows, patch) => patch(rows), page.headers);
        run.result = { ...page, headers };
      } catch (error) {
        run.result = { error: error ?? 'unknown' };
      } finally {
        run.request = undefined;
        if (current.current === run) setState({ scope, result: run.result });
      }
    }, criteria.query ? 320 : 0);
    return () => {
      window.clearTimeout(timer);
      current.current = undefined;
    };
  }, [scope, accountId, folder, criteria, active]);

  async function loadMore() {
    const run = current.current;
    const cursor = currentResult?.nextCursor;
    if (run?.scope !== scope || !cursor || run.request) return;
    run.request = [];
    run.result = { ...run.result, loadingMore: true, error: undefined };
    setState({ scope, result: run.result });
    try {
      const page = await searchConnectedMessages(accountId, folder, { ...criteria, cursor });
      if (current.current !== run) return;
      const newHeaders = run.request.reduce((rows, patch) => patch(rows), page.headers);
      run.result = { headers: [...(run.result.headers ?? []), ...newHeaders], nextCursor: page.nextCursor };
    } catch (error) {
      run.result = { ...run.result, loadingMore: false, error: error ?? 'unknown' };
    } finally {
      run.request = undefined;
      if (current.current === run) setState({ scope, result: run.result });
    }
  }

  function patch(source: string, update: (rows: ImapHeader[]) => ImapHeader[]) {
    const run = current.current;
    if (run?.scope.folder !== source) return;
    run.request?.push(update);
    if (!run.result.headers) return;
    run.result = { ...run.result, headers: update(run.result.headers) };
    setState({ scope: run.scope, result: run.result });
  }

  return {
    ...displayed,
    pending: active && !currentResult,
    loadMore, patch,
    retry: () => setAttempt((value) => value + 1),
  };
}
