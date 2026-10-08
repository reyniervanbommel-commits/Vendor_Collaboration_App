import React, { useCallback } from 'react';
import {
  Button,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import { History16Filled, History16Regular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  toggle: {
    minWidth: '22px',
    width: '22px',
    height: '22px',
    ...shorthands.padding('0'),
  },
});

function historyTitle(checked, disabled) {
  if (disabled) return checked ? 'History on (only staff can change shared views)' : 'Only staff can change shared views';
  return checked ? 'Hide history' : 'Show history';
}

/**
 * Per-view history toggle (colors come from the row): grey when off, blue when on. Click flips it.
 */
export default function SavedViewHistoryToggle({
  className,
  checked,
  disabled,
  onChange,
}) {
  const styles = useStyles();

  const handleClick = useCallback((event) => {
    event.stopPropagation();
    onChange(event, { checked: !checked });
  }, [checked, onChange]);

  // Enter/Space on the toggle must not also apply the view via the parent MenuItem.
  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  }, []);

  return (
    <Button
      appearance="transparent"
      size="small"
      className={mergeClasses(styles.toggle, className)}
      icon={checked ? <History16Filled /> : <History16Regular />}
      aria-pressed={checked}
      data-tour="po-view-history"
      aria-label={checked ? 'Hide history' : 'Show history'}
      title={historyTitle(checked, disabled)}
      disabledFocusable={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    />
  );
}
