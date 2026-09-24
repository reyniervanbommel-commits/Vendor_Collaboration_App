'use strict';

const { parseJson } = require('./parseJson');
const { historyCellKey } = require('./historyCells');
const {
  buildValuesFromColumns,
  buildDetailRow,
  buildDetailRollup,
  buildRollupFromAggregate,
  applyAggregatedLinkedHeaderValues,
  detailMatchesItemsFilter,
} = require('./buildDetailRow');

function boardDeps() {
  return require('../TableDataService');
}

function assembleBoardRows(ctx) {
  const {
    masterRows, masterCols, detailsByRecord, rollupByRecord, rollupPlan,
    lineChangesByOrder, orderChanges, customByCell, enrichment, historyByCell,
    trackMarks, runtimeLinks, includeDetails, useLightDetails, detailContext,
    hasLedgerWindow, compareAgainstBaseline, compiledMasterFormulas, formulaToday,
    itemsLineFilterActive, itemsFilterField, itemsFilterKeys, MASTER_DETAIL_KEY,
    buildStats,
  } = ctx;
  const { applyLookups, applyFormulaColumnsToRowValues, applyRuntimeLinkedHeaderValues } = boardDeps();
  let newCount = 0;
  let changedCount = 0;
  const ordersHiddenByItemsFilter = new Set();
  const valuesFor = buildValuesFromColumns;
  const rows = masterRows.map((m) => {
    const recKey = `${m.partition_key}|${m.record_key}`;
    const masterJson = parseJson(m.data_json);
    const masterCustom = customByCell.get(`${m.partition_key}|${m.record_key}|${MASTER_DETAIL_KEY}`) || {};
    let hasLineChanges = false;
    let details = [];
    let detailRollup;
    if (rollupByRecord) {
      // SQL heeft de rollup al berekend; de losse regels zijn niet gelezen.
      const aggregate = rollupByRecord.get(recKey);
      detailRollup = buildRollupFromAggregate(aggregate, lineChangesByOrder.get(recKey), hasLedgerWindow);
      hasLineChanges = Boolean(detailRollup.hasNewLine || detailRollup.hasChangedLine);
    } else {
      let rawDetailRows = detailsByRecord.get(recKey) || [];
      if (itemsLineFilterActive) {
        rawDetailRows = rawDetailRows.filter((d) => detailMatchesItemsFilter(d, itemsFilterField, itemsFilterKeys));
        if (!rawDetailRows.length) ordersHiddenByItemsFilter.add(recKey);
      }
      const detailStart = process.hrtime.bigint();
      details = rawDetailRows.map((d) => {
        const detail = buildDetailRow(d, detailContext, { light: useLightDetails });
        if (detail.isNew || detail.isChanged) hasLineChanges = true;
        return detail;
      });
      buildStats.detailMs += Number(process.hrtime.bigint() - detailStart) / 1e6;
      buildStats.detailRows += rawDetailRows.length;
      detailRollup = buildDetailRollup(details);
      for (const detail of details) delete detail.hasRemovalChange;
    }

    const firstSeenMs = m.first_seen_at ? new Date(m.first_seen_at).getTime() : null;
    const changedMs = m.content_changed_at ? new Date(m.content_changed_at).getTime() : null;
    const orderLedgerState = orderChanges.get(recKey);
    const isBaseNew = compareAgainstBaseline(firstSeenMs);
    const isBaseChanged = compareAgainstBaseline(changedMs);
    const isNew = Boolean(orderLedgerState?.isNew) || (!hasLedgerWindow && isBaseNew);
    const isChanged = !isNew && (Boolean(orderLedgerState?.isChanged) || (!hasLedgerWindow && isBaseChanged) || hasLineChanges);
    const isRemovedAtSource = Boolean(m.removed_at_source) && !Boolean(m.sync_retained);
    const hasRemovalChange = Boolean(orderLedgerState?.isRemoved)
      || (!hasLedgerWindow && isRemovedAtSource);
    if (isNew) newCount += 1;
    else if (isChanged) changedCount += 1;

    const masterValues = valuesFor(masterCols, masterJson, masterCustom);
    applyLookups(masterValues, m.partition_key, enrichment.lookups, 'master', masterJson);
    const linkedLineValues = rollupByRecord
      ? applyAggregatedLinkedHeaderValues(masterValues, rollupByRecord.get(recKey), rollupPlan)
      : applyRuntimeLinkedHeaderValues(masterValues, details, runtimeLinks);
    const formulaErrors = applyFormulaColumnsToRowValues(masterValues, compiledMasterFormulas, { today: formulaToday });

    // Lege objecten/arrays laten we weg: de client vult ze zelf aan met dezelfde defaults, en bij
    // ~2000 rijen scheelt dat honderden kilobytes aan "historyByColumnId":{} in de payload.
    const masterCellKey = historyCellKey(m.partition_key, m.record_key, MASTER_DETAIL_KEY);
    const changedFieldKeys = [...(orderLedgerState?.changedFieldKeys || new Set())];
    const historyByColumnId = historyByCell.get(masterCellKey);
    const trackMarksByColumnId = trackMarks.trackMarksByCell.get(masterCellKey);

    return {
      partitionKey: m.partition_key,
      recordKey: m.record_key,
      removedAtSource: Boolean(m.removed_at_source),
      syncRetained: Boolean(m.sync_retained),
      isNew,
      isChanged,
      ...(hasRemovalChange ? { hasRemovalChange: true } : {}),
      ...(changedFieldKeys.length ? { changedFieldKeys } : {}),
      values: masterValues,
      ...(historyByColumnId ? { historyByColumnId } : {}),
      ...(trackMarksByColumnId ? { trackMarksByColumnId } : {}),
      ...(formulaErrors && Object.keys(formulaErrors).length ? { formulaErrors } : {}),
      ...(includeDetails ? { details } : {}),
      ...(Object.keys(linkedLineValues).length ? { linkedLineValues } : {}),
      ...detailRollup,
    };
  });
  return { rows, newCount, changedCount, ordersHiddenByItemsFilter };
}

module.exports = { assembleBoardRows };
