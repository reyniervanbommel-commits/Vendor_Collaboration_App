import React, { memo, useCallback, useMemo } from 'react';
import { Button, Tab, TabList } from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import RemarkComposer from './RemarkComposer';
import RowActivityFeed from './RowActivityFeed';
import RowHistoryFeed from './RowHistoryFeed';
import { partitionActivityItems } from './historyTableModel';
import { usePurchaseOrderRemarksController } from './usePurchaseOrderRemarksController';
import { layout } from '../../../styles/brandTokens';
import './remarks.css';

function RemarksPanel({
  open,
  onClose,
  row,
  currentUser,
  columns = [],
  initialColumn = null,
  openerRef,
  tableKey = 'purchase-orders',
  summaryState = null,
  onLocateRow = null,
  canCompose = true,
}) {
  const controller = usePurchaseOrderRemarksController({
    open,
    onClose,
    row,
    initialColumn,
    openerRef,
    tableKey,
    summaryState,
  });
  const remarkItems = useMemo(
    () => controller.remarks.items.map((item) => ({ ...item, kind: 'remark' })),
    [controller.remarks.items]
  );
  const remarkActions = useMemo(
    () => ({
      onDelete: controller.remarks.deleteRemark,
      onReaction: controller.remarks.toggleReaction,
    }),
    [controller.remarks.deleteRemark, controller.remarks.toggleReaction]
  );
  const remarkCount = controller.remarks.total || controller.selectedSummary?.count || 0;
  const historyCount = controller.historyUpdatedCount;
  const showComposer = canCompose && controller.selectedTab !== 'history';
  const activeFeed = controller.selectedTab === 'history' ? controller.history : controller.all;
  const partitionedAll = useMemo(
    () => (controller.selectedTab === 'all' ? partitionActivityItems(activeFeed.items) : { remarks: [], history: [] }),
    [activeFeed.items, controller.selectedTab]
  );
  const allRemarkItems = useMemo(
    () => partitionedAll.remarks.map((item) => ({ ...item, kind: 'remark' })),
    [partitionedAll.remarks]
  );
  const orderNumber = row?.recordKey || row?.orderNumber || '';
  const handleLocateRow = useCallback(() => {
    onLocateRow?.();
  }, [onLocateRow]);
  const handleSubmitRemark = useCallback(
    async (body, columnId) => {
      const remark = await controller.remarks.createRemark(body, columnId);
      if (controller.selectedTab === 'all') await controller.all.refresh();
      return remark;
    },
    [controller.all, controller.remarks, controller.selectedTab]
  );

  const panelStyle = useMemo(
    () => ({
      top: `${layout.headerHeight}px`,
      height: `calc(100vh - ${layout.headerHeight}px)`,
    }),
    []
  );

  if (!open) return null;

  return (
    <aside
      className="remarks-side-panel"
      style={panelStyle}
      aria-label={`Remarks for purchase order ${orderNumber}`}
      data-tour="remarks-panel"
    >
      <header className="remarks-panel-header">
        <Button
          className="remarks-close-button"
          appearance="subtle"
          aria-label="Close remarks panel"
          icon={<Dismiss24Regular />}
          onClick={onClose}
        />
        <h2 className="remarks-heading">
          Purchase order{' '}
          {onLocateRow ? (
            <button
              type="button"
              className="remarks-order-locate-button"
              onClick={handleLocateRow}
              aria-label={`Go to purchase order ${orderNumber} in table`}
            >
              {orderNumber}
            </button>
          ) : (
            orderNumber
          )}
          {initialColumn?.label ? <span className="remarks-header-context"> · {initialColumn.label}</span> : null}
        </h2>
      </header>
      <div className="remarks-panel-body">
        <div className="remarks-panel">
          <TabList
            className="remarks-tabs"
            selectedValue={controller.selectedTab}
            onTabSelect={controller.onTabSelect}
            data-tour="remarks-tabs"
          >
            <Tab value="remarks">Remarks ({remarkCount})</Tab>
            <Tab value="history">History ({historyCount})</Tab>
            <Tab value="all">All</Tab>
          </TabList>

          {showComposer ? (
            <RemarkComposer
              currentUser={currentUser}
              column={initialColumn}
              onSubmit={handleSubmitRemark}
              textareaRef={controller.composerRef}
            />
          ) : null}

          {controller.selectedTab === 'remarks' ? (
            <RowActivityFeed
              items={remarkItems}
              loading={controller.remarks.loading}
              error={controller.remarks.error}
              hasMore={controller.remarks.hasMore}
              emptyMessage="No remarks have been added yet."
              currentUser={currentUser}
              onLoadOlder={controller.remarks.loadOlder}
              onRetry={controller.remarks.retry}
              remarkActions={remarkActions}
              olderLabel="Show older remarks"
            />
          ) : null}

          {controller.selectedTab === 'history' ? (
            <RowHistoryFeed
              items={controller.history.items}
              loading={controller.history.loading}
              error={controller.history.error}
              hasMore={controller.history.hasMore}
              emptyMessage="No history has been recorded yet."
              onLoadOlder={controller.history.loadOlder}
              onRetry={controller.history.retry}
              columns={columns}
              serverColumnId={controller.columnId}
              onServerColumnChange={controller.onColumnChange}
              serverActionFilter={controller.historyActionFilter}
              onServerActionFilterChange={controller.onHistoryActionFilterChange}
              useServerActionFilter
            />
          ) : null}

          {controller.selectedTab === 'all' ? (
            <>
              {allRemarkItems.length > 0 ? (
                <RowActivityFeed
                  items={allRemarkItems}
                  loading={false}
                  error=""
                  hasMore={false}
                  emptyMessage=""
                  currentUser={currentUser}
                  onLoadOlder={activeFeed.loadOlder}
                  onRetry={activeFeed.retry}
                  remarkActions={remarkActions}
                  olderLabel="Show older activity"
                />
              ) : null}
              {partitionedAll.history.length > 0 || activeFeed.loading || activeFeed.hasMore ? (
                <RowHistoryFeed
                  items={partitionedAll.history}
                  loading={activeFeed.loading}
                  error={activeFeed.error}
                  hasMore={activeFeed.hasMore}
                  emptyMessage="No history has been recorded yet."
                  onLoadOlder={activeFeed.loadOlder}
                  onRetry={activeFeed.retry}
                  columns={columns}
                  serverColumnId={controller.columnId}
                  onServerColumnChange={controller.onColumnChange}
                />
              ) : (
                !activeFeed.loading && allRemarkItems.length === 0 ? (
                  <div className="remarks-state">No activity has been recorded yet.</div>
                ) : null
              )}
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export default memo(RemarksPanel);
