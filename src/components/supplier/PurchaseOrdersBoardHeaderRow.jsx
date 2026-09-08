import React, { useRef } from 'react';
import PurchaseOrderColumnHeader from './PurchaseOrderColumnHeader';
import PurchaseOrderColumnFilterMenu from './PurchaseOrderColumnFilterMenu';
import PurchaseOrdersBoardHeaderHoverLayer from './PurchaseOrdersBoardHeaderHoverLayer';
import PurchaseOrderProductImageColumnHeader from './PurchaseOrderProductImageColumnHeader';
import PurchaseOrderProductImageColumnMenu from './PurchaseOrderProductImageColumnMenu';
import PurchaseOrdersTableControls from './PurchaseOrdersTableControls';
import ResizableTableHeaderCell from './ResizableTableHeaderCell';
import { PurchaseOrderCollapsedColumnHeaderCell } from './PurchaseOrderCollapsedColumnCell';
import { isColumnFilterActive, isColumnFormatRuleSetActive } from './purchaseOrderColumnFilterMenuConstants';
import { getPoHeaderConnectionTargets } from './poHeaderHoverModel';
import { isProductImageColumn, PRODUCT_IMAGE_MIN_COLUMN_WIDTH } from '../../utils/purchaseOrderProductImageColumn';
import { isColumnCollapsed } from '../../utils/collapsedColumnUtils';
import { buildColumnSumToggles } from './PurchaseOrderColumnSumToggles';
import { getPoTableZoom } from '../../utils/poTableZoom';

