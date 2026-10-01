import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../../utils/api';
import { useCommentPermissions } from '../../../hooks/useCommentPermissions';
import { noteCommentPermissionDenied } from '../../../utils/commentPermissionNotice';
import { rowKey } from './remarksFormatters';

/**
 * Fetches remarks match keys for a column filter (`search` or `hasComment`).
 * @param {{ query: string, enabled: boolean, tableKey?: string, mode?: 'search'|'hasComment' }} params
 * @returns {{ matchKeys: Set<string>|null, loading: boolean, error: string }}
 */
export function useRemarksColumnFilter({ query, enabled, tableKey = 'purchase-orders', mode = 'search' }) {
  const { canView } = useCommentPermissions();
  const active = Boolean(enabled && canView);
  const [matchKeys, setMatchKeys] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!active) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setMatchKeys(null);
      setLoading(false);
      setError('');
      return undefined;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const path = mode === 'hasComment'
          ? `/data/${encodeURIComponent(tableKey)}/remarks/has-comment`
          : `/data/${encodeURIComponent(tableKey)}/remarks/search?q=${encodeURIComponent(query)}`;
        const data = await apiRequest(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const keys = Array.isArray(data?.keys)
          ? new Set(data.keys.map((item) => rowKey(item.partitionKey, item.recordKey)))
          : new Set();
        setMatchKeys(keys);
      } catch (requestError) {
        if (controller.signal.aborted || controllerRef.current !== controller) return;
        if (noteCommentPermissionDenied(requestError)) return;
        if (requestError?.name !== 'AbortError') {
          setError(requestError?.message || 'Failed to search remarks');
        }
      } finally {
        if (controllerRef.current === controller) {
          setLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [query, active, tableKey, mode]);

  return useMemo(
    () => ({ matchKeys, loading, error }),
    [error, loading, matchKeys]
  );
}

export default useRemarksColumnFilter;
