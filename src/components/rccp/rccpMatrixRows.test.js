import { describe, expect, it } from 'vitest';
import { mergeChartVisibleKeys, sortRccpMatrixRows } from './rccpMatrixRows';

describe('sortRccpMatrixRows', () => {
  it('orders ordered, remaining, received, capacity, overcapacity', () => {
    const rows = [
      { measureKey: '__overcapacity__', isOvercapacity: true },
      { measureKey: '__capacity__', isCapacity: true },
      { measureKey: 'open', isOpen: true },
      { measureKey: 'delivered', isDelivered: true },
      { measureKey: 'ordered' },
    ];
    expect(sortRccpMatrixRows(rows).map((row) => row.measureKey)).toEqual([
      'ordered',
      'open',
      'delivered',
      '__capacity__',
      '__overcapacity__',
    ]);
  });

  it('keeps warning rows last', () => {
    const rows = [
      { measureKey: '__warning__', isWarning: true },
      { measureKey: 'ordered' },
    ];
    expect(sortRccpMatrixRows(rows).map((row) => row.measureKey)).toEqual([
      'ordered',
      '__warning__',
    ]);
  });
});

describe('mergeChartVisibleKeys', () => {
  const rows = [
    { measureKey: 'open', showInChart: true },
    { measureKey: '__capacity__', showInChart: false },
  ];

  it('uses the stored value when the user has not toggled yet', () => {
    expect(mergeChartVisibleKeys(rows, {}, { open: false, __capacity__: true })).toEqual({
      open: false,
      __capacity__: true,
    });
  });

  it('keeps an in-session toggle over stored and default values', () => {
    expect(mergeChartVisibleKeys(rows, { open: true }, { open: false })).toEqual({
      open: true,
      __capacity__: false,
    });
  });

  it('applies stored keys over in-session defaults when hydrating', () => {
    expect(mergeChartVisibleKeys(
      rows,
      { open: true, __capacity__: false },
      { open: false, __capacity__: true },
      { preferStored: true },
    )).toEqual({
      open: false,
      __capacity__: true,
    });
  });
});
