// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePurchaseOrderViewTabs } from './usePurchaseOrderViewTabs';
import { ALL_TAB_ID } from '../utils/viewTabs';

function createBoardView(filters = {}) {
  let current = { filterByColumn: filters, sortState: {}, grouping: {} };
  return {
    exportFilterSortGrouping: () => current,
    applyFilterSortGrouping: vi.fn((state) => {
      current = { ...current, ...state };
    }),
    get filterByColumn() {
      return current.filterByColumn;
    },
    allItems: [
      { values: { vendorAccount: 'Q000104', status: 'Invoiced' } },
      { values: { vendorAccount: 'Q000105', status: 'Invoiced' } },
    ],
  };
}

describe('usePurchaseOrderViewTabs', () => {
  it('voegt bulk-tabs toe zonder bestaande extra tabs te vervangen', () => {
    const boardView = createBoardView();
    const { result } = renderHook(() => usePurchaseOrderViewTabs({
      activeViewId: 9,
      boardView,
      columns: [
        { key: 'vendorAccount', label: 'Vendor', dataType: 'text' },
        { key: 'status', label: 'Status', dataType: 'text' },
      ],
      allItems: [
        { values: { vendorAccount: 'Q000104', status: 'Invoiced' } },
        { values: { vendorAccount: 'Q000105', status: 'Invoiced' } },
      ],
    }));

    act(() => {
      result.current.addBlankTab('Dates');
    });
    act(() => {
      result.current.addTabsFromColumn({ columnKey: 'vendorAccount', color: '#579bfc' });
    });

    expect(result.current.extraTabs.some((tab) => tab.name === 'Dates')).toBe(true);
    expect(result.current.extraTabs.filter((tab) => tab.groupColumnKey === 'vendorAccount').length).toBe(2);
    expect(result.current.groups[0].columnKey).toBe('vendorAccount');
    expect(result.current.activeTabId).not.toBe(ALL_TAB_ID);
  });

  it('markeert unshared extra filters op een groepstab zonder prompt', () => {
    const boardView = createBoardView();
    const { result, rerender } = renderHook(() => usePurchaseOrderViewTabs({
      activeViewId: 9,
      boardView,
      columns: [
        { key: 'vendorAccount', label: 'Vendor', dataType: 'text' },
        { key: 'status', label: 'Status', dataType: 'text' },
      ],
      allItems: [
        { values: { vendorAccount: 'Q000104', status: 'Open' } },
        { values: { vendorAccount: 'Q000105', status: 'Open' } },
      ],
    }));

    act(() => {
      result.current.addTabsFromColumn({ columnKey: 'vendorAccount', color: '#579bfc' });
    });
    const firstId = result.current.extraTabs[0].id;
    act(() => {
      result.current.selectTab(firstId);
    });
    expect(result.current.unsavedExtraTabIds).toEqual([]);

    act(() => {
      boardView.applyFilterSortGrouping({
        filterByColumn: {
          vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '' },
          status: { operator: 'equals', value: 'Open', secondaryValue: '' },
        },
      });
    });
    rerender();

    expect(result.current.unsavedExtraTabIds).toContain(firstId);
    expect(result.current.extraTabs.find((tab) => tab.id === firstId)?.extraFilters?.status?.value).toBe('Open');
  });

  it('houdt een extra filter na opslaan op de actieve tab, niet op de hele groep', () => {
    const boardView = createBoardView();
    const { result, rerender } = renderHook(() => usePurchaseOrderViewTabs({
      activeViewId: 9,
      boardView,
      columns: [
        { key: 'vendorAccount', label: 'Vendor', dataType: 'text' },
        { key: 'status', label: 'Status', dataType: 'text' },
        { key: 'delivery', label: 'Delivery', dataType: 'date' },
      ],
      allItems: [
        { values: { vendorAccount: 'Q000104', status: 'Open', delivery: '2026-01-01' } },
        { values: { vendorAccount: 'Q000105', status: 'Open', delivery: '2026-01-01' } },
      ],
    }));

    act(() => {
      result.current.addTabsFromColumn({ columnKey: 'vendorAccount', color: '#579bfc' });
    });
    const firstId = result.current.extraTabs[0].id;
    const secondId = result.current.extraTabs[1].id;
    act(() => {
      result.current.selectTab(firstId);
    });
    act(() => {
      boardView.applyFilterSortGrouping({
        filterByColumn: {
          vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '' },
          status: { operator: 'equals', value: 'Open', secondaryValue: '' },
        },
      });
    });
    rerender();
    act(() => {
      result.current.applySaveScope('tab');
    });

    act(() => {
      boardView.applyFilterSortGrouping({
        filterByColumn: {
          vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '' },
          status: { operator: 'equals', value: 'Open', secondaryValue: '' },
          delivery: { operator: 'after', value: '2026-01-01', secondaryValue: '' },
        },
      });
    });
    rerender();

    expect(result.current.extraTabs.find((tab) => tab.id === firstId)?.extraFilters?.delivery?.value).toBe('2026-01-01');
    expect(result.current.extraTabs.find((tab) => tab.id === secondId)?.extraFilters?.delivery).toBeUndefined();
    expect(result.current.unsavedExtraTabIds).toEqual([firstId]);

    act(() => {
      result.current.selectTab(secondId);
    });
    const live = boardView.exportFilterSortGrouping().filterByColumn;
    expect(live.delivery).toBeUndefined();
    expect(live.status).toBeUndefined();
  });

  it('koppelt een nieuw extra-filter na group-save niet aan de andere groeptabs', () => {
    const boardView = createBoardView();
    const { result, rerender } = renderHook(() => usePurchaseOrderViewTabs({
      activeViewId: 9,
      boardView,
      columns: [
        { key: 'vendorAccount', label: 'Vendor', dataType: 'text' },
        { key: 'status', label: 'Status', dataType: 'text' },
        { key: 'delivery', label: 'Delivery', dataType: 'date' },
      ],
      allItems: [
        { values: { vendorAccount: 'Q000104', status: 'Open', delivery: '2026-01-01' } },
        { values: { vendorAccount: 'Q000105', status: 'Open', delivery: '2026-01-01' } },
      ],
    }));

    act(() => {
      result.current.addTabsFromColumn({ columnKey: 'vendorAccount', color: '#579bfc' });
    });
    const firstId = result.current.extraTabs[0].id;
    const secondId = result.current.extraTabs[1].id;
    act(() => {
      result.current.selectTab(firstId);
    });
    act(() => {
      boardView.applyFilterSortGrouping({
        filterByColumn: {
          vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '' },
          status: { operator: 'equals', value: 'Open', secondaryValue: '' },
        },
      });
    });
    rerender();
    act(() => {
      result.current.applySaveScope('group');
    });
    expect(result.current.extraTabs.every((tab) => tab.extraFilters?.status?.value === 'Open')).toBe(true);
    expect(result.current.unsavedExtraTabIds).toEqual([]);

    act(() => {
      boardView.applyFilterSortGrouping({
        filterByColumn: {
          vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '' },
          status: { operator: 'equals', value: 'Open', secondaryValue: '' },
          delivery: { operator: 'after', value: '2026-01-01', secondaryValue: '' },
        },
      });
    });
    rerender();

    expect(result.current.extraTabs.find((tab) => tab.id === firstId)?.extraFilters?.delivery?.value).toBe('2026-01-01');
    expect(result.current.extraTabs.find((tab) => tab.id === secondId)?.extraFilters?.delivery).toBeUndefined();
    expect(result.current.unsavedExtraTabIds).toEqual([firstId]);
  });

  it('verwijdert alle tabs van dezelfde groep', () => {
    const boardView = createBoardView();
    const { result } = renderHook(() => usePurchaseOrderViewTabs({
      activeViewId: 9,
      boardView,
      columns: [
        { key: 'vendorAccount', label: 'Vendor', dataType: 'text' },
      ],
      allItems: [
        { values: { vendorAccount: 'Q000104' } },
        { values: { vendorAccount: 'Q000105' } },
      ],
    }));

    act(() => {
      result.current.addTabsFromColumn({ columnKey: 'vendorAccount', color: '#579bfc' });
    });
    const firstId = result.current.extraTabs[0].id;
    expect(result.current.extraTabs).toHaveLength(2);

    act(() => {
      result.current.removeTab(firstId, 'group');
    });
    expect(result.current.extraTabs).toHaveLength(0);
    expect(result.current.activeTabId).toBe(ALL_TAB_ID);
  });

  it('houdt een later startsWith-filter op All bij bestaande kolom-tabs na opslaan', () => {
    const boardView = createBoardView();
    const columns = [
      { key: 'vendorName', label: 'Leveranciersnaam', dataType: 'text' },
      { key: 'itemValues', label: 'External item number values', dataType: 'text' },
    ];
    const { result, rerender } = renderHook(() => usePurchaseOrderViewTabs({
      activeViewId: 11,
      boardView,
      columns,
      allItems: [
        { values: { vendorName: 'Acme', itemValues: 'Boot, Shoe' } },
        { values: { vendorName: 'Beta', itemValues: 'Sock' } },
      ],
    }));

    act(() => {
      result.current.addTabsFromColumn({ columnKey: 'vendorName', color: '#579bfc' });
    });
    expect(result.current.extraTabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe(ALL_TAB_ID);

    act(() => {
      result.current.snapshotCurrentTab();
    });
    const firstSave = result.current.peekTabsState();
    expect(firstSave.viewBaseFilters.itemValues).toBeUndefined();

    act(() => {
      boardView.applyFilterSortGrouping({
        filterByColumn: {
          itemValues: { operator: 'startsWith', value: 's', secondaryValue: '' },
        },
      });
    });
    rerender();

    act(() => {
      result.current.snapshotCurrentTab();
    });
    const secondSave = result.current.peekTabsState();
    expect(secondSave.viewBaseFilters.itemValues).toEqual({
      operator: 'startsWith',
      value: 's',
      secondaryValue: '',
    });
    expect(secondSave.extraTabs.every((tab) => !tab.extraFilters?.itemValues)).toBe(true);

    const firstTabId = result.current.extraTabs[0].id;
    act(() => {
      result.current.selectTab(firstTabId);
    });
    const live = boardView.exportFilterSortGrouping().filterByColumn;
    expect(live.itemValues).toEqual({
      operator: 'startsWith',
      value: 's',
      secondaryValue: '',
    });
    expect(live.vendorName?.operator).toBe('equals');
  });
});
