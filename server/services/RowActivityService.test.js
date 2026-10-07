'use strict';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function loadWithSqlStub(request, parent, isMain) {
  if (request !== 'mssql') return originalLoad.call(this, request, parent, isMain);
  return {
    BigInt: 'BigInt',
    Bit: 'Bit',
    Int: 'Int',
    NVarChar: (length) => ({ type: 'NVarChar', length }),
  };
};

const {
  createRowActivityService,
  decodeCursor,
  encodeCursor,
  enrichRemarkActivity,
  mapActivityRow,
  matchesUpdatedAction,
  parseActionFilter,
  parseLimit,
} = require('./RowActivityService');
Module._load = originalLoad;

function activityRow(overrides = {}) {
  return {
    source_id: 1,
    activity_type: 'custom',
    type_rank: 2,
    created_at_iso: '2026-07-13T10:00:00.0000000Z',
    action: 'update',
    field_key: 'status',
    column_id: 12,
    column_label: 'Status',
    old_value_text: 'Open',
    old_value_number: null,
    old_value_date: null,
    old_value_bool: null,
    new_value_text: 'Closed',
    new_value_number: null,
    new_value_date: null,
    new_value_bool: null,
    status: null,
    error: null,
    body: null,
    is_deleted: false,
    user_id: 7,
    user_name: 'Test User',
    user_email: 'test@example.com',
    ...overrides,
  };
}

function createHarness({ rows = [], totals = { remarks: 0, history: rows.length, historyUpdated: 0 }, column = null } = {}) {
  const calls = { inputs: {}, query: '' };
  const request = {
    input(name, _type, value) {
      calls.inputs[name] = value;
      return this;
    },
    async query(query) {
      calls.query = query;
      return { recordsets: [rows, [totals]] };
    },
  };
  const getRowActivity = createRowActivityService({
    getTableByKey: vi.fn().mockResolvedValue({ id: 9, key: 'purchase-orders' }),
    getColumnById: vi.fn().mockResolvedValue(column),
    getPool: vi.fn().mockResolvedValue({ request: () => request }),
    time: vi.fn((_label, fn) => fn()),
  });
  return { calls, getRowActivity };
}

const BASE_OPTIONS = {
  tableKey: 'purchase-orders',
  partitionKey: 'whsl',
  recordKey: 'PO-1',
};

describe('RowActivityService formatters', () => {
  it('maps typed values, actor and deleted remark content safely', () => {
    const mapped = mapActivityRow(activityRow({
      activity_type: 'remark',
      type_rank: 5,
      old_value_text: null,
      new_value_text: null,
      old_value_number: '12.50',
      new_value_bool: 1,
      body: 'secret retained body',
      is_deleted: true,
    }));

    expect(mapped).toMatchObject({
      id: 'remark:1',
      oldValue: 12.5,
      newValue: true,
      body: null,
      isDeleted: true,
      actor: { id: 7, name: 'Test User', email: 'test@example.com' },
    });
  });

  it('round-trips an opaque cursor with SQL datetime precision', () => {
    const encoded = encodeCursor({
      createdAt: '2026-07-13T10:00:00.1234567Z',
      typeRank: 4,
      sourceId: '9007199254740993',
    });

    expect(encoded).not.toContain('{');
    expect(decodeCursor(encoded)).toEqual({
      v: 1,
      at: '2026-07-13T10:00:00.1234567Z',
      r: 4,
      id: '9007199254740993',
    });
  });

  it('enriches All-feed remarks with author, column, reactions and delete rights', () => {
    const enriched = enrichRemarkActivity(
      mapActivityRow(activityRow({
        activity_type: 'remark',
        type_rank: 5,
        column_id: 12,
        column_label: 'Status',
      })),
      [{ emoji: '👍', count: 2, reactedByCurrentUser: true }],
      { id: 7, role: 'employee' }
    );

    expect(enriched).toMatchObject({
      author: { id: 7, displayName: 'Test User' },
      column: { id: 12, label: 'Status' },
      reactions: [{ emoji: '👍', count: 2, reactedByCurrentUser: true }],
      canDelete: true,
    });
  });

  it.each(['', 'abc=', 'eyJ2IjoxfQ', 'bm90LWpzb24'])('rejects invalid cursor %j', (cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(/invalid/i);
  });

  it.each([0, 101, '1.5', 'abc'])('rejects invalid limit %j', (limit) => {
    expect(() => parseLimit(limit)).toThrow(/limit/i);
  });

  it('uses limit 50 by default and accepts boundaries', () => {
    expect(parseLimit()).toBe(50);
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('100')).toBe(100);
  });

  it('normalizes history action filters', () => {
    expect(parseActionFilter('updated')).toBe('updated');
    expect(parseActionFilter('all')).toBeNull();
    expect(parseActionFilter()).toBeNull();
    expect(matchesUpdatedAction('update')).toBe(true);
    expect(matchesUpdatedAction('correct')).toBe(false);
  });
});

