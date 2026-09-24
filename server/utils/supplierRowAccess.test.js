'use strict';

const {
  assertSupplierPurchaseOrderRow,
  clearSupplierVisibleRowKeyCache,
  filterRowsForSupplier,
  getSupplierFilterColumnKey,
  loadSupplierVisibleRowKeys,
  rememberSupplierVisibleRowKeys,
  selectRecKeysMatchingNativeSupplierColumn,
  configureSupplierRowAccess,
} = require('./supplierRowAccess');
const settingsService = require('../services/SettingsService');
const originalGetAsync = settingsService.getAsync;
const readPurchaseOrders = vi.fn();

beforeEach(() => {
  readPurchaseOrders.mockReset();
  readPurchaseOrders.mockResolvedValue({ rows: [] });
  configureSupplierRowAccess({ read: readPurchaseOrders });
});

afterEach(() => {
  settingsService.getAsync = originalGetAsync;
  clearSupplierVisibleRowKeyCache();
  vi.restoreAllMocks();
});

describe('filterRowsForSupplier', () => {
  it('houdt alleen rijen over waarvan de partition+record-key in visibleKeys staat', () => {
    const rows = [
      { partitionKey: 'PO', recordKey: '1' },
      { partitionKey: 'PO', recordKey: '2' },
      { partitionKey: 'PO', recordKey: '3' },
    ];
    const visibleKeys = new Set(['PO|1', 'PO|3']);

    expect(filterRowsForSupplier(rows, visibleKeys)).toEqual([
      { partitionKey: 'PO', recordKey: '1' },
      { partitionKey: 'PO', recordKey: '3' },
    ]);
  });

  it('ondersteunt zowel camelCase als snake_case veldnamen (DB-rows)', () => {
    const rows = [{ partition_key: 'PO', record_key: '5' }];
    const visibleKeys = new Set(['PO|5']);

    expect(filterRowsForSupplier(rows, visibleKeys)).toEqual(rows);
  });

  it('geeft een lege lijst als geen enkele rij zichtbaar is — voorkomt datalek naar andere suppliers', () => {
    const rows = [{ partitionKey: 'PO', recordKey: '1' }];
    const visibleKeys = new Set(['PO|999']);

    expect(filterRowsForSupplier(rows, visibleKeys)).toEqual([]);
  });

  it('geeft een lege lijst voor een lege visibleKeys-set', () => {
    const rows = [{ partitionKey: 'PO', recordKey: '1' }];

    expect(filterRowsForSupplier(rows, new Set())).toEqual([]);
  });
});

describe('getSupplierFilterColumnKey', () => {
  it('delegeert naar SettingsService met de juiste key en default', async () => {
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');

    const result = await getSupplierFilterColumnKey();

    expect(result).toBe('vendorAccount');
    expect(settingsService.getAsync).toHaveBeenCalledWith('SUPPLIER_FILTER_COLUMN_KEY', 'vendorAccount');
  });
});

const supplierUser = { id: 7, role: 'supplier', vendorAccount: 'V000583' };

describe('assertSupplierPurchaseOrderRow', () => {
  it('roept geen board-read aan voor staff', async () => {
    await assertSupplierPurchaseOrderRow({ id: 1, role: 'employee' }, {
      tableKey: 'purchase-orders',
      partitionKey: 'whsl',
      recordKey: 'WSPO-0061689',
    });
    expect(readPurchaseOrders).not.toHaveBeenCalled();
  });

  it('leest alleen de gevraagde order (geen volledige board-read)', async () => {
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    readPurchaseOrders.mockResolvedValue({
      rows: [{ partitionKey: 'whsl', recordKey: 'WSPO-0061689' }],
    });

    await assertSupplierPurchaseOrderRow(supplierUser, {
      tableKey: 'purchase-orders',
      partitionKey: 'whsl',
      recordKey: 'WSPO-0061689',
    });

    expect(readPurchaseOrders).toHaveBeenCalledTimes(1);
    expect(readPurchaseOrders).toHaveBeenCalledWith(expect.objectContaining({
      tableKey: 'purchase-orders',
      userId: 7,
      supplierAccount: 'V000583',
      supplierFilterColumn: 'vendorAccount',
      includeDetails: false,
      partitionKey: 'whsl',
      recordKey: 'WSPO-0061689',
    }));
  });

  it('gooit 403 wanneer de order niet in de vendor-scope zit', async () => {
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    readPurchaseOrders.mockResolvedValue({ rows: [] });

    await expect(assertSupplierPurchaseOrderRow(supplierUser, {
      tableKey: 'purchase-orders',
      partitionKey: 'whsl',
      recordKey: 'OTHER-PO',
    })).rejects.toMatchObject({ status: 403 });
  });
});

describe('loadSupplierVisibleRowKeys', () => {
  it('deelt één in-flight board-read tussen parallelle aanroepen', async () => {
    let resolveRead;
    readPurchaseOrders.mockImplementation(() => new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const first = loadSupplierVisibleRowKeys('V000583', 'vendorAccount', 7);
    const second = loadSupplierVisibleRowKeys('V000583', 'vendorAccount', 7);
    expect(readPurchaseOrders).toHaveBeenCalledTimes(1);

    resolveRead({
      rows: [
        { partitionKey: 'whsl', recordKey: 'PO-1' },
        { partitionKey: 'whsl', recordKey: 'PO-2' },
      ],
    });

    await expect(first).resolves.toEqual(new Set(['whsl|PO-1', 'whsl|PO-2']));
    await expect(second).resolves.toEqual(new Set(['whsl|PO-1', 'whsl|PO-2']));
    expect(readPurchaseOrders).toHaveBeenCalledTimes(1);
  });

  it('hergebruikt een keyset die het board al heeft gevuld', async () => {
    rememberSupplierVisibleRowKeys('V000583', 'vendorAccount', [
      { partitionKey: 'whsl', recordKey: 'PO-1' },
    ]);

    const keys = await loadSupplierVisibleRowKeys('V000583', 'vendorAccount', 7);

    expect(keys).toEqual(new Set(['whsl|PO-1']));
    expect(readPurchaseOrders).not.toHaveBeenCalled();
  });
});

describe('selectRecKeysMatchingNativeSupplierColumn', () => {
  it('selecteert recKeys waarvan het native JSON-veld het vendor-account is', () => {
    const masterJsonByRecKey = new Map([
      ['whsl|PO-1', { vendorAccount: 'V000583', status: 'Open' }],
      ['whsl|PO-2', { vendorAccount: 'V000999', status: 'Open' }],
    ]);

    expect(selectRecKeysMatchingNativeSupplierColumn(
      masterJsonByRecKey,
      'V000583',
      'vendorAccount',
    )).toEqual(new Set(['whsl|PO-1']));
  });

  it('geeft null als de filterkolom niet in de master-JSON staat (lookup-kolom)', () => {
    const masterJsonByRecKey = new Map([
      ['whsl|PO-1', { orderNumber: 'PO-1' }],
    ]);

    expect(selectRecKeysMatchingNativeSupplierColumn(
      masterJsonByRecKey,
      'V000583',
      'vendorName',
    )).toBeNull();
  });
});

