import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import PurchaseOrderBulkActionsBar from './PurchaseOrderBulkActionsBar';
import PurchaseOrderSyncStatus from './PurchaseOrderSyncStatus';
import PurchaseOrderViewTitleRow from './PurchaseOrderViewTitleRow';
import PurchaseOrderViewTabsHost from './PurchaseOrderViewTabsHost';
import PurchaseOrderSaveTabsDialog from './viewTabs/PurchaseOrderSaveTabsDialog';
import { useViewTabsActions } from './viewTabs/ViewTabsDialogsProvider';
import { ALL_TAB_ID, hasExtraViewTabs, inferGroupColumnKey } from '../../utils/viewTabs';
import PurchaseOrderHiddenRowsPanel from './PurchaseOrderHiddenRowsPanel';
import PurchaseOrderErrorDialog from './PurchaseOrderErrorDialog';
import PurchaseOrderChangeActivityBar from './PurchaseOrderChangeActivityBar';
import { useAuth } from '../../context/AuthContext';

const useStyles = makeStyles({
  contentInset: {
    paddingLeft: '24px',
    paddingRight: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: '24px',
    marginBottom: '8px',
  },
  titleWrap: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 },
  tableName: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    lineHeight: '1',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: tokens.spacingVerticalS,
    flexWrap: 'wrap',
  },
  toolbarWithTabs: {
    marginBottom: 0,
  },
  tabsMount: {
    display: 'flex',
    alignItems: 'flex-end',
    minWidth: 0,
    marginBottom: 0,
  },
  errorIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
});

export default function PurchaseOrdersPageTopBar({
  savedViewsState,
  headerState,
  activityState,
  bulkState,
  hiddenRowsState,
  refreshState,
  onExportExcel,
  error,
  columns = [],
}) {
  const styles = useStyles();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const {
    savedViews,
    activeViewId,
    handleSaveAsNew,
    handleUpdateActive,
    viewTabs,
  } = savedViewsState;
  const { openCreateTabs } = useViewTabsActions();
  const [saveTabsOpen, setSaveTabsOpen] = useState(false);
  const {
    isStaff,
    hasCache,
    lastRefreshedLabel,
    visibleCount,
    total,
  } = headerState;
  const {
    newCount,
    changedCount,
    removedCount,
    markViewed,
    markingViewed,
    activityFilter,
    toggleActivityFilter,
  } = activityState;
  const {
    selectedCount,
    onDeleteSelected,
    onClearSelection,
  } = bulkState;
  const {
    refreshing,
    onRefresh,
  } = refreshState;
  const hasError = Boolean(error);

  useEffect(() => {
    if (hasError) setErrorDialogOpen(true);
  }, [hasError]);

  const openErrorDialog = useCallback(() => {
    setErrorDialogOpen(true);
  }, []);

  const closeErrorDialog = useCallback((open) => {
    setErrorDialogOpen(Boolean(open));
  }, []);

  const activeView = useMemo(
    () => savedViews.views.find((view) => view.id === activeViewId) || null,
    [savedViews.views, activeViewId]
  );
  const groupLabel = useMemo(() => {
    const tab = viewTabs?.extraTabs?.find((entry) => entry.id === viewTabs.activeTabId);
    const key = tab ? inferGroupColumnKey(tab) : '';
    const column = columns.find((entry) => entry.key === key);
    return column?.label || key;
  }, [columns, viewTabs]);

  const onSaveAsNew = useCallback(async (payload) => {
    await handleSaveAsNew(payload);
    openCreateTabs();
  }, [handleSaveAsNew, openCreateTabs]);

  const onRequestUpdate = useCallback(() => {
    if (!activeView) return;
    if (viewTabs?.activeTabId && viewTabs.activeTabId !== ALL_TAB_ID) {
      setSaveTabsOpen(true);
      return;
    }
    handleUpdateActive(activeView, 'all');
  }, [activeView, handleUpdateActive, viewTabs]);

  const onSaveTabs = useCallback(async (scope) => {
    if (!activeView) return;
    await handleUpdateActive(activeView, scope);
  }, [activeView, handleUpdateActive]);

  const showViewTabs = Boolean(activeViewId && hasExtraViewTabs(viewTabs?.extraTabs));

  return (
    <div className={styles.contentInset}>
      <div className={styles.header}>
        <div className={styles.titleWrap}>
          <div className={styles.tableName}>Master plan purchase orders</div>
          <PurchaseOrderViewTitleRow
            savedViewsState={savedViewsState}
            isStaff={isStaff}
            columns={columns}
            onExportExcel={onExportExcel}
            onSaveAsNew={onSaveAsNew}
            onRequestUpdate={onRequestUpdate}
          />
        </div>

        <div className={styles.headerRight}>
          {hiddenRowsState ? (
            <PurchaseOrderHiddenRowsPanel
              hiddenRows={hiddenRowsState.hiddenRows}
              columns={hiddenRowsState.columns}
              count={hiddenRowsState.count}
              loading={hiddenRowsState.loading}
              restoring={hiddenRowsState.restoring}
              onRestore={hiddenRowsState.restoreRows}
            />
          ) : null}
          {error ? (
            <div className={styles.errorIndicator}>
              <Badge color="danger" appearance="filled">Request failed</Badge>
              <Button appearance="subtle" size="small" onClick={openErrorDialog}>
                What went wrong?
              </Button>
            </div>
          ) : null}
          <PurchaseOrderSyncStatus
            hasCache={hasCache}
            lastRefreshedLabel={lastRefreshedLabel}
            visibleCount={visibleCount}
            total={total}
            refreshing={refreshing}
          />
        </div>
      </div>

      <div className={mergeClasses(styles.toolbar, showViewTabs && styles.toolbarWithTabs)}>
        <PurchaseOrderChangeActivityBar
          newCount={newCount}
          changedCount={changedCount}
          removedCount={removedCount}
          markViewed={markViewed}
          markingViewed={markingViewed}
          canMarkViewed
          activityFilter={activityFilter}
          toggleActivityFilter={toggleActivityFilter}
        />

        <PurchaseOrderBulkActionsBar
          selectedCount={selectedCount}
          onDelete={onDeleteSelected}
          onClear={onClearSelection}
        />
      </div>

      {showViewTabs ? (
        <div className={styles.tabsMount}>
          <PurchaseOrderViewTabsHost
            activeViewId={activeViewId}
            viewTabs={viewTabs}
            columns={columns}
            canManage={isStaff}
          />
        </div>
      ) : null}

      {error ? (
        <PurchaseOrderErrorDialog
          error={error}
          open={errorDialogOpen}
          onOpenChange={closeErrorDialog}
          onRefresh={onRefresh}
          refreshing={refreshing}
          canRefresh={isAdmin}
        />
      ) : null}
      <PurchaseOrderSaveTabsDialog
        open={saveTabsOpen}
        groupLabel={groupLabel}
        confirmLabel="Save"
        title="Save tab changes"
        fieldLabel="What should be saved?"
        onOpenChange={setSaveTabsOpen}
        onSubmit={onSaveTabs}
      />
    </div>
  );
}
