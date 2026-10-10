import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAppToast } from '../hooks/useAppToast';
import { runCorrectRows } from '../hooks/purchaseOrderBulkEditRun';
import { usePurchaseOrderBulkEditRetry } from '../hooks/usePurchaseOrderBulkEditRetry';
import {
  JOB_NEEDS_ATTENTION,
  JOB_RUNNING,
  JOB_SUCCESS,
  SUCCESS_HOLD_MS,
  buildCorrectSummaryMessage,
  countAttentionRows,
  isJobRunning,
  jobCandidateCurrentValue,
  jobLockColumnKeys,
  orderKeysFromCandidates,
} from '../hooks/bulkWriteBackJobState';

const BulkWriteBackJobContext = createContext(null);

export function useBulkWriteBackJobOptional() {
  return useContext(BulkWriteBackJobContext);
}

export function useBulkWriteBackJob() {
  const ctx = useContext(BulkWriteBackJobContext);
  if (!ctx) throw new Error('useBulkWriteBackJob must be used within BulkWriteBackJobProvider');
  return ctx;
}

function applyJobUpdate(setJob, jobRef, updater) {
  setJob((prev) => {
    const next = updater(prev);
    jobRef.current = next;
    return next;
  });
}

/**
 * Houdt max. één D365 bulk-write-back-job in de app-shell (overleeft page-unmount).
 * Input: children. Output: startCorrectJob, job-state, retry, panel-acties.
 */
