import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../../utils/api';
import { useCommentPermissions } from '../../../hooks/useCommentPermissions';
import { noteCommentPermissionDenied } from '../../../utils/commentPermissionNotice';
import { rowKey } from './remarksFormatters';

/**
 * Loads table remark summaries and supports scoped optimistic updates for one row.
 */
export function useRemarksSummary({ enabled = true, tableKey = 'purchase-orders' } = {}) {
  const { canView } = useCommentPermissions();
  const active = enabled && canView;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controllerRef = useRef(null);
  const requestInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!active || requestInFlightRef.current) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    requestInFlightRef.current = true;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/data/${encodeURIComponent(tableKey)}/remarks/summary`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (requestError) {
      if (noteCommentPermissionDenied(requestError)) return;
      if (requestError?.name !== 'AbortError') {
        setError(requestError?.message || 'Failed to load remark summaries');
      }
    } finally {
      if (controllerRef.current === controller) {
        requestInFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [active, tableKey]);

  const updateRow = useCallback((row, change) => {
    const targetKey = rowKey(row?.partitionKey, row?.recordKey);
    setRows((current) => {
      const currentRow = current.find((item) => rowKey(item.partitionKey, item.recordKey) === targetKey);
      const previousCount = Number(currentRow?.count) || 0;
      const nextCount = change.count ?? Math.max(0, previousCount + (change.countDelta || 0));
      const nextRow = {
        partitionKey: row.partitionKey,
        recordKey: row.recordKey,
        count: nextCount,
        latest: change.latest === undefined ? currentRow?.latest || null : change.latest,
      };
      return [nextRow, ...current.filter((item) => rowKey(item.partitionKey, item.recordKey) !== targetKey)];
    });
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      controllerRef.current?.abort();
      requestInFlightRef.current = false;
    };
  }, [refresh]);

  const summaryByRow = useMemo(() => {
    const map = new Map();
    rows.forEach((item) => map.set(rowKey(item.partitionKey, item.recordKey), item));
    return map;
  }, [rows]);

  return useMemo(
    () => ({
      summaryByRow,
      loading,
      error,
      refresh,
      updateRow,
    }),
    [error, loading, refresh, summaryByRow, updateRow]
  );
}

export default useRemarksSummary;
