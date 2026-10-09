import React, { memo, useCallback, useMemo, useState } from 'react';
import { Avatar, Button } from '@fluentui/react-components';
import { LockClosedRegular } from '@fluentui/react-icons';
import { ROLES, canChooseRemarkVisibility } from '../../../constants/roles';
import MentionSuggestions from './MentionSuggestions';
import { activeMentions, findMentionQuery, insertMention, splitMentions } from './mentionText';
import { useMentionPreview, useMentionSuggestions } from './useMentionSuggestions';

const SUBMIT_LABELS = { vendor: 'Send to vendor', internal: 'Post internal note' };
const MENTION_LIST_ID = 'row-remark-mentions';

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * `visibility` komt van de toggle in het panel (admin/supply_chain): 'vendor', 'internal' of
 * null (All). Bij All kan er niet gepost worden. Employee-remarks zijn altijd intern (server).
 * `@waarde` uit een mentionable kolom plaatst de opmerking op alle PO's met die waarde.
 */
function RemarkComposer({
  currentUser,
  column = null,
  onSubmit,
  textareaRef = null,
  visibility = null,
  tableKey = null,
  row = null,
}) {
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [chosen, setChosen] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listDismissed, setListDismissed] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const normalizedLength = draft.normalize('NFC').trim().length;
  const invalid = normalizedLength < 1 || normalizedLength > 2000;
  const canChoose = canChooseRemarkVisibility(currentUser?.role);
  const isEmployee = currentUser?.role === ROLES.EMPLOYEE;
  const isSupplier = currentUser?.role === ROLES.SUPPLIER;
  const blocked = canChoose && !visibility;
  const submitLabel = canChoose
    ? (SUBMIT_LABELS[visibility] || 'Add remark')
    : (isEmployee ? SUBMIT_LABELS.internal : 'Add remark');
  const displayName =
    currentUser?.display_name
    || currentUser?.displayName
    || currentUser?.email
    || 'User';

  const mentionQuery = tableKey ? findMentionQuery(draft, caret) : null;
  const { suggestions, loading: suggestionsLoading } = useMentionSuggestions({
    tableKey,
    query: mentionQuery?.query || '',
  });
  const listOpen = Boolean(mentionQuery && mentionQuery.query.length >= 2 && !listDismissed);
  const mentions = useMemo(() => activeMentions(draft, chosen), [chosen, draft]);
  const reach = useMentionPreview({ tableKey, row, mentions });
  const reachBlocks = mentions.length > 0 && (Boolean(reach.error) || reach.loading || reach.orderCount === null);

  const reachText = useMemo(() => {
    if (!mentions.length || reach.orderCount === null) return '';
    if (isSupplier) return `Will be posted on ${reach.orderCount} of your purchase orders`;
    return `Will be posted on ${plural(reach.orderCount, 'purchase order', 'purchase orders')} from ${plural(reach.vendorCount, 'vendor', 'vendors')}`;
  }, [isSupplier, mentions.length, reach.orderCount, reach.vendorCount]);
  const reachWarning = !isSupplier && visibility === 'vendor' && reach.vendorCount > 1;

  const handleScroll = useCallback((event) => setScrollTop(event.target.scrollTop), []);

  const trackCaret = useCallback((event) => {
    setCaret(event.target.selectionStart ?? event.target.value.length);
  }, []);

  const handleChange = useCallback((event) => {
    setDraft(event.target.value);
    setCaret(event.target.selectionStart ?? event.target.value.length);
    setActiveIndex(0);
    setListDismissed(false);
    setSubmitError('');
  }, []);

  const pickSuggestion = useCallback(
    (suggestion) => {
      if (!mentionQuery) return;
      const next = insertMention(draft, mentionQuery.start, caret, suggestion.value);
      setDraft(next.text);
      setCaret(next.caret);
      setChosen((current) => [...current, { columnId: suggestion.columnId, value: suggestion.value }]);
      setListDismissed(true);
      requestAnimationFrame(() => {
        const element = textareaRef?.current;
        if (element) element.setSelectionRange(next.caret, next.caret);
      });
    },
    [caret, draft, mentionQuery, textareaRef]
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (!listOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setListDismissed(true);
        return;
      }
      if (!suggestions.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pickSuggestion(suggestions[Math.min(activeIndex, suggestions.length - 1)]);
      }
    },
    [activeIndex, listOpen, pickSuggestion, suggestions]
  );

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (invalid || submitting || blocked || reachBlocks) return;
      setSubmitting(true);
      setSubmitError('');
      try {
        await onSubmit(draft, column?.id || null, canChoose ? visibility : null, mentions);
        setDraft('');
        setChosen([]);
      } catch (error) {
        setSubmitError(error?.message || 'Failed to save remark');
      } finally {
        setSubmitting(false);
      }
    },
    [blocked, canChoose, column?.id, draft, invalid, mentions, onSubmit, reachBlocks, submitting, visibility]
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
      <div className="remarks-composer-field">
        {mentions.length ? (
          // Gekozen @mentions krijgen al tijdens het typen dezelfde chip-kleur als na plaatsen.
          // Deze laag ligt exact onder het (transparante) tekstvak en spiegelt de tekst.
          <div className="remarks-composer-highlight" aria-hidden="true">
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
              {splitMentions(draft, mentions).map((part, index) => (
                part.type === 'mention'
                  ? <mark key={index} className="remark-mention-chip">@{part.value}</mark>
                  : <React.Fragment key={index}>{part.value}</React.Fragment>
              ))}
              {'​'}
            </div>
          </div>
        ) : null}
        <textarea
          id="row-remark-composer"
          ref={textareaRef}
          className={[
            canChoose && visibility ? `remarks-composer-input--${visibility}` : '',
            isEmployee ? 'remarks-composer-input--internal' : '',
            mentions.length ? 'remarks-composer-input--highlighted' : '',
          ].filter(Boolean).join(' ') || undefined}
          value={draft}
          maxLength={2000}
          disabled={submitting || blocked}
          aria-describedby="row-remark-counter row-remark-error"
          aria-expanded={listOpen}
          aria-controls={listOpen ? MENTION_LIST_ID : undefined}
          aria-activedescendant={listOpen && suggestions.length ? `${MENTION_LIST_ID}-option-${activeIndex}` : undefined}
          onChange={handleChange}
          onSelect={trackCaret}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
        />
        {listOpen ? (
          <MentionSuggestions
            id={MENTION_LIST_ID}
            suggestions={suggestions}
            loading={suggestionsLoading}
            activeIndex={activeIndex}
            onPick={pickSuggestion}
          />
        ) : null}
      </div>
      {isEmployee ? (
        <span className="remarks-composer-internal-hint">
          <LockClosedRegular aria-hidden="true" />
          Internal — not visible to vendors
        </span>
      ) : null}
      {mentions.length && reach.error ? (
        <div className="remarks-error" role="alert">{reach.error}</div>
      ) : null}
      {reachText ? (
        <div className={`remarks-mention-reach${reachWarning ? ' remarks-mention-reach--warning' : ''}`}>
          {reachText}
        </div>
      ) : null}
      <div className="remarks-composer-actions">
        <span id="row-remark-counter" className="remarks-muted">
          {blocked ? 'Select Vendor or Internal to post a remark' : `${normalizedLength}/2000`}
        </span>
        <Button appearance="primary" type="submit" disabled={invalid || submitting || blocked || reachBlocks}>
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
