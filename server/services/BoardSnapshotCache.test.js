'use strict';

const { readBoardSnapshot, readRccpPoRows, invalidateBoardSnapshots } = require('./BoardSnapshotCache');
// BoardSnapshotCache.js gebruikt het gedeelde dataService-object (niet gedestructureerd),
// dus getRevision/read direct op dat object vervangen is genoeg — geen module-reset nodig.
const dataService = require('./TableDataService');

const originalGetRevision = dataService.getRevision;
const originalRead = dataService.read;

afterEach(() => {
  dataService.getRevision = originalGetRevision;
  dataService.read = originalRead;
  vi.restoreAllMocks();
});

function mockDataService({ revision = 1, parts = { syncedAt: 't1' }, rows = [{ id: 1 }], columns = [{ key: 'status' }] } = {}) {
  dataService.getRevision = vi.fn().mockResolvedValue({ revision, parts });
  dataService.read = vi.fn().mockResolvedValue({ meta: { columns: { master: columns } }, rows });
}

describe('readBoardSnapshot', () => {
  it('leest het volledige board bij een cache-miss en geeft rows/columns/revision terug', async () => {
    mockDataService();

    const result = await readBoardSnapshot({ tableKey: 'snapshot-test-1' });

    expect(dataService.read).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ rows: [{ id: 1 }], columns: [{ key: 'status' }], revision: 1 });
  });

  it('hergebruikt het snapshot bij een ongewijzigde content-signatuur — geen tweede read()', async () => {
    mockDataService({ parts: { syncedAt: 'same' } });

    await readBoardSnapshot({ tableKey: 'snapshot-test-2' });
    await readBoardSnapshot({ tableKey: 'snapshot-test-2' });

    expect(dataService.getRevision).toHaveBeenCalledTimes(2);
    expect(dataService.read).toHaveBeenCalledTimes(1);
  });

  it('doet een verse read() zodra de content-signatuur wijzigt (bv. na een sync)', async () => {
    mockDataService({ parts: { syncedAt: 'before' } });
    await readBoardSnapshot({ tableKey: 'snapshot-test-3' });

    mockDataService({ parts: { syncedAt: 'after' } });
    await readBoardSnapshot({ tableKey: 'snapshot-test-3' });

    expect(dataService.read).toHaveBeenCalledTimes(1);
  });

  it('gebruikt een apart snapshot per supplierAccount — geen datalek tussen suppliers', async () => {
    mockDataService({ parts: { syncedAt: 'same' } });

    await readBoardSnapshot({ tableKey: 'snapshot-test-4', supplierAccount: 'V000583' });
    await readBoardSnapshot({ tableKey: 'snapshot-test-4', supplierAccount: 'V000696' });

    expect(dataService.read).toHaveBeenCalledTimes(2);
  });

  // BL-007: versheid komt van de content-signatuur, niet van een klok. Een cache die na 5 minuten
  // verviel liet de eerstvolgende bezoeker de volledige koude read betalen (18,2 s tegen 8-13 ms
  // warm, gemeten op Azure DEV). Beleid: cache.crossPageTtlPolicy = "unlimited-until-revision".
  it('houdt het snapshot vast ruim voorbij de oude TTL van 5 minuten zolang de signatuur gelijk blijft', async () => {
    vi.useFakeTimers();
    mockDataService({ parts: { syncedAt: 'same' } });

    await readBoardSnapshot({ tableKey: 'snapshot-test-5' });
    vi.advanceTimersByTime(60 * 60 * 1000); // een uur — twaalf keer de oude TTL
    await readBoardSnapshot({ tableKey: 'snapshot-test-5' });

    expect(dataService.read).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('doet alsnog een verse read() zodra het veiligheidsnet (12 uur) verstreken is', async () => {
    vi.useFakeTimers();
    mockDataService({ parts: { syncedAt: 'same' } });

    await readBoardSnapshot({ tableKey: 'snapshot-test-6' });
    vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1);
    await readBoardSnapshot({ tableKey: 'snapshot-test-6' });

    expect(dataService.read).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  // Regressiebescherming bij het vervallen van de 5-minuten-TTL: saveSyncFilters() markeert rijen
  // out-of-scope zonder content_changed_at of last_full_sync_at te raken. Zonder settingsAt in de
  // signatuur zou zo'n scope-wijziging tot 12 uur onzichtbaar blijven in BI/RCCP.
  it('invalideert wanneer de sync-filterregels wijzigen (settingsAt wijzigt)', async () => {
    mockDataService({ parts: { syncedAt: 'same', settingsAt: 'rules-v1' } });
    await readBoardSnapshot({ tableKey: 'snapshot-scope-1' });

    mockDataService({ parts: { syncedAt: 'same', settingsAt: 'rules-v2' } });
    await readBoardSnapshot({ tableKey: 'snapshot-scope-1' });

    expect(dataService.read).toHaveBeenCalledTimes(1);
  });

  it('laat een per-gebruiker-veld het gedeelde snapshot juist NIET invalideren', async () => {
    mockDataService({ parts: { syncedAt: 'same', userViewedAt: 'user-a' } });
    await readBoardSnapshot({ tableKey: 'snapshot-scope-2' });

    mockDataService({ parts: { syncedAt: 'same', userViewedAt: 'user-b' } });
    await readBoardSnapshot({ tableKey: 'snapshot-scope-2' });

    expect(dataService.read).not.toHaveBeenCalled();
  });

  it('leest een gedeeld snapshot user-neutraal, zonder change-decoraties', async () => {
    mockDataService({
      rows: [{ id: 1, isNew: false, isChanged: false }],
    });
    await readBoardSnapshot({ tableKey: 'snapshot-neutral', userId: 99, supplierAccount: 'V1' });
    expect(dataService.getRevision).toHaveBeenCalledWith({
      tableKey: 'snapshot-neutral', userId: null, supplierAccount: 'V1',
    });
    expect(dataService.read).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      supplierAccount: 'V1',
      includeChangeDecorations: false,
    }));
  });

  it('invalideert nog steeds direct bij een gebruikersbewerking (maxCustomValueAt wijzigt)', async () => {
    mockDataService({ parts: { syncedAt: 'same', maxCustomValueAt: 'edit-1' } });
    await readBoardSnapshot({ tableKey: 'snapshot-test-7' });

    mockDataService({ parts: { syncedAt: 'same', maxCustomValueAt: 'edit-2' } });
    await readBoardSnapshot({ tableKey: 'snapshot-test-7' });

    expect(dataService.read).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateBoardSnapshots', () => {
  it('gooit het snapshot van één tabel weg zodat de volgende read vers is', async () => {
    mockDataService({ parts: { syncedAt: 'same' } });
    await readBoardSnapshot({ tableKey: 'invalidate-1' });
    expect(dataService.read).toHaveBeenCalledTimes(1);

    invalidateBoardSnapshots({ tableKey: 'invalidate-1' });
    await readBoardSnapshot({ tableKey: 'invalidate-1' });

    expect(dataService.read).toHaveBeenCalledTimes(2);
  });

  it('laat snapshots van andere tabellen ongemoeid', async () => {
    mockDataService({ parts: { syncedAt: 'same' } });
    await readBoardSnapshot({ tableKey: 'invalidate-keep' });
    dataService.read.mockClear();

    invalidateBoardSnapshots({ tableKey: 'invalidate-other' });
    await readBoardSnapshot({ tableKey: 'invalidate-keep' });

    expect(dataService.read).not.toHaveBeenCalled();
  });

  it('raakt ook de kpi-cache van die tabel, niet alleen het board-snapshot', async () => {
    mockDataService({ parts: { syncedAt: 'same' }, rows: [{ recordKey: 'PO-1', details: [] }] });
    await readRccpPoRows({ tableKey: 'invalidate-kpi' });
    expect(dataService.read).toHaveBeenCalledTimes(1);

    invalidateBoardSnapshots({ tableKey: 'invalidate-kpi' });
    await readRccpPoRows({ tableKey: 'invalidate-kpi' });

    expect(dataService.read).toHaveBeenCalledTimes(2);
  });
});

