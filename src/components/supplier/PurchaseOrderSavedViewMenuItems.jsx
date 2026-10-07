import React, { useCallback } from 'react';
import {
  MenuItem,
  Switch,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { ClockRegular } from '@fluentui/react-icons';
import { viewScopeLabel, viewVendorAccount } from '../../utils/viewTabs';

const useStyles = makeStyles({
  viewMenuItem: {
    ...shorthands.padding('0'),
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
  },
  viewMenuItemContent: {
    minWidth: 0,
    maxWidth: '100%',
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
    gridTemplateColumns: 'minmax(0, 1fr) 4.75rem auto',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
  },
  viewNameCell: {
    display: 'flex',
    alignItems: 'baseline',
    minWidth: 0,
    overflow: 'hidden',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  viewName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  metaSuffix: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
  },
  vendorSuffix: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    textDecorationLine: 'underline',
  },
  scopeCell: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    textAlign: 'end',
    whiteSpace: 'nowrap',
  },
  historyControl: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    ...shorthands.gap('0'),
  },
  historyIcon: {
    fontSize: '14px',
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    marginLeft: '4px',
    marginRight: '-2px',
  },
  historySwitch: {
    flexShrink: 0,
    transform: 'scale(0.72)',
    transformOrigin: 'center center',
    marginLeft: '-6px',
  },
});

function canToggleViewHistory(view, canManageGlobal) {
  if (view.scope === 'personal') return true;
  return canManageGlobal;
}

export function SavedViewMenuItem({
  view,
  activeViewId,
  onApplyView,
  onToggleShowHistory,
  canManageGlobal,
}) {
  const styles = useStyles();
  const isActive = view.id === activeViewId;
  const showHistory = view.viewState?.showHistoryIndicators !== false;
  const canToggleHistory = canToggleViewHistory(view, canManageGlobal);

  const handleToggleHistory = useCallback((event, data) => {
    event.stopPropagation();
    onToggleShowHistory(view, data.checked);
  }, [onToggleShowHistory, view]);

  const handleSwitchClick = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handleApply = useCallback(() => {
    onApplyView(view);
  }, [onApplyView, view]);

  const vendorAccount = viewVendorAccount(view);
  const scopeLabel = viewScopeLabel(view);
  const labelText = [
    view.name,
    scopeLabel,
    vendorAccount,
    view.isDefault ? '(default)' : '',
  ].filter(Boolean).join(' ');

  return (
    <MenuItem
      className={mergeClasses(styles.viewMenuItem, isActive && styles.viewMenuItemActive)}
      content={{ className: styles.viewMenuItemContent }}
      aria-current={isActive ? 'true' : undefined}
      onClick={handleApply}
    >
      <span className={styles.viewMenuItemRow}>
        <span className={styles.viewNameCell} title={labelText}>
          <span className={styles.viewName}>{view.name}</span>
          {vendorAccount ? <span className={styles.vendorSuffix}>{vendorAccount}</span> : null}
          {view.isDefault ? <span className={styles.metaSuffix}>default</span> : null}
        </span>
        <span className={styles.scopeCell}>{scopeLabel}</span>
        <span className={styles.historyControl} title="Show history indicators">
          <ClockRegular className={styles.historyIcon} aria-hidden />
          <Switch
            className={styles.historySwitch}
            checked={showHistory}
            disabled={!canToggleHistory}
            aria-label="Show history indicators"
            onClick={handleSwitchClick}
            onChange={handleToggleHistory}
          />
        </span>
      </span>
    </MenuItem>
  );
}

export function SavedViewScopeGroup({
  views,
  activeViewId,
  onApplyView,
  onToggleShowHistory,
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
      canManageGlobal={canManageGlobal}
    />
  ));
}
