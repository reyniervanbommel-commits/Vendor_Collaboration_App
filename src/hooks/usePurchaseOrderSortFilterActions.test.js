import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePurchaseOrderSortFilterActions } from './usePurchaseOrderSortFilterActions';

function setup(draft = { operator: 'oneOf', value: [], secondaryValue: '' }) {
  const setDraft = vi.fn((updater) => updater(draft));
  const { result } = renderHook(() => usePurchaseOrderSortFilterActions({
    columnKey: 'vendor',
    draft,
    onSetSortDirection: vi.fn(),
    onSetOperator: vi.fn(),
    onSetValue: vi.fn(),
    onSetSecondaryValue: vi.fn(),
    onApplyFilter: vi.fn(),
    onClearFilter: vi.fn(),
    setDraft,
    setOpen: vi.fn(),
  }));
  return { result, setDraft };
}

describe('usePurchaseOrderSortFilterActions — handleDraftValueChange', () => {
  it('zet draft.value direct op de meegegeven array-waarde', () => {
    const { result, setDraft } = setup();
    act(() => {
      result.current.handleDraftValueChange(['Acme', 'Beta']);
    });
    expect(setDraft).toHaveBeenCalled();
    const updater = setDraft.mock.calls[0][0];
    expect(updater({ operator: 'oneOf', value: [], secondaryValue: '' })).toEqual({
      operator: 'oneOf',
      value: ['Acme', 'Beta'],
      secondaryValue: '',
    });
  });
});

describe('usePurchaseOrderSortFilterActions — handleApplyFilter', () => {
  it('does not apply a remarks search shorter than 2 characters', () => {
    const onApplyFilter = vi.fn();
    const setOpen = vi.fn();
    const { result } = renderHook(() => usePurchaseOrderSortFilterActions({
      columnKey: 'remarks',
      columnDataType: 'remarks',
      draft: { operator: 'contains', value: 'a', secondaryValue: '' },
      onSetSortDirection: vi.fn(),
      onSetOperator: vi.fn(),
      onSetValue: vi.fn(),
      onSetSecondaryValue: vi.fn(),
      onApplyFilter,
      onClearFilter: vi.fn(),
      setDraft: vi.fn(),
      setOpen,
    }));

    act(() => {
      result.current.handleApplyFilter();
    });

    expect(onApplyFilter).not.toHaveBeenCalled();
    expect(setOpen).not.toHaveBeenCalled();
  });

  it('applies hasComment without a search term and clears leftover values', () => {
    const onApplyFilter = vi.fn();
    const setOpen = vi.fn();
    const { result } = renderHook(() => usePurchaseOrderSortFilterActions({
      columnKey: 'remarks',
      columnDataType: 'remarks',
      draft: { operator: 'hasComment', value: 'leftover', secondaryValue: 'x' },
      onSetSortDirection: vi.fn(),
      onSetOperator: vi.fn(),
      onSetValue: vi.fn(),
      onSetSecondaryValue: vi.fn(),
      onApplyFilter,
      onClearFilter: vi.fn(),
      setDraft: vi.fn(),
      setOpen,
    }));

    act(() => {
      result.current.handleApplyFilter();
    });

    expect(onApplyFilter).toHaveBeenCalledWith('remarks', {
      operator: 'hasComment',
      value: '',
      secondaryValue: '',
    });
    expect(setOpen).not.toHaveBeenCalled();
  });

  it('houdt het menu open na Apply van meerdere voorwaarden', () => {
    const setOpen = vi.fn();
    const onApplyFilter = vi.fn();
    const { result } = renderHook(() => usePurchaseOrderSortFilterActions({
      columnKey: 'vendor',
      drafts: [
        { operator: 'contains', value: 'c', secondaryValue: '' },
        { operator: 'contains', value: 'g', secondaryValue: '' },
      ],
      setDrafts: vi.fn(),
      onSetSortDirection: vi.fn(),
      onSetOperator: vi.fn(),
      onSetValue: vi.fn(),
      onSetSecondaryValue: vi.fn(),
      onApplyFilter,
      onClearFilter: vi.fn(),
      setOpen,
    }));

    act(() => {
      result.current.handleApplyAllFilters();
    });

    expect(onApplyFilter).toHaveBeenCalled();
    expect(setOpen).not.toHaveBeenCalled();
  });
});
