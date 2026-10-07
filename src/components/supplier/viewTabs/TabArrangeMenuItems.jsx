import React from 'react';
import {
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
} from '@fluentui/react-components';
import {
  ReOrderDotsVertical16Regular,
  TextSortAscending16Regular,
  TextSortDescending16Regular,
} from '@fluentui/react-icons';

/**
 * "Arrange" block shared by the pinned-view and column-tab context menus:
 * alphabetical sort, and the drag dialog for manual ordering.
 */
export default function TabArrangeMenuItems({
  sortHint = '',
  onSort,
  onOpenReorder,
}) {
  return (
    <MenuGroup>
      <MenuGroupHeader>Arrange</MenuGroupHeader>
      <MenuItem icon={<TextSortAscending16Regular />} secondaryContent={sortHint} onClick={() => onSort('asc')}>
        Sort A to Z
      </MenuItem>
      <MenuItem icon={<TextSortDescending16Regular />} secondaryContent={sortHint} onClick={() => onSort('desc')}>
        Sort Z to A
      </MenuItem>
      <MenuItem icon={<ReOrderDotsVertical16Regular />} onClick={onOpenReorder}>
        Reorder tabs…
      </MenuItem>
    </MenuGroup>
  );
}
