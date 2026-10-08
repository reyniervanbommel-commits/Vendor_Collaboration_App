import React, { memo, useCallback, useRef, useState } from 'react';
import { Button } from '@fluentui/react-components';
import RemarkMessageCard from './RemarkMessageCard';
import RemarkReplyComposer from './RemarkReplyComposer';

const VISIBLE_REPLIES = 2;

function RemarkThread({
  remark, currentUser, remarkActions, canReply, replyOpen,
  onOpenReply, onCloseReply, onSubmitReply, showVisibility,
}) {
  const [expanded, setExpanded] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const replyButtonRef = useRef(null);
  // Verwijderde replies verdwijnen helemaal.
  const replies = (remark.replies || []).filter((reply) => !reply.isDeleted);
  const hiddenCount = expanded ? 0 : Math.max(0, replies.length - VISIBLE_REPLIES);
  const shownReplies = replies.slice(hiddenCount);
  const authorName = remark?.author?.displayName || remark?.author?.email || 'Unknown user';

  const close = useCallback(() => {
    onCloseReply();
    requestAnimationFrame(() => replyButtonRef.current?.focus());
  }, [onCloseReply]);

  const submit = useCallback(async (body) => {
    const created = await onSubmitReply(remark.id, body);
    setHighlightId(created?.id ?? null);
    close();
  }, [close, onSubmitReply, remark.id]);

  const visibilityClass = showVisibility && remark.visibility ? ` remark-thread--${remark.visibility}` : '';

  return (
    <div className={`remark-thread${visibilityClass}`}>
      <RemarkMessageCard
        remark={remark}
        currentUser={currentUser}
        onDelete={remarkActions.onDelete}
        onReaction={remarkActions.onReaction}
        onReply={canReply && !remark.isDeleted ? () => onOpenReply(remark.id) : null}
        replyButtonRef={replyButtonRef}
      />
      {replies.length > 0 || replyOpen ? (
        <div className="remark-thread-replies">
          {hiddenCount > 0 ? (
            <Button appearance="transparent" size="small" onClick={() => setExpanded(true)}>
              {hiddenCount === 1 ? 'Show 1 earlier reply' : `Show ${hiddenCount} earlier replies`}
            </Button>
          ) : null}
          {shownReplies.length > 0 ? (
            <ul className="remark-thread-list" role="list" aria-label={`Replies to ${authorName}'s remark`}>
              {shownReplies.map((reply) => (
                <li key={reply.id} className={reply.id === highlightId ? 'remark-reply--new' : undefined}>
                  <RemarkMessageCard
                    remark={{ ...reply, visibility: undefined, replyTo: undefined }}
                    currentUser={currentUser}
                    onDelete={remarkActions.onDelete}
                    onReaction={remarkActions.onReaction}
                    compact
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {replyOpen ? (
            <RemarkReplyComposer
              authorName={authorName}
              visibility={remark.visibility}
              showVisibility={showVisibility}
              onSubmit={submit}
              onCancel={close}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default memo(RemarkThread);
