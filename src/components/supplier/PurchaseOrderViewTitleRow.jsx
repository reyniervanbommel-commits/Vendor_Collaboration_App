import React from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import PurchaseOrderSavedViewsControl from './PurchaseOrderSavedViewsControl';
import PurchaseOrderPinnedViewTabs from './PurchaseOrderPinnedViewTabs';
import PurchaseOrderViewTabMenuSection from './viewTabs/PurchaseOrderViewTabMenuSection';

const useStyles = makeStyles({
  row: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '100%',
    columnGap: tokens.spacingHorizontalL,
  },
  viewTitle: {
    flexShrink: 0,
    width: '25ch',
    minWidth: '25ch',
    overflow: 'visible',
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
    handleSetDefault,
    handleDeleteView,
    handleToggleShowHistory,
    handleToggleShowAsTab,
    allOrdersShowHistoryIndicators,
    viewTabs,
  } = savedViewsState;

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
          onSetDefault={handleSetDefault}
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
      />
    </div>
  );
}
