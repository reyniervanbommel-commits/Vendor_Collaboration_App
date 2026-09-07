/**
 * Matrix row order and chart-visibility merge for the RCCP dashboard.
 * Ordered → remaining → received → capacity → overcapacity (warning last).
 */

function matrixRowRank(row) {
  if (row?.isWarning) return 90;
  if (row?.isOvercapacity) return 50;
  if (row?.isCapacity) return 40;
  if (row?.isDelivered) return 30;
  if (row?.isOpen) return 20;
  if (row?.isOrdered) return 10;
  return 10;
}

export function sortRccpMatrixRows(rows) {
  return [...(rows || [])].sort((a, b) => matrixRowRank(a) - matrixRowRank(b));
}

export function mergeChartVisibleKeys(rows, prev = {}, stored = {}, options = {}) {
  const preferStored = Boolean(options.preferStored);
  const next = {};
  (rows || []).forEach((row) => {
    const key = row.measureKey;
    if (!preferStored && prev[key] !== undefined) next[key] = Boolean(prev[key]);
    else if (stored[key] !== undefined) next[key] = Boolean(stored[key]);
    else if (prev[key] !== undefined) next[key] = Boolean(prev[key]);
    else next[key] = row.showInChart !== false;
  });
  return next;
}
