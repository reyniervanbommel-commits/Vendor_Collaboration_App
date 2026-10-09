'use strict';

const mocks = {
  queries: [],
  queryHandler: null,
};

class FakeRequest {
  constructor(transaction = null) {
    this.transaction = transaction;
    this.inputs = {};
  }

  input(name, type, value) {
    this.inputs[name] = value;
    return this;
  }

  query(text) {
    mocks.queries.push({ text, inputs: this.inputs, transaction: this.transaction });
    return mocks.queryHandler({ text, inputs: this.inputs, transaction: this.transaction });
  }
}

const {
  hasRemarks,
  searchRemarks,
  setTestDependencies,
} = require('./RowRemarksSearchService');
const settingsService = require('./SettingsService');
const {
  clearSupplierVisibleRowKeyCache,
  rememberSupplierVisibleRowKeys,
} = require('../utils/supplierRowAccess');

const employee = { id: 12, role: 'employee' };
const supplier = { id: 7, role: 'supplier', vendorAccount: 'V000583' };
const originalGetAsync = settingsService.getAsync;

function result(recordset = []) {
  return { recordset, recordsets: [recordset] };
}

function defaultQueryHandler() {
  return result([
    { partition_key: 'whsl', record_key: 'PO-1' },
  ]);
}

beforeEach(() => {
  mocks.queries.length = 0;
  mocks.queryHandler = defaultQueryHandler;
  settingsService.getAsync = originalGetAsync;
  clearSupplierVisibleRowKeyCache();
  setTestDependencies({
    getPool: async () => ({ request: () => new FakeRequest() }),
    getTable: async () => ({ id: 7, key: 'purchase-orders' }),
  });
});

afterEach(() => {
  settingsService.getAsync = originalGetAsync;
  clearSupplierVisibleRowKeyCache();
  setTestDependencies();
});

describe('searchRemarks', () => {
  it('staff: searches with CHARINDEX, no body in SELECT, and maps keys', async () => {
    const response = await searchRemarks('purchase-orders', '  delay  ', employee);
    const search = mocks.queries.find(({ text }) => text.includes('CHARINDEX'));
    expect(search).toBeDefined();
    expect(search.text).toMatch(/CHARINDEX\(@q,\s*r\.body COLLATE Latin1_General_CI_AS\)/);
    expect(search.text).toMatch(/is_deleted\s*=\s*0/);
    expect(search.text).toMatch(/detail_key\s*=\s*-1/);
    expect(search.text).toMatch(/SELECT DISTINCT r\.partition_key,\s*r\.record_key/);
    const selectClause = search.text.slice(0, search.text.search(/\bFROM\b/i));
    expect(selectClause).not.toMatch(/\bbody\b/i);
    expect(search.inputs.q).toBe('delay');
    expect(response).toEqual({
      keys: [{ partitionKey: 'whsl', recordKey: 'PO-1' }],
    });
  });

  it('supplier: drops keys outside visibleKeys after SQL (IDOR)', async () => {
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    rememberSupplierVisibleRowKeys('V000583', 'vendorAccount', [
      { partitionKey: 'whsl', recordKey: 'PO-OWN' },
    ]);
    mocks.queryHandler = () => result([
      { partition_key: 'whsl', record_key: 'PO-OWN' },
      { partition_key: 'whsl', record_key: 'PO-OTHER' },
    ]);

    const response = await searchRemarks('purchase-orders', 'delay', supplier);

    expect(response).toEqual({
      keys: [{ partitionKey: 'whsl', recordKey: 'PO-OWN' }],
    });
    expect(response.keys.some((key) => key.recordKey === 'PO-OTHER')).toBe(false);
  });

  it('binds the normalized query string as q', async () => {
    await searchRemarks('purchase-orders', '  ab  ', employee);
    const search = mocks.queries.find(({ text }) => text.includes('CHARINDEX'));
    expect(search.inputs.q).toBe('ab');
    expect(typeof search.inputs.q).toBe('string');
  });
});

describe('hasRemarks', () => {
  it('staff: lists distinct keys without a search term', async () => {
    const response = await hasRemarks('purchase-orders', employee);
    expect(mocks.queries).toHaveLength(1);
    expect(mocks.queries[0].text).not.toMatch(/CHARINDEX/);
    expect(mocks.queries[0].inputs.q).toBeUndefined();
    expect(mocks.queries[0].text).toMatch(/is_deleted\s*=\s*0/);
    expect(mocks.queries[0].text).toMatch(/detail_key\s*=\s*-1/);
    expect(response).toEqual({
      keys: [{ partitionKey: 'whsl', recordKey: 'PO-1' }],
    });
  });

  it('supplier: drops keys outside visibleKeys after SQL (IDOR)', async () => {
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    rememberSupplierVisibleRowKeys('V000583', 'vendorAccount', [
      { partitionKey: 'whsl', recordKey: 'PO-OWN' },
    ]);
    mocks.queryHandler = () => result([
      { partition_key: 'whsl', record_key: 'PO-OWN' },
      { partition_key: 'whsl', record_key: 'PO-OTHER' },
    ]);

    const response = await hasRemarks('purchase-orders', supplier);

    expect(response).toEqual({
      keys: [{ partitionKey: 'whsl', recordKey: 'PO-OWN' }],
    });
  });
});

describe('zichtbaarheid', () => {
  const lastQuery = () => mocks.queries.at(-1);

  it('searchRemarks filtert employee op internal', async () => {
    await searchRemarks('purchase-orders', 'abc', employee);
    expect(lastQuery().inputs.visibility).toBe('internal');
    expect(lastQuery().text).toContain('r.visibility = @visibility');
  });

  it('searchRemarks filtert supplier op vendor', async () => {
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    rememberSupplierVisibleRowKeys('V000583', 'vendorAccount', [{ partitionKey: 'whsl', recordKey: 'PO-1' }]);
    await searchRemarks('purchase-orders', 'abc', supplier);
    const search = mocks.queries.find(({ text }) => text.includes('CHARINDEX'));
    expect(search.inputs.visibility).toBe('vendor');
    expect(search.text).toContain('r.visibility = @visibility');
  });

  it.each([
    ['admin', { id: 1, role: 'admin' }],
    ['supply_chain', { id: 3, role: 'supply_chain' }],
  ])('hasRemarks zonder filter voor %s', async (_label, actor) => {
    await hasRemarks('purchase-orders', actor);
    expect(lastQuery().text).not.toContain('@visibility');
    expect(lastQuery().inputs).not.toHaveProperty('visibility');
  });

  it('hasRemarks filtert employee op internal', async () => {
    await hasRemarks('purchase-orders', employee);
    expect(lastQuery().inputs.visibility).toBe('internal');
  });
});
