import React, { useCallback } from 'react';
import { Button } from '@fluentui/react-components';

export default function AppNavItem({ item, compact, active, styles, onNavigate, onItemMouseEnter }) {
  const handleClick = useCallback(() => {
    onNavigate(item.path);
  }, [item.path, onNavigate]);

  const handleMouseEnter = useCallback(() => {
    onItemMouseEnter?.(item);
  }, [item, onItemMouseEnter]);

  if (item.type === 'divider') {
    return (
      <div
        className={`${styles.divider} ${compact ? styles.dividerCompact : ''}`}
        role="separator"
        aria-orientation="horizontal"
      />
    );
  }

  const Icon = item.icon;

  if (compact) {
    return (
      <div className={styles.railItem} onMouseEnter={handleMouseEnter} data-tour={`nav-${item.id}`}>
        <Button
          appearance={active ? 'primary' : 'subtle'}
          icon={<Icon />}
          onClick={handleClick}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
        />
        <span data-tooltip className={styles.railTooltip}>{item.tooltipLabel ?? item.label}</span>
      </div>
    );
  }

  return (
    <Button
      appearance={active ? 'primary' : 'subtle'}
      icon={<Icon />}
      className={styles.navButton}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      aria-current={active ? 'page' : undefined}
    >
      {item.label}
    </Button>
  );
}
