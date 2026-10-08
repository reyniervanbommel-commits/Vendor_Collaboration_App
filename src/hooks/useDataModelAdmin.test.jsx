import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useDataModelAdmin } from './useDataModelAdmin';
import { apiRequest } from '../utils/api';

vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));

const DATAMODEL_PATH = '/data/purchase-orders/datamodel';

function columnFixture(overrides = {}) {
  return {
    id: 1,
    key: 'poNumber',
    label: 'PO Number',
    level: 'header',
    dataType: 'string',
    source: 'd365',
    sourceField: 'PurchaseOrderNumber',
    isActive: true,
    writable: false,
    visibleAtDelete: false,
    ...overrides,
  };
}

function datamodelPayload(overrides = {}) {
  return {
    entities: [],
    relation: null,
    columns: { header: [columnFixture()], line: [] },
    cache: null,
    ...overrides,
  };
}

async function renderReady(payload = datamodelPayload()) {
  apiRequest.mockResolvedValueOnce(payload);
  const view = renderHook(() => useDataModelAdmin('purchase-orders'));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  apiRequest.mockClear();
  return view;
}

beforeEach(() => {
  apiRequest.mockReset();
});

// Vangnet: als een test met vi.useFakeTimers() faalt vóórdat hij zelf vi.useRealTimers()
// aanroept, blijven fake timers actief en hangt renderReady()'s waitFor() in élke volgende
// test. useRealTimers() op al-echte timers is een veilige no-op.
afterEach(() => {
  vi.useRealTimers();
});

