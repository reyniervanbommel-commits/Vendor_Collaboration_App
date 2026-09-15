import React, { useCallback } from 'react';
import { mergeClasses, Text } from '@fluentui/react-components';
import {
  AddRegular,
  ArrowBidirectionalLeftRightRegular,
  CalendarLtrRegular,
  CheckmarkRegular,
  DeleteRegular,
  EditRegular,
  LinkRegular,
  NumberSymbolRegular,
  PinOffRegular,
  PinRegular,
  TabAddRegular,
} from '@fluentui/react-icons';
import PurchaseOrderColumnFilterSubmenuButton from './PurchaseOrderColumnFilterSubmenuButton';
import PurchaseOrderColumnFilterMenuButton from './PurchaseOrderColumnFilterMenuButton';
import D365LogoIcon from './D365LogoIcon';
import { menuLabel } from './purchaseOrderColumnFilterMenuMainPaneUtils';
import { getStickyColumnMenuText } from './purchaseOrderColumnFilterMenuConstants';
import { useViewTabsActions } from './viewTabs/ViewTabsDialogsProvider';

export default function PurchaseOrderColumnFilterMenuColumnActionsSection({
  styles,
  closeSubmenu,
  activeSubmenu,
  openSubmenu,
  showColumnMutations = true,
  canHideColumn = false,
  handleHideColumn,
  canSetColumnTextStyle,
  canSetColumnFormatRules,
  canToggleWriteback,
  handleToggleWriteback,
  writable,
  canConfigureDatePeriodDisplay,
  datePeriodDisplayMode,
  onSelectDatePeriodDisplayMode,
  canAddColumn,
  canEditFormulaColumn,
  handleEditFormulaColumn,
  canRemoveColumn,
  handleRemoveColumn,
  canToggleLineTotal,
  isLineColumnSummed,
  handleToggleLineTotal,
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
  showAppearanceSection = false,
  showColumnSection = false,
  columnKey = '',
}) {
  const { canCreateFromColumn, openCreateTabs } = useViewTabsActions();
  const stickyMenuText = getStickyColumnMenuText({ canUnstickSticky, isStickyColumn, stickyColumnCount });
  const stickyActionDisabled = !canPromoteToSticky && !canUnstickSticky;
  const stickyLabelClassName = `${styles.menuItemContent} ${stickyActionDisabled ? styles.menuItemContentDisabled : ''}`.trim();
  const stickyIconClassName = `${styles.menuItemIcon} ${stickyActionDisabled ? styles.menuItemIconDisabled : ''}`.trim();
  const weekSelected = datePeriodDisplayMode !== 'month';
  const monthSelected = datePeriodDisplayMode === 'month';
  const handleCreateTabsFromColumn = useCallback(() => {
    openCreateTabs(columnKey);
  }, [columnKey, openCreateTabs]);

  if (!showAppearanceSection && !showColumnSection) {
    return null;
  }

  return (
    <>
      {showAppearanceSection ? (
        <>
          <Text className={styles.sectionTitle}>Appearance</Text>
          <div className={styles.sectionBlock}>
            {canSetColumnTextStyle ? (
              <PurchaseOrderColumnFilterSubmenuButton
                styles={styles}
                name="textStyle"
                label="Text style"
                icon={<EditRegular />}
                activeSubmenu={activeSubmenu}
                onOpenSubmenu={openSubmenu}
              />
            ) : null}
            {canSetColumnFormatRules ? (
              <PurchaseOrderColumnFilterSubmenuButton
                styles={styles}
                name="formatRules"
                label="Conditional formatting"
                icon={<NumberSymbolRegular />}
                activeSubmenu={activeSubmenu}
                onOpenSubmenu={openSubmenu}
              />
            ) : null}
            {canConfigureDatePeriodDisplay ? (
              <>
                <Text className={styles.subPaneTitle}>Display as</Text>
                <PurchaseOrderColumnFilterMenuButton
                  className={mergeClasses(styles.sortButton, weekSelected && styles.displayModeButtonSelected)}
                  appearance="subtle"
                  size="small"
                  closeSubmenu={closeSubmenu}
                  aria-pressed={weekSelected}
                  onClick={() => onSelectDatePeriodDisplayMode('week')}
                >
                  {menuLabel(
                    styles,
                    weekSelected ? <CheckmarkRegular /> : <CalendarLtrRegular />,
                    'Week number'
                  )}
                </PurchaseOrderColumnFilterMenuButton>
                <PurchaseOrderColumnFilterMenuButton
                  className={mergeClasses(styles.sortButton, monthSelected && styles.displayModeButtonSelected)}
                  appearance="subtle"
                  size="small"
                  closeSubmenu={closeSubmenu}
                  aria-pressed={monthSelected}
                  onClick={() => onSelectDatePeriodDisplayMode('month')}
                >
                  {menuLabel(
                    styles,
                    monthSelected ? <CheckmarkRegular /> : <CalendarLtrRegular />,
                    'Month name'
                  )}
                </PurchaseOrderColumnFilterMenuButton>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {showColumnSection ? (
        <>
          <Text className={styles.sectionTitle}>Column</Text>
          <div className={styles.sectionBlock}>
            {canToggleWriteback ? (
              <PurchaseOrderColumnFilterMenuButton className={styles.sortButton} appearance="subtle" size="small" closeSubmenu={closeSubmenu} onClick={handleToggleWriteback}>
                <span className={styles.d365SyncLabel}>
                  <D365LogoIcon size="small" alt="" />
                  {writable ? 'Disable sync' : 'Enable sync'}
                </span>
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {canHideColumn ? (
              <PurchaseOrderColumnFilterMenuButton
                className={styles.sortButton}
                appearance="subtle"
                size="small"
                closeSubmenu={closeSubmenu}
                onClick={handleHideColumn}
              >
                {menuLabel(styles, <ArrowBidirectionalLeftRightRegular />, 'Hide column')}
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {canCreateFromColumn ? (
              <PurchaseOrderColumnFilterMenuButton
                className={styles.sortButton}
                appearance="subtle"
                size="small"
                closeSubmenu={closeSubmenu}
                onClick={handleCreateTabsFromColumn}
                data-tour="col-tabs-from-column"
              >
                {menuLabel(styles, <TabAddRegular />, 'Tabs from column…')}
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {canAddColumn ? (
              <PurchaseOrderColumnFilterSubmenuButton
                styles={styles}
                name="add"
                label="Add column to the right"
                icon={<AddRegular />}
                activeSubmenu={activeSubmenu}
                onOpenSubmenu={openSubmenu}
              />
            ) : null}
            {showColumnMutations && canEditFormulaColumn ? (
              <PurchaseOrderColumnFilterMenuButton className={styles.sortButton} appearance="subtle" size="small" closeSubmenu={closeSubmenu} onClick={handleEditFormulaColumn}>
                {menuLabel(styles, <NumberSymbolRegular />, 'Edit formula column')}
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {showColumnMutations && canRemoveColumn ? (
              <PurchaseOrderColumnFilterMenuButton className={styles.sortButton} appearance="subtle" size="small" closeSubmenu={closeSubmenu} onClick={handleRemoveColumn}>
                {menuLabel(styles, <DeleteRegular />, 'Delete column')}
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {canToggleLineTotal ? (
              <PurchaseOrderColumnFilterMenuButton className={styles.sortButton} appearance="subtle" size="small" closeSubmenu={closeSubmenu} onClick={handleToggleLineTotal}>
                {menuLabel(styles, <NumberSymbolRegular />, isLineColumnSummed ? 'Disable total row sum' : 'Enable total row sum')}
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {canPushLineTotalToHeader ? (
              <PurchaseOrderColumnFilterMenuButton className={styles.sortButton} appearance="subtle" size="small" closeSubmenu={closeSubmenu} onClick={handlePushLineTotalToHeader}>
                {menuLabel(styles, <LinkRegular />, 'Push total to header column')}
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {canPushLineValuesToHeader ? (
              <PurchaseOrderColumnFilterMenuButton className={styles.sortButton} appearance="subtle" size="small" closeSubmenu={closeSubmenu} onClick={handlePushLineValuesToHeader}>
                {menuLabel(styles, <LinkRegular />, 'Push values to header column')}
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
            {canMakeColumnSticky ? (
              <PurchaseOrderColumnFilterMenuButton
                className={styles.sortButton}
                appearance="subtle"
                size="small"
                closeSubmenu={closeSubmenu}
                onClick={handleMakeColumnSticky}
                disabled={stickyActionDisabled}
              >
                <span className={stickyLabelClassName}>
                  <span className={stickyIconClassName} aria-hidden>
                    {canUnstickSticky ? <PinOffRegular /> : <PinRegular />}
                  </span>
                  <span>{stickyMenuText}</span>
                </span>
              </PurchaseOrderColumnFilterMenuButton>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
