'use strict';

// Na een sync is élke gecachete board-snapshot ongeldig: contentSignature() in
// BoardSnapshotCache bevat syncedAt. Zonder warmup betaalt de eerste bezoeker van de dag de
// volledige koude read. Gemeten op PROD, 22-09-2026: 23,9 s koud tegen ~6,0 s warm. Dezelfde
// klap valt na een deploy en na een Azure platform-herstart, want de caches zijn in-memory Maps
// die per container leven.
//
// Deze module bouwt die caches opnieuw op zodra de refresh klaar is (RefreshRunService.finishRun)
// en bij het opstarten van de container (server.js). Zie W1 in
// .cursor/plans/2026-09-21-perf-dev-prod-gelijktrekken.plan.md.

const { logger } = require('../utils/logger');
const { time } = require('../utils/timing');

const WARM_TABLE_KEY = 'purchase-orders';

let inFlight = null;

// Lazy: BoardSnapshotCache trekt TableDataService mee, dat op zijn beurt BoardSnapshotCache
// lazy requiret. Bovenaan importeren zou die cirkel op module-load leggen.
function defaultCache() {
  // eslint-disable-next-line global-require
  return require('./BoardSnapshotCache');
}

async function runWarmup(reason, cache) {
  const startedAt = Date.now();
  try {
    // readBoardSnapshot vult zowel de snapshot- als (via rememberKpiPoRows) de KPI-rijencache.
    // readRccpPoRows daarna is in het gunstige geval dus gratis; hij doet alleen eigen werk als
    // de board-read geen detailregels opleverde, en dan is dat precies wat RCCP/BI nodig heeft.
    await time('warmup_board_snapshot', () => cache.readBoardSnapshot({
      tableKey: WARM_TABLE_KEY,
      userId: null,
      supplierAccount: null,
    }));
    await time('warmup_kpi_rows', () => cache.readRccpPoRows({
      tableKey: WARM_TABLE_KEY,
      supplierAccount: null,
    }));
    logger.info('Board-caches opgewarmd', { reason, durationMs: Date.now() - startedAt });
    return { warmed: true, reason };
  } catch (err) {
    // Stil falen: een mislukte warmup mag een refresh-run of het opstarten van de server niet
    // stukmaken. De eerstvolgende bezoeker leest dan gewoon koud, zoals voorheen.
    logger.warn('Board-warmup mislukt; eerste bezoeker leest koud', {
      reason,
      error: err && err.message ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    return { warmed: false, reason };
  }
}

/**
 * Warmt de gedeelde board- en KPI-caches voor de staff-scope (supplierAccount = null).
 *
 * Bewust alleen die scope: de caches zijn gesleuteld op (tableKey, supplierAccount), dus élke
 * leverancier warmen zou N reads én N snapshots in 1 GiB containergeheugen betekenen. De
 * staff-scope is de zware; een leverancier leest een gefilterde, veel kleinere set.
 *
 * Meerdere aanroepen delen één lopende read. Dat is nodig omdat BoardSnapshotCache zelf geen
 * single-flight heeft: warmup-bij-opstarten en warmup-na-sync (of een tweede refresh) zouden
 * anders tegelijk dezelfde volledige read kunnen starten.
 *
 * @param {{ reason?: string, cache?: object }} [options] - `cache` alleen voor tests.
 * @returns {Promise<{ warmed: boolean, reason: string }>} - werpt nooit.
 */
function warmBoardCaches({ reason = 'unknown', cache = null } = {}) {
  if (inFlight) return inFlight;
  inFlight = runWarmup(reason, cache || defaultCache()).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

module.exports = { warmBoardCaches, WARM_TABLE_KEY };
