const MAX_SHOWN = 3;
const FALLBACK_REASON = 'Write-back to D365 failed';

function withPeriod(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** "Line 20: <reden>." voor de eerste `max` failures, plus "(+N more)". */
export function formatLineFailures(failures, { max = MAX_SHOWN } = {}) {
  const list = Array.isArray(failures) ? failures : [];
  if (!list.length) return '';
  const shown = list.slice(0, max).map((failure) => (
    `Line ${failure.detailKey}: ${withPeriod(String(failure.message || FALLBACK_REASON).trim())}`
  ));
  const extra = list.length - shown.length;
  return extra > 0 ? `${shown.join(' ')} (+${extra} more)` : shown.join(' ');
}

/** Melding voor een header-fan-out met ≥1 mislukte regel (partial of volledig mislukt). */
export function formatCorrectAllFailure({
  updated = 0, attempted = 0, failed = 0, failures = [],
} = {}) {
  const detail = formatLineFailures(failures);
  if (updated > 0) {
    const head = `${updated} of ${attempted} lines updated.`;
    return detail ? `${head} ${detail}` : head;
  }
  return detail || `Write-back failed on ${failed} of ${attempted} lines.`;
}
