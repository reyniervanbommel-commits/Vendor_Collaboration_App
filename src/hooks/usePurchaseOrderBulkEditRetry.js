import { useCallback, useRef, useState } from 'react';
import { runCorrectRows } from './purchaseOrderBulkEditRun';

/**
 * Retry-lifecycle voor mislukte D365 bulk-correcties.
 * Input: failedRows + updater + runSingleUpdate. Output: retryingBulk, retryRow, retryAllFailed.
 */
export function usePurchaseOrderBulkEditRetry({ failedRows, onFailedRowsChange, runSingleUpdate }) {
  const [retryingBulk, setRetryingBulk] = useState(false);
  const failedRowsRef = useRef(failedRows);
  failedRowsRef.current = failedRows;

  const retryRows = useCallback(async (entries) => {
    if (!entries.length) return;
    setRetryingBulk(true);
    try {
      const candidates = entries.map((e) => ({
        dataAreaId: e.dataAreaId,
        orderNumber: e.orderNumber,
        currentValue: e.basedOnValue,
      }));
      const first = entries[0];
      const payload = {
        columnId: first.columnId,
        columnKey: first.columnKey,
        value: first.value,
        lineColumnId: first.lineColumnId,
        lineColumnKey: first.lineColumnKey,
        headerColumnKey: first.headerColumnKey,
      };
      const { failedRows: stillFailed } = await runCorrectRows({
        candidates,
        payload,
        runSingleUpdate,
        mode: first.mode || 'correct',
      });
      const stillFailedKeys = new Set(stillFailed.map((r) => r.key));
      const retriedKeys = new Set(entries.map((e) => e.key));
      onFailedRowsChange((prevFailedRows) => prevFailedRows
        .filter((r) => !retriedKeys.has(r.key) || stillFailedKeys.has(r.key))
        .map((r) => {
          const sf = stillFailed.find((x) => x.key === r.key);
          // A retry skips lines already at the target value, so it reports partial=false;
          // the order stays partially updated in D365, so keep the earlier Partial status.
          return sf ? { ...sf, partial: Boolean(r.partial || sf.partial) } : r;
        }));
    } finally {
      setRetryingBulk(false);
    }
  }, [onFailedRowsChange, runSingleUpdate]);

  const retryRow = useCallback(
    (key) => retryRows(failedRowsRef.current.filter((r) => r.key === key)),
    [retryRows],
  );
  const retryAllFailed = useCallback(
    () => retryRows(failedRowsRef.current),
    [retryRows],
  );

  return { retryingBulk, retryRow, retryAllFailed };
}