describe('useDataModelAdmin — laden', () => {
  it('laadt het datamodel bij mount en mapt de kolommen', async () => {
    const { result } = await renderReady();

    expect(result.current.columns.header[0]).toMatchObject({
      key: 'poNumber',
      writeBackAllowed: true,
      hideAllowed: true,
    });
    expect(result.current.error).toBe('');
  });

  it('zet een foutmelding als het laden mislukt', async () => {
    apiRequest.mockRejectedValue(new Error('datamodel unavailable'));
    const { result } = renderHook(() => useDataModelAdmin('purchase-orders'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('datamodel unavailable');
  });
});

describe('useDataModelAdmin — losse kolom-toggles', () => {
  it('toggleVisibility PATCHt de zichtbaarheid en vervangt de kolom in de state', async () => {
    const { result } = await renderReady();
    apiRequest.mockResolvedValue({ column: columnFixture({ isActive: false }) });

    await act(async () => { await result.current.toggleVisibility(result.current.columns.header[0]); });

    expect(apiRequest).toHaveBeenCalledWith(`${DATAMODEL_PATH.replace('/datamodel', '')}/columns/1/visibility`, {
      method: 'PATCH',
      body: { visible: false },
    });
    expect(result.current.columns.header[0].isActive).toBe(false);
    expect(result.current.togglingKey).toBeNull();
  });

  it('toggleMentionable PATCHt naar het mentionable-endpoint en markeert alleen tekstbronkolommen', async () => {
    const payload = datamodelPayload({
      columns: {
        header: [],
        line: [
          columnFixture({ id: 9, key: 'itemNumber', level: 'line', dataType: 'text', mentionable: false }),
          columnFixture({ id: 10, key: 'qty', level: 'line', dataType: 'number' }),
        ],
      },
    });
    const { result } = await renderReady(payload);
    const [item, qty] = result.current.columns.line;
    expect(item.mentionableAllowed).toBe(true);
    expect(qty.mentionableAllowed).toBe(false);
    apiRequest.mockResolvedValue({ column: { ...item, mentionable: true } });

    await act(async () => { await result.current.toggleMentionable(item); });

    expect(apiRequest).toHaveBeenCalledWith('/data/purchase-orders/columns/9/mentionable', {
      method: 'PATCH',
      body: { mentionable: true },
    });
    expect(result.current.columns.line[0].mentionable).toBe(true);
  });

  it('toggleWriteback PATCHt naar het writeback-endpoint met het omgekeerde writable-gedrag', async () => {
    const { result } = await renderReady();
    apiRequest.mockResolvedValue({ column: columnFixture({ writable: true }) });

    await act(async () => { await result.current.toggleWriteback(result.current.columns.header[0]); });

    expect(apiRequest).toHaveBeenCalledWith('/data/purchase-orders/columns/1/writeback', {
      method: 'PATCH',
      body: { writable: true, mechanism: 'patch' },
    });
    expect(result.current.columns.header[0].writableToD365).toBe(true);
  });

  it('zet een foutmelding en reset togglingKey als een toggle mislukt', async () => {
    const { result } = await renderReady();
    apiRequest.mockRejectedValue(new Error('forbidden'));

    await act(async () => { await result.current.toggleVisibility(result.current.columns.header[0]); });

    expect(result.current.error).toBe('forbidden');
    expect(result.current.togglingKey).toBeNull();
  });

  it('deleteColumn verwijdert alleen custom kolommen — d365-kolommen worden genegeerd', async () => {
    const { result } = await renderReady();

    await act(async () => { await result.current.deleteColumn(result.current.columns.header[0]); });

    expect(apiRequest).not.toHaveBeenCalled(); // source is 'd365', geen custom kolom
  });

  it('deleteColumn verwijdert een custom kolom uit de state na succesvolle DELETE', async () => {
    const payload = datamodelPayload({ columns: { header: [columnFixture({ id: 2, source: 'custom' })], line: [] } });
    const { result } = await renderReady(payload);
    apiRequest.mockResolvedValue({});

    await act(async () => { await result.current.deleteColumn(result.current.columns.header[0]); });

    expect(apiRequest).toHaveBeenCalledWith('/data/purchase-orders/columns/2', { method: 'DELETE' });
    expect(result.current.columns.header).toHaveLength(0);
  });

  it('behoudt linkedFromLine van de datamodel-payload', async () => {
    const payload = datamodelPayload({
      columns: { header: [columnFixture({ id: 3, source: 'custom', linkedFromLine: 'values' })], line: [] },
    });
    const { result } = await renderReady(payload);
    expect(result.current.columns.header[0].linkedFromLine).toBe('values');
  });
});

describe('useDataModelAdmin — bulk-toggle (setColumnToggleState)', () => {
  it('PATCHt alleen kolommen die daadwerkelijk van state veranderen (idempotent)', async () => {
    const payload = datamodelPayload({
      columns: {
        header: [
          columnFixture({ id: 1, isActive: false }), // gaat aan → eligible
          columnFixture({ id: 2, isActive: true }), // al aan → niet eligible
        ],
        line: [],
      },
    });
    const { result } = await renderReady(payload);
    apiRequest.mockResolvedValue({ column: columnFixture({ id: 1, isActive: true }) });

    await act(async () => {
      await result.current.setColumnToggleState({
        columns: result.current.columns.header,
        toggleType: 'visibility',
        enabled: true,
      });
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith('/data/purchase-orders/columns/1/visibility', {
      method: 'PATCH',
      body: { visible: true },
    });
  });

  it('verwerkt gedeeltelijke fouten: succesvolle kolommen worden bijgewerkt, gefaalde tellen mee in de foutmelding', async () => {
    const payload = datamodelPayload({
      columns: {
        header: [
          columnFixture({ id: 1, isActive: false }),
          columnFixture({ id: 2, isActive: false }),
        ],
        line: [],
      },
    });
    const { result } = await renderReady(payload);
    apiRequest
      .mockResolvedValueOnce({ column: columnFixture({ id: 1, isActive: true }) })
      .mockRejectedValueOnce(new Error('locked'));

    await act(async () => {
      await result.current.setColumnToggleState({
        columns: result.current.columns.header,
        toggleType: 'visibility',
        enabled: true,
      });
    });

    expect(result.current.columns.header.find((c) => c.id === 1).isActive).toBe(true);
    expect(result.current.columns.header.find((c) => c.id === 2).isActive).toBe(false);
    expect(result.current.error).toContain('Bulk update failed for 1 column');
    expect(result.current.error).toContain('locked');
  });

  it('doet niets als geen enkele kolom eligible is', async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.setColumnToggleState({
        columns: result.current.columns.header, // al isActive:true, enabled:true → niet eligible
        toggleType: 'visibility',
        enabled: true,
      });
    });

    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe('useDataModelAdmin — sync/refresh-acties', () => {
  it('syncNow start een achtergrond-refresh, pollt tot running:false, en herlaadt dan het datamodel', async () => {
    const { result } = await renderReady();
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({ started: true }) // refresh/start
      .mockResolvedValueOnce({ running: false, progress: {} }) // refresh/progress — klaar na 1 poll
      .mockResolvedValueOnce(datamodelPayload()); // reload

    await act(async () => {
      const syncPromise = result.current.syncNow();
      await vi.advanceTimersByTimeAsync(2000);
      await syncPromise;
    });

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/data/purchase-orders/refresh/start', { method: 'POST' });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/data/purchase-orders/refresh/progress');
    expect(apiRequest).toHaveBeenNthCalledWith(3, DATAMODEL_PATH);
    expect(result.current.togglingKey).toBeNull();
    vi.useRealTimers();
  });

  it('syncNow blijft pollen zolang running:true is, pas daarna wordt herladen', async () => {
    const { result } = await renderReady();
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({ started: true })
      .mockResolvedValueOnce({ running: true, progress: {} }) // eerste poll: nog bezig
      .mockResolvedValueOnce({ running: false, progress: {} }) // tweede poll: klaar
      .mockResolvedValueOnce(datamodelPayload());

    await act(async () => {
      const syncPromise = result.current.syncNow();
      await vi.advanceTimersByTimeAsync(4000);
      await syncPromise;
    });

    expect(apiRequest).toHaveBeenCalledTimes(4);
    expect(apiRequest).toHaveBeenNthCalledWith(4, DATAMODEL_PATH);
  });

  it('toont de lookupWarnings-melding na afloop, ook al roept reload() zelf setError(\'\') aan', async () => {
    // Regressietest voor een gevonden bug: syncNow zette de warning vóór reload(), en reload()
    // begint zelf met setError('') — de warning werd zo altijd meteen overschreven en was voor de
    // gebruiker nooit zichtbaar. Fix: de warning wordt nu pas ná reload() gezet.
    const { result } = await renderReady();
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({ started: true })
      .mockResolvedValueOnce({ running: false, progress: { lookupWarnings: ['Vendors kon niet verversen'] } })
      .mockResolvedValueOnce(datamodelPayload());

    await act(async () => {
      const syncPromise = result.current.syncNow();
      await vi.advanceTimersByTimeAsync(2000);
      await syncPromise;
    });

    expect(result.current.error).toContain('Vendors kon niet verversen');
  });

  it('reimportBaseline stuurt baseline:true mee zodat wijzigingen niet als nieuw gelogd worden', async () => {
    const { result } = await renderReady();
    apiRequest.mockResolvedValueOnce({}).mockResolvedValueOnce(datamodelPayload());

    await act(async () => { await result.current.reimportBaseline(); });

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/data/purchase-orders/refresh', {
      method: 'POST',
      body: { baseline: true },
    });
  });

  it('discoverFields haalt nieuwe velden op en voegt discovery toe aan de state', async () => {
    const { result } = await renderReady();
    apiRequest
      .mockResolvedValueOnce({ discovered: ['newField'] })
      .mockResolvedValueOnce(datamodelPayload());

    await act(async () => { await result.current.discoverFields(); });

    expect(result.current.discovery).toEqual({ discovered: ['newField'] });
  });
});
