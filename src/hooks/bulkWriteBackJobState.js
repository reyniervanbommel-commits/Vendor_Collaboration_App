import { rowSelectionKey } from './usePurchaseOrderRowSelection';

export const JOB_RUNNING = 'running';
export const JOB_NEEDS_ATTENTION = 'needsAttention';
export const JOB_SUCCESS = 'success';
export const LARGE_BULK_SELECTION = 25;
export const SUCCESS_HOLD_MS = 5000;

export function countAttentionRows(failedRows) {
  const list = Array.isArray(failedRows) ? failedRows : [];
  const partialCount = list.filter((row) => row?.partial).length;
  return { partialCount, failedCount: list.length - partialCount };
}

export function buildCorrectSummaryMessage({
  updated, skipped, failedCount, partialCount = 0,
}) {
  const partialPart = partialCount > 0 ? ` Partially updated: ${partialCount}.` : '';
  return `Bulk edit finished. Updated: ${updated}.${partialPart} Skipped: ${skipped}. Failed: ${failedCount}.`;
}

export function orderKeysFromCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => (
    rowSelectionKey(candidate.dataAreaId, candidate.orderNumber)
  ));
}

export function jobLockColumnKeys(payload = {}, mode = 'correct') {
  const headerKey = payload.columnKey || payload.headerColumnKey;
  if (mode === 'correctAll' && payload.lineColumnKey && payload.lineColumnKey !== headerKey) {
    return [headerKey, payload.lineColumnKey].filter(Boolean);
  }
  return headerKey ? [headerKey] : [];
}

export function jobCandidateCurrentValue(row, payload = {}, mode = 'correct') {
  if (mode === 'correctAll') {
    const key = payload.headerColumnKey || payload.columnKey;
    const vals = row?.linkedLineValues?.[key];
    if (!Array.isArray(vals) || vals.length !== 1) return undefined;
    return vals[0];
  }
  return row?.values?.[payload.columnKey];
}

function jobMatchesColumn(job, columnKey) {
  const keys = Array.isArray(job.lockColumnKeys) && job.lockColumnKeys.length
    ? job.lockColumnKeys
    : (job.columnKey ? [job.columnKey] : []);
  return keys.includes(columnKey);
}

/**
 * Lock voor één write-back-cel: queued / writing / failed, of null.
 * Alleen de kolom van de lopende job, alleen geselecteerde rijen.
 */
export function cellLockStatus(job, rowKey, columnKey) {
  if (!job || !rowKey || !columnKey) return null;
  if (!jobMatchesColumn(job, columnKey)) return null;
  const rowKeys = job.rowKeys || [];
  if (!rowKeys.includes(rowKey)) return null;
  if ((job.failedRows || []).some((row) => row.key === rowKey)) return 'failed';
  if (job.status === JOB_NEEDS_ATTENTION) return null;
  if ((job.doneKeys || []).includes(rowKey)) return null;
  if (job.currentKey === rowKey) return 'writing';
  if (job.status === JOB_RUNNING) return 'queued';
  return null;
}

export function isJobRunning(job) {
  return job?.status === JOB_RUNNING;
}

export function jobBadgeLabel(job) {
  if (!job) return '';
  if (job.status === JOB_RUNNING) {
    return `Write-back ${job.processed}/${job.total}`;
  }
  if (job.status === JOB_SUCCESS) {
    return 'Write-back complete';
  }
  const attentionCount = job.failedRows?.length || 0;
  if (job.status === JOB_NEEDS_ATTENTION && attentionCount) {
    return attentionCount === 1
      ? 'Write-back: 1 needs attention'
      : `Write-back: ${attentionCount} need attention`;
  }
  return '';
}
