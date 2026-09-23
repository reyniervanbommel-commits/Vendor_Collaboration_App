// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../utils/rccpAnalysisPrefetch', () => ({
  clearRccpAnalysisPrefetchCache: vi.fn(),
  getCachedRccpAnalysis: vi.fn(() => null),
}));

import { apiRequest } from '../utils/api';
import { useRccpAnalysisModes, rccpAnalysisScopeKey } from './useRccpAnalysisModes';

const WINDOW = { fromYear: 2026, fromWeek: 1, toYear: 2026, toWeek: 8 };

function modeOf(path) {
  return new URL(`http://x${path}`).searchParams.get('planningDateMode');
}

function requestedModes() {
  return apiRequest.mock.calls.map((call) => modeOf(call[0]));
}

describe('rccpAnalysisScopeKey', () => {
  it('changes with vendor, window and reload token', () => {
    const base = rccpAnalysisScopeKey({ isoWindow: WINDOW, vendorAccount: 'V1' });
    expect(rccpAnalysisScopeKey({ isoWindow: WINDOW, vendorAccount: 'V2' })).not.toBe(base);
    expect(rccpAnalysisScopeKey({ isoWindow: WINDOW, vendorAccount: 'V1', reloadToken: 1 }))
      .not.toBe(base);
    expect(rccpAnalysisScopeKey({ isoWindow: null, vendorAccount: 'V1' })).toBe('');
  });
});

describe('useRccpAnalysisModes', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((path) => Promise.resolve({ mode: modeOf(path) }));
  });

  it('loads the active load date and prefetches the other one in the background', async () => {
    const { result } = renderHook(() => useRccpAnalysisModes({
      vendorAccount: 'V1',
      isoWindow: WINDOW,
      modes: 'requested',
    }));

    await waitFor(() => expect(result.current.analysis).toEqual({ mode: 'requested' }));
    await waitFor(() => expect(result.current.byMode.confirmed).toEqual({ mode: 'confirmed' }));
    expect(requestedModes().sort()).toEqual(['confirmed', 'requested']);
  });

  it('switches load date without firing another request', async () => {
    const { result, rerender } = renderHook(
      ({ modes }) => useRccpAnalysisModes({ vendorAccount: 'V1', isoWindow: WINDOW, modes }),
      { initialProps: { modes: 'requested' } },
    );

    await waitFor(() => expect(result.current.byMode.confirmed).toBeTruthy());
    const callsBefore = apiRequest.mock.calls.length;

    rerender({ modes: 'confirmed' });
    expect(result.current.analysis).toEqual({ mode: 'confirmed' });
    expect(result.current.loading).toBe(false);
    expect(apiRequest.mock.calls.length).toBe(callsBefore);

    rerender({ modes: { requested: true, confirmed: true } });
    expect(result.current.byMode.requested).toEqual({ mode: 'requested' });
    expect(result.current.byMode.confirmed).toEqual({ mode: 'confirmed' });
    expect(apiRequest.mock.calls.length).toBe(callsBefore);
  });

  it('loads both load dates at once when both are active', async () => {
    const { result } = renderHook(() => useRccpAnalysisModes({
      vendorAccount: 'V1',
      isoWindow: WINDOW,
      modes: { requested: true, confirmed: true },
    }));

    await waitFor(() => {
      expect(result.current.byMode.requested).toBeTruthy();
      expect(result.current.byMode.confirmed).toBeTruthy();
    });
    expect(apiRequest.mock.calls.length).toBe(2);
  });

  it('drops loaded modes when the vendor changes', async () => {
    const { result, rerender } = renderHook(
      ({ vendorAccount }) => useRccpAnalysisModes({
        vendorAccount, isoWindow: WINDOW, modes: 'requested',
      }),
      { initialProps: { vendorAccount: 'V1' } },
    );
    await waitFor(() => expect(result.current.analysis).toBeTruthy());

    apiRequest.mockImplementation(() => new Promise(() => {}));
    rerender({ vendorAccount: 'V2' });
    expect(result.current.analysis).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('stays loading while keepPrevious still shows the previous analysis', async () => {
    const { result, rerender } = renderHook(
      ({ vendorAccount }) => useRccpAnalysisModes({
        vendorAccount, isoWindow: WINDOW, modes: 'requested', keepPrevious: true,
      }),
      { initialProps: { vendorAccount: 'V1' } },
    );
    await waitFor(() => expect(result.current.analysis).toEqual({ mode: 'requested' }));

    apiRequest.mockImplementation(() => new Promise(() => {}));
    rerender({ vendorAccount: 'V2' });
    expect(result.current.analysis).toEqual({ mode: 'requested' });
    expect(result.current.loading).toBe(true);
  });

  it('reports a failed load and stays out of a retry loop', async () => {
    apiRequest.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useRccpAnalysisModes({
      vendorAccount: 'V1',
      isoWindow: WINDOW,
      modes: 'requested',
    }));

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });

  it('does nothing while disabled', async () => {
    const { result } = renderHook(() => useRccpAnalysisModes({
      vendorAccount: 'V1',
      isoWindow: WINDOW,
      modes: 'requested',
      enabled: false,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.current.analysis).toBeNull();
  });
});
