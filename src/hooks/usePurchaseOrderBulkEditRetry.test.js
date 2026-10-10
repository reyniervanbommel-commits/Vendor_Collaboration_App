import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePurchaseOrderBulkEditRetry } from './usePurchaseOrderBulkEditRetry';

const ROW_PO1 = {
  key: 'USMF|PO1',
  dataAreaId: 'USMF',
  orderNumber: 'PO1',
  columnId: 9,
  columnKey: 'status',
  value: 'Closed',
  basedOnValue: 'Open',
  errorMessage: 'first fail',
};
const ROW_PO2 = {
  ...ROW_PO1,
  key: 'USMF|PO2',
  orderNumber: 'PO2',
  errorMessage: 'second fail',
};

function setup(initialRows, runSingleUpdate) {
  let failedRows = initialRows;
  const onFailedRowsChange = vi.fn((updater) => {
    failedRows = updater(failedRows);
  });
  const { result } = renderHook(() => usePurchaseOrderBulkEditRetry({
    get failedRows() { return failedRows; },
    onFailedRowsChange,
    runSingleUpdate,
  }));
  return { result, getFailedRows: () => failedRows, onFailedRowsChange };
}

describe('usePurchaseOrderBulkEditRetry', () => {
  it('retryRow verwijdert de rij bij succes', async () => {
    const runSingleUpdate = vi.fn().mockResolvedValue();
    const { result, getFailedRows } = setup([ROW_PO1, ROW_PO2], runSingleUpdate);

    await act(async () => { await result.current.retryRow('USMF|PO1'); });

    expect(runSingleUpdate).toHaveBeenCalledTimes(1);
    expect(getFailedRows()).toEqual([expect.objectContaining({ key: 'USMF|PO2' })]);
  });

  it('retryAllFailed verwerkt de hele lijst via runCorrectRows', async () => {
    const runSingleUpdate = vi.fn().mockResolvedValue();
    const { result, getFailedRows } = setup([ROW_PO1, ROW_PO2], runSingleUpdate);

    await act(async () => { await result.current.retryAllFailed(); });

    expect(runSingleUpdate).toHaveBeenCalledTimes(2);
    expect(getFailedRows()).toEqual([]);
  });

  it('rij die opnieuw faalt houdt de nieuwe errorMessage', async () => {
    const runSingleUpdate = vi.fn().mockRejectedValue(new Error('still locked'));
    const { result, getFailedRows } = setup([ROW_PO1], runSingleUpdate);

    await act(async () => { await result.current.retryRow('USMF|PO1'); });

    expect(getFailedRows()).toEqual([
      expect.objectContaining({ key: 'USMF|PO1', errorMessage: 'still locked' }),
    ]);
  });

  it('partial-rij die opnieuw faalt (err.partial=false) blijft partial met nieuwe errorMessage', async () => {
    const err = Object.assign(new Error('Line 20: still locked'), { partial: false });
    const runSingleUpdate = vi.fn().mockRejectedValue(err);
    const { result, getFailedRows } = setup([{ ...ROW_PO1, partial: true }], runSingleUpdate);

    await act(async () => { await result.current.retryRow('USMF|PO1'); });

    expect(getFailedRows()).toEqual([
      expect.objectContaining({ key: 'USMF|PO1', partial: true, errorMessage: 'Line 20: still locked' }),
    ]);
  });

  it('niet-partial rij die opnieuw faalt blijft partial=false', async () => {
    const err = Object.assign(new Error('still locked'), { partial: false });
    const runSingleUpdate = vi.fn().mockRejectedValue(err);
    const { result, getFailedRows } = setup([{ ...ROW_PO1, partial: false }], runSingleUpdate);

    await act(async () => { await result.current.retryRow('USMF|PO1'); });

    expect(getFailedRows()[0].partial).toBe(false);
  });

  it('retry van een correctAll-rij roept runSingleUpdate met correctAll aan', async () => {
    const runSingleUpdate = vi.fn().mockResolvedValue();
    const { result } = setup([{
      key: 'USMF|PO1',
      dataAreaId: 'USMF',
      orderNumber: 'PO1',
      columnId: 44,
      columnKey: 'colorValues',
      lineColumnId: 44,
      lineColumnKey: 'color',
      headerColumnKey: 'colorValues',
      mode: 'correctAll',
      value: 'Green',
      basedOnValue: 'Red',
      errorMessage: 'fail',
    }], runSingleUpdate);

    await act(async () => { await result.current.retryRow('USMF|PO1'); });

    expect(runSingleUpdate).toHaveBeenCalledWith('correctAll', expect.objectContaining({
      orderNumber: 'PO1',
      lineColumnId: 44,
      lineColumnKey: 'color',
      headerColumnKey: 'colorValues',
      value: 'Green',
    }));
  });

  it('retryingBulk is true tijdens de aanroep en false erna', async () => {
    let resolveUpdate;
    const runSingleUpdate = vi.fn(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    const { result } = setup([ROW_PO1], runSingleUpdate);

    let pending;
    act(() => { pending = result.current.retryRow('USMF|PO1'); });
    expect(result.current.retryingBulk).toBe(true);

    await act(async () => {
      resolveUpdate();
      await pending;
    });
    expect(result.current.retryingBulk).toBe(false);
  });
});
