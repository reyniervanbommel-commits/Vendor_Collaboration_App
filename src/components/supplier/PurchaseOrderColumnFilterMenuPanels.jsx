import React from 'react';
import { mergeClasses } from '@fluentui/react-components';
import PurchaseOrderColumnGroupingSection from './PurchaseOrderColumnGroupingSection';
import PurchaseOrderAddColumnPane from './PurchaseOrderAddColumnPane';
import PurchaseOrderColumnFormatRulesPane from './PurchaseOrderColumnFormatRulesPane';
import PurchaseOrderColumnTextStylePane from './PurchaseOrderColumnTextStylePane';
import FilterMenuMainPane from './PurchaseOrderColumnFilterMenuMainPane';
import { usePurchaseOrderColumnMenuFlyoutPlacement } from './usePurchaseOrderColumnMenuFlyoutPlacement';
import { withSumToggleHandlers } from './PurchaseOrderColumnSumToggles';

export { FilterMenuMainPane };

export function FilterMenuSubPane({
  styles,
  activeSubmenu,
  submenuTop,
  handleAddType,
  remarksAlreadyAdded,
  textStyleDraft,
  handleTextColorChange,
  handleToggleBold,
  handleToggleItalic,
  handleToggleUnderline,
  columnLabel,
  handleClearTextStyle,
  formatTarget,
  setFormatTarget,
  formatRules,
  formatReferenceColumns,
  addFormatRule,
  updateFormatRule,
  removeFormatRule,
  handleClearFormatRules,
  column,
  isGroupingColumn,
  groupingColor,
  onSetGroupingColumn,
  onClearGrouping,
  onSetGroupingColor,
  sumToggles,
  sumFlags,
  handleToggleGroupSummary,
}) {
  const flyout = usePurchaseOrderColumnMenuFlyoutPlacement({
    active: activeSubmenu !== 'none',
    requestedTop: submenuTop || 0,
    placementKey: activeSubmenu,
  });
  let content = null;

  if (activeSubmenu === 'add') {
    content = (
      <PurchaseOrderAddColumnPane
        styles={styles}
        columnLevel={column?.level}
        remarksAlreadyAdded={remarksAlreadyAdded}
        onConfirm={handleAddType}
      />
    );
  }
  if (activeSubmenu === 'textStyle') {
    content = (
      <PurchaseOrderColumnTextStylePane
        styles={styles}
        textStyleDraft={textStyleDraft}
        handleTextColorChange={handleTextColorChange}
        handleToggleBold={handleToggleBold}
        handleToggleItalic={handleToggleItalic}
        handleToggleUnderline={handleToggleUnderline}
        columnLabel={columnLabel}
        handleClearTextStyle={handleClearTextStyle}
      />
    );
  }

  if (activeSubmenu === 'formatRules') {
    content = (
      <PurchaseOrderColumnFormatRulesPane
        styles={styles}
        formatTarget={formatTarget}
        setFormatTarget={setFormatTarget}
        formatRules={formatRules}
        formatReferenceColumns={formatReferenceColumns}
        addFormatRule={addFormatRule}
        updateFormatRule={updateFormatRule}
        removeFormatRule={removeFormatRule}
        handleClearFormatRules={handleClearFormatRules}
      />
    );
  }

  if (activeSubmenu === 'group') {
    content = (
      <PurchaseOrderColumnGroupingSection
        styles={styles}
        column={column}
        isGroupingColumn={isGroupingColumn}
        groupingColor={groupingColor}
        onSetGroupingColumn={onSetGroupingColumn}
        onClearGrouping={onClearGrouping}
        onSetGroupingColor={onSetGroupingColor}
        sumToggles={withSumToggleHandlers(sumToggles, { canToggleGroupSummary: sumFlags?.canToggleGroupSummary }, handleToggleGroupSummary)}
      />
    );
  }

  if (!content) return null;

  return (
    <div
      ref={flyout.ref}
      className={mergeClasses(styles.subPane, flyout.alignLeft && styles.subPaneAlignLeft)}
      style={{ top: `${flyout.top}px` }}
      data-flyout-side={flyout.alignLeft ? 'left' : 'right'}
      data-tour={activeSubmenu === 'add' ? 'col-type-list' : undefined}
    >
      {content}
    </div>
  );
}
