import React, { useCallback } from 'react';
import {
  MenuItem,
  Switch,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { StarFilled } from '@fluentui/react-icons';
import { viewScopeLabel } from '../../utils/viewTabs';
import { truncateViewName, viewShowsAsTab } from '../../utils/savedViewDisplay';
import SavedViewScopeIcon from './SavedViewScopeIcon';
import SavedViewHistoryMiniMenu from './SavedViewHistoryMiniMenu';

const useStyles = makeStyles({
  viewMenuItem: {
    ...shorthands.padding('0'),
    maxWidth: '100%',
    minWidth: 0,
    minHeight: '24px',
    overflow: 'hidden',
  },
  viewMenuItemContent: {
    minWidth: 0,
    maxWidth: '100%',
    minHeight: '24px',
    overflow: 'hidden',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  viewMenuItemActive: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Selected,
    },
  },
  viewMenuItemRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 22px auto',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    minHeight: '24px',
    ...shorthands.padding('0', tokens.spacingHorizontalS),
  },
  viewNameCell: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    overflow: 'hidden',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  viewName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground1,
  },
  star: {
    fontSize: '12px',
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  tabSwitch: {
    flexShrink: 0,
    transform: 'scale(0.72)',
    transformOrigin: 'center center',
    marginLeft: '-6px',
  },
});

function canToggleViewMeta(view, canManageGlobal) {
  if (!view.id) return true;
  if (view.scope === 'personal') return true;
  return canManageGlobal;
}

export function SavedViewMenuItem({
  view,
  activeViewId,
  onApplyView,
  onToggleShowHistory,
  onToggleShowAsTab,
  canManageGlobal,
}) {
  const styles = useStyles();
  const isActive = view.id === activeViewId;
  const showHistory = view.viewState?.showHistoryIndicators !== false;
  const showAsTab = viewShowsAsTab(view);
  const canToggleMeta = canToggleViewMeta(view, canManageGlobal);
  const displayName = truncateViewName(view.name);
  const labelText = [view.name, viewScopeLabel(view)].filter(Boolean).join(' ');

  const handleToggleHistory = useCallback((event, data) => {
    event.stopPropagation();
    onToggleShowHistory(view, data.checked);
  }, [onToggleShowHistory, view]);

  const handleToggleTab = useCallback((event, data) => {
    event.stopPropagation();
    onToggleShowAsTab(view, data.checked);
  }, [onToggleShowAsTab, view]);

  const handleSwitchClick = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handleApply = useCallback(() => {
    onApplyView(view);
  }, [onApplyView, view]);

  return (
    <MenuItem
      className={mergeClasses(styles.viewMenuItem, isActive && styles.viewMenuItemActive)}
      content={{ className: styles.viewMenuItemContent }}
      aria-current={isActive ? 'true' : undefined}
      onClick={handleApply}
    >
      <span className={styles.viewMenuItemRow}>
        <span className={styles.viewNameCell} title={labelText}>
          <SavedViewScopeIcon scope={view.scope} hasId={Boolean(view.id)} />
          <span className={styles.viewName}>{displayName}</span>
          {view.isDefault ? <StarFilled className={styles.star} aria-label="Default view" /> : null}
        </span>
        <SavedViewHistoryMiniMenu
          checked={showHistory}
          disabled={!canToggleMeta}
          onChange={handleToggleHistory}
        />
        {view.id ? (
          <Switch
            className={styles.tabSwitch}
            checked={showAsTab}
            disabled={!canToggleMeta}
            aria-label="Show as tab"
            title="Show as tab"
            onClick={handleSwitchClick}
            onChange={handleToggleTab}
          />
        ) : (
          <span />
        )}
      </span>
    </MenuItem>
  );
}

export function SavedViewScopeGroup({
  views,
  activeViewId,
  onApplyView,
  onToggleShowHistory,
  onToggleShowAsTab,
  canManageGlobal,
}) {
  if (!views.length) return null;
  return views.map((view) => (
    <SavedViewMenuItem
      key={view.id}
      view={view}
      activeViewId={activeViewId}
      onApplyView={onApplyView}
      onToggleShowHistory={onToggleShowHistory}
      onToggleShowAsTab={onToggleShowAsTab}
      canManageGlobal={canManageGlobal}
    />
  ));
}
