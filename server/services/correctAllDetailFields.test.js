import { describe, expect, it, vi } from 'vitest';
import { correctAllDetailFields } from './TableDataService';

const STAFF = { id: 1, role: 'admin' };
const WRITABLE_LINE_COLUMN = {
  id: 44,
  tableId: 7,
  isActive: true,
  source: 'source',
  writable: true,
  writeMechanism: 'patch',
  sourceField: 'Color',
  scope: 'detail',
  key: 'color',
  dataType: 'text',
};

function baseDeps(overrides = {}) {
  return {
    getTableByKey: vi.fn().mockResolvedValue({ id: 7, key: 'purchase-orders' }),
    getColumnById: vi.fn().mockResolvedValue(WRITABLE_LINE_COLUMN),
    loadDetailLines: vi.fn().mockResolvedValue([
      { detailKey: 1, values: { color: 'Red' }, removed: false },
      { detailKey: 2, values: { color: 'Blue' }, removed: false },
    ]),
    correctOne: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

const params = {
  tableKey: 'purchase-orders',
  columnId: 44,
  partitionKey: 'nl01',
  recordKey: 'PO-1',
  value: 'Green',
};

describe('correctAllDetailFields auth', () => {
  it('throws 403 for an unknown role before any SQL', async () => {
    const deps = baseDeps({
      getTableByKey: vi.fn(() => {
        throw new Error('SQL should not run');
      }),
    });
    await expect(correctAllDetailFields(params, { id: 9, role: 'user' }, deps))
      .rejects.toMatchObject({ status: 403 });
    expect(deps.getTableByKey).not.toHaveBeenCalled();
  });

  it('throws 403 for a supplier on a column that is not vendor-editable', async () => {
    const deps = baseDeps({
      getColumnById: vi.fn().mockResolvedValue({ ...WRITABLE_LINE_COLUMN, vendorEditable: false }),
    });
    await expect(correctAllDetailFields(params, { id: 9, role: 'supplier' }, deps))
      .rejects.toMatchObject({ status: 403 });
  });

  it('allows a supplier on a column the admin made vendor-editable', async () => {
    const deps = baseDeps({
      getColumnById: vi.fn().mockResolvedValue({ ...WRITABLE_LINE_COLUMN, vendorEditable: true }),
    });
    const result = await correctAllDetailFields(params, { id: 9, role: 'supplier' }, deps);
    expect(result.attempted).toBe(2);
  });
});

describe('correctAllDetailFields guards', () => {
  it('rejects a non purchase-orders table with 400', async () => {
    await expect(correctAllDetailFields(
      { ...params, tableKey: 'vendors' },
      STAFF,
      baseDeps(),
    )).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a header-scope column with 400', async () => {
    await expect(correctAllDetailFields(
      params,
      STAFF,
      baseDeps({
        getColumnById: vi.fn().mockResolvedValue({ ...WRITABLE_LINE_COLUMN, scope: 'master' }),
      }),
    )).rejects.toMatchObject({ status: 400 });
  });

  it('rejects more than 200 lines to patch with 400', async () => {
    const lines = Array.from({ length: 201 }, (_, i) => ({
      detailKey: i + 1,
      values: { color: 'A' },
      removed: false,
    }));
    await expect(correctAllDetailFields(
      params,
      STAFF,
      baseDeps({ loadDetailLines: vi.fn().mockResolvedValue(lines) }),
    )).rejects.toMatchObject({
      status: 400,
      message: 'Too many lines to write back from the header.',
    });
  });
});

describe('correctAllDetailFields fan-out', () => {
  it('continues after a 409 and reports remaining values', async () => {
    const correctOne = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }));
    const result = await correctAllDetailFields(params, STAFF, baseDeps({ correctOne }));
    expect(result).toMatchObject({
      attempted: 2,
      updated: 1,
      failed: 1,
      skipped: 0,
      updatedDetailKeys: [1],
    });
    expect(result.remainingValues).toEqual(['Green', 'Blue']);
    expect(result.failures[0]).toMatchObject({ detailKey: 2, message: 'Conflict' });
  });

  it('rethrows a 502 when no line was updated', async () => {
    const correctOne = vi.fn().mockRejectedValue(Object.assign(new Error('D365 down'), { status: 502 }));
    await expect(correctAllDetailFields(params, STAFF, baseDeps({ correctOne })))
      .rejects.toMatchObject({ status: 502 });
  });

  it('returns generic failure text after a 502 following a success', async () => {
    const correctOne = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(Object.assign(new Error('{"odata.error":"secret"}'), { status: 502 }));
    const result = await correctAllDetailFields(params, STAFF, baseDeps({ correctOne }));
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0].message).toBe('Write-back to D365 failed');
  });
});
