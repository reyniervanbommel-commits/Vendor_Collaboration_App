import React, { useCallback } from 'react';
import {
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import { ColorRegular, TabAddRegular } from '@fluentui/react-icons';
import PurchaseOrderViewTabGroupColorItem from './PurchaseOrderViewTabGroupColorItem';
import { useViewTabsActions } from './ViewTabsDialogsProvider';

export default function PurchaseOrderViewTabMenuSection({
  enabled,
  groups = [],
  columns = [],
  onSetGroupColor,
}) {
  const { openNewTab, openCreateTabs } = useViewTabsActions();
  const handleOpenCreateTabs = useCallback(() => openCreateTabs(), [openCreateTabs]);

  if (!enabled) return null;

  return (
    <>
      <MenuDivider />
      <MenuGroup>
        <MenuGroupHeader>Tabs</MenuGroupHeader>
        <MenuItem icon={<TabAddRegular />} onClick={openNewTab}>Tab</MenuItem>
        <MenuItem icon={<TabAddRegular />} onClick={handleOpenCreateTabs}>Tabs from column…</MenuItem>
        {groups.length > 0 ? (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<ColorRegular />}>Group colors</MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {groups.map((group) => (
                  <PurchaseOrderViewTabGroupColorItem
                    key={group.columnKey}
                    columnKey={group.columnKey}
                    label={columns.find((column) => column.key === group.columnKey)?.label || group.columnKey}
                    selectedColor={group.color}
                    onSetGroupColor={onSetGroupColor}
                  />
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        ) : null}
      </MenuGroup>
    </>
  );
}
