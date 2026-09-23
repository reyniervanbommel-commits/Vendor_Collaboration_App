import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePurchaseOrdersPage } from './usePurchaseOrdersPage';
import { apiRequest } from '../utils/api';
import { clearCachedBoard } from '../utils/boardSessionStore';
import { clearBoardPresentationCache } from '../utils/boardPresentationCache';

vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));

const BOARD_PAYLOAD = {
  revision: 'rev-contract-1',
  syncedAt: '2026-05-01T00:00:00.000Z',
  stale: false,
  hasCache: true,
  staleThresholdMinutes: 15,
  total: 1,
  newCount: 0,
  changedCount: 0,
  rows: [{
    partitionKey: 'usmf',
    recordKey: 'PO-100',
    values: { vendorAccount: 'VEND-1', note: 'old' },
    isNew: false,
    isChanged: false,
    removedAtSource: false,
    syncRetained: false,
    detailCount: 1,
  }],
  meta: {
    columns: {
      master: [{ id: 1, key: 'vendorAccount', scope: 'master', source: 'source', label: 'Vendor' }],
      detail: [{ id: 11, key: 'itemNumber', scope: 'detail', source: 'source', label: 'Item' }],
    },
    trackChanges: null,
  },
};

function boardResponse(url, options) {
  if (url === '/data/purchase-orders' && !options) return BOARD_PAYLOAD;
  if (url === '/data/purchase-orders/revision') return { revision: 'rev-contract-1' };
  if (url === '/supplier/board-settings/purchase-orders' && !options) {
    return { settings: { visibleColumns: ['vendorAccount'] } };
  }
  if (url === '/supplier/board-settings/purchase-orders' && options?.method === 'PATCH') {
    return { ok: true };
  }
  if (url === '/data/purchase-orders/value') return { formulaValues: {} };
  return {};
}

describe('usePurchaseOrdersPage', () => {
  beforeEach(() => {
    clearCachedBoard();
    clearBoardPresentationCache();
    apiRequest.mockReset();
    apiRequest.mockImplementation(boardResponse);
  });

  it('laadt en mapt de board-response naar orders', async () => {
    const { result } = renderHook(() => usePurchaseOrdersPage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.orders).toEqual([
      expect.objectContaining({
        dataAreaId: 'usmf',
        orderNumber: 'PO-100',
        values: expect.objectContaining({ vendorAccount: 'VEND-1', note: 'old' }),
      }),
    ]);
    expect(result.current.headerColumns.map((column) => column.key)).toContain('vendorAccount');
    expect(result.current.error).toBe('');
  });

  it('slaat de volledige read over wanneer de gecachte revision gelijk blijft', async () => {
    const first = renderHook(() => usePurchaseOrdersPage());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(apiRequest.mock.calls.filter(([url, options]) => url === '/data/purchase-orders' && !options)).toHaveLength(1);
    first.unmount();

    apiRequest.mockClear();
    apiRequest.mockImplementation(boardResponse);
    const second = renderHook(() => usePurchaseOrdersPage());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    await waitFor(() => {
      expect(apiRequest.mock.calls.map(([url]) => url)).toContain('/data/purchase-orders/revision');
    });
    expect(apiRequest.mock.calls.some(([url, options]) => url === '/data/purchase-orders' && !options)).toBe(false);
    expect(second.result.current.orders[0].orderNumber).toBe('PO-100');
    second.unmount();
  });

  it('zet een cel optimistisch en draait terug na een API-fout', async () => {
    const { result } = renderHook(() => usePurchaseOrdersPage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let releaseSave;
    const pending = new Promise((resolve) => {
      releaseSave = resolve;
    });
    apiRequest.mockImplementation((url, options) => {
      if (url === '/data/purchase-orders/value') return pending;
      return boardResponse(url, options);
    });

    let savePromise;
    act(() => {
      savePromise = result.current.saveValue({
        columnId: 5,
        columnKey: 'note',
        dataAreaId: 'usmf',
        orderNumber: 'PO-100',
        lineNumber: null,
        value: 'rush',
      });
    });
    await waitFor(() => expect(result.current.orders[0].values.note).toBe('rush'));
    await act(async () => {
      releaseSave({ formulaValues: {} });
      await savePromise;
    });
    expect(result.current.orders[0].values.note).toBe('rush');

    apiRequest.mockImplementation((url, options) => {
      if (url === '/data/purchase-orders/value') return Promise.reject(new Error('save failed'));
      return boardResponse(url, options);
    });
    await expect(act(async () => {
      await result.current.saveValue({
        columnId: 5,
        columnKey: 'note',
        dataAreaId: 'usmf',
        orderNumber: 'PO-100',
        lineNumber: null,
        value: 'broken',
      });
    })).rejects.toThrow('save failed');
    expect(result.current.orders[0].values.note).toBe('rush');
  });

  it('persisteert zichtbare kolommen via board-settings', async () => {
    const { result } = renderHook(() => usePurchaseOrdersPage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.saveVisibleColumns(['vendorAccount']);
    });
    const patch = apiRequest.mock.calls.find(([url, options]) => (
      url === '/supplier/board-settings/purchase-orders' && options?.method === 'PATCH'
    ));
    expect(patch).toBeTruthy();
    expect(patch[1].body.settings.visibleColumns).toContain('vendorAccount');
  });
});
