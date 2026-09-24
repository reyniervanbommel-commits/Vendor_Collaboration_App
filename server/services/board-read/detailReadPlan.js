'use strict';

const { logger } = require('../../utils/logger');
const { time, mark } = require('../../utils/timing');
const { getTableByKey } = require('../TableRegistryService');
const { resolveCollapsedDetailFields } = require('../../utils/collapsedDetailFields');
const { resolveCollapsedRollupPlan, buildCollapsedRollupSql } = require('../../utils/collapsedDetailRollup');
const { resolveLedgerSinceMs, usesViewedBaseline } = require('../../utils/ledgerWindow');

function parseDefaultFilterRules(defaultFilter) {
  if (!defaultFilter) return [];
  try {
    const parsed = JSON.parse(defaultFilter);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Is het items-syncfilter actief? Dan hangt per régel af of die meetelt en of de order zichtbaar
// blijft, en kan de rollup niet in SQL. Bewust conservatief: bij twijfel geen aggregatie.
async function itemsLineFilterConfigured(table) {
  if (table.key !== 'purchase-orders') return false;
  try {
    const itemsTable = await getTableByKey('items');
    return parseDefaultFilterRules(itemsTable.defaultFilter).length > 0;
  } catch {
    return true;
  }
}

// Leesplan voor een dichtgeklapt bord: laat SQL de rollup per order berekenen ('aggregate'), of
// anders alleen de data_json-velden leveren die de rollup nog leest ('fields'). Geeft null zodra
// geen van beide met zekerheid kan — de read leest dan de volledige blob, zoals voorheen.
async function planCollapsedDetailRead(input) {
  const plan = await time('tb_detail_plan', () => resolveCollapsedDetailPlan(input));
  // Welke leestak gekozen is, bepaalt volledig waar tb_read_details zijn tijd laat: de
  // rollup-aggregatie, de JSON_VALUE-projectie of de volledige blob-read. Zonder deze marker is
  // dat van buitenaf niet te zien en is een meting niet toe te rekenen.
  mark(`tb_detail_plan_${plan?.mode || 'none'}`);
  return plan;
}

// Mag de read terugvallen op de 'fields'-projectie (JSON_VALUE per veld, buildDetailProjectionSql)?
// Standaard niet. Gemeten op Azure, 21-09-2026: die projectie kost 44 s waar dezelfde read met de
// volledige data_json 4,6 s kost — ~73k detailregels, identieke SQL-server en -tier (zie
// .cursor/plans/2026-09-21-perf-dev-prod-gelijktrekken.plan.md, §5c en §5e). SQL Server parst de
// blob dan per rij per veld; Node parst hem één keer per rij en houdt bovendien alle velden over.
// De schakelaar blijft bestaan zodat beide takken meetbaar zijn zonder de code terug te draaien.
function fieldsProjectionEnabled() {
  const raw = String(process.env.PO_DETAIL_FIELDS_PROJECTION || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

async function resolveCollapsedDetailPlan({
  table, colsPromise, linksPromise, enrichmentPromise, syncStatePromise, viewedPromise,
}) {
  try {
    // De rollup heeft alleen kolommen, koppelingen en de items-filtercheck nodig. De
    // lookup-enrichment is uitsluitend voor de veldprojectie — staat die uit, dan wachten we er
    // ook niet op. Dat scheelt de detail-read de hele lookup-tijd (gemeten 0,9-1,6 s), want die
    // read wacht op dit plan.
    const [[, detailCols], runtimeLinks, itemsFilterActive] = await Promise.all([
      colsPromise, linksPromise, itemsLineFilterConfigured(table),
    ]);

    const rollupPlan = resolveCollapsedRollupPlan({ detailColumns: detailCols, runtimeLinks, itemsFilterActive });
    if (rollupPlan) {
      const [{ lastFullSyncAt }, lastViewedAt] = await Promise.all([syncStatePromise, viewedPromise]);
      const baselineMs = resolveLedgerSinceMs({ lastViewedAt, lastFullSyncAt });
      const baseline = { enabled: baselineMs !== null, exclusive: usesViewedBaseline(lastViewedAt) };
      return {
        mode: 'aggregate',
        rollupPlan,
        sql: buildCollapsedRollupSql(rollupPlan, baseline),
        baselineAt: baseline.enabled ? new Date(baselineMs) : null,
      };
    }

    if (!fieldsProjectionEnabled()) return null;
    return planCollapsedDetailFields({ detailCols, runtimeLinks, enrichment: await enrichmentPromise });
  } catch (err) {
    logger.warn('Leesplan voor collapsed detail-read mislukt; volledige data_json gelezen', {
      error: err.message,
    });
    return null;
  }
}

// Veldplan voor een collapsed detail-read: welke data_json-velden blijven er nodig als de
// sublijnen niet in de response komen. Geeft null zodra de set niet met zekerheid te bepalen is.
function planCollapsedDetailFields({ detailCols, runtimeLinks, enrichment }) {
  {
    const formulaReferences = new Map();
    for (const item of require('../TableDataService').compileFormulaColumns(detailCols)) {
      const key = String(item?.column?.key || '').trim().toLowerCase();
      const references = item?.compiled?.references;
      if (key && Array.isArray(references)) formulaReferences.set(key, [...references]);
    }
    // Het items-syncfilter matcht rechtstreeks op een JSON-veld van de regel; welk veld dat is
    // volgt uit de items-lookup, met itemNumber als vaste fallback.
    const itemsLookup = (enrichment?.lookups || []).find((lk) => (
      String(lk?.targetTableKey || '').trim().toLowerCase() === 'items' && lk.sourceScope === 'detail'
    ));
    const alwaysFields = ['itemNumber'];
    const itemsFilterField = String(itemsLookup?.sourceFieldKey || '').trim();
    if (itemsFilterField) alwaysFields.push(itemsFilterField);

    const fields = resolveCollapsedDetailFields({
      detailColumns: detailCols,
      runtimeLinks,
      lookups: enrichment?.lookups || [],
      alwaysFields,
      formulaReferences,
    });
    return fields ? { mode: 'fields', fields } : null;
  }
}

module.exports = {
  parseDefaultFilterRules,
  itemsLineFilterConfigured,
  planCollapsedDetailRead,
  fieldsProjectionEnabled,
  planCollapsedDetailFields,
};
