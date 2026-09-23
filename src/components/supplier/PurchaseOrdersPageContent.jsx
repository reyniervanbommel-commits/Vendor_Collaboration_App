import React, { memo, useEffect, useMemo, useRef } from 'react';
import { makeStyles } from '@fluentui/react-components';
import EmptyState from '../shared/EmptyState';
import PurchaseOrdersBoardTable from './PurchaseOrdersBoardTable';
import PurchaseOrdersTableSkeleton from './PurchaseOrdersTableSkeleton';
import PurchaseOrdersActiveRulesFlyout from './PurchaseOrdersActiveRulesFlyout';
import { usePurchaseOrdersActiveRulesFlyout } from './usePurchaseOrdersActiveRulesFlyout';
import { RemarksPanel } from './remarks';
import BoardSplitView from '../bi/BoardSplitView';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants/roles';
import { TrackChangesContext } from './trackChangesContext';
import { LineDetailsContext } from './lineDetailsContext';
import { savePoRccpHandoff } from '../../utils/poVendorFilterHandoff';
import {
  collectOrderNumbers,
  orderNumbersFingerprint,
  orderNumbersIfSubset,
  resolveSharedVendorFromOrders,
} from '../../utils/poVisibleRccpScope';
import { buildTableDataRevision } from '../bi/tableDataRevision';
import { useDataPagesPrefetch } from '../../hooks/useDataPagesPrefetch';

// Vendors mogen alleen terugschrijven naar D365 op kolommen die de admin expliciet als
// vendor-editable heeft aangemerkt (Data model > Editable by vendor). Op alle andere kolommen
// forceren we write-back uit, zodat zowel de inline write-back editor als de D365-sync-indicator
// verdwijnen voor niet-staff.
function disableWriteBack(columns) {
  if (!Array.isArray(columns)) return columns;
  return columns.map((c) => (
    c && c.writableToD365 && !c.vendorEditable ? { ...c, writableToD365: false } : c
  ));
}

// Stabiele referentie zodat de "All orders"-override geen onnodige re-renders triggert.
const EMPTY_FORMAT_RULES = Object.freeze({});

const useStyles = makeStyles({
  contentInset: {
    paddingLeft: '24px',
    paddingRight: '24px',
  },
  tableRegion: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    overflow: 'hidden',
    '& > *': {
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      overflow: 'hidden',
      scrollbarGutter: 'stable',
    },
  },
});

