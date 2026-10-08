import React, { useCallback } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import PurchaseOrderSavedViewsControl from './PurchaseOrderSavedViewsControl';
import PurchaseOrderPinnedViewTabs from './PurchaseOrderPinnedViewTabs';
import PurchaseOrderViewTabMenuSection from './viewTabs/PurchaseOrderViewTabMenuSection';
import { VIEW_TITLE_SLOT_WIDTH } from './PurchaseOrderSavedViewTitleTrigger';
import { canToggleViewMeta } from './PurchaseOrderSavedViewMenuItems';
import { usePinnedViewOrder } from '../../hooks/usePinnedViewOrder';

const useStyles = makeStyles({
  row: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '100%',
    columnGap: tokens.spacingHorizontalM,
  },
  // Slot in the title font: the first pinned tab starts at the same x for any name <= 25 chars.
  viewTitle: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    fontSize: tokens.fontSizeHero700,
    minWidth: VIEW_TITLE_SLOT_WIDTH,
    maxWidth: '70%',
  },
});

export default function PurchaseOrderViewTitleRow({
  savedViewsState,
  isStaff,
  columns,
  onExportExcel,
  onSaveAsNew,
  onRequestUpdate,
}) {
  const styles = useStyles();
  const {
    savedViews,
    activeViewId,
    hasUnsavedChanges,
    getUnsavedViewDiff,
    applyViewState,
    handleResetView,
    handleRenameView,
    handleToggleDefault,
    defaultViewId,
    handleDeleteView,
    handleToggleShowHistory,
    handleToggleShowAsTab,
    allOrdersShowHistoryIndicators,
    viewTabs,
  } = savedViewsState;
  const pinnedOrder = usePinnedViewOrder();
  const canUnpin = useCallback((view) => canToggleViewMeta(view, isStaff), [isStaff]);
  const handleUnpin = useCallback((view) => handleToggleShowAsTab(view, false), [handleToggleShowAsTab]);

  return (
    <div className={styles.row}>
      <div className={styles.viewTitle}>
        <PurchaseOrderSavedViewsControl
          titleMode
          views={savedViews.views}
          activeViewId={activeViewId}
          canManageGlobal={isStaff}
          canManageViews={isStaff}
          saving={savedViews.saving}
          hasUnsavedChanges={hasUnsavedChanges}
          getUnsavedViewDiff={getUnsavedViewDiff}
          onApplyView={applyViewState}
          onResetView={handleResetView}
          onSaveAsNew={onSaveAsNew}
          onUpdateActive={onRequestUpdate}
          onRenameView={handleRenameView}
          defaultViewId={defaultViewId}
          onToggleDefault={handleToggleDefault}
          onDeleteView={handleDeleteView}
          onToggleShowHistory={handleToggleShowHistory}
          onToggleShowAsTab={handleToggleShowAsTab}
          allOrdersShowHistoryIndicators={allOrdersShowHistoryIndicators}
          onExportExcel={onExportExcel}
          tabMenu={(
            <PurchaseOrderViewTabMenuSection
              enabled={Boolean(activeViewId && isStaff && viewTabs)}
              groups={viewTabs?.groups || []}
              columns={columns}
              onSetGroupColor={viewTabs?.setGroupColor}
            />
          )}
        />
      </div>
      <PurchaseOrderPinnedViewTabs
        views={savedViews.views}
        activeViewId={activeViewId}
        onApplyView={applyViewState}
        order={pinnedOrder.order}
        onReorder={pinnedOrder.setOrder}
        canUnpin={canUnpin}
        onUnpin={handleUnpin}
      />
    </div>
  );
}
