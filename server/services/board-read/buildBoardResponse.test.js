import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildBoardReadResponse } = require('./buildBoardResponse');

describe('buildBoardReadResponse', () => {
  it('bouwt de stabiele board-envelope', () => {
    const response = buildBoardReadResponse({
      table: { key: 'purchase-orders', label: 'PO', relation: { kind: 'lines' } },
      revision: 'rev',
      lastFullSyncAt: '2026-09-24T00:00:00.000Z',
      stale: false,
      staleThresholdMinutes: 60,
      masterCols: [{ key: 'vendorAccount' }],
      detailCols: [],
      enrichment: { masterCols: [], detailCols: [] },
      hideRemarksColumns: false,
      trackActive: false,
      trackConfig: { mode: 'session' },
      trackMarks: { activeOffsetByColumnId: {}, defaultPattern: {} },
      scopedRows: [{ recordKey: 'PO-1' }],
      lastViewedAt: null,
      newCount: 1,
      changedCount: 0,
      retentionMeta: { retainedCount: 0, retentionWarning: 'none' },
    });
    expect(response.revision).toBe('rev');
    expect(response.total).toBe(1);
    expect(response.table.hasDetail).toBe(true);
    expect(response.meta.columns.master).toEqual([{ key: 'vendorAccount' }]);
    expect(response.retention.retainedCount).toBe(0);
  });
});
