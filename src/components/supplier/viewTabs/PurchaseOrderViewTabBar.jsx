import React, { useCallback, useMemo, useState } from 'react';
import {
  Tab,
  TabList,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import PurchaseOrderViewTabContextMenu from './PurchaseOrderViewTabContextMenu';
import PurchaseOrderViewTabHoverCard from './PurchaseOrderViewTabHoverCard';
import PurchaseOrderViewTabCaption from './PurchaseOrderViewTabCaption';
import PurchaseOrderViewTabBarScroller from './PurchaseOrderViewTabBarScroller';
import { useTabBarOverflow } from './useTabBarOverflow';
import { ALL_TAB_ID, groupColorForTab, hasExtraViewTabs } from '../../../utils/viewTabs';

const ALL_HOVER_TAB = { id: ALL_TAB_ID, name: 'All', extraFilters: {} };

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
  },
  tabList: {
    width: 'max-content',
    flexShrink: 0,
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
  },
  tab: {
    position: 'relative',
    maxWidth: '12ch',
    minHeight: '28px',
    flexShrink: 0,
    overflow: 'visible',
    ...shorthands.margin('0', '4px', '0', '0'),
    '::after': {
      display: 'none',
    },
  },
  tabActive: {
    backgroundColor: tokens.colorNeutralBackground4,
    fontWeight: tokens.fontWeightSemibold,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
});

export default function PurchaseOrderViewTabBar({
  activeTabId,
  extraTabs,
  groups,
  columns = [],
  canManage,
  unsavedExtraTabIds = [],
  onSelectTab,
  onRemoveTab,
  onSetGroupColor,
}) {
  const styles = useStyles();
  const [context, setContext] = useState({ open: false, x: 0, y: 0, tabId: '' });
  const [hover, setHover] = useState(null);
  const contentKey = useMemo(
    () => extraTabs.map((tab) => tab.id).join('|'),
    [extraTabs],
  );
  const { scrollerRef, overflow, canScrollLeft, canScrollRight, isDragging, scrollByPage } = useTabBarOverflow(
    contentKey,
    activeTabId,
  );

  const handleSelect = useCallback((_, data) => {
    onSelectTab(data.value);
  }, [onSelectTab]);

  const handleScrollLeft = useCallback(() => {
    scrollByPage(-1);
  }, [scrollByPage]);

  const handleScrollRight = useCallback(() => {
    scrollByPage(1);
  }, [scrollByPage]);

  const handleTabEnter = useCallback((event) => {
    const tabId = event.currentTarget.getAttribute('data-tab-id') || ALL_TAB_ID;
    const tab = tabId === ALL_TAB_ID
      ? ALL_HOVER_TAB
      : extraTabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHover({ tab, rect: { left: rect.left, top: rect.bottom } });
  }, [extraTabs]);

  const handleTabLeave = useCallback(() => {
    setHover(null);
  }, []);

  const handleContextMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const tabId = event.currentTarget.getAttribute('data-tab-id');
    if (!tabId || tabId === ALL_TAB_ID) return;
    setHover(null);
    setContext({ open: true, x: event.clientX, y: event.clientY, tabId });
  }, []);

  const handleContextOpenChange = useCallback((open) => {
    setContext((prev) => ({ ...prev, open }));
  }, []);

  if (!hasExtraViewTabs(extraTabs)) return null;

  return (
    <div className={styles.root} data-tour="po-view-tab-bar">
      <PurchaseOrderViewTabBarScroller
        overflow={overflow}
        isDragging={isDragging}
        canScrollLeft={canScrollLeft}
        canScrollRight={canScrollRight}
        scrollerRef={scrollerRef}
        onScrollLeft={handleScrollLeft}
        onScrollRight={handleScrollRight}
      >
        <TabList
          className={styles.tabList}
          appearance="subtle"
          selectedValue={activeTabId}
          onTabSelect={handleSelect}
          size="small"
        >
          <Tab
            className={mergeClasses(styles.tab, activeTabId === ALL_TAB_ID && styles.tabActive)}
            value={ALL_TAB_ID}
            data-tab-id={ALL_TAB_ID}
            onMouseEnter={handleTabEnter}
            onMouseLeave={handleTabLeave}
          >
            <PurchaseOrderViewTabCaption
              label="All"
              isActive={activeTabId === ALL_TAB_ID}
            />
          </Tab>
          {extraTabs.map((tab) => {
            const color = groupColorForTab(tab, groups);
            const isActive = activeTabId === tab.id;
            const hasUnsharedExtra = unsavedExtraTabIds.includes(tab.id);
            return (
              <Tab
                key={tab.id}
                className={mergeClasses(styles.tab, isActive && styles.tabActive)}
                value={tab.id}
                data-tab-id={tab.id}
                title={hasUnsharedExtra ? 'This tab has an extra filter not used on other tabs in the group' : undefined}
                onContextMenu={handleContextMenu}
                onMouseEnter={handleTabEnter}
                onMouseLeave={handleTabLeave}
              >
                <PurchaseOrderViewTabCaption
                  label={tab.name}
                  color={color}
                  isActive={isActive}
                  hasUnsharedExtra={hasUnsharedExtra}
                />
              </Tab>
            );
          })}
        </TabList>
      </PurchaseOrderViewTabBarScroller>
      <PurchaseOrderViewTabHoverCard tab={isDragging ? null : hover?.tab} columns={columns} anchorRect={hover?.rect} />
      <PurchaseOrderViewTabContextMenu
        open={context.open}
        x={context.x}
        y={context.y}
        tabId={context.tabId}
        extraTabs={extraTabs}
        groups={groups}
        columns={columns}
        canManage={canManage}
        onOpenChange={handleContextOpenChange}
        onRemoveTab={onRemoveTab}
        onSetGroupColor={onSetGroupColor}
      />
    </div>
  );
}
