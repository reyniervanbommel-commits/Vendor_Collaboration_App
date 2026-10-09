import React from 'react';
import { makeStyles } from '@fluentui/react-components';
import { PurchaseOrderViewTabBar } from './viewTabs';
import { hasExtraViewTabs } from '../../utils/viewTabs';

const useStyles = makeStyles({
  wrap: {
    minWidth: 0,
    width: '100%',
    display: 'flex',
    alignItems: 'flex-end',
  },
});

export default function PurchaseOrderViewTabsHost({
  activeViewId,
  viewTabs,
  columns = [],
  canManage,
}) {
  const styles = useStyles();
  if (!activeViewId || !hasExtraViewTabs(viewTabs?.extraTabs)) return null;

  return (
    <div className={styles.wrap}>
      <PurchaseOrderViewTabBar
        activeTabId={viewTabs.activeTabId}
        extraTabs={viewTabs.extraTabs}
        groups={viewTabs.groups}
        canManage={canManage}
        unsavedExtraTabIds={viewTabs.unsavedExtraTabIds || []}
        onSelectTab={viewTabs.selectTab}
        onRemoveTab={viewTabs.removeTab}
        onSetGroupColor={viewTabs.setGroupColor}
        onReorderTabs={canManage ? viewTabs.reorderTabs : null}
        columns={columns}
        viewBaseFilters={viewTabs.viewBaseFilters}
      />
    </div>
  );
}