function PurchaseOrdersPageContent({ status, tableContext }) {
  const styles = useStyles();
  const { user } = useAuth();
  const isStaff = user?.role === ROLES.ADMIN || user?.role === ROLES.EMPLOYEE;
  const isSupplier = user?.role === ROLES.SUPPLIER;
  const { pageModel, boardView, bulkEdit } = tableContext;
  const trackChangesMeta = pageModel.trackChangesMeta || null;
  const orderNumbersCacheRef = useRef({ fingerprint: '', orderNumbers: [] });
  const visibleOrderNumbers = useMemo(
    () => {
      const orderNumbers = collectOrderNumbers(boardView.processedItems);
      const fingerprint = orderNumbersFingerprint(orderNumbers);
      if (orderNumbersCacheRef.current.fingerprint !== fingerprint) {
        orderNumbersCacheRef.current = { fingerprint, orderNumbers };
      }
      return orderNumbersCacheRef.current.orderNumbers;
    },
    [boardView.processedItems],
  );
  const rccpOrderNumbers = useMemo(
    () => orderNumbersIfSubset(visibleOrderNumbers, pageModel.orders),
    [visibleOrderNumbers, pageModel.orders],
  );
  const derivedVendor = useMemo(
    () => resolveSharedVendorFromOrders(boardView.processedItems, { vendors: [], vendorNames: {} }),
    [boardView.processedItems],
  );

  // Geeft het actieve vendor-filter door aan de RCCP-pagina, zodat die bij openen
  // dezelfde vendor toont in plaats van standaard de eerste vendor uit de lijst.
  useEffect(() => {
    savePoRccpHandoff({ filterByColumn: boardView.filterByColumn, derivedVendor });
  }, [boardView.filterByColumn, derivedVendor]);

  // Zelfde fingerprint als BoardSplitView's `dataRevision` — zo hergebruikt de KPI-tab
  // (PoBoardKpiStrip) de idle-geprefetchte `getPoBoardKpis`-cache in plaats van een tweede call.
  const dataRevision = useMemo(() => buildTableDataRevision(pageModel.orders), [pageModel.orders]);
  useDataPagesPrefetch({ enabled: !status.loading, refreshKey: dataRevision, isSupplier });

  // Track-changes worden centraal in Settings beheerd; hier alleen de header-indicator.
  const trackChangesActiveByColumnId = useMemo(
    () => trackChangesMeta?.activeOffsetByColumnId || null,
    [trackChangesMeta],
  );
  const data = useMemo(() => ({
    items: pageModel.orders,
    columns: isStaff ? pageModel.visibleHeaderColumns : disableWriteBack(pageModel.visibleHeaderColumns),
    lineColumns: isStaff ? pageModel.lineColumns : disableWriteBack(pageModel.lineColumns),
    boardView,
  }), [
    boardView,
    isStaff,
    pageModel.lineColumns,
    pageModel.orders,
    pageModel.visibleHeaderColumns,
  ]);
  const layout = useMemo(() => ({
    headerColumnWidths: pageModel.headerColumnWidths,
    lineColumnWidths: pageModel.lineColumnWidths,
    stickyColumns: tableContext.stickyColumns,
    collapsedHeaderColumnKeys: pageModel.collapsedHeaderColumnKeys,
    collapsedLineColumnKeys: pageModel.collapsedLineColumnKeys,
  }), [
    pageModel.collapsedHeaderColumnKeys,
    pageModel.collapsedLineColumnKeys,
    pageModel.headerColumnWidths,
    pageModel.lineColumnWidths,
    tableContext.stickyColumns,
  ]);
  // "All orders" (geen actieve saved view, activeViewId === null) is een neutrale weergave:
  // conditional formatting is een board-brede instelling en mag hier niet doorschemeren.
  // Dit is puur een render-override — de onderliggende state in usePurchaseOrdersPage blijft
  // intact, dus de opgeslagen view waar de regel bij hoort raakt de formatting niet kwijt.
  const isAllOrdersView = tableContext.activeViewId == null;
  const formatting = useMemo(() => ({
    headerColumnWidths: pageModel.headerColumnWidths,
    lineColumnWidths: pageModel.lineColumnWidths,
    headerColumnTextStyles: pageModel.headerColumnTextStyles,
    headerColumnFormatRules: isAllOrdersView ? EMPTY_FORMAT_RULES : pageModel.headerColumnFormatRules,
    lineColumnTextStyles: pageModel.lineColumnTextStyles,
    lineColumnFormatRules: isAllOrdersView ? EMPTY_FORMAT_RULES : pageModel.lineColumnFormatRules,
  }), [
    isAllOrdersView,
    pageModel.headerColumnFormatRules,
    pageModel.headerColumnTextStyles,
    pageModel.headerColumnWidths,
    pageModel.lineColumnFormatRules,
    pageModel.lineColumnTextStyles,
    pageModel.lineColumnWidths,
  ]);
  const { activeRulesControls, flyoutProps } = usePurchaseOrdersActiveRulesFlyout({
    isStaff,
    headerColumns: data.columns,
    lineColumns: data.lineColumns,
    orders: pageModel.orders,
    boardView,
    pageModel,
    datePeriodDisplayModes: tableContext.datePeriodDisplayModes,
    headerColumnFormatRules: formatting.headerColumnFormatRules,
    lineColumnFormatRules: formatting.lineColumnFormatRules,
  });
  const cellActions = useMemo(() => ({
    onSaveValue: bulkEdit.handleSaveValue,
    // Write-back naar D365 door vendors wordt hierna alsnog per kolom geblokkeerd: de cel toont
    // de write-back-editor alleen als column.writableToD365 true is, en disableWriteBack() zet
    // dat voor vendors uit tenzij de admin de kolom vendor-editable heeft gemaakt. De server
    // herhaalt deze check (column.vendorEditable) als laatste laag.
    onCorrect: isStaff || isSupplier ? bulkEdit.handleCorrectField : undefined,
    onCorrectAllLines: isStaff || isSupplier ? bulkEdit.handleCorrectAllLines : undefined,
    onUpdateStatusOptions: pageModel.updateStatusOptions,
    isAdmin: tableContext.isAdmin,
    isStaff: tableContext.isStaff,
    showHistoryIndicators: tableContext.showHistoryIndicators !== false,
  }), [
    bulkEdit.handleCorrectAllLines,
    bulkEdit.handleCorrectField,
    bulkEdit.handleSaveValue,
    isStaff,
    pageModel.updateStatusOptions,
    tableContext.isAdmin,
    tableContext.isStaff,
    tableContext.showHistoryIndicators,
  ]);
  const columnActions = useMemo(() => ({
    onRenameColumn: pageModel.renameColumn,
    onRemoveColumn: pageModel.removeColumn,
    isAdmin: tableContext.isAdmin,
    isStaff: tableContext.isStaff,
    onToggleWriteback: pageModel.toggleWriteback,
    onReorderHeaderColumn: pageModel.reorderHeaderColumn,
    onReorderLineColumn: pageModel.reorderLineColumn,
    onSaveHeaderColumnWidth: pageModel.saveHeaderColumnWidth,
    onSaveLineColumnWidth: pageModel.saveLineColumnWidth,
    onSaveHeaderColumnTextStyle: pageModel.saveHeaderColumnTextStyle,
    onSaveHeaderColumnFormatRules: pageModel.saveHeaderColumnFormatRules,
    onSaveLineColumnTextStyle: pageModel.saveLineColumnTextStyle,
    onSaveLineColumnFormatRules: pageModel.saveLineColumnFormatRules,
    onAddColumnRightOf: tableContext.handleAddColumnRightOf,
    datePeriodDisplayModes: tableContext.datePeriodDisplayModes,
    onSetDatePeriodDisplayMode: tableContext.setDatePeriodDisplayMode,
    editingColumnKey: tableContext.editingColumnKey,
    onEditingDone: tableContext.handleEditingDone,
    reorderingColumns: pageModel.savingColumns,
    trackChangesActiveByColumnId,
    onToggleHeaderColumnCollapsed: pageModel.toggleHeaderColumnCollapsed,
    onToggleLineColumnCollapsed: pageModel.toggleLineColumnCollapsed,
    productImageColumnVisible: pageModel.productImageColumnVisible,
    onToggleProductImageColumn: pageModel.setProductImageColumnVisible,
  }), [
    pageModel,
    tableContext.editingColumnKey,
    tableContext.handleAddColumnRightOf,
    tableContext.datePeriodDisplayModes,
    tableContext.setDatePeriodDisplayMode,
    tableContext.handleEditingDone,
    tableContext.isAdmin,
    tableContext.isStaff,
    trackChangesActiveByColumnId,
  ]);
  const linkActions = useMemo(() => ({
    onSetLineColumnTotal: pageModel.setLineColumnTotal,
    onPushLineTotalToHeader: tableContext.handlePushLineTotalToHeader,
    onPushLineValuesToHeader: tableContext.handlePushLineValuesToHeader,
    lineTotalColumns: pageModel.lineTotalColumns,
    lineTotalHeaderLinks: pageModel.lineTotalHeaderLinks,
    lineValueHeaderLinks: pageModel.lineValueHeaderLinks,
  }), [
    pageModel,
    tableContext.handlePushLineTotalToHeader,
    tableContext.handlePushLineValuesToHeader,
  ]);
  const table = useMemo(() => ({
    data,
    layout,
    formatting,
    cellActions,
    columnActions,
    linkActions,
    selection: tableContext.tableSelection,
    remarks: tableContext.remarks.tableState,
    activeRulesControls,
  }), [
    activeRulesControls,
    cellActions,
    columnActions,
    data,
    formatting,
    layout,
    linkActions,
    tableContext.remarks.tableState,
    tableContext.tableSelection,
  ]);

  if (status.loading) {
    return <PurchaseOrdersTableSkeleton label="Loading purchase orders from SQL cache" />;
  }
  if (status.refreshing && status.orderCount === 0) {
    return <PurchaseOrdersTableSkeleton label="Loading purchase orders from D365" />;
  }
  if (status.orderCount === 0) {
    return (
      <div className={styles.contentInset}>
        <EmptyState
          title="No purchase orders found"
          description="Refresh the data or check the D365 synchronization."
        />
      </div>
    );
  }

  return (
    <>
      <BoardSplitView
        filterByColumn={boardView.filterByColumn}
        tableRows={pageModel.orders}
        visibleOrders={boardView.kpiSourceItems}
        kpiFilterKey={boardView.kpiFilterKey}
        onKpiFilter={boardView.applyKpiFilter}
        tableFilter={{
          columns: pageModel.visibleHeaderColumns,
          lineValueLinks: pageModel.lineValueHeaderLinks,
          applyColumnFilter: boardView.applyColumnFilter,
          clearColumnFilter: boardView.clearColumnFilter,
        }}
        isStaff={isStaff}
        orderNumbers={rccpOrderNumbers}
        derivedVendor={derivedVendor}
      >
        <div className={styles.tableRegion}>
          <TrackChangesContext.Provider value={trackChangesMeta}>
            <LineDetailsContext.Provider value={pageModel.lineDetails}>
              <PurchaseOrdersBoardTable {...table} />
            </LineDetailsContext.Provider>
          </TrackChangesContext.Provider>
        </div>
      </BoardSplitView>
      {flyoutProps ? <PurchaseOrdersActiveRulesFlyout {...flyoutProps} /> : null}
      <RemarksPanel {...tableContext.remarks.panelProps} />
    </>
  );
}

export default memo(PurchaseOrdersPageContent);
