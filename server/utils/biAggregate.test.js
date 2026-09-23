import { describe, expect, it } from 'vitest';
import { aggregateCharts, matchesFilter } from './biAggregate.js';

const columns = [
  { key: 'vendor', label: 'Vendor', dataType: 'text' },
  { key: 'amount', label: 'Amount', dataType: 'number' },
  { key: 'qty', label: 'Qty', dataType: 'number' },
  { key: 'orderDate', label: 'Order date', dataType: 'date' },
  { key: 'status', label: 'Status', dataType: 'status' },
];

const rows = [
  { values: { vendor: 'A', amount: 100, qty: 2, orderDate: '2026-01-10', status: 'open' } },
  { values: { vendor: 'A', amount: 50, qty: 1, orderDate: '2026-01-20', status: 'closed' } },
  { values: { vendor: 'B', amount: 200, qty: 4, orderDate: '2026-02-05', status: 'open' } },
  { values: { vendor: 'B', amount: 25, qty: 1, orderDate: '2026-02-15', status: 'open' } },
];

describe('biAggregate.matchesFilter (number parity met de tabel)', () => {
  it('past > correct toe op numerieke kolommen', () => {
    expect(matchesFilter(200, { operator: 'gt', value: '100' }, 'number')).toBe(true);
    expect(matchesFilter(50, { operator: 'gt', value: '100' }, 'number')).toBe(false);
  });

  it('past between (inclusief) toe', () => {
    expect(matchesFilter(100, { operator: 'between', value: '50', secondaryValue: '150' }, 'number')).toBe(true);
    expect(matchesFilter(200, { operator: 'between', value: '50', secondaryValue: '150' }, 'number')).toBe(false);
  });

  it('behandelt lege filterwaarde als niet-actief', () => {
    expect(matchesFilter(10, { operator: 'gt', value: '' }, 'number')).toBe(true);
  });
});

describe('biAggregate.aggregateCharts', () => {
  it('somt een measure per dimensie', () => {
    const { results } = aggregateCharts({
      rows,
      columns,
      charts: [{ type: 'bar', dimension: 'vendor', measure: 'amount', aggregation: 'sum' }],
    });
    expect(results[0].series).toEqual([
      { name: 'B', value: 225 },
      { name: 'A', value: 150 },
    ]);
  });

  it('telt rijen per status (count)', () => {
    const { results } = aggregateCharts({
      rows,
      columns,
      charts: [{ type: 'pie', dimension: 'status', aggregation: 'count' }],
    });
    const byName = Object.fromEntries(results[0].series.map((s) => [s.name, s.value]));
    expect(byName).toEqual({ open: 3, closed: 1 });
  });

  it('past een numeriek filter toe met dezelfde semantiek als de tabel', () => {
    const { results } = aggregateCharts({
      rows,
      columns,
      charts: [{
        type: 'bar',
        dimension: 'vendor',
        measure: 'amount',
        aggregation: 'sum',
        filters: [{ columnKey: 'amount', operator: 'gt', value: '60' }],
      }],
    });
    // Alleen 100 (A) en 200 (B) blijven over.
    expect(results[0].series).toEqual([
      { name: 'B', value: 200 },
      { name: 'A', value: 100 },
    ]);
  });

  it('groepeert datum per maand', () => {
    const { results } = aggregateCharts({
      rows,
      columns,
      charts: [{ type: 'line', dimension: 'orderDate', measure: 'amount', aggregation: 'sum', dateGrouping: 'month' }],
    });
    expect(results[0].series).toEqual([
      { name: '2026-01', value: 150 },
      { name: '2026-02', value: 225 },
    ]);
  });

  it('groepeert datum per week', () => {
    const { results } = aggregateCharts({
      rows,
      columns,
      charts: [{ type: 'line', dimension: 'orderDate', measure: 'amount', aggregation: 'sum', dateGrouping: 'week' }],
    });
    expect(results[0].series.length).toBeGreaterThan(0);
    expect(results[0].series[0].name).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('ondersteunt meerdere measures in één bar chart', () => {
    const { results } = aggregateCharts({
      rows,
      columns,
      charts: [{
        type: 'bar',
        dimension: 'vendor',
        measures: ['amount', 'qty'],
        aggregation: 'sum',
      }],
    });
    const byVendor = Object.fromEntries(results[0].series.map((s) => [s.name, s]));
    expect(byVendor.A.amount).toBe(150);
    expect(byVendor.A.qty).toBe(3);
    expect(byVendor.B.amount).toBe(225);
    expect(byVendor.B.qty).toBe(5);
  });

  it('verwerkt meerdere charts in één call', () => {
    const { results } = aggregateCharts({
      rows,
      columns,
      charts: [
        { type: 'kpi', measure: 'amount', aggregation: 'sum' },
        { type: 'bar', dimension: 'vendor', measure: 'amount', aggregation: 'max' },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0].series[0].value).toBe(375);
    const maxByVendor = Object.fromEntries(results[1].series.map((s) => [s.name, s.value]));
    expect(maxByVendor).toEqual({ A: 100, B: 200 });
  });
});

describe('biAggregate — PurchStatus Open order alias', () => {
  it('matcht contains/equals Open order op opgeslagen Backorder', () => {
    expect(matchesFilter('Backorder', { operator: 'contains', value: 'open order' }, 'text')).toBe(true);
    expect(matchesFilter('Backorder', { operator: 'equals', value: 'Open order' }, 'text')).toBe(true);
    expect(matchesFilter('Invoiced', { operator: 'contains', value: 'open order' }, 'text')).toBe(false);
  });

  it('toont Open order als groeplabel voor de statuskolom', () => {
    const { results } = aggregateCharts({
      rows: [
        { values: { status: 'Backorder', amount: 10 } },
        { values: { status: 'Invoiced', amount: 5 } },
      ],
      columns: [
        { key: 'status', dataType: 'text', d365Field: 'PurchaseOrderStatus' },
        { key: 'amount', dataType: 'number' },
      ],
      charts: [{ type: 'bar', dimension: 'status', measure: 'amount', aggregation: 'sum' }],
    });
    const byName = Object.fromEntries(results[0].series.map((s) => [s.name, s.value]));
    expect(byName).toEqual({ 'Open order': 10, Invoiced: 5 });
  });
});