export function BulkWriteBackJobProvider({ children }) {
  const { notifyError } = useAppToast();
  const [job, setJob] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const jobRef = useRef(null);
  const runSingleUpdateRef = useRef(null);
  const generationRef = useRef(0);
  const successTimerRef = useRef(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const showSuccess = useCallback((baseJob, summaryMessage) => {
    const next = {
      ...baseJob,
      status: JOB_SUCCESS,
      currentKey: null,
      failedRows: [],
      summaryMessage,
    };
    jobRef.current = next;
    setJob(next);
    setPanelOpen(false);
    clearSuccessTimer();
    successTimerRef.current = window.setTimeout(() => {
      if (jobRef.current?.status === JOB_SUCCESS) {
        jobRef.current = null;
        setJob(null);
      }
      successTimerRef.current = null;
    }, SUCCESS_HOLD_MS);
  }, [clearSuccessTimer]);

  const startCorrectJob = useCallback(({ payload, rows, columnLabel, runSingleUpdate, mode = 'correct' }) => {
    if (isJobRunning(jobRef.current)) {
      notifyError('A write-back is already running. Wait until it finishes.');
      return false;
    }
    clearSuccessTimer();
    runSingleUpdateRef.current = runSingleUpdate;
    const candidates = (Array.isArray(rows) ? rows : []).map((row) => ({
      dataAreaId: row.dataAreaId,
      orderNumber: row.orderNumber,
      currentValue: jobCandidateCurrentValue(row, payload, mode),
    }));
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const nextJob = {
      status: JOB_RUNNING,
      columnKey: payload.columnKey || payload.headerColumnKey,
      lockColumnKeys: jobLockColumnKeys(payload, mode),
      columnLabel: columnLabel || payload.columnKey,
      payload,
      mode,
      rowKeys: orderKeysFromCandidates(candidates),
      currentKey: null,
      processed: 0,
      total: candidates.length,
      updated: 0,
      skipped: 0,
      failedRows: [],
      doneKeys: [],
      summaryMessage: '',
    };
    jobRef.current = nextJob;
    setJob(nextJob);

    void (async () => {
      const result = await runCorrectRows({
        candidates,
        payload,
        mode,
        runSingleUpdate: (...args) => runSingleUpdateRef.current?.(...args),
        onRowStart: (key) => {
          if (generationRef.current !== generation) return;
          applyJobUpdate(setJob, jobRef, (prev) => (prev ? { ...prev, currentKey: key } : prev));
        },
        onSettled: ({ key, outcome, failedRow }) => {
          if (generationRef.current !== generation) return;
          applyJobUpdate(setJob, jobRef, (prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              currentKey: null,
              processed: prev.processed + 1,
              updated: prev.updated + (outcome === 'updated' ? 1 : 0),
              skipped: prev.skipped + (outcome === 'skipped' ? 1 : 0),
              doneKeys: outcome === 'failed' || outcome === 'partial' ? prev.doneKeys : [...prev.doneKeys, key],
              failedRows: failedRow ? [...prev.failedRows, failedRow] : prev.failedRows,
            };
          });
        },
      });
      if (generationRef.current !== generation) return;
      const { updated, skipped, failedRows } = result;
      const summaryMessage = buildCorrectSummaryMessage({
        updated,
        skipped,
        ...countAttentionRows(failedRows),
      });
      if (failedRows.length === 0) {
        showSuccess(jobRef.current || { updated, skipped }, summaryMessage);
        return;
      }
      applyJobUpdate(setJob, jobRef, (prev) => (prev ? {
        ...prev,
        status: JOB_NEEDS_ATTENTION,
        currentKey: null,
        failedRows,
        updated,
        skipped,
        summaryMessage,
      } : prev));
    })();
    return true;
  }, [clearSuccessTimer, notifyError, showSuccess]);

  const handleFailedRowsChange = useCallback((updateFailedRows) => {
    const prev = jobRef.current;
    if (!prev) return;
    const failedRows = updateFailedRows(prev.failedRows || []);
    if (!failedRows.length) {
      showSuccess(prev, buildCorrectSummaryMessage({
        updated: prev.updated,
        skipped: prev.skipped,
        ...countAttentionRows([]),
      }));
      return;
    }
    applyJobUpdate(setJob, jobRef, (current) => {
      if (!current) return current;
      return {
        ...current,
        failedRows,
        summaryMessage: buildCorrectSummaryMessage({
          updated: current.updated,
          skipped: current.skipped,
          ...countAttentionRows(failedRows),
        }),
      };
    });
  }, [showSuccess]);

  const runSingleUpdate = useCallback(
    (...args) => runSingleUpdateRef.current?.(...args),
    [],
  );

  const retry = usePurchaseOrderBulkEditRetry({
    failedRows: job?.failedRows || [],
    onFailedRowsChange: handleFailedRowsChange,
    runSingleUpdate,
  });

  const wrapRetry = useCallback(async (run) => {
    applyJobUpdate(setJob, jobRef, (prev) => (
      prev ? { ...prev, status: JOB_RUNNING } : prev
    ));
    try {
      await run();
    } finally {
      applyJobUpdate(setJob, jobRef, (prev) => {
        if (!prev) return null;
        if (prev.status === JOB_SUCCESS) return prev;
        if (!(prev.failedRows || []).length) return prev;
        return { ...prev, status: JOB_NEEDS_ATTENTION, currentKey: null };
      });
    }
  }, []);

  const retryRow = useCallback(
    (key) => wrapRetry(() => retry.retryRow(key)),
    [retry.retryRow, wrapRetry],
  );
  const retryAllFailed = useCallback(
    () => wrapRetry(() => retry.retryAllFailed()),
    [retry.retryAllFailed, wrapRetry],
  );

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const dismissJob = useCallback(() => {
    if (isJobRunning(jobRef.current)) return;
    generationRef.current += 1;
    clearSuccessTimer();
    jobRef.current = null;
    setJob(null);
    setPanelOpen(false);
  }, [clearSuccessTimer]);

  useEffect(() => () => clearSuccessTimer(), [clearSuccessTimer]);

  useEffect(() => {
    if (!isJobRunning(job)) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [job]);

  const value = useMemo(() => ({
    job,
    panelOpen,
    retryingBulk: retry.retryingBulk,
    startCorrectJob,
    retryRow,
    retryAllFailed,
    openPanel,
    closePanel,
    dismissJob,
  }), [
    closePanel,
    dismissJob,
    job,
    openPanel,
    panelOpen,
    retry.retryingBulk,
    retryAllFailed,
    retryRow,
    startCorrectJob,
  ]);

  return (
    <BulkWriteBackJobContext.Provider value={value}>
      {children}
    </BulkWriteBackJobContext.Provider>
  );
}
