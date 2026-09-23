import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fixture = require('./boardReadFixture');

const queryLog = [];
const registryPath = require.resolve('../TableRegistryService');
const settingsPath = require.resolve('../SettingsService');
const sqlPoolPath = require.resolve('../../utils/sqlPool');

require.cache[registryPath] = {
  id: registryPath,
  filename: registryPath,
  loaded: true,
  exports: {
    getPool: async () => fixture.createRecordingPool(queryLog),
    getTableByKey: async (key) => {
      if (key === 'purchase-orders') return fixture.PO_TABLE;
      if (key === 'items') return fixture.ITEMS_TABLE;
      throw Object.assign(new Error(`Unknown table ${key}`), { status: 404 });
    },
    listColumns: async ({ tableId, scope }) => {
      if (Number(tableId) === fixture.ITEMS_TABLE.id) return fixture.ITEM_COLS;
      return scope === 'detail' ? fixture.DETAIL_COLS : fixture.MASTER_COLS;
    },
    getLookups: async (tableId) => (
      Number(tableId) === fixture.PO_TABLE.id ? fixture.LOOKUPS : []
    ),
    invalidateTableCache: () => {},
    listRefreshCascadeTargets: async () => [],
  },
};

require.cache[settingsPath] = {
  id: settingsPath,
  filename: settingsPath,
  loaded: true,
  exports: {
    getAsync: async (key, fallback = '') => {
      if (key === 'TRACK_CHANGES_CONFIG') return fixture.TRACK_CONFIG;
      if (key === 'PO_SYNC_RULES') return '[]';
      return fallback;
    },
    get: () => '',
    set: async () => {},
  },
};

require.cache[sqlPoolPath] = {
  id: sqlPoolPath,
  filename: sqlPoolPath,
  loaded: true,
  exports: {
    getSqlPool: async () => fixture.createRecordingPool(queryLog),
  },
};

const { read, invalidateLookupEnrichmentCache } = require('../TableDataService');
const { runWithRequestTiming, buildServerTimingHeader } = require('../../utils/timing');
const { clearRuntimeHeaderLinksCache } = require('../../utils/runtimeHeaderLinks');

const RESPONSE_KEYS = [
  'table', 'changeContractVersion', 'revision', 'syncedAt', 'stale', 'hasCache',
  'staleThresholdMinutes', 'meta', 'rows', 'total', 'lastViewedAt', 'newCount',
  'changedCount', 'retention',
];

const ROW_KEYS = [
  'partitionKey', 'recordKey', 'removedAtSource', 'syncRetained', 'isNew', 'isChanged', 'values',
];

const FULL_READ_LABELS = [
  'tb_meta', 'tb_sync_state', 'tb_viewed', 'tb_revision', 'tb_history_hints', 'tb_track_marks',
  'tb_sync_rules', 'tb_read_cols', 'tb_links', 'tb_lookups', 'tb_lookup_items',
  'tb_read_masters', 'tb_read_details', 'tb_read_custom', 'tb_build_rows', 'tb_build_details',
  'tb_build_det_lookups', 'tb_build_det_pav', 'tb_build_det_formulas', 'tb_build_det_rows_n',
  'tb_detail_rows_full', 'tb_retention', 'tb_ledger',
];

function timingLabels(header) {
  return header.split(',')
    .map((part) => part.split(';')[0].trim())
    .filter((name) => name && name !== 'app');
}

async function readTimed(opts) {
  let header = '';
  const result = await runWithRequestTiming(async () => {
    const value = await read(opts);
    header = buildServerTimingHeader(0);
    return value;
  });
  return { result, labels: timingLabels(header) };
}

function order(result, recordKey) {
  return result.rows.find((row) => row.recordKey === recordKey);
}

