// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../utils/rccpAnalysisPrefetch', () => ({
  clearRccpAnalysisPrefetchCache: vi.fn(),
  getCachedRccpAnalysis: vi.fn(() => null),
}));

const WINDOW = { fromYear: 2026, fromWeek: 1, toYear: 2026, toWeek: 8 };

describe('useRccpSplitAnalysis', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies a saved chart type immediately and refetches analysis', async () => {
    const { apiRequest } = await import('../utils/api');
    const { clearRccpAnalysisPrefetchCache } = await import('../utils/rccpAnalysisPrefetch');
    apiRequest.mockResolvedValue({
      kpis: {},
      periods: [{ year: 2026, week: 1, key: '2026-W01' }],
      cells: [],
      chart: [],
      config: { chartWeekRanges: [] },
      measureRows: [{ measureKey: 'quantity', label: 'Quantity', chartType: 'line', showInChart: true }],
    });
    const { useRccpSplitAnalysis } = await import('./useRccpSplitAnalysis');
    const { publishRccpSettingsSaved } = await import('./rccpSettingsSync');

    const { result } = renderHook(() => useRccpSplitAnalysis({
      vendorAccount: 'V000583',
      isoWindow: WINDOW,
      enabled: true,
      refreshKey: '1',
    }));

    // Ruime timeout: de eerste test in dit bestand betaalt de eenmalige cold-start compile van
    // de volledige module-graaf (incl. Fluent UI); op een zwaarbelaste/parallelle testrun kan dat
    // (zeer) lang duren — machine-belasting, geen logica-probleem (zie losse run: ~5s).
    await waitFor(() => expect(result.current.measureRows[0]?.chartType).toBe('line'), { timeout: 100000 });
    const callsBeforeSave = apiRequest.mock.calls.length;
    apiRequest.mockImplementation(() => new Promise(() => {}));

    act(() => {
      publishRccpSettingsSaved({
        quantityMeasures: [
          { columnKey: 'quantity', label: 'Quantity', chartType: 'bar', showInChart: true },
        ],
      });
    });

    expect(result.current.measureRows[0].chartType).toBe('bar');
    expect(clearRccpAnalysisPrefetchCache).toHaveBeenCalled();
    expect(apiRequest.mock.calls.length).toBeGreaterThan(callsBeforeSave);
  }, 120000);

  it('reuses a warm prefetched analysis for the selected vendor instead of firing a duplicate apiRequest', async () => {
    const { apiRequest } = await import('../utils/api');
    const { getCachedRccpAnalysis } = await import('../utils/rccpAnalysisPrefetch');
    const prefetched = {
      kpis: {}, periods: [], cells: [], chart: [], config: { chartWeekRanges: [] }, measureRows: [],
    };
    getCachedRccpAnalysis.mockReturnValue(Promise.resolve(prefetched));
    apiRequest.mockRejectedValue(new Error('should not be called when a prefetch is warm'));
    const { useRccpSplitAnalysis } = await import('./useRccpSplitAnalysis');

    const { result } = renderHook(() => useRccpSplitAnalysis({
      vendorAccount: 'V000583',
      isoWindow: WINDOW,
      enabled: true,
      refreshKey: '1',
    }));

    await waitFor(() => expect(result.current.analysis).toBe(prefetched), { timeout: 15000 });
    expect(getCachedRccpAnalysis).toHaveBeenCalledWith(WINDOW, 'V000583', 'requested');
    expect(apiRequest).not.toHaveBeenCalled();
  }, 20000);

  it('passes the load-date mode on the analysis request', async () => {
    const { apiRequest } = await import('../utils/api');
    const { getCachedRccpAnalysis } = await import('../utils/rccpAnalysisPrefetch');
    getCachedRccpAnalysis.mockReturnValue(null);
    apiRequest.mockResolvedValue({
      kpis: {}, periods: [], cells: [], chart: [], config: { chartWeekRanges: [] }, measureRows: [],
    });
    const { useRccpSplitAnalysis } = await import('./useRccpSplitAnalysis');

    renderHook(() => useRccpSplitAnalysis({
      vendorAccount: 'V000583',
      isoWindow: WINDOW,
      enabled: true,
      refreshKey: '1',
      planningDateModes: 'confirmed',
    }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled(), { timeout: 15000 });
    expect(String(apiRequest.mock.calls[0][0])).toContain('planningDateMode=confirmed');
  }, 20000);

  it('does not look up the prefetch cache without a vendor (all-vendors on the split tab)', async () => {
    const { apiRequest } = await import('../utils/api');
    const { getCachedRccpAnalysis } = await import('../utils/rccpAnalysisPrefetch');
    apiRequest.mockResolvedValue({
      kpis: {}, periods: [], cells: [], chart: [], config: { chartWeekRanges: [] }, measureRows: [],
    });
    const { useRccpSplitAnalysis } = await import('./useRccpSplitAnalysis');

    renderHook(() => useRccpSplitAnalysis({
      vendorAccount: '',
      isoWindow: WINDOW,
      enabled: true,
      refreshKey: '1',
    }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled(), { timeout: 15000 });
    expect(getCachedRccpAnalysis).not.toHaveBeenCalled();
  }, 20000);

  it('keeps the previous chart while the next vendor loads', async () => {
    const { apiRequest } = await import('../utils/api');
    const first = {
      kpis: {}, periods: [], cells: [], chart: [{ key: 'a' }], config: { chartWeekRanges: [] }, measureRows: [],
    };
    let resolveSecond;
    apiRequest.mockResolvedValueOnce(first);
    const { useRccpSplitAnalysis } = await import('./useRccpSplitAnalysis');

    const { result, rerender } = renderHook(
      ({ vendorAccount, refreshKey }) => useRccpSplitAnalysis({
        vendorAccount,
        isoWindow: WINDOW,
        enabled: true,
        refreshKey,
      }),
      { initialProps: { vendorAccount: 'V1', refreshKey: '1' } },
    );

    await waitFor(() => expect(result.current.analysis).toBe(first), { timeout: 15000 });

    apiRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    rerender({ vendorAccount: 'V2', refreshKey: '2' });

    await waitFor(() => expect(apiRequest.mock.calls.length).toBeGreaterThan(1), { timeout: 15000 });
    expect(result.current.analysis).toBe(first);
    expect(result.current.loading).toBe(true);

    const second = { ...first, chart: [{ key: 'b' }] };
    await act(async () => { resolveSecond(second); });
    await waitFor(() => expect(result.current.analysis).toBe(second), { timeout: 15000 });
  }, 20000);
});
