'use strict';

// Vaste purchase-orders fixture voor het board-read-contract (Fase 0, #AB:334 / #AB:335).
// Alleen testdata en een SQL-router; geen productielogica.

const SYNCED_AT = new Date('2026-05-01T00:00:00.000Z');
const VIEWED_AT = new Date('2026-06-01T00:00:00.000Z');
const SESSION_BOUNDARY = new Date('2026-06-01T00:00:00.000Z');

const PO_TABLE = {
  id: 10,
  key: 'purchase-orders',
  label: 'Purchase orders',
  staleMinutes: 15,
  cacheMode: 'ttl',
  relation: { kind: 'lines' },
  defaultFilter: null,
};

const ITEMS_TABLE = {
  id: 20,
  key: 'items',
  label: 'Items',
  defaultFilter: null,
  source: { providerType: 'd365' },
};

function sourceCol(id, key, sourceField, extra = {}) {
  return {
    id,
    key,
    label: key,
    source: 'source',
    sourceField,
    dataType: 'text',
    isActive: true,
    formulaExpr: null,
    options: null,
    ...extra,
  };
}

const MASTER_COLS = [
  sourceCol(1, 'vendorAccount', 'VendorAccount'),
  sourceCol(2, 'orderedQty', 'OrderedQty', { dataType: 'number' }),
  sourceCol(3, 'receivedQty', 'ReceivedQty', { dataType: 'number' }),
  {
    id: 4,
    key: 'openQty',
    label: 'Open qty',
    source: 'custom',
    dataType: 'number',
    isActive: true,
    formulaExpr: '(orderedQty)-(receivedQty)',
    options: null,
  },
  {
    id: 5,
    key: 'note',
    label: 'Note',
    source: 'custom',
    dataType: 'text',
    isActive: true,
    formulaExpr: null,
    options: null,
  },
];

const DETAIL_COLS = [
  sourceCol(11, 'itemNumber', 'ItemNumber'),
  sourceCol(12, 'quantity', 'Qty', { dataType: 'number' }),
  {
    id: 13,
    key: 'lineDouble',
    label: 'Line double',
    source: 'custom',
    dataType: 'number',
    isActive: true,
    formulaExpr: '(quantity)+(quantity)',
    options: null,
  },
];

const ITEM_COLS = [
  sourceCol(21, 'itemNumber', 'ItemNumber'),
  sourceCol(22, 'itemName', 'itemName'),
];

const LOOKUPS = [{
  id: 1,
  sourceScope: 'detail',
  sourceField: 'itemNumber',
  targetTableKey: 'items',
  targetKeyField: 'ItemNumber',
  fields: { itemName: 'itemName' },
  joinKeys: [],
}];

const MASTER_ROWS = [
  {
    partition_key: 'usmf',
    record_key: 'PO-100',
    data_json: JSON.stringify({
      VendorAccount: 'VEND-1',
      OrderedQty: 10,
      ReceivedQty: 4,
    }),
    removed_at_source: 0,
    sync_retained: 0,
    first_seen_at: new Date('2026-01-01T00:00:00.000Z'),
    content_changed_at: new Date('2026-02-01T00:00:00.000Z'),
    source_modified_at: new Date('2026-02-01T00:00:00.000Z'),
  },
  {
    partition_key: 'usmf',
    record_key: 'PO-200',
    data_json: JSON.stringify({
      VendorAccount: 'VEND-2',
      OrderedQty: 1,
      ReceivedQty: 1,
    }),
    removed_at_source: 0,
    sync_retained: 0,
    first_seen_at: new Date('2026-01-02T00:00:00.000Z'),
    content_changed_at: new Date('2026-02-02T00:00:00.000Z'),
    source_modified_at: new Date('2026-02-02T00:00:00.000Z'),
  },
];

const DETAIL_ROWS = [
  {
    partition_key: 'usmf',
    record_key: 'PO-100',
    detail_key: 1,
    data_json: JSON.stringify({ ItemNumber: 'ART-1', itemNumber: 'ART-1', Qty: 3 }),
    removed_at_source: 0,
    first_seen_at: new Date('2026-01-01T00:00:00.000Z'),
    content_changed_at: new Date('2026-02-01T00:00:00.000Z'),
  },
];

const ITEM_ROWS = [
  {
    partition_key: 'usmf',
    record_key: 'ART-1',
    data_json: JSON.stringify({ ItemNumber: 'ART-1', itemName: 'Bolt' }),
  },
];

