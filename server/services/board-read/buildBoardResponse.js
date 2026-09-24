'use strict';

function buildBoardReadResponse(input) {
  const {
    table, revision, lastFullSyncAt, stale, staleThresholdMinutes,
    masterCols, detailCols, enrichment, hideRemarksColumns,
    trackActive, trackConfig, trackMarks, scopedRows, lastViewedAt,
    newCount, changedCount, retentionMeta,
  } = input;
  const filterRemarksColumns = hideRemarksColumns
    ? require('../../utils/commentPermissions').filterRemarksColumns
    : null;
  return {
    table: { key: table.key, label: table.label, hasDetail: Boolean(table.relation && table.relation.kind !== 'none') },
    changeContractVersion: 1,
    revision,
    syncedAt: lastFullSyncAt ? new Date(lastFullSyncAt).toISOString() : null,
    stale,
    hasCache: Boolean(lastFullSyncAt),
    staleThresholdMinutes,
    meta: {
      columns: {
        master: hideRemarksColumns
          ? filterRemarksColumns([...masterCols, ...enrichment.masterCols], false)
          : [...masterCols, ...enrichment.masterCols],
        detail: hideRemarksColumns
          ? filterRemarksColumns([...detailCols, ...enrichment.detailCols], false)
          : [...detailCols, ...enrichment.detailCols],
      },
      trackChanges: trackActive
        ? {
            mode: trackConfig.mode,
            activeOffsetByColumnId: trackMarks.activeOffsetByColumnId,
            defaultPattern: trackMarks.defaultPattern,
          }
        : null,
    },
    rows: scopedRows,
    total: scopedRows.length,
    lastViewedAt: lastViewedAt ? new Date(lastViewedAt).toISOString() : null,
    newCount,
    changedCount,
    retention: retentionMeta,
  };
}

module.exports = { buildBoardReadResponse };
