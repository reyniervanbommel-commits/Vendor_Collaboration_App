import { useCallback, useMemo, useRef, useState } from 'react';
import { useBulkWriteBackJob } from '../context/BulkWriteBackJobContext';
import { LARGE_BULK_SELECTION, isJobRunning } from './bulkWriteBackJobState';
import { resolveOrderSelectionKey, rowSelectionKey } from './usePurchaseOrderRowSelection';
import { usePurchaseOrderCorrectAllLines } from './usePurchaseOrderCorrectAllLines';
import {
  EMPTY_DIALOG_STATE,
  createBulkErrorMessage,
  findVisibleOrder,
  isHeaderCellUpdate,
  shouldSkipBulkRow,
  startBackgroundCorrectJob,
} from './purchaseOrderBulkEditHelpers';
import { useMixedLineValuesConfirm } from './useMixedLineValuesConfirm';

/**
 * Regelt bulk-bewerken van header-cellen voor zichtbare geselecteerde orderrijen.
 * D365-correcties (header én gepushte line-waarden) gaan naar de achtergrondjob; save blijft blokkerend.
 */
export function usePurchaseOrderBulkEdit({
  visibleHeaderColumns = [],
  visibleOrders = [],
  selection,
  saveValue,
  correctField,
  correctAllLines: correctAllLinesOverride,
  patchLinkedLineValues,
  applyLineValuesBatch,
}) {
  const { onCorrectAllLines } = usePurchaseOrderCorrectAllLines({
    patchLinkedLineValues,
    applyLineValuesBatch,
  });
  const correctAllLines = correctAllLinesOverride || onCorrectAllLines;
  const decisionResolverRef = useRef(null);
  const [dialogState, setDialogState] = useState(EMPTY_DIALOG_STATE);
  const { startCorrectJob, job } = useBulkWriteBackJob();
  const { confirmMixedLineValues, mixedConfirmState, mixedConfirmActions } = useMixedLineValuesConfirm();

  const columnLabelByKey = useMemo(
    () => new Map((Array.isArray(visibleHeaderColumns) ? visibleHeaderColumns : []).map((column) => [column.key, column.label || column.key])),
    [visibleHeaderColumns]
  );

  const selectedVisibleOrders = useMemo(
    () => (Array.isArray(visibleOrders) ? visibleOrders : []).filter(
      (order) => selection?.isSelected?.(resolveOrderSelectionKey(order))
    ),
    [visibleOrders, selection]
  );

  const selectedVisibleKeys = useMemo(
    () => new Set(selectedVisibleOrders.map((order) => resolveOrderSelectionKey(order))),
    [selectedVisibleOrders]
  );

  const runSingleUpdate = useCallback(async (mode, payload) => {
    if (mode === 'correctAll') {
      await correctAllLines?.(payload);
      return;
    }
    if (mode === 'correct') {
      await correctField(payload);
      return;
    }
    await saveValue(payload);
  }, [correctAllLines, correctField, saveValue]);

  const showDecisionDialog = useCallback(({ columnLabel, selectedCount }) => (
    new Promise((resolve) => {
      decisionResolverRef.current = resolve;
      setDialogState({
        ...EMPTY_DIALOG_STATE,
        open: true,
        mode: 'confirm',
        columnLabel,
        selectedCount,
      });
    })
  ), []);

  const closeDialog = useCallback(() => {
    decisionResolverRef.current = null;
    setDialogState(EMPTY_DIALOG_STATE);
  }, []);

  const resolveDialogDecision = useCallback((decision) => {
    const resolver = decisionResolverRef.current;
    if (!resolver) return;
    decisionResolverRef.current = null;
    if (decision === 'bulk') {
      setDialogState((previous) => ({
        ...previous,
        busy: true,
      }));
    } else {
      setDialogState(EMPTY_DIALOG_STATE);
    }
    resolver(decision);
  }, []);

  const openSummaryDialog = useCallback((summaryMessage) => {
    setDialogState((previous) => ({
      ...previous,
      open: true,
      mode: 'summary',
      busy: false,
      summaryMessage,
    }));
  }, []);

  const runBulkUpdate = useCallback(async ({ mode, payload, rows }) => {
    let updated = 0;
    let skipped = 0;
    const total = rows.length;
    for (let index = 0; index < total; index += 1) {
      const row = rows[index];
      if (shouldSkipBulkRow(mode, row, payload)) {
        skipped += 1;
        setDialogState((previous) => ({ ...previous, processedCount: index + 1 }));
        continue;
      }
      const rowPayload = {
        ...payload,
        dataAreaId: row.dataAreaId,
        orderNumber: row.orderNumber,
      };
      if (mode !== 'correctAll') {
        rowPayload.lineNumber = null;
      }
      if (mode === 'correct') {
        rowPayload.basedOnValue = row?.values?.[payload.columnKey];
      }
      try {
        await runSingleUpdate(mode, rowPayload);
        updated += 1;
        setDialogState((previous) => ({ ...previous, processedCount: index + 1 }));
      } catch (err) {
        const notTried = Math.max(0, total - (updated + skipped + 1));
        const summaryMessage = createBulkErrorMessage({ updated, skipped, notTried });
        openSummaryDialog(summaryMessage);
        throw new Error(summaryMessage);
      }
    }
    closeDialog();
  }, [closeDialog, openSummaryDialog, runSingleUpdate]);

  const executeWithBulkOption = useCallback(async (mode, payload) => {
    if (!isHeaderCellUpdate(payload)) {
      await runSingleUpdate(mode, payload);
      return;
    }
    const activeOrderKey = rowSelectionKey(payload.dataAreaId, payload.orderNumber);
    const visibleSelectionCount = selectedVisibleOrders.length;
    const backgroundArgs = {
      startCorrectJob, closeDialog, columnLabelByKey, runSingleUpdate, payload, mode,
    };
    // Header-fan-out: eerst bevestigen als regels afwijkende waarden hebben (nooit twee dialogen tegelijk).
    const startCorrectAll = async (rows) => {
      closeDialog();
      const confirmed = await confirmMixedLineValues({
        rows,
        headerColumnKey: payload.headerColumnKey || payload.columnKey,
        value: payload.value,
      });
      if (!confirmed) return { cancelled: true };
      return startBackgroundCorrectJob({ ...backgroundArgs, rows });
    };
    const activeOrderRows = () => [findVisibleOrder(visibleOrders, payload)];

    if (visibleSelectionCount <= 1 || !selectedVisibleKeys.has(activeOrderKey)) {
      if (mode === 'correctAll') return startCorrectAll(activeOrderRows());
      await runSingleUpdate(mode, payload);
      return undefined;
    }

    const columnKey = payload.columnKey || payload.headerColumnKey;
    const columnLabel = columnLabelByKey.get(columnKey) || columnKey || 'this column';
    const decision = await showDecisionDialog({ columnLabel, selectedCount: visibleSelectionCount });
    if (decision !== 'bulk') {
      if (mode === 'correctAll') return startCorrectAll(activeOrderRows());
      await runSingleUpdate(mode, payload);
      return undefined;
    }
    if (mode === 'correctAll') return startCorrectAll(selectedVisibleOrders);
    if (mode === 'correct') {
      return startBackgroundCorrectJob({ ...backgroundArgs, rows: selectedVisibleOrders });
    }
    await runBulkUpdate({ mode, payload, rows: selectedVisibleOrders });
    return undefined;
  }, [
    closeDialog,
    columnLabelByKey,
    confirmMixedLineValues,
    runBulkUpdate,
    runSingleUpdate,
    selectedVisibleKeys,
    selectedVisibleOrders,
    showDecisionDialog,
    startCorrectJob,
    visibleOrders,
  ]);

  const handleSaveValue = useCallback(
    async (payload) => executeWithBulkOption('save', payload),
    [executeWithBulkOption]
  );
  const handleCorrectField = useCallback(
    async (payload) => executeWithBulkOption('correct', payload),
    [executeWithBulkOption]
  );
  const handleCorrectAllLines = useCallback(
    async (payload) => executeWithBulkOption('correctAll', payload),
    [executeWithBulkOption]
  );
  const handleDialogOpenChange = useCallback((open) => {
    if (open) return;
    if (dialogState.mode === 'confirm') {
      resolveDialogDecision('single');
      return;
    }
    closeDialog();
  }, [closeDialog, dialogState.mode, resolveDialogDecision]);

  const exposedDialogState = useMemo(
    () => ({
      ...dialogState,
      writeBackBusy: isJobRunning(job),
      largeSelection: dialogState.selectedCount >= LARGE_BULK_SELECTION,
    }),
    [dialogState, job],
  );

  return useMemo(() => ({
    handleSaveValue,
    handleCorrectField,
    handleCorrectAllLines,
    dialogState: exposedDialogState,
    mixedConfirm: { state: mixedConfirmState, actions: mixedConfirmActions },
    dialogActions: {
      onOpenChange: handleDialogOpenChange,
      onChooseSingleCell: () => resolveDialogDecision('single'),
      onChooseBulk: () => resolveDialogDecision('bulk'),
      onCloseSummary: closeDialog,
    },
  }), [
    closeDialog,
    exposedDialogState,
    handleCorrectAllLines,
    handleCorrectField,
    handleDialogOpenChange,
    handleSaveValue,
    mixedConfirmActions,
    mixedConfirmState,
    resolveDialogDecision,
  ]);
}
