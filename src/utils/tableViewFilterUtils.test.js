import { describe, expect, it, vi } from 'vitest';
import {
  buildFilterFromCellValue,
  columnValueMatchesFilter,
  copyCellValueToClipboard,
  isCellContextMenuDisabled,
  serializeRawValueForFilter,
  hasActiveFilter,
  resolveFilterModel,
  textMatchesFilter,
  NUMBER_FILTER_OPERATORS,
  numberMatchesFilter,
  filterItemsByColumnFilters,
  isRemarksSearchTermValid,
  isRemarksFilterOperatorReady,
} from './tableViewFilterUtils';

describe('tableViewFilterUtils', () => {
  it('serializes text values as strings', () => {
    expect(serializeRawValueForFilter({ dataType: 'text' }, 42)).toBe('42');
    expect(serializeRawValueForFilter({ dataType: 'text' }, null)).toBe('');
  });

  it('serializes date values as yyyy-mm-dd', () => {
    expect(serializeRawValueForFilter({ dataType: 'date' }, '2026-03-15T10:00:00Z')).toBe('2026-03-15');
  });

  it('builds equals filter from raw cell value', () => {
    expect(buildFilterFromCellValue({ dataType: 'text' }, 'Open')).toEqual({
      operator: 'equals',
      value: 'Open',
      secondaryValue: '',
    });
    expect(buildFilterFromCellValue({ dataType: 'text' }, null)).toEqual({
      operator: 'equals',
      value: '',
      secondaryValue: '',
    });
  });

  it('disables context menu only when column key is missing', () => {
    expect(isCellContextMenuDisabled({ dataType: 'text' })).toBe(true);
    expect(isCellContextMenuDisabled(
      { key: 'total', dataType: 'number' },
      { linkedLineTotalKeys: { total: 'qty' } }
    )).toBe(false);
    expect(isCellContextMenuDisabled(
      { key: 'values', dataType: 'text' },
      { linkedLineValueKeys: { values: { lineColumnKey: 'desc' } } }
    )).toBe(false);
    expect(isCellContextMenuDisabled({ key: 'status', dataType: 'text' })).toBe(false);
  });

  it('copies raw value to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await copyCellValueToClipboard({ dataType: 'text' }, 'PO-1001');
    expect(writeText).toHaveBeenCalledWith('PO-1001');
  });

  it('filters date period week columns with numeric operators', () => {
    const column = {
      key: 'deliveryWeek',
      dataType: 'date_period',
      options: { sourceColumnKey: 'requestedDeliveryDate' },
    };
    const modes = { deliveryWeek: 'week' };

    expect(columnValueMatchesFilter(column, '12', { operator: 'gt', value: '5' }, modes)).toBe(true);
    expect(columnValueMatchesFilter(column, '4', { operator: 'gt', value: '5' }, modes)).toBe(false);
    expect(columnValueMatchesFilter(column, '12', { operator: 'between', value: '10', secondaryValue: '20' }, modes)).toBe(true);
  });
});

describe('oneOf filter — array-based waarde + backward compat', () => {
  const textColumn = { key: 'vendor', dataType: 'text' };

  it('resolveFilterModel normaliseert een array-waarde ongewijzigd', () => {
    const model = resolveFilterModel(textColumn, { operator: 'oneOf', value: ['Acme', 'Beta'] });
    expect(model).toEqual({ operator: 'oneOf', value: ['Acme', 'Beta'], secondaryValue: '' });
  });

  it('resolveFilterModel zet een legacy kommagescheiden string om naar een array', () => {
    const model = resolveFilterModel(textColumn, { operator: 'oneOf', value: 'Acme, Inc.,Beta' });
    expect(model).toEqual({ operator: 'oneOf', value: ['Acme, Inc.', 'Beta'], secondaryValue: '' });
  });

  it('resolveFilterModel geeft een lege array zonder bestaand filter', () => {
    const model = resolveFilterModel(textColumn, { operator: 'oneOf' });
    expect(model.value).toEqual([]);
  });

  it('hasActiveFilter is alleen actief met een niet-lege oneOf-array', () => {
    expect(hasActiveFilter(textColumn, { operator: 'oneOf', value: [] })).toBe(false);
    expect(hasActiveFilter(textColumn, { operator: 'oneOf', value: ['Acme'] })).toBe(true);
  });

  it('textMatchesFilter matcht case-insensitive tegen de oneOf-array', () => {
    const filter = { operator: 'oneOf', value: ['Acme, Inc.', 'Beta'] };
    expect(textMatchesFilter('acme, inc.', filter)).toBe(true);
    expect(textMatchesFilter('Gamma', filter)).toBe(false);
  });

  it('textMatchesFilter valt terug op een legacy string-waarde', () => {
    const filter = { operator: 'oneOf', value: 'Acme,Beta' };
    expect(textMatchesFilter('beta', filter)).toBe(true);
  });
});

describe('oneOf filter — number-kolommen', () => {
  it('NUMBER_FILTER_OPERATORS bevat oneOf', () => {
    expect(NUMBER_FILTER_OPERATORS.oneOf).toBe('is one of');
  });

  it('numberMatchesFilter matcht een waarde uit de oneOf-array', () => {
    const filter = { operator: 'oneOf', value: [100, 250] };
    expect(numberMatchesFilter(100, filter)).toBe(true);
    expect(numberMatchesFilter('250', filter)).toBe(true);
    expect(numberMatchesFilter(300, filter)).toBe(false);
  });

  it('numberMatchesFilter met lege oneOf-array matcht alles', () => {
    expect(numberMatchesFilter(42, { operator: 'oneOf', value: [] })).toBe(true);
  });

  it('numberMatchesFilter negeert niet-numerieke rijwaarden', () => {
    expect(numberMatchesFilter('n/a', { operator: 'oneOf', value: [1] })).toBe(false);
  });
});

