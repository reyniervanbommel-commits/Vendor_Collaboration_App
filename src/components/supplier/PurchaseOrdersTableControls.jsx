import React, { memo, useCallback } from 'react';
import {
  Button,
  Checkbox,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  Filter20Regular,
  TextBulletList20Regular,
} from '@fluentui/react-icons';
import { purchaseOrderBoardControlColumnWidth } from './purchaseOrderBoardLayout';
import { SUBITEM_CONNECTOR_COLOR } from './purchaseOrderSubitemConnectorStyles';

function FilterIconThick20() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="4.5" width="13" height="2" rx="1" />
      <rect x="5.5" y="8.75" width="9" height="2" rx="1" />
      <rect x="7.5" y="13" width="5" height="2" rx="1" />
    </svg>
  );
}

const CONTROL_ICON_SIZE = '22px';

const useStyles = makeStyles({
  controlHeaderCell: {
    backgroundColor: tokens.colorNeutralBackground2,
    position: 'sticky',
    top: 0,
    left: 0,
    zIndex: 4,
    width: purchaseOrderBoardControlColumnWidth,
    minWidth: purchaseOrderBoardControlColumnWidth,
    maxWidth: purchaseOrderBoardControlColumnWidth,
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRight('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.padding('10px', '2px'),
    textAlign: 'left',
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    height: CONTROL_ICON_SIZE,
    ...shorthands.gap('2px'),
  },
  selectAll: {
    ...shorthands.padding('0'),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: CONTROL_ICON_SIZE,
    height: CONTROL_ICON_SIZE,
    minWidth: CONTROL_ICON_SIZE,
    minHeight: CONTROL_ICON_SIZE,
  },
  selectAllIndicator: {
    ...shorthands.margin('0'),
    alignSelf: 'center',
  },
  selectAllInput: {
    width: CONTROL_ICON_SIZE,
    height: CONTROL_ICON_SIZE,
  },
  button: {
    minWidth: CONTROL_ICON_SIZE,
    width: CONTROL_ICON_SIZE,
    height: CONTROL_ICON_SIZE,
    ...shorthands.padding('0'),
  },
  filterIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterIconActive: {
    color: SUBITEM_CONNECTOR_COLOR,
  },
});

function PurchaseOrdersTableControls({
  onSetExpansion,
  productImageColumnVisible = true,
  onToggleProductImageColumn,
  selectionEnabled = false,
  allSelected = false,
  someSelected = false,
  onToggleAll,
  hasActive = false,
  onOpenFlyout,
}) {
  const styles = useStyles();
  const expandAll = useCallback(() => onSetExpansion('all', true), [onSetExpansion]);
  const expandGroups = useCallback(() => onSetExpansion('boards', true), [onSetExpansion]);
  const expandSubitems = useCallback(() => onSetExpansion('groups', true), [onSetExpansion]);
  const collapseAll = useCallback(() => onSetExpansion('all', false), [onSetExpansion]);
  const collapseGroups = useCallback(() => onSetExpansion('boards', false), [onSetExpansion]);
  const collapseSubitems = useCallback(() => onSetExpansion('groups', false), [onSetExpansion]);
  const hideProductImageColumn = useCallback(() => {
    onToggleProductImageColumn?.(false);
  }, [onToggleProductImageColumn]);
  const showProductImageColumn = useCallback(() => {
    onToggleProductImageColumn?.(true);
  }, [onToggleProductImageColumn]);
  const openFlyout = useCallback(() => {
    onOpenFlyout?.();
  }, [onOpenFlyout]);
  const filterButtonLabel = hasActive
    ? 'Show active filters and formatting (active)'
    : 'Show active filters and formatting';
  const filterIcon = (
    <span className={mergeClasses(styles.filterIcon, hasActive && styles.filterIconActive)}>
      {hasActive ? <FilterIconThick20 /> : <Filter20Regular />}
    </span>
  );

  return (
    <th className={styles.controlHeaderCell} aria-label="Table display controls">
      <div className={styles.toolbar}>
        {selectionEnabled ? (
          <Checkbox
            size="large"
            className={styles.selectAll}
            indicator={{ className: styles.selectAllIndicator }}
            input={{ className: styles.selectAllInput }}
            checked={allSelected ? true : (someSelected ? 'mixed' : false)}
            onChange={onToggleAll}
            aria-label="Select all rows"
            title="Select all rows"
          />
        ) : null}
        <Menu positioning="below-start">
          <MenuTrigger disableButtonEnhancement>
            <Button
              size="small"
              appearance="subtle"
              className={styles.button}
              icon={<TextBulletList20Regular />}
              title="Table options"
              aria-label="Table options"
              data-tour="po-table-options"
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>Expand</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={expandAll}>All</MenuItem>
                    <MenuItem onClick={expandGroups}>Groups</MenuItem>
                    <MenuItem onClick={expandSubitems}>Subitems</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>Collapse</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={collapseAll}>All</MenuItem>
                    <MenuItem onClick={collapseGroups}>Groups</MenuItem>
                    <MenuItem onClick={collapseSubitems}>Subitems</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              {typeof onToggleProductImageColumn === 'function' ? (
                <>
                  <MenuDivider />
                  {productImageColumnVisible ? (
                    <MenuItem onClick={hideProductImageColumn}>Hide image column</MenuItem>
                  ) : (
                    <MenuItem onClick={showProductImageColumn}>Show image column</MenuItem>
                  )}
                </>
              ) : null}
            </MenuList>
          </MenuPopover>
        </Menu>
        {typeof onOpenFlyout === 'function' ? (
          <Button
            size="small"
            appearance="subtle"
            className={mergeClasses(styles.button, hasActive && styles.filterIconActive)}
            icon={filterIcon}
            title={filterButtonLabel}
            aria-label={filterButtonLabel}
            onClick={openFlyout}
            data-tour="po-active-filters"
          />
        ) : null}
      </div>
    </th>
  );
}

export default memo(PurchaseOrdersTableControls);
