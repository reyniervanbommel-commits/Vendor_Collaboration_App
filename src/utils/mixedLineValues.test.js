import { describe, expect, it } from 'vitest';
import { buildMixedValuesMessage, distinctLineValues, findOrdersWithMixedValues } from './mixedLineValues';

const ROWS = [
  { dataAreaId: 'whsl', orderNumber: 'PO1', linkedLineValues: { ext: ['test', '', null, '-'] } },
  { dataAreaId: 'whsl', orderNumber: 'PO2', linkedLineValues: { ext: ['test', 'Reference : 26/08/24'] } },
  { dataAreaId: 'whsl', orderNumber: 'PO3', linkedLineValues: {} },
];

describe('distinctLineValues', () => {
  it('negeert lege waarden en dedupliceert op getrimde tekst', () => {
    expect(distinctLineValues(['a ', 'a', '', null, undefined, '-', 'b'])).toEqual(['a', 'b']);
    expect(distinctLineValues(undefined)).toEqual([]);
  });
});

describe('findOrdersWithMixedValues', () => {
  it('vindt alleen orders met ≥2 echte unieke waarden', () => {
    expect(findOrdersWithMixedValues(ROWS, 'ext').map((r) => r.orderNumber)).toEqual(['PO2']);
  });
});

describe('buildMixedValuesMessage', () => {
  it('enkele order: noemt de huidige waarden en de doelwaarde', () => {
    expect(buildMixedValuesMessage({ rows: [ROWS[1]], mixedRows: [ROWS[1]], headerColumnKey: 'ext', value: 'new' }))
      .toBe('Lines on order PO2 currently have 2 different values ("test", "Reference : 26/08/24"). All lines will be set to "new" in D365.');
  });

  it('enkele order: maximaal 3 waarden, lange waarden afgekapt, ISO-datum als datum', () => {
    const row = { orderNumber: 'PO9', linkedLineValues: { ext: ['2026-10-01T00:00:00Z', 'b', 'c', 'd', 'x'.repeat(50)] } };
    expect(buildMixedValuesMessage({ rows: [row], mixedRows: [row], headerColumnKey: 'ext', value: 'y' }))
      .toBe('Lines on order PO9 currently have 5 different values ("2026-10-01", "b", "c", …). All lines will be set to "y" in D365.');
  });

  it('bulk: telt orders met afwijkende waarden', () => {
    expect(buildMixedValuesMessage({ rows: ROWS, mixedRows: [ROWS[1]], headerColumnKey: 'ext', value: 'new' }))
      .toBe('1 of 3 selected orders have different line values. All their lines will be set to "new" in D365.');
  });
});
