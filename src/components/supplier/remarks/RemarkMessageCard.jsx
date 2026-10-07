import React, { memo, useCallback, useState } from 'react';
import { Avatar, Button } from '@fluentui/react-components';
import RemarkReactionBar from './RemarkReactionBar';
import RemarkVisibilityBadge from './RemarkVisibilityBadge';
import { formatDateTime } from './remarksFormatters';

function RemarkMessageCard({ remark, currentUser, onDelete, onReaction }) {
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
      className={`remark-card${remark?.visibility ? ` remark-card--${remark.visibility}` : ''}`}
      aria-label={`Remark by ${authorName}`}
    >
      <header className="remark-card-header">
        <div className="remark-author">
          <Avatar name={authorName} size={28} color="colorful" />
          <span className="remark-author-text">
            <strong>{authorName}</strong>
            <span className="remarks-meta remark-card-date">{formatDateTime(remark?.createdAt)}</span>
          </span>
          <RemarkVisibilityBadge visibility={remark?.visibility} />
        </div>
        {remark?.canDelete && !remark?.isDeleted && !confirmDelete ? (
          <Button appearance="subtle" size="small" onClick={showDeleteConfirmation}>
            Delete
          </Button>
        ) : null}
      </header>

      {remark?.column?.label ? <span className="remark-column-tag">{remark.column.label}</span> : null}
      {remark?.isDeleted ? (
        <p className="remark-tombstone">This remark was deleted.</p>
      ) : (
        <p className="remark-body">{remark?.body}</p>
      )}

      {confirmDelete ? (
        <div className="remarks-state-actions" role="group" aria-label="Confirm remark deletion">
          <span>Delete this remark?</span>
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
        <RemarkReactionBar
          remarkId={remark.id}
          reactions={remark.reactions}
          ownRemark={ownRemark}
          onToggle={onReaction}
        />
      ) : null}
    </article>
  );
}

export default memo(RemarkMessageCard);
