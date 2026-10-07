import React, { useCallback } from 'react';
import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Switch,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { ChevronRight12Regular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  trigger: {
    minWidth: '22px',
    width: '22px',
    height: '22px',
    ...shorthands.padding('0'),
    color: tokens.colorNeutralForeground3,
  },
  // Accent when history is off, so the non-default state is visible without hovering.
  triggerOff: {
    color: tokens.colorBrandForeground1,
  },
  surface: {
    ...shorthands.padding(tokens.spacingVerticalXXS, tokens.spacingHorizontalS),
  },
  switch: {
    fontSize: tokens.fontSizeBase200,
  },
});

/**
 * Per-view options shown on hover over the chevron (click/keyboard also open it).
 */
export default function SavedViewHistoryMiniMenu({
  checked,
  disabled,
  onChange,
}) {
  const styles = useStyles();

  const stop = useCallback((event) => {
    event.stopPropagation();
  }, []);

  // Enter/Space on the chevron must not also apply the view via the parent MenuItem.
  const stopActivationKeys = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  }, []);

  const handleChange = useCallback((event, data) => {
    event.stopPropagation();
    onChange(event, data);
  }, [onChange]);

  return (
    <span onClick={stop} onKeyDown={stopActivationKeys}>
      <Popover
        openOnHover
        mouseLeaveDelay={250}
        positioning="after-top"
        withArrow
        size="small"
      >
        <PopoverTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            size="small"
            className={mergeClasses(styles.trigger, !checked && styles.triggerOff)}
            icon={<ChevronRight12Regular />}
            aria-label={`View options (history ${checked ? 'on' : 'off'})`}
          />
        </PopoverTrigger>
        <PopoverSurface className={styles.surface} onClick={stop}>
          <Switch
            className={styles.switch}
            label="Show history"
            labelPosition="before"
            checked={checked}
            disabled={disabled}
            onChange={handleChange}
          />
        </PopoverSurface>
      </Popover>
    </span>
  );
}
