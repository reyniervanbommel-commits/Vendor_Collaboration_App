import { describe, expect, it } from 'vitest';
import { usePurchaseOrderTableView } from './usePurchaseOrderTableView';
import { renderHook, act } from '@testing-library/react';

describe('usePurchaseOrderTableView equals filter', () => {
  const columns = [
    { key: 'status', dataType: 'text' },
    { key: 'amount', dataType: 'number' },
    { key: 'delivery', dataType: 'date' },
  ];

  const items = [
    { values: { status: 'Open', amount: 10, delivery: '2026-03-15' } },
    { values: { status: 'Closed', amount: 20, delivery: '2026-04-01' } },
    { values: { status: '', amount: null, delivery: null } },
  ];

  it('filters text columns with equals on raw value', () => {
    const { result } = renderHook(() => usePurchaseOrderTableView({ items, columns }));

    act(() => {
      result.current.applyFilterFromCellValue('status', 'Open');
    });

    expect(result.current.processedItems).toHaveLength(1);
    expect(result.current.processedItems[0].values.status).toBe('Open');
    expect(result.current.filterByColumn.status).toEqual({
      operator: 'equals',
      value: 'Open',
      secondaryValue: '',
    });
  });

  it('filters empty cells with equals', () => {
    const { result } = renderHook(() => usePurchaseOrderTableView({ items, columns }));

    act(() => {
      result.current.applyFilterFromCellValue('status', null);
    });

    expect(result.current.processedItems).toHaveLength(1);
    expect(result.current.processedItems[0].values.status).toBe('');
  });

  it('filters date columns with equals on same calendar day', () => {
    const { result } = renderHook(() => usePurchaseOrderTableView({ items, columns }));

    act(() => {
      result.current.applyFilterFromCellValue('delivery', '2026-03-15T08:00:00Z');
    });

    expect(result.current.processedItems).toHaveLength(1);
    expect(result.current.filterByColumn.delivery.operator).toBe('equals');
    expect(result.current.filterByColumn.delivery.value).toBe('2026-03-15');
  });

  it('filtert correct op een legacy oneOf-komma-string uit een opgeslagen view (backward compat)', () => {
    const legacyColumns = [{ key: 'vendor', dataType: 'text', label: 'Vendor' }];
    const legacyItems = [
      { values: { vendor: 'Acme' } },
      { values: { vendor: 'Beta' } },
      { values: { vendor: 'Gamma' } },
    ];
    const { result } = renderHook(() => usePurchaseOrderTableView({ items: legacyItems, columns: legacyColumns }));

    act(() => {
      result.current.applyState({
        filterByColumn: { vendor: { operator: 'oneOf', value: 'Acme,Gamma' } },
      });
    });

    expect(result.current.processedItems.map((item) => item.values.vendor)).toEqual(['Acme', 'Gamma']);
    expect(result.current.filterByColumn.vendor.value).toEqual(['Acme', 'Gamma']);
  });

  it('sorts date period week columns numerically', () => {
    const weekColumn = {
      key: 'deliveryWeek',
      dataType: 'date_period',
      options: { sourceColumnKey: 'requestedDeliveryDate' },
    };
    const weekItems = [
      { values: { deliveryWeek: '12' } },
      { values: { deliveryWeek: '2' } },
      { values: { deliveryWeek: '5' } },
    ];
    const { result } = renderHook(() => usePurchaseOrderTableView({
      items: weekItems,
      columns: [weekColumn],
      datePeriodDisplayModes: { deliveryWeek: 'week' },
    }));

    act(() => {
      result.current.setSortDirection('deliveryWeek', 'asc');
    });

    expect(result.current.processedItems.map((item) => item.values.deliveryWeek)).toEqual(['2', '5', '12']);
  });
});

describe('usePurchaseOrderTableView session hydrate', () => {
  const columns = [
    { key: 'status', dataType: 'text' },
  ];
  const items = [
    { values: { status: 'Open' } },
    { values: { status: 'Closed' } },
  ];

  it('filters rows on the first render from the last session snapshot', async () => {
    window.sessionStorage.clear();
    const { savePoTableSession } = await import('../utils/poTableSessionState');
    savePoTableSession(7, {
      filterByColumn: { status: { operator: 'equals', value: 'Open', secondaryValue: '' } },
    });
    const { result } = renderHook(() => usePurchaseOrderTableView({ items, columns }));
    expect(result.current.processedItems).toHaveLength(1);
    expect(result.current.processedItems[0].values.status).toBe('Open');
  });
});

describe('usePurchaseOrderTableView meerdere voorwaarden', () => {
  const columns = [{ key: 'status', dataType: 'text' }];
  const items = [
    { values: { status: 'Open' } },
    { values: { status: 'Opened' } },
    { values: { status: 'Closed' } },
  ];

  it('voegt een cel-filter toe aan een bestaand kolomfilter', () => {
    const { result } = renderHook(() => usePurchaseOrderTableView({ items, columns }));

    act(() => {
      result.current.applyColumnFilter('status', { operator: 'startsWith', value: 'O', secondaryValue: '' });
    });
    act(() => {
      result.current.applyFilterFromCellValue('status', 'Open');
    });

    expect(result.current.filterByColumn.status.rules).toEqual([
      { operator: 'startsWith', value: 'O', secondaryValue: '' },
      { operator: 'equals', value: 'Open', secondaryValue: '' },
    ]);
    expect(result.current.processedItems.map((item) => item.values.status)).toEqual(['Open']);
  });

  it('past AND toe op een regels-envelope', () => {
    const { result } = renderHook(() => usePurchaseOrderTableView({ items, columns }));

    act(() => {
      result.current.applyColumnFilter('status', {
        rules: [
          { operator: 'startsWith', value: 'O', secondaryValue: '' },
          { operator: 'notContains', value: 'ed', secondaryValue: '' },
        ],
      });
    });

    expect(result.current.processedItems.map((item) => item.values.status)).toEqual(['Open']);
  });
});
