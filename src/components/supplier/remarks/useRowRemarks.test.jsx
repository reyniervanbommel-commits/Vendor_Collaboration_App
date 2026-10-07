// @vitest-environment jsdom
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../../utils/api';
import { useRowRemarks } from './useRowRemarks';

vi.mock('../../../utils/api', () => ({ apiRequest: vi.fn() }));

const OPTIONS = {
  enabled: true,
  tableKey: 'purchase-orders',
  row: { partitionKey: 'USMF', recordKey: 'PO-1' },
  onSummaryChange: vi.fn(),
};

function setVisibility(value) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useRowRemarks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('laadt remarks, pollt na vijf seconden met afterCursor en ruimt op', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [{ id: 1, body: 'Existing' }],
        total: 1,
        nextCursor: null,
      })
      .mockResolvedValueOnce({ items: [], totals: { remarks: 1, history: 0 }, newestCursor: 'new-1' })
      .mockResolvedValueOnce({
        items: [
          {
            id: 2,
            kind: 'remark',
            body: 'Delta',
            createdAt: '2026-07-13T11:00:00.000Z',
          },
        ],
        totals: { remarks: 2, history: 0 },
        newestCursor: 'new-2',
      });

    const { result, unmount } = renderHook(() => useRowRemarks(OPTIONS));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.items.map((item) => item.id)).toEqual([1]);
    expect(apiRequest.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(apiRequest.mock.calls[2][0]).toContain('afterCursor=new-1');
    expect(result.current.items.map((item) => item.id)).toEqual([2, 1]);
    expect(result.current.total).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dedupliceert een net geplaatste remark wanneer polling dezelfde activity teruggeeft', async () => {
    apiRequest
      .mockResolvedValueOnce({ items: [], total: 0, nextCursor: null })
      .mockResolvedValueOnce({ items: [], totals: { remarks: 0, history: 0 }, newestCursor: 'new-1' })
      .mockResolvedValueOnce({
        remark: { id: 42, body: 'New remark', createdAt: '2026-07-14T09:47:00.000Z' },
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'remark:42',
            type: 'remark',
            sourceId: '42',
            body: 'New remark',
            createdAt: '2026-07-14T09:47:00.000Z',
          },
        ],
        totals: { remarks: 1, history: 0 },
        newestCursor: 'new-2',
      });

    const { result, unmount } = renderHook(() => useRowRemarks(OPTIONS));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.createRemark('New remark');
    });
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe(42);
    unmount();
  });

  it('pauzeert polling wanneer het document verborgen is', async () => {
    apiRequest
      .mockResolvedValueOnce({ items: [], total: 0, nextCursor: null })
      .mockResolvedValueOnce({ items: [], totals: { remarks: 0, history: 0 }, newestCursor: 'cursor' })
      .mockResolvedValue({ items: [], totals: { remarks: 0, history: 0 }, newestCursor: 'cursor' });

    const { unmount } = renderHook(() => useRowRemarks(OPTIONS));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    setVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(apiRequest).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(apiRequest).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('behoudt data bij een overlappende load-older tick', async () => {
    let resolveOlder;
    apiRequest
      .mockResolvedValueOnce({ items: [{ id: 1 }], total: 2, nextCursor: 'older' })
      .mockResolvedValueOnce({ items: [], totals: { remarks: 2, history: 0 }, newestCursor: 'new' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlder = resolve;
          })
      );

    const { result, unmount } = renderHook(() => useRowRemarks(OPTIONS));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.loadOlder();
      result.current.loadOlder();
    });
    expect(apiRequest).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolveOlder({ items: [{ id: 0 }], total: 2, nextCursor: null });
    });
    expect(result.current.items.map((item) => item.id)).toEqual([1, 0]);
    unmount();
  });

  it('stuurt visibility alleen mee als die gekozen is', async () => {
    apiRequest.mockResolvedValue({ items: [], total: 0, nextCursor: null, remark: { id: 7, body: 'x' } });
    const { result, unmount } = renderHook(() => useRowRemarks(OPTIONS));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.createRemark('With choice', null, 'internal');
      await result.current.createRemark('Without choice');
    });

    const posts = apiRequest.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts[0][1].body).toMatchObject({ body: 'With choice', visibility: 'internal' });
    expect(posts[1][1].body).not.toHaveProperty('visibility');
    unmount();
  });
});
