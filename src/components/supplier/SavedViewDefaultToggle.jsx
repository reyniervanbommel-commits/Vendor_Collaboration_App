import React, { useCallback } from 'react';
import {
  Button,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import { Star12Filled, Star12Regular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  toggle: {
    minWidth: '20px',
    width: '20px',
    height: '20px',
    flexShrink: 0,
    ...shorthands.padding('0'),
  },
});

/**
 * Default-view star (colors come from the row): grey = not the default, blue = opens on start. Only one view is default.
 */
export default function SavedViewDefaultToggle({ className, viewName, isDefault, onToggle }) {
  const styles = useStyles();

  const handleClick = useCallback((event) => {
    event.stopPropagation();
    onToggle();
  }, [onToggle]);

  // Enter/Space on the star must not also apply the view via the parent MenuItem.
  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  }, []);

  return (
    <Button
      appearance="transparent"
      size="small"
      className={mergeClasses(styles.toggle, className)}
      icon={isDefault ? <Star12Filled /> : <Star12Regular />}
      aria-pressed={isDefault}
      data-tour="po-view-default"
      aria-label={isDefault ? `${viewName} is your default view` : `Make ${viewName} your default view`}
      title={isDefault ? 'Your default view — opens when you start' : 'Make this your default view'}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    />
  );
}
