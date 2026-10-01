'use strict';

const { warmBoardCaches, WARM_TABLE_KEY } = require('./BoardWarmup');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeCache({ snapshot = null, kpi = null } = {}) {
  const calls = { readBoardSnapshot: [], readRccpPoRows: [] };
  return {
    calls,
    async readBoardSnapshot(args) {
      calls.readBoardSnapshot.push(args);
      if (snapshot) return snapshot();
      return { rows: [], columns: [], revision: 'r1' };
    },
    async readRccpPoRows(args) {
      calls.readRccpPoRows.push(args);
      if (kpi) return kpi();
      return { rows: [], revision: 'r1' };
    },
  };
}

describe('BoardWarmup.warmBoardCaches', () => {
  it('warmt board-snapshot en KPI-rijen voor de staff-scope', async () => {
    const cache = fakeCache();
    const result = await warmBoardCaches({ reason: 'test', cache });

    expect(result).toEqual({ warmed: true, reason: 'test' });
    expect(cache.calls.readBoardSnapshot).toEqual([
      { tableKey: WARM_TABLE_KEY, userId: null, supplierAccount: null },
    ]);
    expect(cache.calls.readRccpPoRows).toEqual([
      { tableKey: WARM_TABLE_KEY, supplierAccount: null },
    ]);
  });

  it('warmt nooit een leveranciers-scope mee', async () => {
    const cache = fakeCache();
    await warmBoardCaches({ reason: 'test', cache });

    const scopes = [...cache.calls.readBoardSnapshot, ...cache.calls.readRccpPoRows]
      .map((args) => args.supplierAccount);
    expect(scopes.every((scope) => scope === null)).toBe(true);
  });

  it('faalt stil: werpt niet en meldt warmed=false', async () => {
    const cache = fakeCache({
      snapshot: () => { throw new Error('SQL onbereikbaar'); },
    });

    await expect(warmBoardCaches({ reason: 'test', cache })).resolves.toEqual({
      warmed: false,
      reason: 'test',
    });
  });

  it('slaat de KPI-read over zodra de board-read faalt', async () => {
    const cache = fakeCache({
      snapshot: () => { throw new Error('stuk'); },
    });
    await warmBoardCaches({ reason: 'test', cache });
    expect(cache.calls.readRccpPoRows).toHaveLength(0);
  });

  it('deelt één lopende read tussen gelijktijdige aanroepen', async () => {
    const gate = deferred();
    const cache = fakeCache({ snapshot: () => gate.promise });

    const first = warmBoardCaches({ reason: 'startup', cache });
    const second = warmBoardCaches({ reason: 'refresh-done', cache });
    expect(second).toBe(first);

    gate.resolve({ rows: [], columns: [], revision: 'r1' });
    await first;

    // Eén gedeelde read, niet twee volledige board-reads naast elkaar op 1 GiB geheugen.
    expect(cache.calls.readBoardSnapshot).toHaveLength(1);
  });

  it('laat een volgende warmup toe zodra de vorige klaar is', async () => {
    const cache = fakeCache();
    await warmBoardCaches({ reason: 'startup', cache });
    await warmBoardCaches({ reason: 'refresh-done', cache });
    expect(cache.calls.readBoardSnapshot).toHaveLength(2);
  });

  it('laat een volgende warmup toe nadat de vorige is gefaald', async () => {
    const failing = fakeCache({ snapshot: () => { throw new Error('stuk'); } });
    await warmBoardCaches({ reason: 'eerste', cache: failing });

    const healthy = fakeCache();
    const result = await warmBoardCaches({ reason: 'tweede', cache: healthy });
    expect(result.warmed).toBe(true);
    expect(healthy.calls.readBoardSnapshot).toHaveLength(1);
  });
});
