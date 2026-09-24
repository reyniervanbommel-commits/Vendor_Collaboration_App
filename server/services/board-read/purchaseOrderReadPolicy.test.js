import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveItemsLineFilter } = require('./purchaseOrderReadPolicy');

describe('resolveItemsLineFilter', () => {
  it('doet niets buiten purchase-orders', async () => {
    const result = await resolveItemsLineFilter({
      table: { key: 'vendors' },
      enrichment: { lookups: [] },
      loadPresentItemFilterKeys: async () => { throw new Error('niet aanroepen'); },
    });
    expect(result).toEqual({
      itemsFilterKeys: null,
      itemsFilterField: 'itemNumber',
      itemsLineFilterActive: false,
    });
  });
});
