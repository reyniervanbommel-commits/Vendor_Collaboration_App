import React, { useCallback } from 'react';
import {
  Button,
  MenuItem,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { Pin16Filled, Pin16Regular, StarFilled } from '@fluentui/react-icons';
import { viewScopeLabel } from '../../utils/viewTabs';
import { viewShowsAsTab } from '../../utils/savedViewDisplay';
import SavedViewScopeIcon from './SavedViewScopeIcon';
import SavedViewHistoryMiniMenu from './SavedViewHistoryMiniMenu';

const PIN_CLASS = 'po-view-pin';

const useStyles = makeStyles({
  viewMenuItem: {
    // Idle pins are faint; they surface on row hover/focus so the list stays calm.
    [`&:hover .${PIN_CLASS}, &:focus-within .${PIN_CLASS}`]: {
      opacity: 1,
    },
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
    gridTemplateColumns: 'minmax(0, 1fr) 22px 24px',
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
  // Full name, wrapping onto a second line when the menu is too narrow.
  viewName: {
    minWidth: 0,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    lineHeight: tokens.lineHeightBase300,
    ...shorthands.padding('2px', '0'),
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground1,
  },
  star: {
    fontSize: '12px',
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  pin: {
    minWidth: '24px',
    width: '24px',
    height: '24px',
    ...shorthands.padding('0'),
    color: tokens.colorNeutralForeground3,
    opacity: 0.45,
    ':hover': {
      color: tokens.colorBrandForeground1,
    },
  },
  pinOn: {
    opacity: 1,
    color: tokens.colorBrandForeground1,
  },
});

export function canToggleViewMeta(view, canManageGlobal) {
  if (!view.id) return true;
  if (view.scope === 'personal') return true;
  return canManageGlobal;
}

function pinTitle(pinned, canToggle) {
  if (!canToggle) return pinned ? 'Pinned (only staff can change shared views)' : 'Only staff can pin shared views';
  return pinned ? 'Unpin from the tab bar' : 'Pin to the tab bar';
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
  const labelText = [view.name, viewScopeLabel(view)].filter(Boolean).join(' ');

  const handleToggleHistory = useCallback((event, data) => {
    event.stopPropagation();
    onToggleShowHistory(view, data.checked);
  }, [onToggleShowHistory, view]);

  const handleTogglePin = useCallback((event) => {
    event.stopPropagation();
    onToggleShowAsTab(view, !showAsTab);
  }, [onToggleShowAsTab, showAsTab, view]);

  // Enter/Space on the pin must not also apply the view via the parent MenuItem.
  const handlePinKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
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
          <span className={styles.viewName}>{view.name}</span>
          {view.isDefault ? <StarFilled className={styles.star} aria-label="Default view" /> : null}
        </span>
        <SavedViewHistoryMiniMenu
          checked={showHistory}
          disabled={!canToggleMeta}
          onChange={handleToggleHistory}
        />
        {view.id ? (
          <Button
            appearance="transparent"
            size="small"
            className={mergeClasses(PIN_CLASS, styles.pin, showAsTab && styles.pinOn)}
            icon={showAsTab ? <Pin16Filled /> : <Pin16Regular />}
            aria-pressed={showAsTab}
            aria-label={showAsTab ? `Unpin ${view.name}` : `Pin ${view.name} as a tab`}
            title={pinTitle(showAsTab, canToggleMeta)}
            disabledFocusable={!canToggleMeta}
            onClick={handleTogglePin}
            onKeyDown={handlePinKeyDown}
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
