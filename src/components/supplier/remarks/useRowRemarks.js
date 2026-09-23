import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../../utils/api';
import { useCommentPermissions } from '../../../hooks/useCommentPermissions';
import { noteCommentPermissionDenied } from '../../../utils/commentPermissionNotice';
import { isRemarkActivity, mergeNewest, mergeOlder, toRemark } from './remarksFormatters';

const INITIAL_DELAY = 5000;
const MAX_DELAY = 60000;

function rowQuery(row) {
  return new URLSearchParams({
    partitionKey: row.partitionKey,
    recordKey: row.recordKey,
  });
}

function remarksPath(tableKey, row, cursor) {
  const query = rowQuery(row);
  query.set('limit', '50');
  if (cursor) query.set('cursor', cursor);
  return `/data/${encodeURIComponent(tableKey)}/remarks?${query.toString()}`;
}

function activityPath(tableKey, row, afterCursor) {
  const query = rowQuery(row);
  query.set('kind', 'all');
  query.set('limit', afterCursor ? '50' : '1');
  if (afterCursor) query.set('afterCursor', afterCursor);
  return `/data/${encodeURIComponent(tableKey)}/activity?${query.toString()}`;
}

/**
 * Owns remark pagination, mutations and five-second delta polling for one open row.
 */
export function useRowRemarks({ enabled, tableKey, row, onSummaryChange }) {
  const { canView, canWrite } = useCommentPermissions();
  const active = Boolean(enabled && canView);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controllersRef = useRef(new Set());
  const requestInFlightRef = useRef(false);
  const newestCursorRef = useRef(null);
  const timerRef = useRef(null);
  const backoffRef = useRef(INITIAL_DELAY);
  const loadingRef = useRef(false);

  const request = useCallback(async (path, options = {}) => {
    if (requestInFlightRef.current) {
      const busyError = new Error('A remarks request is already in progress');
      busyError.code = 'REQUEST_IN_PROGRESS';
      throw busyError;
    }
    const controller = new AbortController();
    controllersRef.current.add(controller);
    requestInFlightRef.current = true;
    try {
      return await apiRequest(path, { ...options, signal: controller.signal });
    } finally {
      requestInFlightRef.current = false;
      controllersRef.current.delete(controller);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    if (!active || !tableKey || !row?.partitionKey || !row?.recordKey) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const remarksData = await request(remarksPath(tableKey, row));
      setItems(Array.isArray(remarksData?.items) ? remarksData.items : []);
      setTotal(Number(remarksData?.total) || 0);
      setNextCursor(remarksData?.nextCursor || null);
      const activityData = await request(activityPath(tableKey, row));
      newestCursorRef.current = activityData?.newestCursor || null;
      backoffRef.current = INITIAL_DELAY;
    } catch (requestError) {
      if (noteCommentPermissionDenied(requestError)) return;
      if (requestError?.name !== 'AbortError' && requestError?.code !== 'REQUEST_IN_PROGRESS') {
        setError(requestError?.message || 'Failed to load remarks');
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [active, request, row, tableKey]);

  const loadOlder = useCallback(async () => {
    if (!nextCursor) return;
    setError('');
    try {
      const data = await request(remarksPath(tableKey, row, nextCursor));
      setItems((current) => mergeOlder(current, Array.isArray(data?.items) ? data.items : []));
      setTotal(Number(data?.total) || 0);
      setNextCursor(data?.nextCursor || null);
    } catch (requestError) {
      if (requestError?.name !== 'AbortError' && requestError?.code !== 'REQUEST_IN_PROGRESS') {
        setError(requestError?.message || 'Failed to load older remarks');
      }
    }
  }, [nextCursor, request, row, tableKey]);

  const createRemark = useCallback(
    async (body, columnId = null) => {
      const normalizedBody = String(body ?? '')
        .normalize('NFC')
        .trim();
      if (!canWrite || !normalizedBody || normalizedBody.length > 2000) {
        throw new Error('Remark must contain between 1 and 2000 characters');
      }
      const data = await request(`/data/${encodeURIComponent(tableKey)}/remarks`, {
        method: 'POST',
        body: {
          partitionKey: row.partitionKey,
          recordKey: row.recordKey,
          body: normalizedBody,
          ...(columnId ? { columnId } : {}),
        },
      });
      const remark = data?.remark;
      if (remark) {
        setItems((current) => mergeNewest(current, [remark]));
        setTotal((current) => current + 1);
        onSummaryChange?.({ countDelta: 1, latest: remark });
      }
      return remark;
    },
    [canWrite, onSummaryChange, request, row, tableKey]
  );

  const deleteRemark = useCallback(
    async (remarkId) => {
      const data = await request(`/data/${encodeURIComponent(tableKey)}/remarks/${remarkId}`, {
        method: 'DELETE',
        body: { partitionKey: row.partitionKey, recordKey: row.recordKey },
      });
      if (data?.remark) {
        setItems((current) => current.map((item) => (String(item.id) === String(remarkId) ? data.remark : item)));
        setTotal((current) => Math.max(0, current - 1));
        onSummaryChange?.({ countDelta: -1, latest: null });
      }
      return data?.remark;
    },
    [onSummaryChange, request, row, tableKey]
  );

  const toggleReaction = useCallback(
    async (remarkId, emoji, active) => {
      const data = await request(`/data/${encodeURIComponent(tableKey)}/remarks/${remarkId}/reaction`, {
        method: 'PUT',
        body: { partitionKey: row.partitionKey, recordKey: row.recordKey, emoji, active },
      });
      setItems((current) =>
        current.map((item) =>
          String(item.id) === String(remarkId) ? { ...item, reactions: data?.reactions || [] } : item
        )
      );
      return data?.reactions || [];
    },
    [request, row, tableKey]
  );

  const retry = useCallback(() => {
    backoffRef.current = INITIAL_DELAY;
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    loadInitial();
    return () => {
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      loadingRef.current = false;
      requestInFlightRef.current = false;
    };
  }, [loadInitial]);

  useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    const clearTimer = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const schedule = () => {
      clearTimer();
      if (!disposed && document.visibilityState === 'visible') {
        timerRef.current = window.setTimeout(poll, backoffRef.current);
      }
    };
    const poll = async () => {
      if (disposed || requestInFlightRef.current || document.visibilityState !== 'visible') {
        schedule();
        return;
      }
      if (!newestCursorRef.current) {
        schedule();
        return;
      }
      try {
        const data = await request(activityPath(tableKey, row, newestCursorRef.current));
        const newRemarks = (Array.isArray(data?.items) ? data.items : []).filter(isRemarkActivity).map(toRemark);
        setItems((current) => mergeNewest(current, newRemarks));
        setTotal(Number(data?.totals?.remarks) || 0);
        newestCursorRef.current = data?.newestCursor || newestCursorRef.current;
        backoffRef.current = INITIAL_DELAY;
        setError('');
        if (newRemarks.length > 0) {
          onSummaryChange?.({ count: data?.totals?.remarks, latest: newRemarks[0] });
        }
      } catch (requestError) {
        if (requestError?.name !== 'AbortError') {
          setError(requestError?.message || 'Failed to refresh remarks');
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_DELAY);
        }
      } finally {
        schedule();
      }
    };
    const handleVisibility = () => {
      clearTimer();
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    schedule();
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      requestInFlightRef.current = false;
    };
  }, [active, onSummaryChange, request, row, tableKey]);

  return useMemo(
    () => ({
      items,
      total,
      loading,
      error,
      hasMore: Boolean(nextCursor),
      createRemark,
      deleteRemark,
      toggleReaction,
      loadOlder,
      retry,
    }),
    [createRemark, deleteRemark, error, items, loadOlder, loading, nextCursor, retry, toggleReaction, total]
  );
}

export default useRowRemarks;
