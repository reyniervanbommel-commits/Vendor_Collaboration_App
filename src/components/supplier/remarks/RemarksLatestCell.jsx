import React, { memo, useCallback } from 'react';
import { formatDateTime } from './remarksFormatters';

function RemarksLatestCell({ summary, onOpen, orderNumber = '', onFormattedBackground = false }) {
  const latest = summary?.latest || null;
  const isEmpty = !latest;
  const preview = latest?.bodyPreview || latest?.body || 'No remarks';
  const authorName = latest?.authorName || latest?.author?.displayName || 'Unknown user';
  const title = latest
    ? `${preview} · ${authorName} · ${formatDateTime(latest.createdAt)}`
    : preview;

  const handleOpen = useCallback(
    (event) => {
      onOpen?.(event.currentTarget);
    },
    [onOpen]
  );

  return (
    <button
      type="button"
      className={`remarks-latest-cell${onFormattedBackground ? ' remarks-latest-cell--formatted' : ''}`}
      aria-label={`Open remarks for purchase order ${orderNumber}`}
      title={title}
      onClick={handleOpen}
      data-tour="remarks-latest-cell"
    >
      <div className={`remarks-latest-preview${isEmpty ? ' remarks-latest-preview--empty' : ''}`}>
        {preview}
      </div>
    </button>
  );
}

export default memo(RemarksLatestCell);
