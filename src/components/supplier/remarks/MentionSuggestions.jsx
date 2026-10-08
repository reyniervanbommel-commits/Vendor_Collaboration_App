import React, { memo } from 'react';

/** Suggestielijst onder het tekstvak voor @mentions (toetsenbord wordt door de composer bediend). */
function MentionSuggestions({ id, suggestions, loading, activeIndex, onPick }) {
  return (
    <div id={id} className="remarks-mention-list" role="listbox" aria-label="Mention suggestions">
      {loading && !suggestions.length ? <div className="remarks-mention-empty remarks-muted">Searching…</div> : null}
      {!loading && !suggestions.length ? <div className="remarks-mention-empty remarks-muted">No matches</div> : null}
      {suggestions.map((suggestion, index) => (
        <div
          key={`${suggestion.columnId}|${suggestion.value}`}
          id={`${id}-option-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          className={`remarks-mention-option${index === activeIndex ? ' is-active' : ''}`}
          // mouseDown i.p.v. click: het tekstvak verliest zo geen focus vóór het kiezen.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(suggestion);
          }}
        >
          <span className="remarks-mention-value">{suggestion.value}</span>
          <span className="remarks-muted">
            {suggestion.columnLabel} · {suggestion.orderCount} {suggestion.orderCount === 1 ? 'PO' : 'POs'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default memo(MentionSuggestions);
