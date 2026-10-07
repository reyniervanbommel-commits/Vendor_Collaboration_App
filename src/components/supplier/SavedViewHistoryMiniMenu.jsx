import React, { useCallback } from 'react';
import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Switch,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { ClockRegular, MoreHorizontalRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  trigger: {
    minWidth: '22px',
    width: '22px',
    height: '22px',
    ...shorthands.padding('0'),
  },
  surface: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalS),
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalXS),
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
  },
  switch: {
    transform: 'scale(0.72)',
    transformOrigin: 'center right',
  },
});

export default function SavedViewHistoryMiniMenu({
  checked,
  disabled,
  onChange,
}) {
  const styles = useStyles();

  const handleClick = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handleChange = useCallback((event, data) => {
    event.stopPropagation();
    onChange(event, data);
  }, [onChange]);

  return (
    <span onClick={handleClick}>
      <Popover positioning="after" trapFocus>
        <PopoverTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            className={styles.trigger}
            icon={<MoreHorizontalRegular />}
            aria-label="View options"
          />
        </PopoverTrigger>
        <PopoverSurface className={styles.surface}>
          <span className={styles.label}>
            <ClockRegular aria-hidden />
            History
          </span>
          <Switch
            className={styles.switch}
            checked={checked}
            disabled={disabled}
            aria-label="Show history indicators"
            onClick={handleClick}
            onChange={handleChange}
          />
        </PopoverSurface>
      </Popover>
    </span>
  );
}
