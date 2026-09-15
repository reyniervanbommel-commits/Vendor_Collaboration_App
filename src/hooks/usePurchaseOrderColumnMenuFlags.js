import { useMemo } from 'react';
import { getColumnSourceMeta, getColumnTypeMeta } from '../components/supplier/purchaseOrderColumnFilterMenuConstants';
import { isDatePeriodColumn } from '../utils/datePeriodColumnUtils';

export function usePurchaseOrderColumnMenuFlags({
  column,
  isAdmin,
  isStaff = true,
  onToggleWriteback,
  onRenameColumn,
  onRemoveColumn,
  onToggleLineColumnSum,
  sumToggles,
  onPushLineTotalToHeader,
  onPushLineValuesToHeader,
  onSetColumnTextStyle,
  onSetColumnFormatRules,
  onAddColumnRightOf,
  canMakeColumnSticky,
  isStickyColumn,
  isStickyActionEnabled,
  onMakeColumnSticky,
  onToggleColumnCollapsed,
}) {
  const isRemarksColumn = column?.dataType === 'remarks';
  const isImageColumn = column?.dataType === 'image';
  const staffMenu = isStaff !== false;
  // Write-back naar D365 is uitsluitend instelbaar via Admin > Data model.
  // De sync-toggle is bewust verwijderd uit de PO Table-kolomheader (ook voor admins).
  const canToggleWriteback = false;
  const showWritebackLocked = Boolean(staffMenu && column.source === 'd365' && column.d365Field && column.writeBackAllowed === false);
  const canRenameColumn = Boolean(staffMenu && !isRemarksColumn && !isImageColumn && column?.id && typeof onRenameColumn === 'function');
  const canRemoveColumn = Boolean(staffMenu && column.source === 'custom' && typeof onRemoveColumn === 'function');
  const isLineColumn = column.level === 'line';
  const isLineNumberColumn = isLineColumn && column.dataType === 'number';
  const isHeaderNumberColumn = column.level !== 'line' && column.dataType === 'number';
  const canToggleLineTotal = Boolean(staffMenu && isLineNumberColumn && typeof onToggleLineColumnSum === 'function');
  const canToggleGroupSummary = Boolean(staffMenu && isHeaderNumberColumn && typeof sumToggles?.onSetGroupSummaryColumn === 'function');
  const canToggleColumnSum = Boolean(staffMenu && isHeaderNumberColumn && typeof sumToggles?.onSetColumnSumColumn === 'function');
  const sumFlags = { canToggleGroupSummary, canToggleColumnSum };
  const canPushLineTotalToHeader = Boolean(staffMenu && isLineNumberColumn && typeof onPushLineTotalToHeader === 'function');
  const canPushLineValuesToHeader = Boolean(staffMenu && isLineColumn && typeof onPushLineValuesToHeader === 'function');
  const canSetColumnTextStyle = staffMenu && !isRemarksColumn && !isImageColumn && typeof onSetColumnTextStyle === 'function';
  const canSetColumnFormatRules = staffMenu && !isRemarksColumn && !isImageColumn && typeof onSetColumnFormatRules === 'function';
  const canPromoteToSticky = Boolean(
    staffMenu
    && canMakeColumnSticky
    && !isStickyColumn
    && isStickyActionEnabled
    && typeof onMakeColumnSticky === 'function'
  );
  const canUnstickSticky = Boolean(
    staffMenu
    && canMakeColumnSticky
    && isStickyColumn
    && isStickyActionEnabled
    && typeof onMakeColumnSticky === 'function'
  );
  const canToggleStickyAction = canPromoteToSticky || canUnstickSticky;
  const canAddColumn = staffMenu && typeof onAddColumnRightOf === 'function';
  const canEditFormulaColumn = Boolean(staffMenu && canAddColumn && column.source === 'custom' && String(column.formulaExpr || '').trim());
  const canEditImageColumn = Boolean(staffMenu && canAddColumn && column.source === 'custom' && column.dataType === 'image');
  const canConfigureDatePeriodDisplay = Boolean(staffMenu && isDatePeriodColumn(column));
  const canHideColumn = Boolean(
    staffMenu
    && !isImageColumn
    && column?.key
    && typeof onToggleColumnCollapsed === 'function'
  );
  const readOnlyColumnMenu = isImageColumn;
  const columnTypeMeta = useMemo(() => getColumnTypeMeta(column), [column]);
  const columnSourceMeta = useMemo(() => getColumnSourceMeta(column), [column]);

  return {
    canToggleWriteback,
    showWritebackLocked,
    canRenameColumn,
    canRemoveColumn,
    canToggleLineTotal,
    canToggleGroupSummary,
    sumFlags,
    canPushLineTotalToHeader,
    canPushLineValuesToHeader,
    canSetColumnTextStyle,
    canSetColumnFormatRules,
    canPromoteToSticky,
    canUnstickSticky,
    canToggleStickyAction,
    canAddColumn,
    canEditFormulaColumn,
    canEditImageColumn,
    canConfigureDatePeriodDisplay,
    canHideColumn,
    isImageColumn,
    readOnlyColumnMenu,
    columnTypeMeta,
    columnSourceMeta,
  };
}
