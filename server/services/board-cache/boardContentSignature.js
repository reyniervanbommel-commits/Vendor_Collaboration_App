'use strict';

function contentSignature(parts = {}) {
  return JSON.stringify({
    syncedAt: parts.syncedAt ?? null,
    maxContentChangedAt: parts.maxContentChangedAt ?? null,
    maxFirstSeenAt: parts.maxFirstSeenAt ?? null,
    maxCustomValueAt: parts.maxCustomValueAt ?? null,
    maxLedgerAt: parts.maxLedgerAt ?? null,
    maxColumnsAt: parts.maxColumnsAt ?? null,
    exclusionCount: parts.exclusionCount ?? 0,
    maxExclusionAt: parts.maxExclusionAt ?? null,
    settingsAt: parts.settingsAt ?? null,
  });
}

module.exports = { contentSignature };
