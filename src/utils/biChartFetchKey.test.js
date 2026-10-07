import { describe, expect, it } from 'vitest';
import { filtersFromColumnMap } from './biChartFetchKey';

describe('filtersFromColumnMap', () => {
  it('strips remarks from BI inherited filters', () => {
    const result = filtersFromColumnMap({
      remarks: { operator: 'contains', value: 'ab' },
      vendor: { operator: 'contains', value: 'x' },
    });
    expect(result.some((filter) => filter.columnKey === 'remarks')).toBe(false);
    expect(result).toEqual([
      { columnKey: 'vendor', operator: 'contains', value: 'x', secondaryValue: '' },
    ]);
  });

  it('zet meerdere kolomvoorwaarden om naar losse BI-filters', () => {
    expect(filtersFromColumnMap({
      vendor: {
        rules: [
          { operator: 'startsWith', value: 'S' },
          { operator: 'notContains', value: 'closed' },
        ],
      },
    })).toEqual([
      { columnKey: 'vendor', operator: 'startsWith', value: 'S', secondaryValue: '' },
      { columnKey: 'vendor', operator: 'notContains', value: 'closed', secondaryValue: '' },
    ]);
  });
});
