import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/sqlPool', () => ({ getSqlPool: () => ({}) }));
vi.mock('../services/D365ODataService', () => ({ fetchPurchaseOrders: vi.fn() }));
vi.mock('../utils/supplierScope', () => ({
  getSupplierAccount: () => '',
  isStaffUser: () => true,
}));
vi.mock('../utils/runtimeHeaderLinks', () => ({
  loadRuntimeHeaderLinks: vi.fn(),
  clearRuntimeHeaderLinksCache: vi.fn(),
}));

import supplierRouter from './supplier.js';

describe('normalizeViewState columnSumKeys', () => {
  it('keeps columnSumKeys on table-level and defaults missing keys to []', () => {
    const withKeys = supplierRouter.normalizeViewState({
      table: { columnSumKeys: ['qty', 'qty', ' amount '] },
    });
    expect(withKeys.table.columnSumKeys).toEqual(['qty', 'amount']);

    const withoutKeys = supplierRouter.normalizeViewState({ table: { grouping: { summaryColumnKeys: ['qty'] } } });
    expect(withoutKeys.table.columnSumKeys).toEqual([]);
    expect(withoutKeys.table.grouping.summaryColumnKeys).toEqual(['qty']);
  });

  it('keeps showAsTab on the view state', () => {
    expect(supplierRouter.normalizeViewState({ showAsTab: true }).showAsTab).toBe(true);
    expect(supplierRouter.normalizeViewState({}).showAsTab).toBe(false);
  });
});