describe('RowActivityService query', () => {
  it('sorts newest-first stably and removes USER field-ledger duplicates', async () => {
    const rows = [
      activityRow({ source_id: 3, activity_type: 'row', type_rank: 3, field_key: 'status' }),
      activityRow({ source_id: 4, activity_type: 'd365', type_rank: 4, created_at_iso: '2026-07-13T11:00:00.0000000Z' }),
      activityRow({ source_id: 8, activity_type: 'custom', type_rank: 2 }),
      activityRow({ source_id: 2, activity_type: 'remark', type_rank: 5 }),
      activityRow({ source_id: 9, activity_type: 'custom', type_rank: 2 }),
      activityRow({ source_id: 5, activity_type: 'row', type_rank: 3, field_key: null }),
    ];
    const { getRowActivity } = createHarness({ rows, totals: { remarks: 1, history: 5 } });

    const result = await getRowActivity({ ...BASE_OPTIONS, kind: 'all', currentUser: { id: 7, role: 'admin' } });

    expect(result.items.map((item) => item.id)).toEqual([
      'd365:4', 'remark:2', 'row:5', 'custom:9', 'custom:8',
    ]);
    expect(result.items.some((item) => item.id === 'row:3')).toBe(false);
  });

  it('returns totals, page cursors and the mandatory timing label', async () => {
    const rows = [
      activityRow({ source_id: 3, created_at_iso: '2026-07-13T12:00:00.0000000Z' }),
      activityRow({ source_id: 2, created_at_iso: '2026-07-13T11:00:00.0000000Z' }),
      activityRow({ source_id: 1, created_at_iso: '2026-07-13T10:00:00.0000000Z' }),
    ];
    const harness = createHarness({ rows, totals: { remarks: 4, history: 12 } });

    const result = await harness.getRowActivity({
      ...BASE_OPTIONS, kind: 'all', limit: 2, currentUser: { id: 7, role: 'admin' },
    });

    expect(result.items).toHaveLength(2);
    expect(result.totals).toEqual({ remarks: 4, history: 12, historyUpdated: 0 });
    expect(decodeCursor(result.newestCursor).id).toBe('3');
    expect(decodeCursor(result.nextCursor).id).toBe('2');
    expect(harness.calls.inputs.take).toBe(3);
  });

  it('binds cursor and afterCursor independently and rejects combining them', async () => {
    const cursor = encodeCursor({ createdAt: '2026-07-13T10:00:00.000Z', typeRank: 2, sourceId: '4' });
    const harness = createHarness();
    const delta = await harness.getRowActivity({ ...BASE_OPTIONS, afterCursor: cursor });
    expect(harness.calls.inputs.afterId).toBe('4');
    expect(harness.calls.inputs.cursorId).toBeNull();
    expect(harness.calls.inputs.take).toBe(50);
    expect(delta.newestCursor).toBe(cursor);

    await expect(harness.getRowActivity({
      ...BASE_OPTIONS,
      cursor,
      afterCursor: cursor,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('validates an active same-table master column and binds the filter', async () => {
    const valid = createHarness({
      column: { id: 12, tableId: 9, scope: 'master', isActive: true },
    });
    await valid.getRowActivity({ ...BASE_OPTIONS, columnId: '12' });
    expect(valid.calls.inputs.columnId).toBe(12);
    expect(valid.calls.query).toContain('(@columnId IS NULL OR h.column_id=@columnId)');

    for (const column of [
      null,
      { id: 12, tableId: 10, scope: 'master', isActive: true },
      { id: 12, tableId: 9, scope: 'detail', isActive: true },
      { id: 12, tableId: 9, scope: 'master', isActive: false },
    ]) {
      const invalid = createHarness({ column });
      await expect(invalid.getRowActivity({ ...BASE_OPTIONS, columnId: '12' }))
        .rejects.toMatchObject({ status: 400 });
    }
  });

  it('queries only D365 and fieldless USER ledger rows at master detail key', async () => {
    const harness = createHarness();
    await harness.getRowActivity(BASE_OPTIONS);

    expect(harness.calls.query).toContain("l.source='D365' OR (l.source='USER' AND l.field_key IS NULL)");
    expect(harness.calls.query).toContain('l.detail_key=-1');
    expect(harness.calls.inputs.includeRemarks).toBe(false);
  });

  it('binds updated action filters and returns historyUpdated totals', async () => {
    const harness = createHarness({
      rows: [activityRow({ action: 'update' })],
      totals: { remarks: 0, history: 1, history_updated: 1 },
    });
    const result = await harness.getRowActivity({ ...BASE_OPTIONS, actionFilter: 'updated' });

    expect(harness.calls.inputs.actionFilter).toBe('updated');
    expect(harness.calls.query).toContain("UPPER(ISNULL(h.action, '')) = 'UPDATE'");
    expect(result.totals.historyUpdated).toBe(1);
  });
});

describe('RowActivityService zichtbaarheid', () => {
  const remarkRow = (overrides = {}) => activityRow({
    source_id: 2, activity_type: 'remark', type_rank: 5, field_key: null, body: 'hi',
    visibility: 'internal', author_role: 'supplier', ...overrides,
  });

  it('filtert remarks in de All-feed voor employee op internal', async () => {
    const harness = createHarness({ rows: [remarkRow()], totals: { remarks: 1, history: 0 } });
    const result = await harness.getRowActivity({ ...BASE_OPTIONS, kind: 'all', currentUser: { id: 1, role: 'employee' } });
    expect(harness.calls.inputs.visibility).toBe('internal');
    expect(harness.calls.query).toMatch(/r\.visibility = @visibility/);
    expect(result.items[0]).not.toHaveProperty('visibility');
    expect(result.items[0]).not.toHaveProperty('fromVendor');
  });

  it('filtert remarks voor supplier op vendor', async () => {
    const dataService = require('./TableDataService');
    const settingsService = require('./SettingsService');
    const { clearSupplierVisibleRowKeyCache } = require('../utils/supplierRowAccess');
    const originalRead = dataService.read;
    const originalGetAsync = settingsService.getAsync;
    clearSupplierVisibleRowKeyCache();
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    dataService.read = vi.fn(async () => ({ rows: [{ partitionKey: 'whsl', recordKey: 'PO-1' }] }));
    try {
      const harness = createHarness({ rows: [], totals: { remarks: 0, history: 0 } });
      await harness.getRowActivity({
        ...BASE_OPTIONS, kind: 'all', currentUser: { id: 3, role: 'supplier', vendor_account: 'V1' },
      });
      expect(harness.calls.inputs.visibility).toBe('vendor');
      expect(harness.calls.query).toMatch(/r\.visibility = @visibility/);
    } finally {
      dataService.read = originalRead;
      settingsService.getAsync = originalGetAsync;
    }
  });

  it('geen filter voor admin; remark-item krijgt visibility en fromVendor', async () => {
    const harness = createHarness({ rows: [remarkRow()], totals: { remarks: 1, history: 0 } });
    const result = await harness.getRowActivity({ ...BASE_OPTIONS, kind: 'all', currentUser: { id: 9, role: 'admin' } });
    expect(harness.calls.query).not.toContain('@visibility');
    expect(harness.calls.inputs).not.toHaveProperty('visibility');
    expect(result.items[0]).toMatchObject({ visibility: 'internal', fromVendor: true });
  });

  it('All-feed zonder bekende rol → 403', async () => {
    const harness = createHarness({ rows: [] });
    await expect(harness.getRowActivity({ ...BASE_OPTIONS, kind: 'all' })).rejects.toMatchObject({ status: 403 });
  });

  it('history-feed heeft geen rolfilter nodig', async () => {
    const harness = createHarness({ rows: [] });
    await harness.getRowActivity({ ...BASE_OPTIONS, kind: 'history' });
    expect(harness.calls.inputs).not.toHaveProperty('visibility');
  });

  it('non-remark items dragen geen visibility-velden', () => {
    const mapped = enrichRemarkActivity(mapActivityRow(activityRow()), [], { id: 1, role: 'admin' });
    expect(mapped).not.toHaveProperty('visibility');
    expect(mapped).not.toHaveProperty('authorRole');
  });
});
