import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../../utils/api';
import { rowKey } from './remarksFormatters';
import { useRemarksSummary } from './useRemarksSummary';
import { useRowActivity } from './useRowActivity';
import { useRowRemarks } from './useRowRemarks';

function buildHistoryTotalsPath({ tableKey, row, columnId }) {
  const query = new URLSearchParams({
    partitionKey: row.partitionKey,
    recordKey: row.recordKey,
    kind: 'history',
    limit: '1',
  });
  if (columnId) query.set('columnId', String(columnId));
  return `/data/${encodeURIComponent(tableKey)}/activity?${query.toString()}`;
}

/**
 * Coordinates panel tabs, row-scoped hooks, column filtering and focus on the composer.
 */
export function usePurchaseOrderRemarksController({
  open,
  tableKey = 'purchase-orders',
  row,
  initialColumn = null,
  openerRef,
  onClose,
  summaryState = null,
}) {
  const [selectedTab, setSelectedTab] = useState('remarks');
  const [columnId, setColumnId] = useState(initialColumn?.id || '');
  const [historyActionFilter, setHistoryActionFilter] = useState('updated');
  const [historyUpdatedCount, setHistoryUpdatedCount] = useState(0);
  const composerRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const localSummary = useRemarksSummary({ enabled: !summaryState && open, tableKey });
  const summary = summaryState || localSummary;
  const { summaryByRow, updateRow, refresh: refreshSummary } = summary;

  const handleSummaryChange = useCallback(
    (change) => {
      if (!row) return;
      updateRow(row, change);
      if (change.latest === null || change.refreshAll) refreshSummary();
    },
    [refreshSummary, row, updateRow]
  );

  const remarks = useRowRemarks({
    enabled: open && selectedTab === 'remarks',
    tableKey,
    row,
    onSummaryChange: handleSummaryChange,
  });
  const history = useRowActivity({
    enabled: open && selectedTab === 'history',
    tableKey,
    row,
    kind: 'history',
    columnId: columnId || null,
    actionFilter: historyActionFilter,
  });
  const all = useRowActivity({
    enabled: open && selectedTab === 'all',
    tableKey,
    row,
    kind: 'all',
    columnId: columnId || null,
  });

  const onTabSelect = useCallback((_, data) => {
    setSelectedTab(data.value);
  }, []);

  const onColumnChange = useCallback((event) => {
    setColumnId(event.target.value);
  }, []);

  const onHistoryActionFilterChange = useCallback((event) => {
    setHistoryActionFilter(event.target.value);
  }, []);

  useEffect(() => {
    if (!open || !row?.partitionKey || !row?.recordKey) {
      setHistoryUpdatedCount(0);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest(buildHistoryTotalsPath({
          tableKey,
          row,
          columnId: columnId || null,
        }));
        if (!cancelled) {
          setHistoryUpdatedCount(Number(data?.totals?.historyUpdated) || 0);
        }
      } catch {
        if (!cancelled) setHistoryUpdatedCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [columnId, open, row, tableKey]);

  useEffect(() => {
    if (history.totals?.historyUpdated !== undefined) {
      setHistoryUpdatedCount(Number(history.totals.historyUpdated) || 0);
    }
  }, [history.totals?.historyUpdated]);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = openerRef?.current || document.activeElement;
    setSelectedTab('remarks');
    setColumnId(initialColumn?.id || '');
    setHistoryActionFilter('updated');
    const focusFrame = window.requestAnimationFrame(() => composerRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const restoreTarget = openerRef?.current || restoreFocusRef.current;
      window.requestAnimationFrame(() => restoreTarget?.focus?.());
    };
  }, [initialColumn?.id, open, openerRef, row?.partitionKey, row?.recordKey]);

  const selectedSummary = useMemo(
    () => summaryByRow.get(rowKey(row?.partitionKey, row?.recordKey)) || null,
    [row?.partitionKey, row?.recordKey, summaryByRow]
  );

  return useMemo(
    () => ({
      selectedTab,
      columnId,
      historyActionFilter,
      historyUpdatedCount,
      onTabSelect,
      onColumnChange,
      onHistoryActionFilterChange,
      composerRef,
      remarks,
      history,
      all,
      selectedSummary,
    }),
    [
      all,
      columnId,
      history,
      historyActionFilter,
      historyUpdatedCount,
      onColumnChange,
      onHistoryActionFilterChange,
      onTabSelect,
      remarks,
      selectedSummary,
      selectedTab,
    ]
  );
}

export default usePurchaseOrderRemarksController;
