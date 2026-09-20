// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { clearPoBoardKpiCache, getPoBoardKpis } from '../utils/poBoardKpiCache';
import { publishRccpSettingsSaved } from './rccpSettingsSync';
import { usePoBoardKpis } from './usePoBoardKpis';

vi.mock('../utils/poBoardKpiCache', () => ({
  getPoBoardKpis: vi.fn(),
  clearPoBoardKpiCache: vi.fn(),
}));

const ORDERS = [{ orderNumber: 'PO-1' }, { orderNumber: 'PO-2' }];

const PAYLOAD = {
  configured: true,
  config: { splitPanelKpiKeys: ['ordered'] },
  orders: {
    'PO-1': { orderedUnits: 10, openUnits: 4 },
    'PO-2': { orderedUnits: 5, openUnits: 0 },
  },
  confirmed: { orders: { 'PO-1': { orderedUnits: 10, openUnits: 2 } } },
};

beforeEach(() => {
  getPoBoardKpis.mockReset();
  clearPoBoardKpiCache.mockReset();
  getPoBoardKpis.mockResolvedValue(PAYLOAD);
});

afterEach(() => {
  // Eerst unmounten, dan de module-scoped sync-bus legen: een publish naar een nog gemonteerde
  // hook zou een setState buiten act() veroorzaken.
  cleanup();
  publishRccpSettingsSaved(null);
});

describe('usePoBoardKpis', () => {
  it('haalt de stats op en levert geaggregeerde kpis', async () => {
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getPoBoardKpis).toHaveBeenCalledWith('r1');
    expect(result.current.kpis).toBeTruthy();
    expect(result.current.error).toBe('');
    expect(result.current.configured).toBe(true);
  });

  it('geeft de config uit de payload door', async () => {
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual({ splitPanelKpiKeys: ['ordered'] });
  });

  it('levert een tweede kpi-set op confirmed-datumbasis', async () => {
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kpisConfirmed).toBeTruthy();
  });

  it('laat kpisConfirmed leeg wanneer de payload die kant niet bevat', async () => {
    getPoBoardKpis.mockResolvedValue({ ...PAYLOAD, confirmed: undefined });
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kpisConfirmed).toBeNull();
  });

  it('stelt de fetch uit zolang enabled false is', async () => {
    const { result } = renderHook(
      () => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1', enabled: false }),
    );
    await act(async () => {});
    expect(getPoBoardKpis).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('haalt alsnog op zodra enabled true wordt', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1', enabled }),
      { initialProps: { enabled: false } },
    );
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getPoBoardKpis).toHaveBeenCalledTimes(1);
  });

  it('meldt een fout zonder de tegels te laten crashen', async () => {
    getPoBoardKpis.mockRejectedValue(new Error('board-kpis down'));
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('board-kpis down');
    expect(result.current.kpis).toBeTruthy();
  });

  it('markeert configured false wanneer de backend geen KPI-configuratie heeft', async () => {
    getPoBoardKpis.mockResolvedValue({ ...PAYLOAD, configured: false });
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.configured).toBe(false);
  });

  it('haalt niet opnieuw op bij een nieuwe rij-identiteit met dezelfde ordernummers', async () => {
    const { result, rerender } = renderHook(
      ({ orders }) => usePoBoardKpis({ orders, refreshKey: 'r1' }),
      { initialProps: { orders: ORDERS } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ orders: [{ orderNumber: 'PO-1' }, { orderNumber: 'PO-2' }] });
    expect(getPoBoardKpis).toHaveBeenCalledTimes(1);
  });

  it('haalt opnieuw op bij een nieuwe refreshKey', async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey }) => usePoBoardKpis({ orders: ORDERS, refreshKey }),
      { initialProps: { refreshKey: 'r1' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ refreshKey: 'r2' });
    await waitFor(() => expect(getPoBoardKpis).toHaveBeenCalledTimes(2));
    expect(getPoBoardKpis).toHaveBeenLastCalledWith('r2');
  });

  it('gooit de cache weg en herlaadt na het opslaan van RCCP-instellingen', async () => {
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { publishRccpSettingsSaved({ splitPanelKpiKeys: [] }); });
    await waitFor(() => expect(getPoBoardKpis).toHaveBeenCalledTimes(2));
    expect(clearPoBoardKpiCache).toHaveBeenCalled();
  });

  it('bouwt een qty-overlay voor een aangeklikte tegel', async () => {
    const { result } = renderHook(() => usePoBoardKpis({ orders: ORDERS, refreshKey: 'r1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.buildOverlay).toBe('function');
    expect(() => result.current.buildOverlay('open')).not.toThrow();
  });
});
