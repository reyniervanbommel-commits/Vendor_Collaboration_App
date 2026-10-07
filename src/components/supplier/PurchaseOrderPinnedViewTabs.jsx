import React, { useCallback, useMemo } from 'react';
import {
  Tab,
  TabList,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { truncateViewName, viewShowsAsTab } from '../../utils/savedViewDisplay';

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
  },
  tabList: {
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
    ...shorthands.gap(tokens.spacingHorizontalS),
  },
  tab: {
    minHeight: '28px',
    height: '28px',
    flexShrink: 0,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground1,
    ...shorthands.padding('0', tokens.spacingHorizontalM),
    '::after': {
      display: 'none',
    },
  },
  tabActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    ...shorthands.borderRadius(tokens.borderRadiusCircular),
    ':hover': {
      backgroundColor: tokens.colorBrandBackgroundHover,
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
});

export default function PurchaseOrderPinnedViewTabs({
  views,
  activeViewId,
  onApplyView,
}) {
  const styles = useStyles();
  const pinnedViews = useMemo(() => views.filter(viewShowsAsTab), [views]);

  const handleSelect = useCallback((_, data) => {
    const view = pinnedViews.find((entry) => String(entry.id) === String(data.value));
    if (view) onApplyView(view);
  }, [onApplyView, pinnedViews]);

  if (!pinnedViews.length) return null;

  return (
    <div className={styles.root}>
      <TabList
        className={styles.tabList}
        appearance="subtle"
        selectedValue={activeViewId == null ? '' : String(activeViewId)}
        onTabSelect={handleSelect}
        size="small"
      >
        {pinnedViews.map((view) => {
          const isActive = view.id === activeViewId;
          return (
            <Tab
              key={view.id}
              className={mergeClasses(styles.tab, isActive && styles.tabActive)}
              value={String(view.id)}
              title={view.name}
            >
              {truncateViewName(view.name)}
            </Tab>
          );
        })}
      </TabList>
    </div>
  );
}
