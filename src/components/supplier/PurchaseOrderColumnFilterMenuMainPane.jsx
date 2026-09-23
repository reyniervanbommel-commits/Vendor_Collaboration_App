import React, { useCallback, useMemo } from 'react';
import PurchaseOrderColumnFilterMenuTitleRow from './PurchaseOrderColumnFilterMenuTitleRow';
import PurchaseOrderColumnFilterMenuFilterSection from './PurchaseOrderColumnFilterMenuFilterSection';
import PurchaseOrderColumnFilterMenuSortSection from './PurchaseOrderColumnFilterMenuSortSection';
import PurchaseOrderColumnFilterMenuColumnActionsSection from './PurchaseOrderColumnFilterMenuColumnActionsSection';
import PurchaseOrderColumnColorFilterSection from './PurchaseOrderColumnColorFilterSection';
import { useViewTabsActions } from './viewTabs/ViewTabsDialogsProvider';
import { PurchaseOrderShowSumSwitch } from './PurchaseOrderColumnSumToggles';

export default function PurchaseOrderColumnFilterMenuMainPane({
  styles,
  column,
  columnLabel,
  columnTypeMeta,
  columnSourceMeta,
  connectionTargets = [],
  showSortAndFilter = true,
  showGrouping = true,
  showColumnMutations = true,
  activeSubmenu,
  openSubmenu,
  closeSubmenu,
  canSetColumnTextStyle,
  canSetColumnFormatRules,
  canToggleWriteback,
  showWritebackLocked = false,
  handleToggleWriteback,
  writable,
  canAddColumn,
  canRenameColumn,
  handleRenameColumn,
  canEditFormulaColumn,
  handleEditFormulaColumn,
  canConfigureDatePeriodDisplay,
  datePeriodDisplayMode,
  onSelectDatePeriodDisplayMode,
  canRemoveColumn,
  handleRemoveColumn,
  canToggleLineTotal,
  isLineColumnSummed,
  handleToggleLineTotal,
  canToggleColumnSum = false,
  isColumnSumColumn = false,
  handleToggleColumnSum,
  canPushLineTotalToHeader,
  handlePushLineTotalToHeader,
  canPushLineValuesToHeader,
  handlePushLineValuesToHeader,
  canMakeColumnSticky = false,
  isStickyColumn = false,
  canPromoteToSticky = false,
  canUnstickSticky = false,
  stickyColumnCount = 0,
  handleMakeColumnSticky,
  canHideColumn = false,
  handleHideColumn,
  setSortAsc,
  setSortDesc,
  clearSort,
  isDate,
  isNumber,
  draft,
  operatorLabels,
  operatorEntries,
  handleOperatorSelect,
  handleValueChange,
  handleDraftValueChange,
  handleApplyFilterWithValue,
  uniqueColumnValues,
  handleSecondaryValueChange,
  handleApplyFilter,
  handleClearFilter,
  colorFilter,
}) {
  const handleFilterRowMouseEnter = useCallback(() => {
    closeSubmenu?.();
  }, [closeSubmenu]);

  const { canCreateFromColumn } = useViewTabsActions();
  const showAppearanceSection = useMemo(
    () => Boolean(canSetColumnTextStyle || canSetColumnFormatRules || canConfigureDatePeriodDisplay),
    [canConfigureDatePeriodDisplay, canSetColumnFormatRules, canSetColumnTextStyle]
  );

  const isRemarks = column?.dataType === 'remarks';
  const showSort = showSortAndFilter && !isRemarks;
  const showFilter = showSortAndFilter;
  const groupingEnabled = showGrouping && !isRemarks;
  const showColorFilter = Boolean(colorFilter?.supported) && !isRemarks;
  const isHasComment = isRemarks && draft?.operator === 'hasComment';
  const remarksTermLength = isRemarks && !isHasComment ? String(draft?.value ?? '').trim().length : 0;
  const searchHint = isHasComment
    ? 'Matches rows with at least one comment.'
    : remarksTermLength > 200
      ? 'Enter at most 200 characters'
      : remarksTermLength < 2 && isRemarks
        ? 'Enter at least 2 characters'
        : '';

  const showColumnSection = useMemo(
    () => Boolean(
      canHideColumn
      || canToggleWriteback
      || canAddColumn
      || (showColumnMutations && (canEditFormulaColumn || canRemoveColumn))
      || canToggleLineTotal
      || canPushLineTotalToHeader
      || canPushLineValuesToHeader
      || canMakeColumnSticky
      || canCreateFromColumn
    ),
    [
      canAddColumn,
      canCreateFromColumn,
      canEditFormulaColumn,
      canHideColumn,
      canMakeColumnSticky,
      canPushLineTotalToHeader,
      canPushLineValuesToHeader,
      canRemoveColumn,
      canToggleLineTotal,
      canToggleWriteback,
      showColumnMutations,
    ]
  );

  return (
    <div className={styles.mainPane}>
      <PurchaseOrderColumnFilterMenuTitleRow
        styles={styles}
        columnLabel={columnLabel}
        columnTypeMeta={columnTypeMeta}
        columnSourceMeta={columnSourceMeta}
        columnLevel={column?.level}
        connectionTargets={connectionTargets}
        canRenameColumn={canRenameColumn}
        handleRenameColumn={handleRenameColumn}
        showWritebackLocked={showWritebackLocked}
        closeSubmenu={closeSubmenu}
      />
      <div className={styles.divider} />
      {showSortAndFilter ? (
        <>
          {showSort ? (
            <>
              <PurchaseOrderColumnFilterMenuSortSection
                styles={styles}
                closeSubmenu={closeSubmenu}
                activeSubmenu={activeSubmenu}
                openSubmenu={openSubmenu}
                showGrouping={groupingEnabled}
                isDate={isDate}
                isNumber={isNumber}
                setSortAsc={setSortAsc}
                setSortDesc={setSortDesc}
                clearSort={clearSort}
              >
                {canToggleColumnSum ? (
                  <PurchaseOrderShowSumSwitch
                    styles={styles}
                    checked={isColumnSumColumn}
                    onToggle={handleToggleColumnSum}
                    onMouseEnter={closeSubmenu}
                  />
                ) : null}
              </PurchaseOrderColumnFilterMenuSortSection>
              <div className={styles.divider} />
            </>
          ) : null}
          {showFilter ? (
            <PurchaseOrderColumnFilterMenuFilterSection
              styles={styles}
              column={column}
              columnLabel={columnLabel}
              closeSubmenu={closeSubmenu}
              isDate={isDate}
              isNumber={isNumber}
              draft={draft}
              operatorLabels={operatorLabels}
              operatorEntries={operatorEntries}
              handleOperatorSelect={handleOperatorSelect}
              handleValueChange={handleValueChange}
              handleDraftValueChange={handleDraftValueChange}
              handleApplyFilterWithValue={handleApplyFilterWithValue}
              uniqueColumnValues={uniqueColumnValues}
              handleSecondaryValueChange={handleSecondaryValueChange}
              handleApplyFilter={handleApplyFilter}
              handleClearFilter={handleClearFilter}
              onMouseEnter={handleFilterRowMouseEnter}
              searchHint={searchHint}
            />
          ) : null}
          {showColorFilter ? (
            <>
              <div className={styles.divider} />
              <PurchaseOrderColumnColorFilterSection
                styles={styles}
                columnLabel={columnLabel}
                availableColors={colorFilter.availableColors}
                selectedColors={colorFilter.selectedColors}
                onToggleColor={colorFilter.toggleColor}
                onClear={colorFilter.clear}
                closeSubmenu={closeSubmenu}
                onMouseEnter={handleFilterRowMouseEnter}
              />
            </>
          ) : null}
        </>
      ) : null}
      {showAppearanceSection || showColumnSection ? <div className={styles.divider} /> : null}
      <PurchaseOrderColumnFilterMenuColumnActionsSection
        styles={styles}
        closeSubmenu={closeSubmenu}
        activeSubmenu={activeSubmenu}
        openSubmenu={openSubmenu}
        showColumnMutations={showColumnMutations}
        canHideColumn={canHideColumn}
        handleHideColumn={handleHideColumn}
        canSetColumnTextStyle={canSetColumnTextStyle}
        canSetColumnFormatRules={canSetColumnFormatRules}
        canConfigureDatePeriodDisplay={canConfigureDatePeriodDisplay}
        datePeriodDisplayMode={datePeriodDisplayMode}
        onSelectDatePeriodDisplayMode={onSelectDatePeriodDisplayMode}
        canAddColumn={canAddColumn}
        canEditFormulaColumn={canEditFormulaColumn}
        handleEditFormulaColumn={handleEditFormulaColumn}
        canRemoveColumn={canRemoveColumn}
        handleRemoveColumn={handleRemoveColumn}
        canToggleLineTotal={canToggleLineTotal}
        isLineColumnSummed={isLineColumnSummed}
        handleToggleLineTotal={handleToggleLineTotal}
        canPushLineTotalToHeader={canPushLineTotalToHeader}
        handlePushLineTotalToHeader={handlePushLineTotalToHeader}
        canPushLineValuesToHeader={canPushLineValuesToHeader}
        handlePushLineValuesToHeader={handlePushLineValuesToHeader}
        canMakeColumnSticky={canMakeColumnSticky}
        isStickyColumn={isStickyColumn}
        canPromoteToSticky={canPromoteToSticky}
        canUnstickSticky={canUnstickSticky}
        stickyColumnCount={stickyColumnCount}
        handleMakeColumnSticky={handleMakeColumnSticky}
        showAppearanceSection={showAppearanceSection}
        showColumnSection={showColumnSection}
        columnKey={column.key}
      />
    </div>
  );
}
