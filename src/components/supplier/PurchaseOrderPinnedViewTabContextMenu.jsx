import React, { useCallback } from 'react';
import {
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
} from '@fluentui/react-components';
import { PinOff16Regular } from '@fluentui/react-icons';
import TabArrangeMenuItems from './viewTabs/TabArrangeMenuItems';

const useStyles = makeStyles({
  anchor: {
    position: 'fixed',
    width: '1px',
    height: '1px',
    pointerEvents: 'none',
  },
});

export default function PurchaseOrderPinnedViewTabContextMenu({
  open,
  x,
  y,
  canUnpin,
  onOpenChange,
  onSort,
  onOpenReorder,
  onUnpin,
}) {
  const styles = useStyles();
  const handleOpenChange = useCallback((_, data) => onOpenChange(Boolean(data.open)), [onOpenChange]);

  return (
    <Menu open={open} onOpenChange={handleOpenChange}>
      <MenuTrigger disableButtonEnhancement>
        <span className={styles.anchor} style={{ left: `${x}px`, top: `${y}px` }} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <TabArrangeMenuItems
            onSort={onSort}
            onOpenReorder={onOpenReorder}
          />
          {canUnpin ? (
            <>
              <MenuDivider />
              <MenuItem icon={<PinOff16Regular />} onClick={onUnpin}>Unpin</MenuItem>
            </>
          ) : null}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