describe('filterItemsByColumnFilters', () => {
  const columns = [
    { key: 'vendor', dataType: 'text' },
    { key: 'status', dataType: 'text' },
  ];
  const items = [
    { values: { vendor: 'Acme', status: 'Open' } },
    { values: { vendor: 'Acme', status: 'Closed' } },
    { values: { vendor: 'Beta', status: 'Open' } },
  ];

  it('geeft alle items terug zonder actieve filters', () => {
    expect(filterItemsByColumnFilters(items, columns, {}, {}, 'status')).toEqual(items);
  });

  it('past filters van andere kolommen toe, maar niet die van excludeColumnKey', () => {
    const filterByColumn = {
      vendor: { operator: 'equals', value: 'Acme' },
      status: { operator: 'equals', value: 'Open' },
    };
    const result = filterItemsByColumnFilters(items, columns, filterByColumn, {}, 'status');
    expect(result).toEqual([
      { values: { vendor: 'Acme', status: 'Open' } },
      { values: { vendor: 'Acme', status: 'Closed' } },
    ]);
  });

  it('negeert kleurfilters (colorIs) op andere kolommen', () => {
    const filterByColumn = {
      vendor: { operator: 'colorIs', colors: ['#ff0000'] },
    };
    expect(filterItemsByColumnFilters(items, columns, filterByColumn, {}, 'status')).toEqual(items);
  });
});

describe('remarks column — value-pass skip and min-2 helper', () => {
  const remarks = { key: 'remarks', dataType: 'remarks' };
  it('treats remarks as matching in the value pass so unique values of other columns stay filled', () => {
    expect(columnValueMatchesFilter(remarks, undefined, { operator: 'contains', value: 'delay' })).toBe(true);
    expect(hasActiveFilter(remarks, { operator: 'contains', value: 'delay' })).toBe(true);
  });
  it('isRemarksSearchTermValid requires 2–200 trimmed chars', () => {
    expect(isRemarksSearchTermValid(' a ')).toBe(false);
    expect(isRemarksSearchTermValid('ab')).toBe(true);
  });
  it('hasComment is active without a search term and ready to apply', () => {
    expect(hasActiveFilter(remarks, { operator: 'hasComment', value: '' })).toBe(true);
    expect(isRemarksFilterOperatorReady('hasComment', '')).toBe(true);
    expect(isRemarksFilterOperatorReady('contains', 'a')).toBe(false);
    expect(isRemarksFilterOperatorReady('contains', 'ab')).toBe(true);
  });
  it('filterItemsByColumnFilters ignores remarks cell values', () => {
    const items = [{ values: { vendor: 'Acme' } }];
    const columns = [{ key: 'vendor', dataType: 'text' }, remarks];
    const filters = { remarks: { operator: 'contains', value: 'delay' }, vendor: { operator: 'contains', value: 'acme' } };
    expect(filterItemsByColumnFilters(items, columns, filters)).toHaveLength(1);
  });
});

describe('purchase-order status display labels', () => {
  const statusColumn = { key: 'status', dataType: 'text', d365Field: 'PurchaseOrderStatus' };

  it('matcht zowel Backorder als het D365-label Open order', () => {
    expect(columnValueMatchesFilter(statusColumn, 'Backorder', { operator: 'equals', value: 'Backorder' })).toBe(true);
    expect(columnValueMatchesFilter(statusColumn, 'Backorder', { operator: 'equals', value: 'Open order' })).toBe(true);
    expect(columnValueMatchesFilter(statusColumn, 'Backorder', { operator: 'contains', value: 'open' })).toBe(true);
    expect(columnValueMatchesFilter(statusColumn, 'Backorder', { operator: 'contains', value: 'open order' })).toBe(true);
    expect(columnValueMatchesFilter(statusColumn, 'Invoiced', { operator: 'equals', value: 'Open order' })).toBe(false);
  });

  it('sluit Open order uit bij does not contain', () => {
    expect(columnValueMatchesFilter(statusColumn, 'Backorder', { operator: 'notContains', value: 'open order' })).toBe(false);
    expect(columnValueMatchesFilter(statusColumn, 'Invoiced', { operator: 'notContains', value: 'open order' })).toBe(true);
  });

  it('matcht Open order ook op een formulekolom die Backorder bevat', () => {
    const formulaColumn = { key: 'statusLabel', dataType: 'text', formulaExpr: '(status)' };
    expect(columnValueMatchesFilter(formulaColumn, 'Backorder', { operator: 'contains', value: 'open order' })).toBe(true);
    expect(columnValueMatchesFilter(formulaColumn, 'Backorder', { operator: 'equals', value: 'Open order' })).toBe(true);
    expect(columnValueMatchesFilter(formulaColumn, 'Backorder', { operator: 'oneOf', value: ['Open order'] })).toBe(true);
    expect(columnValueMatchesFilter(formulaColumn, 'Invoiced', { operator: 'contains', value: 'open order' })).toBe(false);
    expect(columnValueMatchesFilter(formulaColumn, 'Open order', { operator: 'equals', value: 'Backorder' })).toBe(true);
    expect(columnValueMatchesFilter(formulaColumn, 'Open order', { operator: 'contains', value: 'backorder' })).toBe(true);
  });
});
