// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../../utils/api';
import { useMentionPreview, useMentionSuggestions } from './useMentionSuggestions';

vi.mock('../../../utils/api', () => ({ apiRequest: vi.fn() }));

const ROW = { partitionKey: 'whsl', recordKey: 'PO-1' };

describe('useMentionSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('doet geen call bij minder dan 2 tekens', async () => {
    const { result } = renderHook(() => useMentionSuggestions({ tableKey: 'purchase-orders', query: 'A' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([]);
  });

  it('debounced 200 ms en geeft suggesties terug', async () => {
    apiRequest.mockResolvedValue({ suggestions: [{ value: 'A-1' }] });
    const { result, rerender } = renderHook(({ query }) => useMentionSuggestions({ tableKey: 'purchase-orders', query }), {
      initialProps: { query: 'A-' },
    });
    rerender({ query: 'A-1' });
    await act(async () => { await vi.advanceTimersByTimeAsync(199); });
    expect(apiRequest).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest.mock.calls[0][0]).toBe('/data/purchase-orders/remarks/mentions?q=A-1');
    expect(result.current.suggestions).toEqual([{ value: 'A-1' }]);
  });

  it('wist oude suggesties zodra de query verandert', async () => {
    apiRequest.mockResolvedValue({ suggestions: [{ value: 'SF0001' }] });
    const { result, rerender } = renderHook(({ query }) => useMentionSuggestions({ tableKey: 't', query }), {
      initialProps: { query: 'SF' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(result.current.suggestions).toEqual([{ value: 'SF0001' }]);
    rerender({ query: 'SFM2' });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it('negeert een verouderd antwoord', async () => {
    let resolveFirst;
    apiRequest
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ suggestions: [{ value: 'NEW' }] });
    const { result, rerender } = renderHook(({ query }) => useMentionSuggestions({ tableKey: 't', query }), {
      initialProps: { query: 'OL' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    rerender({ query: 'NE' });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { resolveFirst({ suggestions: [{ value: 'OLD' }] }); });
    expect(result.current.suggestions).toEqual([{ value: 'NEW' }]);
  });
});

describe('useMentionPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('geen call zonder mentions', async () => {
    const { result } = renderHook(() => useMentionPreview({ tableKey: 't', row: ROW, mentions: [] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ orderCount: null, vendorCount: null, error: '' });
  });

  it('haalt het bereik op en geeft fouten door', async () => {
    apiRequest.mockResolvedValueOnce({ orderCount: 14, vendorCount: 3 });
    const mentions = [{ columnId: 11, value: 'A-1' }];
    const { result, rerender } = renderHook(({ m }) => useMentionPreview({ tableKey: 't', row: ROW, mentions: m }), {
      initialProps: { m: mentions },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(apiRequest).toHaveBeenCalledWith('/data/t/remarks/mentions/preview', {
      method: 'POST', body: { partitionKey: 'whsl', recordKey: 'PO-1', mentions },
    });
    expect(result.current).toMatchObject({ orderCount: 14, vendorCount: 3, error: '' });

    apiRequest.mockRejectedValueOnce(new Error('Too many purchase orders (max 200)'));
    rerender({ m: [{ columnId: 11, value: 'B-2' }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.error).toBe('Too many purchase orders (max 200)');
  });
});
