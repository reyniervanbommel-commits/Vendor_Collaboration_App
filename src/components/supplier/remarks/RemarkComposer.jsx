import React, { memo, useCallback, useState } from 'react';
import { Avatar, Button } from '@fluentui/react-components';
import { LockClosedRegular } from '@fluentui/react-icons';
import { ROLES, canChooseRemarkVisibility } from '../../../constants/roles';

const SUBMIT_LABELS = { vendor: 'Send to vendor', internal: 'Post internal note' };

/**
 * `visibility` komt van de toggle in het panel (admin/supply_chain): 'vendor', 'internal' of
 * null (All). Bij All kan er niet gepost worden. Employee-remarks zijn altijd intern (server).
 */
function RemarkComposer({ currentUser, column = null, onSubmit, textareaRef = null, visibility = null }) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const normalizedLength = draft.normalize('NFC').trim().length;
  const invalid = normalizedLength < 1 || normalizedLength > 2000;
  const canChoose = canChooseRemarkVisibility(currentUser?.role);
  const isEmployee = currentUser?.role === ROLES.EMPLOYEE;
  const blocked = canChoose && !visibility;
  const submitLabel = canChoose
    ? (SUBMIT_LABELS[visibility] || 'Add remark')
    : (isEmployee ? SUBMIT_LABELS.internal : 'Add remark');
  const displayName =
    currentUser?.display_name
    || currentUser?.displayName
    || currentUser?.email
    || 'User';

  const handleChange = useCallback((event) => {
    setDraft(event.target.value);
    setSubmitError('');
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (invalid || submitting || blocked) return;
      setSubmitting(true);
      setSubmitError('');
      try {
        await onSubmit(draft, column?.id || null, canChoose ? visibility : null);
        setDraft('');
      } catch (error) {
        setSubmitError(error?.message || 'Failed to save remark');
      } finally {
        setSubmitting(false);
      }
    },
    [blocked, canChoose, column?.id, draft, invalid, onSubmit, submitting, visibility]
  );

  return (
    <form className="remarks-composer" onSubmit={handleSubmit} data-tour="remark-composer">
      <div className="remarks-composer-user">
        <Avatar name={displayName} size={32} color="colorful" aria-hidden="true" />
        <label htmlFor="row-remark-composer" className="remarks-composer-label">
          Add a remark
          {column?.label ? <span className="remarks-muted"> · {column.label}</span> : null}
        </label>
      </div>
      <textarea
        id="row-remark-composer"
        ref={textareaRef}
        className={canChoose && visibility ? `remarks-composer-input--${visibility}` : undefined}
        value={draft}
        maxLength={2000}
        disabled={submitting || blocked}
        aria-describedby="row-remark-counter row-remark-error"
        onChange={handleChange}
      />
      {isEmployee ? (
        <span className="remarks-composer-internal-hint">
          <LockClosedRegular aria-hidden="true" />
          Internal — not visible to vendors
        </span>
      ) : null}
      <div className="remarks-composer-actions">
        <span id="row-remark-counter" className="remarks-muted">
          {blocked ? 'Select Vendor or Internal to post a remark' : `${normalizedLength}/2000`}
        </span>
        <Button appearance="primary" type="submit" disabled={invalid || submitting || blocked}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
      {submitError ? (
        <div id="row-remark-error" className="remarks-error" role="alert">
          {submitError}
        </div>
      ) : null}
    </form>
  );
}

export default memo(RemarkComposer);
