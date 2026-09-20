// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { apiRequest } from '../utils/api';
import { publishRccpSettingsSync } from './rccpSettingsSync';
import { useSplitPanelKpiKeys, useSplitPanelKpiToggle } from './useSplitPanelKpiToggle';

vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));

// De config-load resolvet een Promise ná de eerste render (ook uit cache). Die flushen we
// expliciet, zodat de React-update binnen act() valt in plaats van erna.
const flushEffects = () => act(async () => {});

beforeEach(() => {
  apiRequest.mockReset();
});

afterEach(() => {
  // Eerst unmounten, dan de module-scoped sync-bus legen: een publish naar een nog gemonteerde
  // hook zou een setState buiten act() veroorzaken.
  cleanup();
  publishRccpSettingsSync(null);
});

describe('useSplitPanelKpiToggle', () => {
  it('leest de huidige keuze uit de gedeelde config', async () => {
    publishRccpSettingsSync({ splitPanelKpiKeys: ['ordered', 'open'] });
    const { result } = renderHook(() => useSplitPanelKpiToggle('open'));
    await flushEffects();
    expect(result.current.checked).toBe(true);
    expect(result.current.saving).toBe(false);
  });

  it('is uitgevinkt voor een kpi die niet in de config staat', async () => {
    publishRccpSettingsSync({ splitPanelKpiKeys: ['ordered'] });
    const { result } = renderHook(() => useSplitPanelKpiToggle('open'));
    await flushEffects();
    expect(result.current.checked).toBe(false);
  });

  it('laadt de config eenmalig wanneer er nog niets gecached is', async () => {
    apiRequest.mockResolvedValue({ config: { splitPanelKpiKeys: ['lateDelivery'] } });
    const { result } = renderHook(() => useSplitPanelKpiToggle('lateDelivery'));
    await waitFor(() => expect(result.current.checked).toBe(true));
    expect(apiRequest).toHaveBeenCalledWith('/admin/rccp/settings');
  });

  it('doet geen enkele admin-call wanneer enabled false is', async () => {
    renderHook(() => useSplitPanelKpiToggle('open', false));
    await flushEffects();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('voegt de kpi toe aan de bestaande keuze bij aanzetten', async () => {
    publishRccpSettingsSync({ splitPanelKpiKeys: ['ordered'] });
    apiRequest.mockResolvedValue({ config: { splitPanelKpiKeys: ['ordered', 'open'] } });
    const { result } = renderHook(() => useSplitPanelKpiToggle('open'));
    await flushEffects();
    await act(async () => { await result.current.toggle(true); });
    expect(apiRequest).toHaveBeenCalledWith('/admin/rccp/settings/split-panel-kpis', {
      method: 'PUT',
      body: { kpiKeys: ['ordered', 'open'] },
    });
    expect(result.current.checked).toBe(true);
  });

  it('haalt de kpi uit de keuze bij uitzetten', async () => {
    publishRccpSettingsSync({ splitPanelKpiKeys: ['ordered', 'open'] });
    apiRequest.mockResolvedValue({ config: { splitPanelKpiKeys: ['ordered'] } });
    const { result } = renderHook(() => useSplitPanelKpiToggle('open'));
    await flushEffects();
    await act(async () => { await result.current.toggle(false); });
    expect(apiRequest).toHaveBeenCalledWith('/admin/rccp/settings/split-panel-kpis', {
      method: 'PUT',
      body: { kpiKeys: ['ordered'] },
    });
    expect(result.current.checked).toBe(false);
  });

  it('laat de stand ongemoeid als het opslaan faalt', async () => {
    publishRccpSettingsSync({ splitPanelKpiKeys: ['ordered'] });
    apiRequest.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useSplitPanelKpiToggle('open'));
    await flushEffects();
    await act(async () => { await result.current.toggle(true); });
    expect(result.current.checked).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  it('slaat niets op wanneer enabled false is', async () => {
    const { result } = renderHook(() => useSplitPanelKpiToggle('open', false));
    await act(async () => { await result.current.toggle(true); });
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe('useSplitPanelKpiKeys', () => {
  it('gebruikt de fallback uit de analyse zolang er geen sync-event is geweest', async () => {
    const { result } = renderHook(() => useSplitPanelKpiKeys(['ordered', 'open']));
    await flushEffects();
    expect(result.current).toEqual(['ordered', 'open']);
  });

  it('geeft een lege lijst zonder fallback', async () => {
    const { result } = renderHook(() => useSplitPanelKpiKeys());
    await flushEffects();
    expect(result.current).toEqual([]);
  });

  it('volgt een toggle in dezelfde sessie meteen', async () => {
    const { result } = renderHook(() => useSplitPanelKpiKeys(['ordered']));
    await flushEffects();
    act(() => { publishRccpSettingsSync({ splitPanelKpiKeys: ['lateItems'] }); });
    expect(result.current).toEqual(['lateItems']);
  });
});
