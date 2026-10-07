import React, { useCallback, useMemo } from 'react';
import {
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
} from '@fluentui/react-components';
import { DeleteRegular } from '@fluentui/react-icons';
import PurchaseOrderViewTabGroupColorItem from './PurchaseOrderViewTabGroupColorItem';
import TabArrangeMenuItems from './TabArrangeMenuItems';
import { ALL_TAB_ID, inferGroupColumnKey } from '../../../utils/viewTabs';

const useStyles = makeStyles({
  anchor: {
    position: 'fixed',
    width: '1px',
    height: '1px',
    pointerEvents: 'none',
  },
});

export default function PurchaseOrderViewTabContextMenu({
  open,
  x,
  y,
  tabId,
  extraTabs,
  groups = [],
  columns = [],
  canManage,
  onOpenChange,
  onRemoveTab,
  onSetGroupColor,
  canArrange = false,
  onSort,
  onOpenReorder,
}) {
  const styles = useStyles();
  const tab = useMemo(
    () => extraTabs.find((entry) => entry.id === tabId) || null,
    [extraTabs, tabId]
  );
  const groupKey = tab ? inferGroupColumnKey(tab) : '';
  const group = groups.find((entry) => entry.columnKey === groupKey);
  const groupLabel = columns.find((column) => column.key === groupKey)?.label || groupKey;

  const handleOpenChange = useCallback((_, data) => {
    onOpenChange(Boolean(data.open));
  }, [onOpenChange]);

  const handleDeleteThis = useCallback(() => {
    if (tabId && tabId !== ALL_TAB_ID) onRemoveTab(tabId, 'tab');
    onOpenChange(false);
  }, [onRemoveTab, onOpenChange, tabId]);

  const handleDeleteGroup = useCallback(() => {
    if (tabId && tabId !== ALL_TAB_ID) onRemoveTab(tabId, 'group');
    onOpenChange(false);
  }, [onRemoveTab, onOpenChange, tabId]);

  if (!canManage || !tabId || tabId === ALL_TAB_ID) return null;

  return (
    <Menu open={open} onOpenChange={handleOpenChange}>
      <MenuTrigger disableButtonEnhancement>
        <span className={styles.anchor} style={{ left: `${x}px`, top: `${y}px` }} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {canArrange ? (
            <>
              <TabArrangeMenuItems
                sortHint={groups.length ? 'Per group' : ''}
                onSort={onSort}
                onOpenReorder={onOpenReorder}
              />
              <MenuDivider />
            </>
          ) : null}
          {groupKey ? (
            <PurchaseOrderViewTabGroupColorItem
              columnKey={groupKey}
              label="Group color"
              selectedColor={group?.color}
              onSetGroupColor={onSetGroupColor}
            />
          ) : null}
          {groupKey ? <MenuDivider /> : null}
          <MenuItem icon={<DeleteRegular />} onClick={handleDeleteThis}>This tab only</MenuItem>
          {groupKey ? (
            <MenuItem icon={<DeleteRegular />} onClick={handleDeleteGroup}>
              {groupLabel
                ? `All tabs with the same ${groupLabel} filter`
                : 'All tabs in this group'}
            </MenuItem>
          ) : null}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