describe('board-read contract (purchase-orders)', () => {
  beforeEach(() => {
    queryLog.length = 0;
    invalidateLookupEnrichmentCache();
    clearRuntimeHeaderLinksCache();
  });

  it('levert de vaste responsevelden, lookup, formule, history en track-change-meta', async () => {
    const { result, labels } = await readTimed({ tableKey: 'purchase-orders', userId: 7 });
    for (const key of RESPONSE_KEYS) expect(result).toHaveProperty(key);
    expect(result.table).toEqual({ key: 'purchase-orders', label: 'Purchase orders', hasDetail: true });
    expect(result.changeContractVersion).toBe(1);
    expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(result.syncedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(result.stale).toBe(true);
    expect(result.hasCache).toBe(true);
    expect(result.total).toBe(2);
    expect(result.meta.trackChanges.mode).toBe('session');
    expect(result.meta.columns.master.map((column) => column.key)).toEqual(
      expect.arrayContaining(['vendorAccount', 'openQty', 'note'])
    );
    expect(result.meta.columns.detail.map((column) => column.key)).toEqual(
      expect.arrayContaining(['itemNumber', 'lineDouble', 'itemName'])
    );
    expect(result.retention).toMatchObject({ retainedCount: 0, retentionWarning: 'none' });

    const row = order(result, 'PO-100');
    for (const key of ROW_KEYS) expect(row).toHaveProperty(key);
    expect(row.values).toMatchObject({
      vendorAccount: 'VEND-1',
      orderedQty: 10,
      receivedQty: 4,
      openQty: 6,
      note: 'rush',
    });
    expect(row.historyByColumnId).toEqual({ 5: true });
    expect(typeof row.trackMarksByColumnId['5']).toBe('string');
    expect(row.details).toHaveLength(1);
    expect(row.details[0].values).toMatchObject({
      itemNumber: 'ART-1',
      quantity: 3,
      lineDouble: 6,
      itemName: 'Bolt',
    });
    expect(row.detailCount).toBe(1);
    expect(row.productImageSummary).toEqual({ firstItemNumber: 'ART-1', additionalItemCount: 0 });
    for (const label of FULL_READ_LABELS) expect(labels).toContain(label);
  });

  it('beperkt suppliers tot hun account en behandelt een lege account als nul rijen', async () => {
    const scoped = await read({
      tableKey: 'purchase-orders',
      userId: 8,
      supplierAccount: 'VEND-1',
    });
    expect(scoped.rows.map((row) => row.recordKey)).toEqual(['PO-100']);

    const other = await read({
      tableKey: 'purchase-orders',
      userId: 9,
      supplierAccount: 'VEND-2',
    });
    expect(other.rows.map((row) => row.recordKey)).toEqual(['PO-200']);

    const emptyAccount = await read({
      tableKey: 'purchase-orders',
      userId: 10,
      supplierAccount: '',
    });
    expect(emptyAccount.rows).toEqual([]);
    expect(emptyAccount.total).toBe(0);
  });

  it('laat sublijnen weg bij includeDetails:false en houdt de rollup', async () => {
    const result = await read({
      tableKey: 'purchase-orders',
      userId: 7,
      includeDetails: false,
    });
    const row = order(result, 'PO-100');
    expect(row).not.toHaveProperty('details');
    expect(row.detailCount).toBe(1);
    expect(row.productImageSummary.firstItemNumber).toBe('ART-1');
  });

  it('slaat history, ledger en track-marks over zonder change-decorations', async () => {
    const { result, labels } = await readTimed({
      tableKey: 'purchase-orders',
      userId: 7,
      includeChangeDecorations: false,
    });
    const row = order(result, 'PO-100');
    expect(result.meta.trackChanges).toBeNull();
    expect(row).not.toHaveProperty('historyByColumnId');
    expect(row).not.toHaveProperty('trackMarksByColumnId');
    expect(labels).not.toContain('tb_history_hints');
    expect(labels).not.toContain('tb_track_marks');
    expect(labels).not.toContain('tb_ledger');
    expect(labels).not.toContain('tb_viewed');
    expect(labels).toContain('tb_read_masters');
    expect(labels).toContain('tb_build_rows');
  });

  it('leest één order via partitionKey en recordKey', async () => {
    const result = await read({
      tableKey: 'purchase-orders',
      userId: 7,
      partitionKey: 'usmf',
      recordKey: 'PO-200',
    });
    expect(result.rows.map((row) => row.recordKey)).toEqual(['PO-200']);
    expect(result.rows[0].values.vendorAccount).toBe('VEND-2');
    expect(result.rows[0].values.openQty).toBe(0);
  });

  it('dedupliceert identieke gelijktijdige reads tot één onderliggende read', async () => {
    queryLog.length = 0;
    const opts = { tableKey: 'purchase-orders', userId: 7 };
    const [left, right] = await Promise.all([read(opts), read(opts)]);
    expect(left).toBe(right);
    expect(fixture.countMasterReads(queryLog)).toBe(1);
  });

  it('B1: includeRemoved en supplierFilterColumn vallen nu samen in de inflight-key', async () => {
    queryLog.length = 0;
    const base = { tableKey: 'purchase-orders', userId: 7, includeRemoved: false };
    const removed = { ...base, includeRemoved: true };
    const [left, right] = await Promise.all([read(base), read(removed)]);
    expect(left).toBe(right);
    expect(fixture.countMasterReads(queryLog)).toBe(1);

    queryLog.length = 0;
    const columnA = { tableKey: 'purchase-orders', userId: 11, supplierFilterColumn: 'vendorAccount' };
    const columnB = { ...columnA, supplierFilterColumn: 'invoiceAccount' };
    const [first, second] = await Promise.all([read(columnA), read(columnB)]);
    expect(first).toBe(second);
    expect(fixture.countMasterReads(queryLog)).toBe(1);
  });

  it('B1: een weggelaten includeDetails deelt de inflight-key niet met de default true', async () => {
    queryLog.length = 0;
    await Promise.all([
      read({ tableKey: 'purchase-orders', userId: 12 }),
      read({ tableKey: 'purchase-orders', userId: 12, includeDetails: true }),
    ]);
    expect(fixture.countMasterReads(queryLog)).toBe(2);
  });
});
