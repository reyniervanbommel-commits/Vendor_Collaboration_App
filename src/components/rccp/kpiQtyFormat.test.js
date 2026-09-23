import { describe, expect, it } from 'vitest';
import { formatDays, formatItems, formatPct, formatQty } from './kpiQtyFormat';

describe('formatQty', () => {
  it('keeps full grouped numbers', () => {
    expect(formatQty(333230)).toBe('333,230');
    expect(formatQty(328205.3)).toBe('328,205.3');
    expect(formatQty(50)).toBe('50');
  });
});

describe('formatPct', () => {
  it('formats one decimal with a percent sign', () => {
    expect(formatPct(96.64)).toBe('96.6%');
  });
});

describe('formatDays', () => {
  it('rounds to one decimal', () => {
    expect(formatDays(43.54)).toBe('Ø 43.5 days late');
  });
});

describe('formatItems', () => {
  it('appends the items suffix', () => {
    expect(formatItems(1432)).toBe('1,432 items');
  });
});
