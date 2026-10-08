import React, { memo, useCallback, useMemo } from 'react';
import { Button, Spinner } from '@fluentui/react-components';
import RemarkMessageCard from './RemarkMessageCard';
import RemarkThread from './RemarkThread';
import RowHistoryEntry from './RowHistoryEntry';
import {
  formatDayLabel,
  getActivityTimestamp,
  isRemarkActivity,
  normalizeRemarkId,
  toRemark,
} from './remarksFormatters';

function buildFeedRows(items, threaded) {
  const rows = [];
  let previousDay = null;
  items.forEach((item) => {
    // Gesprekken staan op laatste activiteit; de dagkop volgt die datum.
    const timestamp = threaded ? (item.lastActivityAt || item.createdAt) : getActivityTimestamp(toRemark(item));
    const day = formatDayLabel(timestamp);
    if (day !== previousDay) {
      rows.push({ rowType: 'day', id: `day-${day}-${rows.length}`, label: day });
      previousDay = day;
    }
    rows.push({
      rowType: isRemarkActivity(item) ? 'remark' : 'history',
      id: `${item?.type || item?.kind || 'activity'}-${item?.id}`,
      item,
    });
  });
  return rows;
}

function RowActivityFeed({
  items,
  loading,
  error,
  hasMore,
  emptyMessage,
  currentUser,
  onLoadOlder,
  onRetry,
  remarkActions,
  olderLabel = 'Show older activity',
  threaded = false,
  threadProps = null,
}) {
  const feedRows = useMemo(() => buildFeedRows(items || [], threaded), [items, threaded]);

  const renderRow = useCallback(
    (row) => {
      if (row.rowType === 'day') {
        return (
          <div className="day-separator" key={row.id}>
            {row.label}
          </div>
        );
      }
      if (row.rowType === 'remark' && threaded) {
        // Gesprekken zijn al remark-DTO's (met replies); toRemark zou die velden laten vallen.
        const remark = { ...row.item, id: normalizeRemarkId(row.item.id) };
        return (
          <RemarkThread
            key={row.id}
            remark={remark}
            currentUser={currentUser}
            remarkActions={remarkActions}
            canReply={threadProps.canReply}
            replyOpen={String(threadProps.replyOpenId) === String(remark.id)}
            onOpenReply={threadProps.onOpenReply}
            onCloseReply={threadProps.onCloseReply}
            onSubmitReply={threadProps.onSubmitReply}
            showVisibility={threadProps.showVisibility}
          />
        );
      }
      if (row.rowType === 'remark') {
        return (
          <RemarkMessageCard
            key={row.id}
            remark={toRemark(row.item)}
            currentUser={currentUser}
            onDelete={remarkActions.onDelete}
            onReaction={remarkActions.onReaction}
          />
        );
      }
      return <RowHistoryEntry key={row.id} entry={row.item} />;
    },
    [currentUser, remarkActions, threaded, threadProps]
  );

  if (loading) {
    return (
      <div className="remarks-feed" aria-busy="true" aria-label="Loading activity">
        <div className="remarks-skeleton" />
        <div className="remarks-skeleton" />
      </div>
    );
  }

  if (error && feedRows.length === 0) {
    return (
      <div className="remarks-state" role="alert">
        <p className="remarks-error">{error}</p>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  if (feedRows.length === 0) {
    return <div className="remarks-state">{emptyMessage}</div>;
  }

  return (
    <div className="remarks-feed">
      {error ? (
        <div className="remarks-state-actions" role="alert">
          <span className="remarks-error">{error}</span>
          <Button size="small" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
      {feedRows.map(renderRow)}
      {hasMore ? <Button onClick={onLoadOlder}>{olderLabel}</Button> : null}
    </div>
  );
}

export default memo(RowActivityFeed);
