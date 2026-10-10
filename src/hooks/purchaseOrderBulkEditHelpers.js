import { valuesEqual } from './purchaseOrderBulkEditRun';

export const EMPTY_DIALOG_STATE = {
  open: false,
  mode: 'confirm',
  columnLabel: '',
  selectedCount: 0,
  processedCount: 0,
  busy: false,
  summaryMessage: '',
  failedRows: [],
  updated: 0,
  skipped: 0,
};

export function isHeaderCellUpdate(payload) {
  return payload?.lineNumber === null || payload?.lineNumber === undefined;
}

export function linkedLineValuesEqual(row, headerColumnKey, value) {
  const vals = row?.linkedLineValues?.[headerColumnKey];
  if (!Array.isArray(vals) || vals.length !== 1) return false;
  return valuesEqual(vals[0], value);
}

export function shouldSkipBulkRow(mode, row, payload) {
  if (mode === 'correctAll') {
    return linkedLineValuesEqual(row, payload.headerColumnKey, payload.value);
  }
  return valuesEqual(row?.values?.[payload.columnKey], payload.value);
}

export function createBulkErrorMessage({ updated, skipped, notTried }) {
  return `Bulk edit stopped due to an error. Updated: ${updated}. Skipped (already equal): ${skipped}. Not attempted (after error): ${notTried}.`;
}

export function findVisibleOrder(visibleOrders, payload) {
  const match = (Array.isArray(visibleOrders) ? visibleOrders : []).find((order) => (
    order.dataAreaId === payload.dataAreaId && order.orderNumber === payload.orderNumber
  ));
  return match || { dataAreaId: payload.dataAreaId, orderNumber: payload.orderNumber };
}

export function startBackgroundCorrectJob({
  startCorrectJob, closeDialog, columnLabelByKey, runSingleUpdate, payload, rows, mode,
}) {
  const columnKey = payload.columnKey || payload.headerColumnKey;
  const columnLabel = columnLabelByKey.get(columnKey) || columnKey || 'this column';
  const started = startCorrectJob({ payload, rows, columnLabel, runSingleUpdate, mode });
  closeDialog();
  if (!started) {
    throw new Error('A write-back is already running. Wait until it finishes.');
  }
  return { background: true };
}
