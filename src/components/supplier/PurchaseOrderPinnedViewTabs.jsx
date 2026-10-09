import React, { useCallback, useMemo, useState } from 'react';
import {
  Tab,
  TabList,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { Pin16Regular } from '@fluentui/react-icons';
import { viewShowsAsTab } from '../../utils/savedViewDisplay';
import SavedViewScopeIcon from './SavedViewScopeIcon';
import PurchaseOrderViewTabBarScroller from './viewTabs/PurchaseOrderViewTabBarScroller';
import { useTabBarOverflow } from './viewTabs/useTabBarOverflow';
import TabReorderDialog from './viewTabs/TabReorderDialog';
import PurchaseOrderPinnedViewTabContextMenu from './PurchaseOrderPinnedViewTabContextMenu';
import { orderItemsByIds, sortItemsByName } from '../../utils/tabOrder';

const CLOSED_CONTEXT = { open: false, x: 0, y: 0, viewId: '' };

// Pinned views are pills (scope icon + full name), deliberately unlike the underlined
// column tabs below, so "switch view" and "filter within view" never look alike.
const useStyles = makeStyles({
  root: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
  },
  marker: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    height: '20px',
    paddingLeft: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground3,
    ...shorthands.borderLeft('1px', 'solid', tokens.colorNeutralStroke2),
  },
  tabList: {
    width: 'max-content',
    flexShrink: 0,
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    paddingBottom: tokens.spacingVerticalXXS,
  },
  // Colors come from Fluent's filled-circular appearance (active = brand blue, on-brand text).
  pill: {
    flexShrink: 0,
    maxWidth: 'none',
  },
  pillName: {
    whiteSpace: 'nowrap',
  },
});

export default function PurchaseOrderPinnedViewTabs({
  views,
  activeViewId,
  onApplyView,
  order = [],
  onReorder = null,
  canUnpin = () => false,
  onUnpin = null,
}) {
  const styles = useStyles();
  const [context, setContext] = useState(CLOSED_CONTEXT);
  const [reorderOpen, setReorderOpen] = useState(false);
  // Per-user order; views pinned after the last reorder are appended in server order.
  const pinnedViews = useMemo(
    () => orderItemsByIds(views.filter(viewShowsAsTab), order),
    [order, views],
  );
  const contextView = pinnedViews.find((view) => String(view.id) === context.viewId) || null;
  const reorderItems = useMemo(() => pinnedViews.map((view) => ({
    id: String(view.id),
    name: view.name,
    icon: <SavedViewScopeIcon scope={view.scope} />,
  })), [pinnedViews]);
  const activeTabId = activeViewId == null ? '' : String(activeViewId);
  const contentKey = useMemo(() => pinnedViews.map((view) => `${view.id}:${view.name}`).join('|'), [pinnedViews]);
  const { scrollerRef, overflow, canScrollLeft, canScrollRight, isDragging, scrollByPage } = useTabBarOverflow(
    contentKey,
    activeTabId,
  );

  const handleSelect = useCallback((_, data) => {
    const view = pinnedViews.find((entry) => String(entry.id) === String(data.value));
    if (view) onApplyView(view);
  }, [onApplyView, pinnedViews]);

  const handleScrollLeft = useCallback(() => scrollByPage(-1), [scrollByPage]);
  const handleScrollRight = useCallback(() => scrollByPage(1), [scrollByPage]);

  const handleContextMenu = useCallback((event) => {
    if (!onReorder) return;
    event.preventDefault();
    const viewId = event.currentTarget.getAttribute('data-tab-id') || '';
    setContext({ open: true, x: event.clientX, y: event.clientY, viewId });
  }, [onReorder]);

  const handleContextOpenChange = useCallback((open) => {
    setContext((prev) => ({ ...prev, open }));
  }, []);

  const handleSort = useCallback((direction) => {
    onReorder(sortItemsByName(pinnedViews, direction).map((view) => String(view.id)));
  }, [onReorder, pinnedViews]);

  const handleUnpin = useCallback(() => {
    if (contextView) onUnpin?.(contextView);
  }, [contextView, onUnpin]);

  if (!pinnedViews.length) return null;

  return (
    <div className={styles.root} data-tour="po-pinned-view-tabs">
      <span className={styles.marker} title="Pinned views">
        <Pin16Regular aria-hidden />
      </span>
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
          appearance="filled-circular"
          selectedValue={activeTabId}
          onTabSelect={handleSelect}
          size="small"
          aria-label="Pinned views"
        >
          {pinnedViews.map((view) => {
            const isActive = String(view.id) === activeTabId;
            return (
              <Tab
                key={view.id}
                className={styles.pill}
                value={String(view.id)}
                data-tab-id={String(view.id)}
                aria-current={isActive ? 'page' : undefined}
                onContextMenu={handleContextMenu}
                icon={<SavedViewScopeIcon scope={view.scope} inheritColor />}
              >
                <span className={styles.pillName}>{view.name}</span>
              </Tab>
            );
          })}
        </TabList>
      </PurchaseOrderViewTabBarScroller>
      {onReorder ? (
        <>
          <PurchaseOrderPinnedViewTabContextMenu
            open={context.open}
            x={context.x}
            y={context.y}
            canUnpin={Boolean(contextView && onUnpin && canUnpin(contextView))}
            onOpenChange={handleContextOpenChange}
            onSort={handleSort}
            onOpenReorder={() => setReorderOpen(true)}
            onUnpin={handleUnpin}
          />
          <TabReorderDialog
            open={reorderOpen}
            title="Reorder pinned views"
            items={reorderItems}
            hint="Only you see this order."
            onOpenChange={setReorderOpen}
            onApply={onReorder}
          />
        </>
      ) : null}
    </div>
  );
}
