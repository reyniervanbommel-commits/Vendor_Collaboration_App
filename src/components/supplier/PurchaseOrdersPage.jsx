import React, { useCallback, useMemo, useRef, useState } from 'react';
import PurchaseOrdersPageLayout from './PurchaseOrdersPageLayout';
import { usePurchaseOrderRemarksBoard } from './remarks';
import { usePurchaseOrdersPage } from '../../hooks/usePurchaseOrdersPage';
import { usePurchaseOrderBoardView } from '../../hooks/usePurchaseOrderBoardView';
import { usePurchaseOrderRefreshProgress } from '../../hooks/usePurchaseOrderRefreshProgress';
import { usePurchaseOrderSavedViewState } from '../../hooks/usePurchaseOrderSavedViewState';
import { usePurchaseOrdersSelection } from '../../hooks/usePurchaseOrdersSelection';
import { usePurchaseOrderHiddenRows } from '../../hooks/usePurchaseOrderHiddenRows';
import { usePurchaseOrdersHeaderLinkActions } from '../../hooks/usePurchaseOrdersHeaderLinkActions';
import { usePurchaseOrderBulkEdit } from '../../hooks/usePurchaseOrderBulkEdit';
import { usePurchaseOrderFormulaDialogState } from '../../hooks/usePurchaseOrderFormulaDialogState';
import { usePurchaseOrderDatePeriodDialogState } from '../../hooks/usePurchaseOrderDatePeriodDialogState';
import { useAuth } from '../../context/AuthContext';
import { formatSyncedAt } from '../../utils/purchaseOrderFormat';
import { exportPurchaseOrdersToExcel, buildExportFileName } from '../../utils/purchaseOrderBoardExport';

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const pageModel = usePurchaseOrdersPage();
  const {
    orders,
    visibleHeaderColumns,
    lineColumns,
    syncedAt,
    hasCache,
    total,
    loading,
    refreshing,
    error,
    refresh,
    finishRefresh,
    setRefreshError,
    reloadAfterRefresh,
    reload,
    deleteRows,
    saveValue,
    addHeaderColumnAfter,
    updateFormulaColumn,
    renameColumn,
    newCount,
    changedCount,
    markViewed,
    markingViewed,
    correctField,
    headerColumnFormatRules,
    lineTotalColumns,
    lineTotalHeaderLinks,
    lineValueHeaderLinks,
    saveHeaderColumnFormatRules,
    setLineColumnTotal,
    addLineTotalHeaderLink,
    addLineValueHeaderLink,
    exportColumnLayout,
    applyColumnLayout,
    datePeriodDisplayModes,
    setDatePeriodDisplayMode,
  } = pageModel;
  const isAdmin = user?.role === 'admin';
  const onAttachedRunFinishedRef = useRef(null);
  const { running: progressRunning, startProgress, finishProgress, waitForCompletion } = usePurchaseOrderRefreshProgress({ enabled: isAdmin, onAttachedRunFinishedRef });
  const isStaff = user?.role === 'admin' || user?.role === 'employee';
  const isSupplier = user?.role === 'supplier';
  const boardView = usePurchaseOrderBoardView({
    items: orders,
    columns: visibleHeaderColumns,
    lineColumns,
    lineTotalHeaderLinks,
    lineValueHeaderLinks,
    datePeriodDisplayModes,
    columnFormatRules: headerColumnFormatRules,
  });
  const remarks = usePurchaseOrderRemarksBoard({
    enabled: !loading,
    currentUser: user,
    columns: visibleHeaderColumns,
    // Suppliers mogen comments plaatsen op hun eigen orders (scope server-side afgedwongen).
    canCompose: isStaff || isSupplier,
  });
  const { selection, tableSelection, handleDeleteSelected } = usePurchaseOrdersSelection({ orders, visibleOrders: boardView.processedItems, deleteRows });
  const hiddenRows = usePurchaseOrderHiddenRows({ onRestored: reload, enabled: isStaff });
  onAttachedRunFinishedRef.current = () => {
    reloadAfterRefresh();
    hiddenRows.reload();
  };
  const { savedViews, activeViewId, hasUnsavedChanges, getUnsavedViewDiff, applyViewState, handleResetView, handleSaveAsNew, handleUpdateActive, handleRenameView, handleSetDefault, handleDeleteView, handleToggleShowHistory, showHistoryIndicators, allOrdersShowHistoryIndicators, stickyColumnKeys, setStickyColumnKeys, viewTabs, clearActiveViewFilterSession } = usePurchaseOrderSavedViewState({
    orders,
    loading,
    exportColumnLayout,
    applyColumnLayout,
    boardView,
    isSupplier,
    columns: visibleHeaderColumns,
    datePeriodDisplayModes,
  });
  // Een kolomfilter wissen (los van "Reset view") moet de niet-opgeslagen sessie-snapshot
  // meteen meewissen — anders komt de gewiste filter terug bij een snelle view/tab-switch
  // (sessionStorage-overlay in usePurchaseOrderTableSession, #PO-filter-sticky).
  const clearColumnFilterAndSession = useCallback((columnKey) => {
    boardView.clearColumnFilter(columnKey);
    clearActiveViewFilterSession();
  }, [boardView, clearActiveViewFilterSession]);
  const clearAllFiltersAndSession = useCallback(() => {
    boardView.clearAllFilters();
    clearActiveViewFilterSession();
  }, [boardView, clearActiveViewFilterSession]);
  const boardViewForContent = useMemo(() => ({
    ...boardView,
    clearColumnFilter: clearColumnFilterAndSession,
    clearAllFilters: clearAllFiltersAndSession,
  }), [boardView, clearColumnFilterAndSession, clearAllFiltersAndSession]);
  const [editingColumnKey, setEditingColumnKey] = useState('');
  const handleEditingDone = useCallback(() => setEditingColumnKey(''), []);
  const {
    formulaDialogState,
    closeFormulaDialog,
    handleFormulaTypeSelection,
    formulaReferenceColumns,
    submitFormulaColumn,
  } = usePurchaseOrderFormulaDialogState({
    visibleHeaderColumns,
    addHeaderColumnAfter,
    updateFormulaColumn,
    renameColumn,
    headerColumnFormatRules,
    saveHeaderColumnFormatRules,
    setEditingColumnKey,
  });
  const {
    datePeriodDialogState,
    closeDatePeriodDialog,
    handleDatePeriodTypeSelection,
    dateSourceColumns,
    submitDatePeriodColumn,
  } = usePurchaseOrderDatePeriodDialogState({
    availableColumns: visibleHeaderColumns,
    lineColumns,
    lineValueHeaderLinks,
    addHeaderColumnAfter,
    setEditingColumnKey,
    setDatePeriodDisplayMode,
  });
  const bulkEdit = usePurchaseOrderBulkEdit({ visibleHeaderColumns, visibleOrders: boardView.processedItems, selection, saveValue, correctField, patchLinkedLineValues: pageModel.patchLinkedLineValues, applyLineValuesBatch: pageModel.lineDetails?.applyLineValuesBatch });

  const handleAddColumnRightOf = useCallback(async (sourceColumn, typeDef) => {
    if (handleFormulaTypeSelection(sourceColumn, typeDef)) {
      return;
    }
    if (handleDatePeriodTypeSelection(sourceColumn, typeDef)) {
      return;
    }
    const created = await addHeaderColumnAfter(sourceColumn.key, {
      label: typeDef.label,
      dataType: typeDef.dataType,
      options: typeDef.options,
    });
    if (created?.key && typeDef.dataType !== 'remarks') setEditingColumnKey(created.key);
  }, [addHeaderColumnAfter, handleFormulaTypeSelection, handleDatePeriodTypeSelection]);

  const { handlePushLineTotalToHeader, handlePushLineValuesToHeader } = usePurchaseOrdersHeaderLinkActions({
    lineTotalHeaderLinks,
    lineValueHeaderLinks,
    visibleHeaderColumns,
    lineTotalColumns,
    addHeaderColumnAfter,
    addLineTotalHeaderLink,
    addLineValueHeaderLink,
    setLineColumnTotal,
    setEditingColumnKey, reload,
  });

  const handleRefresh = useCallback(async () => {
    startProgress();
    try {
      const started = await refresh();
      if (!started) return;
      const finalProgress = await waitForCompletion();
      if (String(finalProgress?.status || '').toLowerCase() === 'error') {
        setRefreshError(finalProgress?.error || 'D365 refresh failed');
        return;
      }
      await reloadAfterRefresh();
      await hiddenRows.reload();
    } catch (err) {
      setRefreshError(err?.message || 'D365 refresh failed');
    } finally {
      await finishProgress();
      finishRefresh();
    }
  }, [finishProgress, finishRefresh, hiddenRows, refresh, reloadAfterRefresh, setRefreshError, startProgress, waitForCompletion]);
  const handleExportExcel = useCallback((scope) => {
    const rows = scope === 'view' ? boardView.processedItems : boardView.allItems;
    exportPurchaseOrdersToExcel({
      orders: rows,
      columns: visibleHeaderColumns,
      fileName: buildExportFileName(scope),
    });
  }, [boardView.processedItems, boardView.allItems, visibleHeaderColumns]);

  const lastRefreshedLabel = formatSyncedAt(syncedAt);
  const isRefreshing = refreshing || progressRunning;
  const contentStatus = useMemo(
    () => ({ loading, refreshing: isRefreshing, orderCount: orders.length }),
    [loading, orders.length, isRefreshing]
  );
  const tableContext = useMemo(() => ({
    pageModel,
    boardView: boardViewForContent,
    bulkEdit,
    // "All orders" (geen actieve saved view) toont bewust geen conditional formatting —
    // die instelling is board-breed en zou anders uit een andere view blijven doorschemeren.
    activeViewId,
    isAdmin,
    isStaff,
    handleAddColumnRightOf,
    datePeriodDisplayModes,
    setDatePeriodDisplayMode,
    handlePushLineTotalToHeader,
    handlePushLineValuesToHeader,
    editingColumnKey,
    handleEditingDone,
    tableSelection,
    remarks,
    stickyColumns: { keys: stickyColumnKeys, onChange: setStickyColumnKeys },
    showHistoryIndicators,
  }), [
    activeViewId,
    boardViewForContent,
    bulkEdit,
    editingColumnKey,
    handleAddColumnRightOf,
    handleEditingDone,
    handlePushLineTotalToHeader,
    handlePushLineValuesToHeader,
    datePeriodDisplayModes,
    setDatePeriodDisplayMode,
    isAdmin,
    isStaff,
    pageModel,
    remarks,
    setStickyColumnKeys,
    showHistoryIndicators,
    stickyColumnKeys,
    tableSelection,
  ]);
  return (
    <PurchaseOrdersPageLayout
      viewTabs={viewTabs}
      columns={visibleHeaderColumns}
      isStaff={isStaff}
      activeViewId={activeViewId}
      savedViewsState={{
        savedViews,
        activeViewId,
        hasUnsavedChanges,
        getUnsavedViewDiff,
        applyViewState,
        handleResetView,
        handleSaveAsNew,
        handleUpdateActive,
        handleRenameView,
        handleSetDefault,
        handleDeleteView,
        handleToggleShowHistory,
        allOrdersShowHistoryIndicators,
        viewTabs,
      }}
      headerState={{
        isStaff,
        hasCache,
        lastRefreshedLabel,
        visibleCount: boardView.processedItems.length,
        total,
      }}
      activityState={{
        newCount: boardView.activityCounts?.newCount ?? newCount,
        changedCount: boardView.activityCounts?.changedCount ?? changedCount,
        removedCount: boardView.activityCounts?.removedCount ?? 0,
        markViewed,
        markingViewed,
        activityFilter: boardView.activityFilter,
        toggleActivityFilter: boardView.toggleActivityFilter,
      }}
      bulkState={{
        selectedCount: selection.selectedCount,
        onDeleteSelected: handleDeleteSelected,
        onClearSelection: selection.clear,
      }}
      hiddenRowsState={{
        hiddenRows: hiddenRows.hiddenRows,
        columns: hiddenRows.columns,
        count: hiddenRows.count,
        loading: hiddenRows.loading,
        restoring: hiddenRows.restoring,
        restoreRows: hiddenRows.restoreRows,
      }}
      refreshState={{
        refreshing: isRefreshing,
        onRefresh: handleRefresh,
      }}
      onExportExcel={handleExportExcel}
      error={error}
      contentStatus={contentStatus}
      tableContext={tableContext}
      dialogs={{
        formula: { state: formulaDialogState, close: closeFormulaDialog, submit: submitFormulaColumn, availableColumns: formulaReferenceColumns, formatRules: headerColumnFormatRules },
        datePeriod: { state: datePeriodDialogState, close: closeDatePeriodDialog, submit: submitDatePeriodColumn, dateSourceColumns },
        bulkEdit,
      }}
    />
  );
}
