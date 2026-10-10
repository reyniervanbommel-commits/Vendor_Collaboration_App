import { useCallback, useMemo } from 'react';
import { apiRequest } from '../utils/api';
import { formatCorrectAllFailure } from '../utils/lineWriteBackFailureText';
import { withHistoryFlag } from '../utils/withHistoryFlag';

/**
 * Staff-only fan-out: één POST schrijft een D365-line-waarde terug op alle regels van één PO.
 * @param {{ patchLinkedLineValues: Function, applyLineValuesBatch?: Function }} params
 * @returns {{ onCorrectAllLines: Function }}
 */
export function usePurchaseOrderCorrectAllLines({
  patchLinkedLineValues,
  applyLineValuesBatch,
}) {
  const onCorrectAllLines = useCallback(async ({
    lineColumnId, lineColumnKey, headerColumnKey, dataAreaId, orderNumber, value,
  }) => {
    const response = await apiRequest('/data/purchase-orders/correct-all-details', {
      method: 'POST',
      body: { columnId: lineColumnId, partitionKey: dataAreaId, recordKey: orderNumber, value },
    });
    const remaining = Array.isArray(response.remainingValues) ? response.remainingValues : [];
    patchLinkedLineValues(dataAreaId, orderNumber, headerColumnKey, remaining);
    const updated = new Set((response.updatedDetailKeys || []).map((key) => Number(key)));
    applyLineValuesBatch?.(dataAreaId, orderNumber, (line) => (
      updated.has(Number(line.lineNumber))
        ? {
          ...line,
          values: { ...line.values, [lineColumnKey]: value },
          historyByColumnId: withHistoryFlag(line.historyByColumnId, lineColumnId),
        }
        : line
    ));
    if (response.failed > 0) {
      const updatedCount = Number(response.updated) || 0;
      const err = new Error(formatCorrectAllFailure(response));
      err.remainingDisplayValue = remaining[0] ?? '';
      err.failures = Array.isArray(response.failures) ? response.failures : [];
      err.updated = updatedCount;
      err.attempted = Number(response.attempted) || 0;
      err.partial = updatedCount > 0;
      throw err;
    }
    return response;
  }, [applyLineValuesBatch, patchLinkedLineValues]);

  return useMemo(() => ({ onCorrectAllLines }), [onCorrectAllLines]);
}
