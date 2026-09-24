'use strict';

const { applyProductAttributePivot } = require('../productAttributePivot');
const { parseJson } = require('./parseJson');
const { historyCellKey } = require('./historyCells');

function boardDeps() {
  return require('../TableDataService');
}

// Kolomwaarden voor één cache-record. Gehoist uit read() zodat de detail-projectie
// gedeeld kan worden met readRowDetails (lazy laden bij expanden).
function buildValuesFromColumns(cols, sourceJson, custom) {
  const values = {};
  for (const col of cols) {
    if (boardDeps().isFormulaColumn(col)) values[col.key] = null;
    else if (col.source === 'source') values[col.key] = boardDeps().resolveSourceColumnValue(sourceJson, col);
    else values[col.key] = custom && col.key in custom ? custom[col.key] : null;
  }
  return values;
}

// Eén detailregel projecteren naar de board-vorm. ctx bundelt de gedeelde lookups die
// zowel de board-read als de per-order details-read opbouwen.
// Welke detailkolommen een ingeklapt bord écht nodig heeft: `itemNumber` voor de
// productImageSummary in buildDetailRollup, plus de lijnkolom van elke gekoppelde header-kolom.
// Geeft null zodra één daarvan géén direct bronveld is — een formule-, lookup-, custom- of
// product-attribuutkolom heeft juist het werk nodig dat de lichte weg overslaat.
function resolveLightDetailColumns({ detailCols = [], runtimeLinks = null } = {}) {
  const byKey = new Map();
  for (const column of detailCols) {
    const key = String(column?.key || '').trim().toLowerCase();
    if (key) byKey.set(key, column);
  }
  const isDirectSource = (column) => Boolean(column)
    && column.source === 'source'
    && !boardDeps().isFormulaColumn(column)
    && String(column?.options?.kind || '') !== 'product-attribute';

  const needed = new Map();
  const itemColumn = byKey.get('itemnumber');
  if (itemColumn) {
    if (!isDirectSource(itemColumn)) return null;
    needed.set('itemnumber', itemColumn);
  }
  for (const group of ['lineTotalHeaderLinks', 'lineValueHeaderLinks']) {
    for (const link of (Array.isArray(runtimeLinks?.[group]) ? runtimeLinks[group] : [])) {
      const key = String(link?.lineColumnKey || '').trim().toLowerCase();
      if (!key) continue;
      const column = byKey.get(key);
      if (!isDirectSource(column)) return null;
      needed.set(key, column);
    }
  }
  return [...needed.values()];
}

/**
 * @param {object} d - ruwe tb_cache-detailrij
 * @param {object} ctx - detailContext
 * @param {{ light?: boolean }} [options] - `light`: de regel gaat niet mee in de response en dient
 *   alleen als input voor buildDetailRollup en de gekoppelde header-kolommen. Dan blijven lookups,
 *   product-attributen, formules, history en track-marks achterwege — bij een ingeklapt bord is dat
 *   werk dat direct daarna wordt weggegooid, en dat voor elke van de ~73k regels. De vlaggen
 *   hieronder blijven bewust in dezelfde functie, zodat licht en volledig nooit uiteen kunnen lopen.
 */