export default function PurchaseOrdersBoardHeaderRow({
  styles,
  selection,
  onSetExpansion,
  productImageColumnVisible = true,
  onToggleProductImageColumn,
  columns,
  headerColumnDrag,
  headerColumnWidths,
  onSaveHeaderColumnWidth,
  onRenameColumn,
  onRemoveColumn,
  isAdmin,
  isStaff = true,
  onToggleWriteback,
  trackChangesActiveByColumnId = null,
  editingColumnKey,
  onEditingDone,
  linkedLineTotalByHeaderKey,
  linkedLineValueByHeaderKey,
  lineColumns = [],
  filterByColumn,
  sortState,
  groupingColumnKey,
  groupingColorsByColumn = {},
  groupSummaryColumnKeys = [],
  setSortDirection,
  setFilterOperator,
  setFilterValue,
  setFilterSecondaryValue,
  applyColumnFilter,
  clearColumnFilter,
  setColumnColorFilter,
  setGroupingColumn,
  clearGrouping,
  setGroupingBarColor,
  setGroupSummaryColumn,
  columnSums,
  onAddColumnRightOf,
  datePeriodDisplayModes = {},
  onSetDatePeriodDisplayMode,
  headerColumnTextStyles,
  onSaveHeaderColumnTextStyle,
  headerColumnFormatRules = {},
  onSaveHeaderColumnFormatRules,
  referenceColumns = [],
  stickyColumnKeys = [],
  firstNonStickyColumnKey = '',
  onMakeColumnSticky,
  collapsedColumnKeys = [],
  onToggleColumnCollapsed,
  items = [],
  activeRulesControls,
}) {
  const headerRowRef = useRef(null);

  return (
    <>
    <tr ref={headerRowRef}>
      <PurchaseOrdersTableControls
        onSetExpansion={onSetExpansion}
        productImageColumnVisible={productImageColumnVisible}
        onToggleProductImageColumn={onToggleProductImageColumn}
        selectionEnabled={Boolean(selection?.enabled)}
        allSelected={Boolean(selection?.allSelected)}
        someSelected={Boolean(selection?.someSelected)}
        onToggleAll={selection?.onToggleAll}
        hasActive={activeRulesControls?.hasActive}
        onOpenFlyout={activeRulesControls?.onOpenFlyout}
      />
      {columns.map((column) => {
        const isSystemColumn = isProductImageColumn(column);
        const hasActiveFilter = isColumnFilterActive(column, filterByColumn[column.key]);
        const hasActiveConditionalFormatting = isColumnFormatRuleSetActive(headerColumnFormatRules[column.key]);
        const connectionTargets = getPoHeaderConnectionTargets({
          columnKey: column.key,
          linkedLineTotalByHeaderKey,
          linkedLineValueByHeaderKey,
          lineColumns,
        });
        const stickyLeft = Number(column?.stickyLeft);
        const isStickyColumn = Number.isFinite(stickyLeft);
        const canPromoteToSticky = column.key === firstNonStickyColumnKey;
        const isRightMostStickyColumn = isStickyColumn && column.key === stickyColumnKeys[stickyColumnKeys.length - 1];
        const canToggleStickyAction = canPromoteToSticky || isRightMostStickyColumn;
        const stickyHeaderStyle = isStickyColumn
          ? {
            left: `${stickyLeft}px`,
            zIndex: 3,
          }
          : undefined;
        const isCollapsed = isColumnCollapsed(column.key, collapsedColumnKeys);
        if (isCollapsed) {
          return (
            <PurchaseOrderCollapsedColumnHeaderCell
              key={column.key}
              columnKey={column.key}
              columnLabel={column.label}
              cellStyle={stickyHeaderStyle}
              onExpandColumn={onToggleColumnCollapsed}
            />
          );
        }
        return (
          <ResizableTableHeaderCell
            key={column.key}
            columnKey={column.key}
            data-col-key={column.key}
            data-column-filtered={hasActiveFilter ? 'true' : undefined}
            width={headerColumnWidths[column.key]}
            minWidth={isSystemColumn ? PRODUCT_IMAGE_MIN_COLUMN_WIDTH : undefined}
            getScale={getPoTableZoom}
            className={[styles.headerCell, hasActiveFilter ? styles.headerCellFiltered : '', hasActiveConditionalFormatting ? styles.headerCellConditionalFormatting : '', headerColumnDrag.canDrag ? styles.dragDropCell : '', headerColumnDrag.draggingKey === column.key ? styles.dragSourceCell : '', headerColumnDrag.dropTargetKey === column.key && headerColumnDrag.dropTargetPosition === 'before' ? styles.dropBeforeCell : '', headerColumnDrag.dropTargetKey === column.key && headerColumnDrag.dropTargetPosition === 'after' ? styles.dropAfterCell : ''].filter(Boolean).join(' ')}
            onResizeEnd={onSaveHeaderColumnWidth}
            cellStyle={stickyHeaderStyle}
            {...headerColumnDrag.getCellDragProps(column.key)}
          >
            <div className={styles.headerCellContent}>
              <div className={styles.headerCellLabel}>
                {isSystemColumn ? (
                  <PurchaseOrderProductImageColumnHeader label={column.label} />
                ) : (
                  <PurchaseOrderColumnHeader
                    column={column}
                    onRename={onRenameColumn}
                    onRemove={onRemoveColumn}
                    isAdmin={isAdmin}
                    onToggleWriteback={onToggleWriteback}
                    showActionsMenu={false}
                    autoEdit={editingColumnKey === column.key}
                    onEditingDone={onEditingDone}
                    showWriteBackIcon={Boolean(linkedLineValueByHeaderKey[column.key]?.writableToD365)}
                  />
                )}
              </div>
              {!isSystemColumn ? (
                <PurchaseOrderColumnFilterMenu
                column={column}
                filter={filterByColumn[column.key]}
                items={items}
                allFilters={filterByColumn}
                allDatePeriodDisplayModes={datePeriodDisplayModes}
                sortState={sortState}
                groupingColumnKey={groupingColumnKey}
                groupingColor={groupingColorsByColumn[column.key] || '#f4e6ed'}
                sumToggles={buildColumnSumToggles(column.key, groupSummaryColumnKeys, columnSums, setGroupSummaryColumn)}
                isAdmin={isAdmin}
                isStaff={isStaff}
                onToggleWriteback={onToggleWriteback}
                onSetSortDirection={setSortDirection}
                onSetOperator={setFilterOperator}
                onSetValue={setFilterValue}
                onSetSecondaryValue={setFilterSecondaryValue}
                onApplyFilter={applyColumnFilter}
                onClearFilter={clearColumnFilter}
                onSetColumnColorFilter={setColumnColorFilter}
                onSetGroupingColumn={setGroupingColumn}
                onClearGrouping={clearGrouping}
                onSetGroupingColor={setGroupingBarColor}
                onAddColumnRightOf={onAddColumnRightOf}
                datePeriodDisplayMode={datePeriodDisplayModes[column.key]}
                onSetDatePeriodDisplayMode={onSetDatePeriodDisplayMode}
                onRenameColumn={onRenameColumn}
                onRemoveColumn={onRemoveColumn}
                columnTextStyle={headerColumnTextStyles[column.key]}
                onSetColumnTextStyle={onSaveHeaderColumnTextStyle}
                columnFormatRuleSet={headerColumnFormatRules[column.key]}
                onSetColumnFormatRules={onSaveHeaderColumnFormatRules}
                columnFormatRules={headerColumnFormatRules}
                referenceColumns={referenceColumns}
                isConnectedType={Boolean(linkedLineValueByHeaderKey[column.key])}
                connectionTargets={connectionTargets}
                canMakeColumnSticky={typeof onMakeColumnSticky === 'function'}
                isStickyColumn={isStickyColumn}
                isStickyActionEnabled={canToggleStickyAction}
                stickyColumnCount={stickyColumnKeys.length}
                onMakeColumnSticky={onMakeColumnSticky}
                onToggleColumnCollapsed={onToggleColumnCollapsed}
              />
              ) : (
                <PurchaseOrderProductImageColumnMenu
                  columnKey={column.key}
                  isStickyColumn={isStickyColumn}
                  canPromoteToSticky={canPromoteToSticky}
                  canUnstickSticky={isRightMostStickyColumn}
                  stickyColumnCount={stickyColumnKeys.length}
                  onMakeColumnSticky={onMakeColumnSticky}
                />
              )}
            </div>
          </ResizableTableHeaderCell>
        );
      })}
    </tr>
    <PurchaseOrdersBoardHeaderHoverLayer
      rowRef={headerRowRef}
      disabled={Boolean(headerColumnDrag?.draggingKey)}
      hoverInput={{
        columns,
        filterByColumn,
        datePeriodDisplayModes,
      }}
    />
    </>
  );
}
