// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRccpChartRowsLayout } from './useRccpChartRowsLayout';

const periods = [
  { key: '2026-W10', year: 2026, week: 10 },
  { key: '2026-W11', year: 2026, week: 11 },
];

const measureRows = [
  { measureKey: 'open', label: 'Open', isOpen: true },
  { measureKey: 'received', label: 'Received', isDelivered: true },
  { measureKey: 'warn', label: 'Warning', isWarning: true },
];

describe('useRccpChartRowsLayout', () => {
  it('orders rows, builds period headers and derives the pixel layout', () => {
    const { result } = renderHook(() => useRccpChartRowsLayout({ measureRows, periods }));
    expect(result.current.periodHeaders).toHaveLength(2);
    // De warning-rij hoort niet in de matrix.
    expect(result.current.matrixRows.some((row) => row.isWarning)).toBe(false);
    expect(result.current.orderedRows).toHaveLength(3);
    expect(result.current.gridWidth).toBeGreaterThan(0);
    expect(result.current.chartWidth).toBeGreaterThan(0);
    // Recharts verticalCoordinatesGenerator: een functie, geen array.
    expect(typeof result.current.weekBoundaryCoordinates).toBe('function');
  });

  it('hides available and over capacity from the chart and the matrix', () => {
    const rows = [
      ...measureRows,
      { measureKey: '__capacity__', label: 'Available capacity', isCapacity: true },
      { measureKey: '__overcapacity__', label: 'Over capacity', isOvercapacity: true },
    ];
    const { result } = renderHook(() => useRccpChartRowsLayout({
      measureRows: rows,
      periods,
      showCapacityRows: false,
    }));
    const hidden = (row) => row.isCapacity || row.isOvercapacity;
    expect(result.current.orderedRows.some(hidden)).toBe(false);
    expect(result.current.matrixRows.some(hidden)).toBe(false);
    expect(result.current.matrixRows.map((row) => row.measureKey)).toEqual(['open', 'received']);
  });

  it('returns an empty layout without periods', () => {
    const { result } = renderHook(() => useRccpChartRowsLayout({ measureRows, periods: [] }));
    expect(result.current.periodHeaders).toHaveLength(0);
    expect(result.current.gridWidth).toBe(0);
  });
});