function buildDetailRow(d, ctx, { light = false } = {}) {
  const {
    detailCols, lightDetailCols, customByCell, enrichment, historyByCell, trackMarks,
    lineChanges, compareAgainstBaseline, hasLedgerWindow,
  } = ctx;
  const detailCustom = customByCell.get(`${d.partition_key}|${d.record_key}|${d.detail_key}`) || {};
  const detailJson = parseJson(d.data_json);
  const detailValues = buildValuesFromColumns(
    light ? (lightDetailCols || detailCols) : detailCols,
    detailJson,
    detailCustom,
  );
  let pavExtras = null;
  if (!light) {
    // De drie zware stappen apart optellen (ctx.stats), zodat Server-Timing laat zien waar de
    // detail-opbouw zijn tijd laat. Zonder die splitsing is tb_build_rows één ondeelbaar getal en
    // is niet te zeggen welk deel weg kan. Kost ~3 hrtime-paren per regel, onder 1% van de post.
    const stats = ctx.stats;
    const tick = () => (stats ? process.hrtime.bigint() : null);
    const add = (key, from) => {
      if (stats && from !== null) stats[key] += Number(process.hrtime.bigint() - from) / 1e6;
    };

    let t = tick();
    const detailLookupSource = boardDeps().buildDetailLookupSourceValues(detailJson, d.record_key, d.detail_key);
    boardDeps().applyLookups(detailValues, d.partition_key, enrichment.lookups, 'detail', detailLookupSource);
    add('lookupMs', t);

    t = tick();
    pavExtras = applyProductAttributePivot(
      detailValues,
      detailValues.itemNumber || detailJson.itemNumber || detailJson.ItemNumber,
      ctx.pavPivot,
      ctx.pavColumns,
    );
    add('pavMs', t);

    t = tick();
    if (Array.isArray(ctx.compiledDetailFormulas) && ctx.compiledDetailFormulas.length) {
      boardDeps().applyFormulaColumnsToRowValues(detailValues, ctx.compiledDetailFormulas, { today: ctx.formulaToday });
    }
    boardDeps().fillEmptyNumberFromFallback(detailValues, 'deliverRemainder', 'remainingPurchaseQuantity');
    boardDeps().fillEmptyNumberFromFallback(detailValues, 'deliverRemainderApprox', 'remainingPurchaseQuantity');
    add('formulaMs', t);
  }
  const cellKey = historyCellKey(d.partition_key, d.record_key, d.detail_key);
  const ledgerState = lineChanges.get(`${d.partition_key}|${d.record_key}|${d.detail_key}`);
  const detailFirstSeenMs = d.first_seen_at ? new Date(d.first_seen_at).getTime() : null;
  const detailChangedMs = d.content_changed_at ? new Date(d.content_changed_at).getTime() : null;
  const isNew = Boolean(ledgerState?.isNew) || (!hasLedgerWindow && compareAgainstBaseline(detailFirstSeenMs));
  const isChanged = !isNew
    && (Boolean(ledgerState?.isChanged) || (!hasLedgerWindow && compareAgainstBaseline(detailChangedMs)));
  const isRemovedAtSource = Boolean(d.removed_at_source);
  // isRemoved = de regel is nu weg in D365 (blijvende staat, o.a. strikethrough / RCCP).
  // hasRemovalChange = ongeziene DELETE in het ledger-venster; Mark as seen moet díe vlag wissen.
  const hasRemovalChange = Boolean(ledgerState?.isRemoved)
    || (!hasLedgerWindow && isRemovedAtSource);
  const isRemoved = isRemovedAtSource || Boolean(ledgerState?.isRemoved);
  if (light) {
    // Precies wat buildDetailRollup en applyRuntimeLinkedHeaderValues lezen, niets meer.
    return {
      values: detailValues,
      isNew,
      isChanged,
      isRemoved,
      hasRemovalChange,
      changedFieldKeys: [...(ledgerState?.changedFieldKeys || new Set())],
    };
  }
  const detailHistory = historyByCell.get(cellKey);
  const detailTrackMarks = trackMarks.trackMarksByCell.get(cellKey);
  return {
    detailKey: d.detail_key,
    values: detailValues,
    ...(detailHistory ? { historyByColumnId: detailHistory } : {}),
    ...(detailTrackMarks ? { trackMarksByColumnId: detailTrackMarks } : {}),
    isNew,
    isChanged,
    isRemoved,
    hasRemovalChange,
    changedFieldKeys: [...(ledgerState?.changedFieldKeys || new Set())],
    ...(pavExtras ? { pavExtras } : {}),
  };
}

// Sleutel om een PO-regel-item te vergelijken met de items-cache. Het itemnummer is de record_key
// van de items-tabel (niet een veld in de item-json), dus we matchen op partition|itemnummer.
function buildItemFilterKey(partitionKey, itemNumber) {
  const value = String(itemNumber ?? '').trim();
  if (!value) return null;
  return `${String(partitionKey || '').trim().toLowerCase()}|${value}`;
}

// Bepaalt of een PO-detailregel binnen de actieve items-syncfilter valt. allowedItemKeys bevat de
// aanwezige (removed_at_source = 0) item-record_keys = de gefilterde set na de sync. Alleen
// aangeroepen wanneer er een items-filter actief is (anders geen extra kosten op het hot-path).
function detailMatchesItemsFilter(d, itemFieldKey, allowedItemKeys) {
  const detailJson = parseJson(d.data_json);
  const key = buildItemFilterKey(d.partition_key, detailJson?.[itemFieldKey]);
  return Boolean(key) && allowedItemKeys.has(key);
}

