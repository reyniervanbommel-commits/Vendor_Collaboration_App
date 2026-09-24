'use strict';

const {
  getOrLoad,
  peek,
  invalidate,
  rememberSupplierVisibleKeys,
  clearVariant,
  cacheKey,
  SUPPLIER_KEYS_TTL_MS,
} = require('./BoardCacheCoordinator');

describe('BoardCacheCoordinator', () => {
  afterEach(() => {
    invalidate(null);
    vi.useRealTimers();
  });

  it('deelt een snapshot op tableKey en supplierAccount, zonder userId in de key', async () => {
    const key = cacheKey({ tableKey: 'purchase-orders', supplierAccount: 'V1', variant: 'snapshot' });
    expect(key).toBe('purchase-orders::V1');
    expect(key).not.toContain('user');

    const loader = vi.fn().mockResolvedValue({ rows: [1] });
    await getOrLoad({ tableKey: 'purchase-orders', supplierAccount: 'V1', variant: 'snapshot', signature: 'a' }, loader);
    await getOrLoad({ tableKey: 'purchase-orders', supplierAccount: 'V1', variant: 'snapshot', signature: 'a' }, loader);
    await getOrLoad({ tableKey: 'purchase-orders', supplierAccount: 'V2', variant: 'snapshot', signature: 'a' }, loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(peek({ tableKey: 'purchase-orders', supplierAccount: 'V1', variant: 'snapshot', signature: 'a' })).toEqual({ rows: [1] });
    expect(peek({ tableKey: 'purchase-orders', supplierAccount: 'V2', variant: 'snapshot', signature: 'a' })).toEqual({ rows: [1] });
  });

  it('mist de cache bij een andere signature en na invalidate', async () => {
    const loader = vi.fn().mockResolvedValue('row');
    await getOrLoad({ tableKey: 't', supplierAccount: null, variant: 'kpi', signature: 's1' }, loader);
    await getOrLoad({ tableKey: 't', supplierAccount: null, variant: 'kpi', signature: 's2' }, loader);
    invalidate('t', 'content-write');
    await getOrLoad({ tableKey: 't', supplierAccount: null, variant: 'kpi', signature: 's2' }, loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('laat supplier-keys na 60 seconden verlopen en houdt snapshots langer', async () => {
    vi.useFakeTimers();
    rememberSupplierVisibleKeys(
      { tableKey: 'purchase-orders', supplierAccount: 'V1', supplierFilterColumn: 'vendorAccount', signature: 'live' },
      new Set(['a|1']),
    );
    await getOrLoad(
      { tableKey: 'purchase-orders', supplierAccount: null, variant: 'snapshot', signature: 'sig' },
      async () => 'snap',
    );
    vi.advanceTimersByTime(SUPPLIER_KEYS_TTL_MS + 1);
    expect(peek({
      tableKey: 'purchase-orders', supplierAccount: 'V1', variant: 'supplier-keys',
      supplierFilterColumn: 'vendorAccount', signature: 'live',
    })).toBeNull();
    expect(peek({
      tableKey: 'purchase-orders', supplierAccount: null, variant: 'snapshot', signature: 'sig',
    })).toBe('snap');
  });

  it('wist alleen supplier-keys bij clearVariant', async () => {
    rememberSupplierVisibleKeys(
      { tableKey: 'purchase-orders', supplierAccount: 'V1', supplierFilterColumn: 'vendorAccount', signature: 'live' },
      new Set(['a|1']),
    );
    await getOrLoad(
      { tableKey: 'purchase-orders', supplierAccount: null, variant: 'snapshot', signature: 'sig' },
      async () => 'snap',
    );
    clearVariant('supplier-keys');
    expect(peek({
      tableKey: 'purchase-orders', supplierAccount: 'V1', variant: 'supplier-keys',
      supplierFilterColumn: 'vendorAccount', signature: 'live',
    })).toBeNull();
    expect(peek({
      tableKey: 'purchase-orders', supplierAccount: null, variant: 'snapshot', signature: 'sig',
    })).toBe('snap');
  });

  it('weigert een onbekende variant of reden', async () => {
    await expect(getOrLoad({ tableKey: 't', variant: 'other', signature: 's' }, async () => 1)).rejects.toThrow(/variant/);
    expect(() => invalidate('t', 'nope')).toThrow(/reason/);
  });
});
