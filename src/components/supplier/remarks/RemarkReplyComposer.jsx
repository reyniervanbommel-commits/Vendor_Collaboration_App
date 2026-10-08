import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@fluentui/react-components';
import RemarkVisibilityBadge from './RemarkVisibilityBadge';

function RemarkReplyComposer({ authorName, visibility = null, showVisibility, onSubmit, onCancel }) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);
  const length = draft.normalize('NFC').trim().length;
  const invalid = length < 1 || length > 2000;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    if (invalid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(draft);
    } catch (submitError) {
      setError(submitError?.message || 'Failed to save reply');
      setSubmitting(false);
    }
  }, [draft, invalid, onSubmit, submitting]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }, [onCancel, submit]);

  return (
    <form
      className="remark-reply-composer"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="remark-reply-composer-header">
        <span className="remarks-muted">Replying to {authorName}</span>
        {showVisibility ? <RemarkVisibilityBadge visibility={visibility} /> : null}
      </div>
      <textarea
        ref={textareaRef}
        aria-label={`Reply to ${authorName}`}
        rows={2}
        value={draft}
        maxLength={2000}
        disabled={submitting}
        onChange={(event) => { setDraft(event.target.value); setError(''); }}
      />
      <div className="remark-reply-composer-actions">
        <Button appearance="secondary" size="small" type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button appearance="primary" size="small" type="submit" disabled={invalid || submitting}>
          {submitting ? 'Saving…' : 'Reply'}
        </Button>
      </div>
      {error ? <div className="remarks-error" role="alert">{error}</div> : null}
    </form>
  );
}

export default memo(RemarkReplyComposer);
