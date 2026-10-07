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
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  tab: {
    minHeight: '22px',
    height: '22px',
    flexShrink: 0,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.padding('0', tokens.spacingHorizontalS),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    ...shorthands.borderRadius(tokens.borderRadiusCircular),
    '::after': {
      display: 'none',
    },
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
  },
  tabActive: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightRegular,
    ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
    ':hover': {
      backgroundColor: tokens.colorBrandBackground2Hover,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
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
