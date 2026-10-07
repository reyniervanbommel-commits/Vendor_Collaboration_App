import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  EMPTY_ACTIVE_RULE_GROUPS,
  hasActivePurchaseOrderRules,
  summarizeColumnFilter,
  summarizeFormatRuleSet,
  usePurchaseOrdersActiveRules,
} from './usePurchaseOrdersActiveRules';

const headerColumns = [
  { key: 'vendor', label: 'Vendor', dataType: 'text' },
  { key: 'status', label: 'Status', dataType: 'status' },
];
const lineColumns = [
  { key: 'qty', label: 'Qty', dataType: 'number' },
];

describe('summarizeColumnFilter', () => {
  it('summarizes contains filters', () => {
    expect(summarizeColumnFilter(
      { key: 'vendor', dataType: 'text' },
      { operator: 'contains', value: 'Acme' },
    )).toBe('contains Acme');
  });

  it('zet spaties tussen operator, waarde en and', () => {
    expect(summarizeColumnFilter(
      { key: 'vendor', dataType: 'text' },
      {
        rules: [
          { operator: 'contains', value: 'c' },
          { operator: 'contains', value: 'g' },
        ],
      },
    )).toBe('contains c and contains g');
  });

  it('summarizes color filters without scanning rows', () => {
    expect(summarizeColumnFilter(
      { key: 'status', dataType: 'status' },
      { operator: 'colorIs', colors: ['#c02f64', '#6161ff'] },
    )).toBe('color is 2 colors');
  });
});

describe('summarizeFormatRuleSet', () => {
  it('counts rules', () => {
    expect(summarizeFormatRuleSet({
      target: 'cell',
      rules: [{ op: '=', value: 'Open', color: '#c02f64' }],
    })).toBe('1 rule');
  });
});

describe('usePurchaseOrdersActiveRules', () => {
  it('returns empty groups and hasActive false when nothing is active', () => {
    const { result } = renderHook(() => usePurchaseOrdersActiveRules({
      headerColumns,
      lineColumns,
      filterByColumn: {},
      headerColumnFormatRules: {},
      lineColumnFormatRules: {},
    }));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.filters).toEqual({ header: [], line: [] });
    expect(result.current.formatRules).toEqual({ header: [], line: [] });
  });

  it('keeps filters header-only while keeping header and line format rules', () => {
    const { result } = renderHook(() => usePurchaseOrdersActiveRules({
      headerColumns,
      lineColumns,
      filterByColumn: {
        vendor: { operator: 'contains', value: 'Acme' },
        qty: { operator: 'gt', value: '10' },
      },
      headerColumnFormatRules: {
        status: { target: 'row', rules: [{ op: '=', value: 'Open', color: '#c02f64' }] },
      },
      lineColumnFormatRules: {
        qty: { target: 'cell', rules: [{ op: '>', value: '10', color: '#fde7e9' }] },
      },
    }));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.filters.header.map((item) => item.columnKey)).toEqual(['vendor']);
    expect(result.current.filters.line).toEqual([]);
    expect(result.current.formatRules.header.map((item) => item.columnKey)).toEqual(['status']);
    expect(result.current.formatRules.line.map((item) => item.columnKey)).toEqual(['qty']);
  });

  it('ignores empty oneOf filters', () => {
    const { result } = renderHook(() => usePurchaseOrdersActiveRules({
      headerColumns,
      lineColumns,
      filterByColumn: { vendor: { operator: 'oneOf', value: [] } },
      headerColumnFormatRules: {},
      lineColumnFormatRules: {},
    }));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.filters.header).toEqual([]);
  });

  it('keeps hasActive without building flyout items while closed', () => {
    const props = {
      headerColumns,
      lineColumns,
      filterByColumn: {
        vendor: { operator: 'contains', value: 'Acme' },
      },
      headerColumnFormatRules: {},
      lineColumnFormatRules: {},
    };
    const { result, rerender } = renderHook(
      ({ open }) => usePurchaseOrdersActiveRules({ ...props, open }),
      { initialProps: { open: false } },
    );

    expect(result.current.hasActive).toBe(true);
    expect(result.current.filters).toBe(EMPTY_ACTIVE_RULE_GROUPS);
    expect(result.current.formatRules).toBe(EMPTY_ACTIVE_RULE_GROUPS);

    rerender({ open: true });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.filters.header.map((item) => item.columnKey)).toEqual(['vendor']);
  });
});

describe('hasActivePurchaseOrderRules', () => {
  it('matches the flyout rules: header filters and format rules, no line filters', () => {
    expect(hasActivePurchaseOrderRules({
      headerColumns,
      lineColumns,
      filterByColumn: { qty: { operator: 'gt', value: '10' } },
      headerColumnFormatRules: {},
      lineColumnFormatRules: {},
    })).toBe(false);

    expect(hasActivePurchaseOrderRules({
      headerColumns,
      lineColumns,
      filterByColumn: { vendor: { operator: 'contains', value: 'Acme' } },
      headerColumnFormatRules: {},
      lineColumnFormatRules: {},
    })).toBe(true);
  });
});
