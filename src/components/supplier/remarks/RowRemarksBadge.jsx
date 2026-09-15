import React, { memo, useCallback, useMemo } from 'react';
import { tokens } from '@fluentui/react-components';
import { Chat24Regular } from '@fluentui/react-icons';
import './remarks.css';

function RowRemarksBadge({ count = 0, onOpen, orderNumber = '', onFormattedBackground = false }) {
  const safeCount = Math.max(0, Number(count) || 0);
  const hasMessages = safeCount > 0;
  const displayCount = safeCount > 99 ? '99+' : safeCount;
  const isWideCount = safeCount > 9;

  const label = useMemo(() => {
    if (!hasMessages) {
      return `Add a remark for purchase order ${orderNumber}`;
    }
    if (safeCount === 1) {
      return `Open 1 remark for purchase order ${orderNumber}`;
    }
    return `Open ${safeCount} remarks for purchase order ${orderNumber}`;
  }, [hasMessages, orderNumber, safeCount]);

  const iconColor = useMemo(() => {
    if (onFormattedBackground) {
      return '#ffffff';
    }
    return hasMessages ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3;
  }, [hasMessages, onFormattedBackground]);

  const handleOpen = useCallback(
    (event) => {
      onOpen?.(event.currentTarget);
    },
    [onOpen]
  );

  return (
    <button
      type="button"
      className="remarks-badge-button"
      aria-label={label}
      title={label}
      onClick={handleOpen}
      data-tour="row-remarks-badge"
    >
      <span className="remarks-badge-icon-wrap" aria-hidden="true">
        <Chat24Regular className="remarks-badge-icon" style={{ color: iconColor }} />
        {!hasMessages ? (
          <span className="remarks-badge-plus" style={{ color: iconColor }}>
            +
          </span>
        ) : (
          <span
            className={`remarks-badge-count${isWideCount ? ' remarks-badge-count--wide' : ''}`}
          >
            {displayCount}
          </span>
        )}
      </span>
    </button>
  );
}

export default memo(RowRemarksBadge);
