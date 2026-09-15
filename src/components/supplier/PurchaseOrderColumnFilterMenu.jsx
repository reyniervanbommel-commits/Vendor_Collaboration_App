import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Popover, PopoverTrigger } from '@fluentui/react-components';
import { DATE_FILTER_OPERATORS, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../hooks/usePurchaseOrderTableView';
import { usePurchaseOrderColumnFilterMenuStyles } from './purchaseOrderColumnFilterMenuStyles';
import { useColumnFormatRulesMenuDraft } from '../../hooks/useColumnFormatRulesMenuDraft';
import { useColumnFormatRulesMenuActions } from '../../hooks/useColumnFormatRulesMenuActions';
import { useColumnTextStyleActions } from '../../hooks/useColumnTextStyleActions';
import { usePurchaseOrderColumnMutationActions } from '../../hooks/usePurchaseOrderColumnMutationActions';
import { usePurchaseOrderSortFilterActions } from '../../hooks/usePurchaseOrderSortFilterActions';
import { usePurchaseOrderColumnMenuFlags } from '../../hooks/usePurchaseOrderColumnMenuFlags';
import { usePurchaseOrderColumnMenuQuickActions } from '../../hooks/usePurchaseOrderColumnMenuQuickActions';
import { usePurchaseOrderColorFilter } from '../../hooks/usePurchaseOrderColorFilter';
import { useAppToast } from '../../hooks/useAppToast';
import PurchaseOrderColumnMutationDialogs from './PurchaseOrderColumnMutationDialogs';
import PurchaseOrderColumnFilterMenuPopoverContent from './PurchaseOrderColumnFilterMenuPopoverContent';
import {
  getDraftFromFilter,
  isColumnFilterActive,
  isDateColumn,
  isNumberColumn,
  REMARKS_FILTER_OPERATORS,
} from './purchaseOrderColumnFilterMenuConstants';
import { getUniqueColumnValues } from '../../utils/columnUniqueValues';

const EMPTY_UNIQUE_VALUES = [];

function PurchaseOrderColumnFilterMenu({
  column,
  filter,
  sortState,
  groupingColumnKey,
  groupingColor,
  isAdmin,
  isStaff = true,
  onToggleWriteback,
  onSetSortDirection,
  onSetOperator,
  onSetValue,
  onSetSecondaryValue,
  onApplyFilter,
  onClearFilter,
  onSetColumnColorFilter,
  onSetGroupingColumn,
  onClearGrouping,
  onSetGroupingColor,
  sumToggles = {},
  onAddColumnRightOf,
  datePeriodDisplayMode,
  onSetDatePeriodDisplayMode,
  onRenameColumn,
  onRemoveColumn,
  isLineColumnSummed = false,
  onToggleLineColumnSum,
  onPushLineTotalToHeader,
  onPushLineValuesToHeader,
  columnTextStyle,
  onSetColumnTextStyle,
  columnFormatRuleSet = null,
  onSetColumnFormatRules,
  columnFormatRules = {},
  referenceColumns = [],
  isConnectedType: _isConnectedType = false,
  connectionTargets = [],
  canMakeColumnSticky = false,
  isStickyColumn = false,
  isStickyActionEnabled = false,
  stickyColumnCount = 0,
  onMakeColumnSticky,
  onToggleColumnCollapsed,
  items = [],
  allFilters = {},
  allDatePeriodDisplayModes = {},
}) {
  const styles = usePurchaseOrderColumnFilterMenuStyles();
  const [open, setOpen] = useState(false);
  // Tracks which flyout submenu is currently aligned with the hovered menu item.
  const [activeSubmenu, setActiveSubmenu] = useState('none');
  const [submenuTop, setSubmenuTop] = useState(0);
  const datePeriodFilterModes = useMemo(
    () => ({ [column.key]: datePeriodDisplayMode }),
    [column.key, datePeriodDisplayMode]
  );
  const [draft, setDraft] = useState(() => getDraftFromFilter(
    column,
    filter,
    { [column.key]: datePeriodDisplayMode }
  ));
  const isDate = isDateColumn(column);
  const isNumber = isNumberColumn(column, datePeriodFilterModes);
  const groupingColumnKeys = useMemo(
    () => String(groupingColumnKey || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    [groupingColumnKey]
  );
  const isGroupingColumn = groupingColumnKeys.includes(column.key);
  const operatorLabels = column.dataType === 'remarks' ? REMARKS_FILTER_OPERATORS : isDate ? DATE_FILTER_OPERATORS : isNumber ? NUMBER_FILTER_OPERATORS : TEXT_FILTER_OPERATORS;
  const operatorEntries = useMemo(() => Object.entries(operatorLabels), [operatorLabels]);
  const uniqueColumnValues = useMemo(() => {
    if (!open || isDate || column.dataType === 'remarks') return EMPTY_UNIQUE_VALUES;
    return getUniqueColumnValues(column, items, referenceColumns, allFilters, allDatePeriodDisplayModes);
  }, [open, isDate, column, items, referenceColumns, allFilters, allDatePeriodDisplayModes]);
  const sortDirection = sortState.columnKey === column.key ? sortState.direction : 'none';
  const filterActive = isColumnFilterActive(column, filter, datePeriodFilterModes);
  const writable = !!column.writableToD365;
  const { notifyError } = useAppToast();
  const { canToggleWriteback, showWritebackLocked, canRenameColumn, canRemoveColumn, canToggleLineTotal, canToggleGroupSummary, sumFlags, canPushLineTotalToHeader, canPushLineValuesToHeader, canSetColumnTextStyle, canSetColumnFormatRules, canPromoteToSticky, canUnstickSticky, canToggleStickyAction, canAddColumn, canEditFormulaColumn, canConfigureDatePeriodDisplay, canHideColumn, readOnlyColumnMenu, columnTypeMeta, columnSourceMeta } = usePurchaseOrderColumnMenuFlags({ column, isAdmin, isStaff, onToggleWriteback, onRenameColumn, onRemoveColumn, onToggleLineColumnSum, sumToggles, onPushLineTotalToHeader, onPushLineValuesToHeader, onSetColumnTextStyle, onSetColumnFormatRules, onAddColumnRightOf, canMakeColumnSticky, isStickyColumn, isStickyActionEnabled, onMakeColumnSticky, onToggleColumnCollapsed });
  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveSubmenu('none');
    setSubmenuTop(0);
  }, []);
  const persistFormatRules = useCallback(async (ruleSet) => {
    if (!canSetColumnFormatRules) return;
    try {
      await onSetColumnFormatRules(column.key, ruleSet);
    } catch (err) {
      notifyError(err?.message || 'Saving conditional formatting failed.');
    }
  }, [canSetColumnFormatRules, column.key, notifyError, onSetColumnFormatRules]);
  const formatRulesDraft = useColumnFormatRulesMenuDraft({
    open,
    columnFormatRuleSet,
    onPersist: persistFormatRules,
  });
  const {
    textStyleDraft,
    handleTextColorChange,
    handleToggleBold,
    handleToggleItalic,
    handleToggleUnderline,
    handleClearTextStyle,
  } = useColumnTextStyleActions({
    open,
    columnTextStyle,
    canSetColumnTextStyle,
    onSetColumnTextStyle,
    columnKey: column.key,
  });
  const { dialogState, setRenameValue, handleRenameColumn, handleRenameCancel, handleRenameSubmit, handleRemoveColumn, handleRemoveCancel, handleRemoveConfirm } = usePurchaseOrderColumnMutationActions({
    column,
    canRenameColumn,
    canRemoveColumn,
    onRenameColumn,
    onRemoveColumn,
    onCloseMenu: closeMenu,
  });
  const handleRenameValueChange = useCallback((_, data) => setRenameValue(data.value), [setRenameValue]);
  const formatReferenceColumns = useMemo(() => (Array.isArray(referenceColumns) ? referenceColumns : []).filter((refColumn) => refColumn?.key && refColumn.key !== column.key), [referenceColumns, column.key]);
  const remarksAlreadyAdded = useMemo(
    () => referenceColumns.some((refColumn) => refColumn?.dataType === 'remarks'),
    [referenceColumns]
  );
  useEffect(() => {
    if (open) {
      setDraft(getDraftFromFilter(column, filter, datePeriodFilterModes));
    }
  }, [open, column, filter, datePeriodFilterModes]);
  const handleOpenChange = useCallback((_, data) => {
    setOpen(data.open);
    if (!data.open) {
      setActiveSubmenu('none');
      setSubmenuTop(0);
    }
  }, []);
  const openSubmenu = useCallback((name, event) => {
    setActiveSubmenu(name);
    setSubmenuTop(event?.currentTarget?.offsetTop || 0);
  }, []);
  const closeSubmenu = useCallback(() => {
    setActiveSubmenu('none');
    setSubmenuTop(0);
  }, []);
  const handleAddType = useCallback((typeDef) => {
    onAddColumnRightOf(column, typeDef);
    setActiveSubmenu('none');
    setOpen(false);
  }, [column, onAddColumnRightOf]);
  const handleEditFormulaColumn = useCallback(() => {
    if (!canEditFormulaColumn) return;
    onAddColumnRightOf(column, { key: 'formula-edit' });
    setOpen(false);
  }, [canEditFormulaColumn, column, onAddColumnRightOf]);
  const handleSelectDatePeriodDisplayMode = useCallback((displayMode) => {
    if (!canConfigureDatePeriodDisplay || typeof onSetDatePeriodDisplayMode !== 'function') return;
    onSetDatePeriodDisplayMode(column.key, displayMode);
    setActiveSubmenu('none');
  }, [canConfigureDatePeriodDisplay, column.key, onSetDatePeriodDisplayMode]);
  const { setSortAsc, setSortDesc, clearSort, handleOperatorSelect, handleValueChange, handleDraftValueChange, handleSecondaryValueChange, handleApplyFilter, handleApplyFilterWithValue, handleClearFilter } = usePurchaseOrderSortFilterActions({
    columnKey: column.key, columnDataType: column.dataType,
    draft,
    onSetSortDirection,
    onSetOperator,
    onSetValue,
    onSetSecondaryValue,
    onApplyFilter,
    onClearFilter,
    setDraft,
    setOpen,
  });
  const { handleClearFormatRules } = useColumnFormatRulesMenuActions({
    canSetColumnFormatRules,
    columnKey: column.key,
    formatRulesDraft,
    onSetColumnFormatRules,
    onError: notifyError,
  });
  const colorFilter = usePurchaseOrderColorFilter({
    column,
    filter,
    columnFormatRuleSet,
    columns: referenceColumns,
    columnFormatRules,
    onSetColumnColorFilter,
  });
  const { handleToggleWriteback, handleToggleLineTotal, handleToggleGroupSummary, handleToggleColumnSum, handlePushLineTotalToHeader, handlePushLineValuesToHeader, handleMakeColumnSticky, handleHideColumn } = usePurchaseOrderColumnMenuQuickActions({ column, writable, isLineColumnSummed, sumToggles, canToggleWriteback, canToggleLineTotal, canToggleGroupSummary, canToggleColumnSum: sumFlags.canToggleColumnSum, canPushLineTotalToHeader, canPushLineValuesToHeader, canToggleStickyAction, onToggleWriteback, onToggleLineColumnSum, onPushLineTotalToHeader, onPushLineValuesToHeader, onMakeColumnSticky, onToggleColumnCollapsed, setOpen });
  const triggerClassName = [
    styles.trigger,
    filterActive ? styles.triggerFilterActive : '',
    !filterActive && sortDirection !== 'none' ? styles.triggerActive : '',
  ].filter(Boolean).join(' ');

  return (
    <>
    <Popover open={open} onOpenChange={handleOpenChange} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <Button
          className={triggerClassName}
          appearance="subtle"
          size="small"
          aria-label={`Sort, filter and add column for ${column.label}`}
          data-column-menu-trigger="true"
          data-column-menu-trigger-active={filterActive ? 'true' : undefined}
          data-tour="po-column-menu-trigger"
          data-column-type={column.dataType || undefined}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          ...
        </Button>
      </PopoverTrigger>
      <PurchaseOrderColumnFilterMenuPopoverContent
        styles={styles} column={column} columnTypeMeta={columnTypeMeta} columnSourceMeta={columnSourceMeta} connectionTargets={connectionTargets}
        activeSubmenu={activeSubmenu} submenuTop={submenuTop} openSubmenu={openSubmenu} closeSubmenu={closeSubmenu}
        showGrouping={isStaff && !readOnlyColumnMenu}
        showColumnMutations={isStaff}
        showSortAndFilter={!readOnlyColumnMenu}
        canSetColumnTextStyle={canSetColumnTextStyle} canSetColumnFormatRules={canSetColumnFormatRules}
        canToggleWriteback={canToggleWriteback} showWritebackLocked={showWritebackLocked} handleToggleWriteback={handleToggleWriteback} writable={writable}
        canAddColumn={canAddColumn} canRenameColumn={canRenameColumn} handleRenameColumn={handleRenameColumn} canEditFormulaColumn={canEditFormulaColumn}
        canConfigureDatePeriodDisplay={canConfigureDatePeriodDisplay}
        datePeriodDisplayMode={datePeriodDisplayMode}
        onSelectDatePeriodDisplayMode={handleSelectDatePeriodDisplayMode}
        handleEditFormulaColumn={handleEditFormulaColumn}
        canRemoveColumn={canRemoveColumn} handleRemoveColumn={handleRemoveColumn} canToggleLineTotal={canToggleLineTotal} isLineColumnSummed={isLineColumnSummed}
        handleToggleLineTotal={handleToggleLineTotal} canPushLineTotalToHeader={canPushLineTotalToHeader} handlePushLineTotalToHeader={handlePushLineTotalToHeader}
        canPushLineValuesToHeader={canPushLineValuesToHeader} handlePushLineValuesToHeader={handlePushLineValuesToHeader}
        canMakeColumnSticky={canMakeColumnSticky} isStickyColumn={isStickyColumn} canPromoteToSticky={canPromoteToSticky} canUnstickSticky={canUnstickSticky}
        stickyColumnCount={stickyColumnCount} handleMakeColumnSticky={handleMakeColumnSticky} canHideColumn={canHideColumn} handleHideColumn={handleHideColumn}
        setSortAsc={setSortAsc} setSortDesc={setSortDesc} clearSort={clearSort}
        isDate={isDate} isNumber={isNumber} draft={draft} operatorLabels={operatorLabels} operatorEntries={operatorEntries} handleOperatorSelect={handleOperatorSelect} handleValueChange={handleValueChange}
        handleDraftValueChange={handleDraftValueChange}
        handleApplyFilterWithValue={handleApplyFilterWithValue}
        uniqueColumnValues={uniqueColumnValues}
        handleSecondaryValueChange={handleSecondaryValueChange} handleApplyFilter={handleApplyFilter} handleClearFilter={handleClearFilter} colorFilter={colorFilter} handleAddType={handleAddType}
        remarksAlreadyAdded={remarksAlreadyAdded}
        textStyleDraft={textStyleDraft} handleTextColorChange={handleTextColorChange} handleToggleBold={handleToggleBold} handleToggleItalic={handleToggleItalic}
        handleToggleUnderline={handleToggleUnderline} handleClearTextStyle={handleClearTextStyle}
        formatRulesDraft={formatRulesDraft} formatReferenceColumns={formatReferenceColumns}
        handleClearFormatRules={handleClearFormatRules} isGroupingColumn={isGroupingColumn} groupingColor={groupingColor}
        onSetGroupingColumn={onSetGroupingColumn} onClearGrouping={onClearGrouping} onSetGroupingColor={onSetGroupingColor}
        sumToggles={sumToggles} sumFlags={sumFlags} handleToggleGroupSummary={handleToggleGroupSummary} handleToggleColumnSum={handleToggleColumnSum}
      />
    </Popover>
    {dialogState.renameOpen || dialogState.removeOpen ? (
      <PurchaseOrderColumnMutationDialogs
        columnLabel={column.label}
        renameOpen={dialogState.renameOpen}
        renameValue={dialogState.renameValue}
        renameBusy={dialogState.renameBusy}
        onRenameValueChange={handleRenameValueChange}
        onRenameCancel={handleRenameCancel}
        onRenameSubmit={handleRenameSubmit}
        removeOpen={dialogState.removeOpen}
        removeBusy={dialogState.removeBusy}
        onRemoveCancel={handleRemoveCancel}
        onRemoveConfirm={handleRemoveConfirm}
      />
    ) : null}
    </>
  );
}

export default memo(PurchaseOrderColumnFilterMenu);