const CUSTOM_ROWS = [{
  column_id: 5,
  key: 'note',
  scope: 'master',
  data_type: 'text',
  partition_key: 'usmf',
  record_key: 'PO-100',
  detail_key: -1,
  value_text: 'rush',
  value_number: null,
  value_date: null,
  value_bool: null,
}];

const HISTORY_ROWS = [{
  column_id: 5,
  partition_key: 'usmf',
  record_key: 'PO-100',
  detail_key: -1,
}];

const TRACK_CONFIG = JSON.stringify({
  mode: 'session',
  sessionRoles: ['admin', 'employee'],
  columns: { 5: { activatedAt: '2026-01-01T00:00:00.000Z' } },
});

function filterRecord(rows, inputs) {
  if (!inputs.recordKey) return rows;
  return rows.filter((row) => (
    row.partition_key === inputs.partitionKey && row.record_key === inputs.recordKey
  ));
}

function routeSql(sqlText, inputs) {
  const sql = String(sqlText).replace(/\s+/g, ' ');
  if (sql.includes('tb_track_change_sessions')) {
    return [{ started_at: SESSION_BOUNDARY }];
  }
  if (sql.includes('WITH changes AS')) {
    return [{
      column_id: 5,
      partition_key: 'usmf',
      record_key: 'PO-100',
      detail_key: -1,
      mark_offset: 0,
    }];
  }
  if (sql.includes('AS syncedAt')) {
    return [{
      syncedAt: SYNCED_AT,
      maxContentChangedAt: new Date('2026-02-01T00:00:00.000Z'),
      maxFirstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      maxCustomValueAt: new Date('2026-03-01T00:00:00.000Z'),
      maxLedgerAt: null,
      maxColumnsAt: new Date('2026-01-15T00:00:00.000Z'),
      exclusionCount: 0,
      maxExclusionAt: null,
      userViewedAt: VIEWED_AT,
      userBoardSettingsAt: null,
      settingsAt: new Date('2026-01-01T00:00:00.000Z'),
    }];
  }
  if (sql.includes('SELECT watermark, last_full_sync_at')) {
    return [{ watermark: null, last_full_sync_at: SYNCED_AT }];
  }
  if (sql.includes('SELECT vs.last_viewed_at')) {
    return [{ last_viewed_at: VIEWED_AT }];
  }
  if (sql.includes('tb_change_ledger') && sql.includes('field_key')) {
    return [];
  }
  if (sql.includes('WITH lines AS')) {
    return [{
      partition_key: 'usmf',
      record_key: 'PO-100',
      detail_count: 1,
      has_new_line: 0,
      has_changed_line: 0,
      has_removed_line: 0,
      unique_item_count: 1,
      first_item_marker: '000000000001ART-1',
    }];
  }
  if (sql.includes("scope = 'master'") && sql.includes('first_seen_at')) {
    return filterRecord(MASTER_ROWS, inputs);
  }
  if (sql.includes("scope = 'detail'") && sql.includes('data_json')) {
    return filterRecord(DETAIL_ROWS, inputs);
  }
  if (sql.includes('tb_custom_values')) {
    return filterRecord(CUSTOM_ROWS, inputs);
  }
  if (sql.includes('tb_cell_history') && sql.includes('UNION')) {
    return filterRecord(HISTORY_ROWS, inputs);
  }
  if (sql.includes('row_count')) {
    return [{
      table_id: 20,
      row_count: 1,
      max_synced: SYNCED_AT,
      max_changed: new Date('2026-02-01T00:00:00.000Z'),
    }];
  }
  if (sql.includes('SELECT partition_key, record_key, data_json FROM dbo.tb_cache')) {
    return Number(inputs.tableId) === ITEMS_TABLE.id ? ITEM_ROWS : [];
  }
  if (sql.includes('user_board_settings')) return [];
  throw new Error(`Unhandled board-read SQL: ${sql.slice(0, 220)}`);
}

function createRecordingPool(queryLog) {
  return {
    request() {
      const inputs = {};
      const request = {
        input(name, _type, value) {
          inputs[name] = value;
          return request;
        },
        query(sqlText) {
          queryLog.push(String(sqlText).replace(/\s+/g, ' ').trim());
          return Promise.resolve({ recordset: routeSql(sqlText, inputs) });
        },
      };
      return request;
    },
  };
}

function countMasterReads(queryLog) {
  return queryLog.filter((sql) => sql.includes("c.scope = 'master'") && sql.includes('first_seen_at')).length;
}

module.exports = {
  PO_TABLE,
  ITEMS_TABLE,
  MASTER_COLS,
  DETAIL_COLS,
  ITEM_COLS,
  LOOKUPS,
  TRACK_CONFIG,
  createRecordingPool,
  countMasterReads,
};
