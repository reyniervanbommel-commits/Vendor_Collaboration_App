import React, { memo, useCallback, useState } from 'react';
import { Avatar, Button } from '@fluentui/react-components';
import { ArrowReplyRegular } from '@fluentui/react-icons';
import RemarkReactionBar from './RemarkReactionBar';
import RemarkVisibilityBadge from './RemarkVisibilityBadge';
import { splitMentions } from './mentionText';
import { formatDateTime } from './remarksFormatters';

function RemarkMessageCard({
  remark,
  currentUser,
  onDelete,
  onReaction,
  onReply = null,
  replyButtonRef = null,
  compact = false,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const authorName = remark?.author?.displayName || remark?.author?.email || 'Unknown user';
  const ownRemark = String(remark?.author?.id) === String(currentUser?.id);

  const showDeleteConfirmation = useCallback(() => {
    setDeleteError('');
    setConfirmDelete(true);
  }, []);

  const cancelDelete = useCallback(() => {
    setConfirmDelete(false);
  }, []);

  const confirmDeleteRemark = useCallback(async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await onDelete(remark.id);
      setConfirmDelete(false);
    } catch (error) {
      setDeleteError(error?.message || 'Failed to delete remark');
    } finally {
      setDeleting(false);
    }
  }, [onDelete, remark.id]);

  return (
    <article
      className={[
        'remark-card',
        remark?.visibility ? `remark-card--${remark.visibility}` : '',
        compact ? 'remark-card--compact' : '',
      ].filter(Boolean).join(' ')}
      aria-label={`Remark by ${authorName}`}
    >
      <header className="remark-card-header">
        <div className="remark-author">
          <Avatar name={authorName} size={compact ? 24 : 28} color="colorful" />
          <span className="remark-author-text">
            <strong>{authorName}</strong>
            <span className="remarks-meta remark-card-date">{formatDateTime(remark?.createdAt)}</span>
          </span>
        </div>
        <div className="remark-card-actions">
          <RemarkVisibilityBadge visibility={remark?.visibility} />
          {remark?.canDelete && !remark?.isDeleted && !confirmDelete ? (
            <Button appearance="subtle" size="small" onClick={showDeleteConfirmation}>
              Delete
            </Button>
          ) : null}
        </div>
      </header>

      {remark?.column?.label ? <span className="remark-column-tag">{remark.column.label}</span> : null}
      {remark?.replyTo ? (
        <span className="remark-reply-to remarks-muted">↳ Reply to {remark.replyTo.authorName || 'Unknown user'}</span>
      ) : null}
      {remark?.isDeleted ? (
        <p className="remark-tombstone">This remark was deleted.</p>
      ) : (
        <p className="remark-body">
          {splitMentions(remark?.body, remark?.mentions).map((part, index) => (
            part.type === 'mention' ? (
              <span
                key={index}
                className="remark-mention-chip"
                title={remark.mentions.find((m) => m.value === part.value)?.columnLabel}
              >
                @{part.value}
              </span>
            ) : (
              <React.Fragment key={index}>{part.value}</React.Fragment>
            )
          ))}
        </p>
      )}

      {!remark?.isDeleted && remark?.broadcastCount ? (
        <span className="remarks-muted remark-broadcast-note">
          Posted on {remark.broadcastCount} purchase {remark.broadcastCount === 1 ? 'order' : 'orders'}
        </span>
      ) : null}

      {confirmDelete ? (
        <div className="remarks-state-actions" role="group" aria-label="Confirm remark deletion">
          <span>
            {remark?.broadcastCount > 1
              ? `Delete this remark on all ${remark.broadcastCount} purchase orders?`
              : 'Delete this remark?'}
          </span>
          <Button appearance="primary" size="small" disabled={deleting} onClick={confirmDeleteRemark}>
            {deleting ? 'Deleting…' : 'Confirm'}
          </Button>
          <Button appearance="secondary" size="small" disabled={deleting} onClick={cancelDelete}>
            Cancel
          </Button>
        </div>
      ) : null}
      {deleteError ? (
        <div className="remarks-error" role="alert">
          {deleteError}
        </div>
      ) : null}

      {!remark?.isDeleted ? (
        <div className="remark-card-footer">
          <RemarkReactionBar
            remarkId={remark.id}
            reactions={remark.reactions}
            ownRemark={ownRemark}
            onToggle={onReaction}
          />
          {onReply ? (
            <Button
              ref={replyButtonRef}
              appearance="subtle"
              size="small"
              icon={<ArrowReplyRegular />}
              aria-label={`Reply to ${authorName}`}
              data-tour="remark-reply-button"
              onClick={onReply}
            >
              Reply
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default memo(RemarkMessageCard);
