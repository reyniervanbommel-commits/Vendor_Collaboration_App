import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applyBoardRowVisibility } = require('./filterVisibleRows');

describe('applyBoardRowVisibility', () => {
  it('filtert op het leveranciersaccount', () => {
    const rows = [
      { values: { vendorAccount: 'V1' }, isNew: true, isChanged: false },
      { values: { vendorAccount: 'V2' }, isNew: false, isChanged: true },
    ];
    const result = applyBoardRowVisibility({
      rows,
      tableKey: 'purchase-orders',
      activeSyncLayers: [],
      itemsLineFilterActive: false,
      ordersHiddenByItemsFilter: new Set(),
      supplierAccount: 'v1',
      supplierFilterColumn: 'vendorAccount',
      newCount: 1,
      changedCount: 1,
    });
    expect(result.scopedRows).toHaveLength(1);
    expect(result.newCount).toBe(1);
    expect(result.changedCount).toBe(0);
  });
});