describe('readRccpPoRows', () => {
  it('leest zonder change-decoraties en hergebruikt de kpi-cache', async () => {
    mockDataService({ parts: { syncedAt: 'kpi-same' }, rows: [{ recordKey: 'PO-1', details: [] }] });

    const first = await readRccpPoRows({ tableKey: 'kpi-test-1' });
    const second = await readRccpPoRows({ tableKey: 'kpi-test-1' });

    expect(dataService.read).toHaveBeenCalledTimes(1);
    expect(dataService.read).toHaveBeenCalledWith({
      tableKey: 'kpi-test-1',
      supplierAccount: null,
      userId: null,
      includeChangeDecorations: false,
    });
    expect(first.rows).toEqual([{ recordKey: 'PO-1', details: [] }]);
    expect(second.rows).toBe(first.rows);
  });

  it('hergebruikt een warm board-snapshot zonder tweede read()', async () => {
    mockDataService({ parts: { syncedAt: 'shared-snap' }, rows: [{ recordKey: 'PO-SNAP', details: [] }] });
    await readBoardSnapshot({ tableKey: 'kpi-reuse-snap' });
    dataService.read.mockClear();
    dataService.getRevision.mockClear();

    const kpi = await readRccpPoRows({ tableKey: 'kpi-reuse-snap' });

    expect(dataService.read).not.toHaveBeenCalled();
    expect(kpi.rows).toEqual([{ recordKey: 'PO-SNAP', details: [] }]);
  });

  it('slaat getRevision over wanneer revision en parts al bekend zijn', async () => {
    mockDataService({ parts: { syncedAt: 'known' }, rows: [{ recordKey: 'PO-2' }] });

    await readRccpPoRows({
      tableKey: 'kpi-known-rev',
      revision: 9,
      parts: { syncedAt: 'known' },
    });

    expect(dataService.getRevision).not.toHaveBeenCalled();
    expect(dataService.read).toHaveBeenCalledTimes(1);
  });

  it('negeert een board-snapshot zonder details en doet alsnog een kpi_po_read mét details', async () => {
    mockDataService({
      parts: { syncedAt: 'poison' },
      rows: [{ recordKey: 'PO-1', values: { vendorAccount: 'V1' } }], // geen details
    });
    const { rememberKpiPoRows, contentSignature } = await import('./BoardSnapshotCache');
    rememberKpiPoRows({
      tableKey: 'purchase-orders',
      supplierAccount: null,
      signature: contentSignature({ syncedAt: 'poison' }),
      rows: [{ recordKey: 'PO-1', values: {} }],
    });
    dataService.read.mockResolvedValue({
      rows: [{ recordKey: 'PO-1', details: [{ detailKey: '1', values: {} }], values: {} }],
    });
    const kpi = await readRccpPoRows({
      tableKey: 'purchase-orders',
      revision: 1,
      parts: { syncedAt: 'poison' },
    });
    expect(dataService.read).toHaveBeenCalledWith(expect.objectContaining({
      includeChangeDecorations: false,
    }));
    expect(kpi.rows[0].details).toEqual([{ detailKey: '1', values: {} }]);
  });

  it('een board-read zonder details overschrijft een eerder warme, details-rijke kpi-cache niet', async () => {
    mockDataService({ parts: { syncedAt: 'guard' }, rows: [{ recordKey: 'PO-9', details: [{ detailKey: 'd1' }] }] });
    const { rememberKpiPoRows, contentSignature } = await import('./BoardSnapshotCache');
    const signature = contentSignature({ syncedAt: 'guard' });

    const first = await readRccpPoRows({ tableKey: 'kpi-guard-1', revision: 1, parts: { syncedAt: 'guard' } });
    expect(first.rows[0].details).toEqual([{ detailKey: 'd1' }]);
    dataService.read.mockClear();

    // Simuleert een header-only board-read die de cache probeert te vergiftigen.
    rememberKpiPoRows({ tableKey: 'kpi-guard-1', supplierAccount: null, signature, rows: [{ recordKey: 'PO-9' }] });

    const second = await readRccpPoRows({ tableKey: 'kpi-guard-1', revision: 1, parts: { syncedAt: 'guard' } });
    expect(dataService.read).not.toHaveBeenCalled();
    expect(second.rows[0].details).toEqual([{ detailKey: 'd1' }]);
  });
});

describe('BoardWarmup deelt de staff-scope met BI/RCCP', () => {
  it('vult snapshot en kpi die de volgende staff-read hergebruikt', async () => {
    mockDataService({
      parts: { syncedAt: 'warm' },
      rows: [{ recordKey: 'PO-W', details: [{ detailKey: '1' }] }],
    });
    const { warmBoardCaches } = require('./BoardWarmup');
    await warmBoardCaches({ reason: 'test' });
    dataService.read.mockClear();

    const { readBoardSnapshot: readSnap, readRccpPoRows: readKpi } = require('./BoardSnapshotCache');
    const snap = await readSnap({ tableKey: 'purchase-orders', supplierAccount: null });
    const kpi = await readKpi({ tableKey: 'purchase-orders', supplierAccount: null });

    expect(dataService.read).not.toHaveBeenCalled();
    expect(snap.rows[0].recordKey).toBe('PO-W');
    expect(kpi.rows).toBe(snap.rows);
    const { invalidate } = require('./board-cache/BoardCacheCoordinator');
    invalidate('purchase-orders', 'refresh-complete');
  });
});
