import React, { memo, useCallback } from 'react';
import { LockClosedRegular } from '@fluentui/react-icons';
import { formatDateTime } from './remarksFormatters';

function RemarksLatestCell({ summary, onOpen, orderNumber = '', onFormattedBackground = false }) {
  const latest = summary?.latest || null;
  const isEmpty = !latest;
  const preview = latest?.bodyPreview || latest?.body || 'No remarks';
  const authorName = latest?.authorName || latest?.author?.displayName || 'Unknown user';
  const isInternal = latest?.visibility === 'internal';
  const title = latest
    ? `${isInternal ? 'Internal · ' : ''}${preview} · ${authorName} · ${formatDateTime(latest.createdAt)}`
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
        {isInternal ? (
          <LockClosedRegular className="remarks-latest-lock" role="img" aria-label="Internal remark" />
        ) : null}
        {preview}
      </div>
    </button>
  );
}

export default memo(RemarksLatestCell);