// Wat het board van de sublijnen nodig heeft zolang de order dichtgeklapt is.
// Hiermee kan details[] uit de board-payload blijven.
function buildDetailRollup(details) {
  const seenItemNumbers = new Set();
  let firstItemNumber = '';
  let uniqueItemCount = 0;
  let hasNewLine = false;
  let hasChangedLine = false;
  let hasRemovedLine = false;

  for (const detail of details) {
    if (detail.isNew) hasNewLine = true;
    if (detail.isChanged || detail.changedFieldKeys?.length) hasChangedLine = true;
    // Alleen ongeziene removals; historisch removed-at-source mag de activity-bar niet vullen.
    if (detail.hasRemovalChange) hasRemovedLine = true;
    if (detail.isRemoved) continue;
    const itemNumber = String(detail.values?.itemNumber ?? '').trim();
    if (!itemNumber || seenItemNumbers.has(itemNumber)) continue;
    seenItemNumbers.add(itemNumber);
    if (!firstItemNumber) firstItemNumber = itemNumber;
    uniqueItemCount += 1;
  }

  // Alleen wat waar is meesturen; de client vult de rest met false/lege defaults.
  return {
    detailCount: details.length,
    ...(hasNewLine ? { hasNewLine } : {}),
    ...(hasChangedLine ? { hasChangedLine } : {}),
    ...(hasRemovedLine ? { hasRemovedLine } : {}),
    ...(firstItemNumber
      ? { productImageSummary: { firstItemNumber, additionalItemCount: Math.max(uniqueItemCount - 1, 0) } }
      : {}),
  };
}

// Dezelfde rollup als buildDetailRollup(), maar uit de SQL-aggregatie. De activiteitsvlaggen komen
// uit het change-ledger zodra er een ledger-venster is; anders uit de baseline-vergelijking die de
// aggregatiequery al per regel heeft gedaan.
function buildRollupFromAggregate(aggregate, ledgerSummary, hasLedgerWindow) {
  const hasNewLine = hasLedgerWindow ? Boolean(ledgerSummary?.hasNewLine) : Boolean(aggregate?.hasNewLine);
  const hasChangedLine = hasLedgerWindow
    ? Boolean(ledgerSummary?.hasChangedLine)
    : Boolean(aggregate?.hasChangedLine);
  const hasRemovedLine = hasLedgerWindow
    ? Boolean(ledgerSummary?.hasRemovedLine)
    : Boolean(aggregate?.hasRemovedLine);
  const firstItemNumber = aggregate?.firstItemNumber || '';
  const additionalItemCount = Math.max((aggregate?.uniqueItemCount || 0) - 1, 0);

  return {
    detailCount: aggregate?.detailCount || 0,
    ...(hasNewLine ? { hasNewLine } : {}),
    ...(hasChangedLine ? { hasChangedLine } : {}),
    ...(hasRemovedLine ? { hasRemovedLine } : {}),
    ...(firstItemNumber ? { productImageSummary: { firstItemNumber, additionalItemCount } } : {}),
  };
}

// Tegenhanger van applyRuntimeLinkedHeaderValues() voor de geaggregeerde read. Loopt over de
// koppelingen uit het plan (niet over de aggregatie) zodat een order zonder regels dezelfde lege
// waarden krijgt als voorheen: 0 voor een totaal, '-' voor een waardelijst.
function applyAggregatedLinkedHeaderValues(masterValues, aggregate, rollupPlan) {
  if (!masterValues || typeof masterValues !== 'object' || !rollupPlan) return {};
  for (const link of rollupPlan.totalLinks) {
    masterValues[link.headerColumnKey] = aggregate?.totals?.[link.headerColumnKey] ?? 0;
  }
  const linkedLineValues = {};
  for (const link of rollupPlan.valueLinks) {
    const list = aggregate?.values?.[link.headerColumnKey] || [];
    const texts = list.map((raw) => String(raw).trim());
    masterValues[link.headerColumnKey] = texts.length ? texts.join(', ') : '-';
    linkedLineValues[link.headerColumnKey] = list;
  }
  return linkedLineValues;
}

module.exports = {
  buildValuesFromColumns,
  resolveLightDetailColumns,
  buildDetailRow,
  buildItemFilterKey,
  detailMatchesItemsFilter,
  buildDetailRollup,
  buildRollupFromAggregate,
  applyAggregatedLinkedHeaderValues,
};
