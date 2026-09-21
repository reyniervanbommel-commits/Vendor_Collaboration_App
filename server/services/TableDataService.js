'use strict';

// Generieke, tableKey-gedreven datalaag voor de Table Builder (#AB:152, Fase A). Bron-neutraal:
// lezen gaat uit tb_cache (cache-is-leidend); de bron wordt alleen geraadpleegd bij refresh. De projectie
// is config-gedreven: per tabel bepalen de actieve bron-kolommen (tb_columns, source='source') wélke
// velden in data_json landen.
//
// Fase A gebruikt een interne fetch-adapter per tabel; in Fase B (#139) wordt dit vervangen door de
// SourceProvider-interface (D365ODataProvider.fetch/discoverFields). Write-back (correctField) blijft in
// Fase A nog op het bestaande po_*-pad en wordt in Fase C generiek via de provider.

const crypto = require('crypto');
const sql = require('mssql');
const { logger } = require('../utils/logger');
const settingsService = require('./SettingsService');
const {
  fetchPurchaseOrders,
  fetchPurchaseOrdersByKeys,
  fetchEntityRecords,
  fetchVendorAccountsByGroups,
  escapeODataLiteral,
  writeBackField,
} = require('./D365ODataService');
const { getPool, getTableByKey, listColumns, getLookups, invalidateTableCache, listRefreshCascadeTargets } = require('./TableRegistryService');
const trackChangesService = require('./TrackChangesService');
const { MARK_COUNT, buildMarkPattern } = require('../utils/trackChangeMarks');
const {
  loadRuntimeHeaderLinks,
  loadStaffRuntimeHeaderLinks,
  annotateAdminColumnsWithLineLinks,
} = require('../utils/runtimeHeaderLinks');
const { compileSyncRules, compileSyncRulesChunks, firstSyncFilterChunk, parseSyncRules, recordMatchesSyncRules, normalizeSyncLayers, recordMatchesAnyLayer, compileSyncLayerChunks, OPERATORS, MAX_RULES, MAX_LAYERS } = require('../utils/odataSyncFilter');
const {
  listStaleSourceColumns,
  lookupRawFieldValue,
  isEmptySampleValue,
  formatSampleValue,
  fillMissingSamplesFromRawRows,
  sampleMapFromDiscoveredFields,
  formatSelectDropNotice,
  inferSourceDataType,
  listSourceColumnsToPromote,
} = require('../utils/discoverSourceColumns');
const {
  listVendorGroupIds,
  expandVendorGroupRules,
  collectAccountsFromVendorRows,
  vendorGroupCatalogEntry,
  isRecommendedFilterField,
  isVendorGroupRule,
} = require('../utils/vendorGroupSyncFilter');
const { getSyncRetentionSettings, resolveRetentionWarning } = require('../utils/syncRetentionSettings');
const { compileFormula, evaluateCompiledFormula, getUtcMidnight } = require('../utils/tableFormulaEngine');
const { time, mark } = require('../utils/timing');
const {
  resolveCollapsedDetailFields,
  buildDetailJsonFromProjection,
  buildDetailProjectionSql,
} = require('../utils/collapsedDetailFields');
const {
  resolveCollapsedRollupPlan,
  buildCollapsedRollupSql,
  parseCollapsedRollupRows,
} = require('../utils/collapsedDetailRollup');
const { valuesEqualForConcurrency } = require('../utils/odataValueEquals');
const {
  planFanout,
  remainingValuesAfterPass,
  isBusinessWriteBackError,
} = require('../utils/detailCorrectionFanout');
const { ROLES } = require('../constants/roles');
const { resolveLedgerSinceMs, usesViewedBaseline } = require('../utils/ledgerWindow');
const { countMergeActions, countSoftDeleted } = require('../utils/refreshRunCounts');
const { orderLookupTargetKeys, formatEntityRefreshError } = require('../utils/refreshCascadeOrder');
const { chunkList, combineODataFilters, buildOneOfFilterClause } = require('../utils/odataFilterCombine');
const { productAttributeValuesFetch } = require('./productAttributeValuesFetch');
const { applyProductAttributePivot, loadProductAttributePivot } = require('./productAttributePivot');
const { assertNotPavWritable } = require('../utils/productAttributeValues');
const { accumulateChunkFetchProgress } = require('../utils/refreshProgress');
const {
  FORBIDDEN_HEADER_D365_FIELDS,
  FORBIDDEN_LINE_D365_FIELDS,
  buildD365SelectFields,
} = require('../utils/d365SelectFields');
const refreshRunService = require('./RefreshRunService');

const MASTER_DETAIL_KEY = -1; // sentinel: master-rij / master-niveau custom-waarde
const MAX_KEY_LENGTH = 64;
const FIELD_DISCOVERY_SAMPLE_LIMIT = 800;
const DATA_MODEL_PREVIEW_ROW_LIMIT = 60;
const MAX_BOARD_LINKS = 80;
// Aantal masterrecords per save-batch. De save schrijft per chunk set-based weg (bulk copy naar een
// staging-temptabel + één MERGE), i.p.v. een transactie + losse INSERTs per order/regel. Dat brengt het
// aantal SQL-round-trips van O(orders × regels) terug naar O(chunks), de grootste refresh-versneller.
const SAVE_CHUNK_SIZE = 500;
// Tabellen waarvan de D365-fetch wordt beperkt tot de sleutelwaarden die via lookups aan de
// PO-cache hangen (PO lookup scope). 'items' houdt deze scope én krijgt daarnaast een eigen
// bewerkbaar sync-filter dat binnen die scope wordt gecombineerd (AND).
const PO_LOOKUP_SCOPED_TABLE_KEYS = new Set(['vendors', 'items', 'product-receipt-lines']);
// Tabellen waarvan het sync-filter in de admin-UI/API read-only is (erven de PO-filter, geen eigen
// regels). 'items' staat hier bewust NIET in: die krijgt een eigen filter binnen de PO lookup scope.
const READ_ONLY_SYNC_FILTER_TABLE_KEYS = new Set(['vendors', 'product-receipt-lines']);
const INHERITED_FILTER_CHUNK_SIZE = 20;
const EMPTY_REFRESH_PROGRESS = Object.freeze({
  status: 'idle',
  fetched: 0,
  totalToFetch: null,
  saved: 0,
  totalToSave: null,
  sourceTotal: null,
  pagesFetched: 0,
  truncated: false,
  retainedTotal: 0,
  retainedFetched: 0,
  retainedPhase: 'idle',
  retentionCapReached: false,
  retentionFetchTruncated: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  updatedAt: null,
});
const refreshProgressByTable = new Map();
const refreshJobsByTable = new Map();

function createRefreshProgressBase() {
  return { ...EMPTY_REFRESH_PROGRESS };
}

function resetRefreshProgress(tableKey, patch = {}) {
  const key = String(tableKey || '').trim();
  if (!key) return;
  refreshProgressByTable.set(key, {
    ...createRefreshProgressBase(),
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function updateRefreshProgress(tableKey, patch = {}) {
  const key = String(tableKey || '').trim();
  if (!key) return;
  const current = refreshProgressByTable.get(key) || createRefreshProgressBase();
  refreshProgressByTable.set(key, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function getRefreshProgress(tableKey) {
  const key = String(tableKey || '').trim();
  if (!key) return createRefreshProgressBase();
  return { ...(refreshProgressByTable.get(key) || createRefreshProgressBase()) };
}

function isRefreshRunning(tableKey) {
  const key = String(tableKey || '').trim();
  if (!key) return false;
  return refreshJobsByTable.has(key);
}

async function resolveCascadeEntityKeys() {
  try {
    const table = await getTableByKey('purchase-orders');
    const targets = await listRefreshCascadeTargets(table.id);
    const ordered = await orderLookupTargetKeys(targets, getTableByKey);
    return ['purchase-orders', ...ordered];
  } catch {
    return ['purchase-orders'];
  }
}

async function startRefresh(tableKey, options = {}) {
  const key = String(tableKey || '').trim();
  if (!key) throw Object.assign(new Error('Invalid table key'), { status: 400 });
  const source = options.source === 'night' ? 'night' : 'manual';
  const triggeredByUserId = options.triggeredByUserId || null;
  if (refreshJobsByTable.has(key)) {
    if (source === 'night' && key === 'purchase-orders') {
      const attached = refreshRunService.attachNight();
      return {
        started: false,
        running: true,
        attached: true,
        runId: attached.runId,
        progress: getRefreshProgress(key),
      };
    }
    return {
      started: false,
      running: true,
      attached: false,
      runId: refreshRunService.getActiveRunId(),
      progress: getRefreshProgress(key),
    };
  }
  resetRefreshProgress(key, {
    status: 'fetching',
    fetched: 0,
    totalToFetch: null,
    saved: 0,
    totalToSave: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  });
  if (key === 'purchase-orders') {
    await refreshRunService.beginPurchaseOrderRun({
      source,
      triggeredByUserId,
      entityKeys: await resolveCascadeEntityKeys(),
    });
  }
  const job = (async () => {
    try {
      await refresh(key);
      if (key === 'purchase-orders') {
        await refreshRunService.finishSuccess();
      }
    } catch (err) {
      logger.error('Achtergrond-refresh mislukt', { tableKey: key, error: err.message });
      if (key === 'purchase-orders') {
        await refreshRunService.failPurchaseOrders(err.message);
      }
    } finally {
      refreshJobsByTable.delete(key);
    }
  })();
  refreshJobsByTable.set(key, job);
  return {
    started: true,
    running: true,
    attached: false,
    runId: refreshRunService.getActiveRunId(),
    progress: getRefreshProgress(key),
  };
}

// ---------------------------------------------------------------------------
// Fetch-adapters: vertalen een bron naar generieke records {partitionKey, recordKey, master, details}.
// TODO (Fase B / #139): vervang door SourceProvider.fetch(), geresolved uit tb_sources.provider_type.
// ---------------------------------------------------------------------------
function mapPurchaseOrderRecordsToCacheRecords(items, company) {
  return (Array.isArray(items) ? items : []).map((order) => {
    const raw = order.raw || {};
    return {
      partitionKey: String(raw.dataAreaId || company || '').trim(),
      recordKey: String(order.orderNumber || raw.PurchaseOrderNumber || '').trim(),
      modifiedAt: raw.ModifiedDateTime || null,
      masterRaw: raw,
      master: {
        orderNumber: order.orderNumber,
        vendorAccount: order.vendorAccount,
        vendorName: order.vendorName,
        status: order.status,
        currencyCode: order.currencyCode,
        requestedDeliveryDate: order.requestedDeliveryDate,
        createdDateTime: order.createdDateTime,
      },
      details: (Array.isArray(order.lines) ? order.lines : []).map((line) => ({
        detailKey: toNumberOrNull(line.lineNumber),
        raw: line.raw || {},
        values: {
          lineNumber: line.lineNumber,
          itemNumber: line.itemNumber,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          lineAmount: line.lineAmount,
          currencyCode: line.currencyCode,
          requestedDeliveryDate: line.requestedDeliveryDate,
        },
      })),
    };
  }).filter((rec) => rec.partitionKey && rec.recordKey);
}

async function clearSyncRetainedForTable(pool, tableId) {
  await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      UPDATE dbo.tb_cache
      SET sync_retained = 0, sync_retained_at = NULL
      WHERE table_id = @tableId AND scope = 'master'
    `);
}

async function markOutOfScopeCacheRows(pool, tableId, syncLayers) {
  const rules = Array.isArray(syncLayers) ? syncLayers.filter((layer) => layer && layer.active) : [];
  if (!rules.length) return { marked: 0 };
  const hasLineRules = rules.some((layer) => (layer.rules || []).some((rule) => String(rule?.level || 'header').trim() === 'line'));
  const masters = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT partition_key, record_key, data_json
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId AND scope = 'master' AND sync_retained = 0
    `);
  const detailJsonByRecord = hasLineRules
    ? await loadDetailJsonByRecord(
      pool,
      tableId,
      (masters.recordset || []).map((row) => `${row.partition_key}|${row.record_key}`)
    )
    : new Map();

  const outOfScopeKeys = [];
  for (const row of masters.recordset || []) {
    const headerJson = parseJson(row.data_json);
    const lineRecords = detailJsonByRecord.get(`${row.partition_key}|${row.record_key}`) || [];
    if (!recordMatchesAnyLayer(rules, headerJson, lineRecords)) {
      outOfScopeKeys.push({ partitionKey: row.partition_key, recordKey: row.record_key });
    }
  }
  if (!outOfScopeKeys.length) return { marked: 0 };

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const { partitionKey, recordKey } of outOfScopeKeys) {
      await new sql.Request(tx)
        .input('tableId', sql.BigInt, tableId)
        .input('partitionKey', sql.NVarChar(32), partitionKey)
        .input('recordKey', sql.NVarChar(128), recordKey)
        .query(`
          UPDATE dbo.tb_cache
          SET removed_at_source = 1
          WHERE table_id = @tableId AND scope = 'master'
            AND partition_key = @partitionKey AND record_key = @recordKey
            AND detail_key = ${MASTER_DETAIL_KEY}
            AND sync_retained = 0
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  return { marked: outOfScopeKeys.length };
}

/**
 * Herstelt cache-rijen die weer binnen scope vallen (bv. een laag is opnieuw geactiveerd) direct,
 * zonder op de volgende nachtrun te wachten. Tegenhanger van markOutOfScopeCacheRows (#325).
 */
async function unmarkInScopeCacheRows(pool, tableId, syncLayers) {
  const layers = Array.isArray(syncLayers) ? syncLayers.filter((layer) => layer && layer.active) : [];
  if (!layers.length) return { unmarked: 0 };
  const hasLineRules = layers.some((layer) => (layer.rules || []).some((rule) => String(rule?.level || 'header').trim() === 'line'));
  const removedMasters = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT partition_key, record_key, data_json
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId AND scope = 'master' AND removed_at_source = 1 AND sync_retained = 0
    `);
  const detailJsonByRecord = hasLineRules
    ? await loadDetailJsonByRecord(
      pool,
      tableId,
      (removedMasters.recordset || []).map((row) => `${row.partition_key}|${row.record_key}`)
    )
    : new Map();

  const inScopeKeys = [];
  for (const row of removedMasters.recordset || []) {
    const headerJson = parseJson(row.data_json);
    const lineRecords = detailJsonByRecord.get(`${row.partition_key}|${row.record_key}`) || [];
    if (recordMatchesAnyLayer(layers, headerJson, lineRecords)) {
      inScopeKeys.push({ partitionKey: row.partition_key, recordKey: row.record_key });
    }
  }
  if (!inScopeKeys.length) return { unmarked: 0 };

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const { partitionKey, recordKey } of inScopeKeys) {
      await new sql.Request(tx)
        .input('tableId', sql.BigInt, tableId)
        .input('partitionKey', sql.NVarChar(32), partitionKey)
        .input('recordKey', sql.NVarChar(128), recordKey)
        .query(`
          UPDATE dbo.tb_cache
          SET removed_at_source = 0
          WHERE table_id = @tableId AND scope = 'master'
            AND partition_key = @partitionKey AND record_key = @recordKey
            AND detail_key = ${MASTER_DETAIL_KEY}
            AND removed_at_source = 1
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  return { unmarked: inScopeKeys.length };
}

async function countSyncRetainedMasters(pool, tableId) {
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT COUNT(*) AS retained_count
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId AND scope = 'master' AND sync_retained = 1
    `);
  return Number(result.recordset?.[0]?.retained_count) || 0;
}

async function loadDetailJsonByRecord(pool, tableId, recordKeys) {
  const keys = Array.isArray(recordKeys) ? recordKeys : [];
  if (!keys.length) return new Map();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT partition_key, record_key, data_json
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId AND scope = 'detail'
    `);
  const wanted = new Set(keys);
  const grouped = new Map();
  for (const row of result.recordset || []) {
    const recKey = `${row.partition_key}|${row.record_key}`;
    if (!wanted.has(recKey)) continue;
    if (!grouped.has(recKey)) grouped.set(recKey, []);
    grouped.get(recKey).push(parseJson(row.data_json));
  }
  return grouped;
}

async function applySyncRetainedTransitions(pool, table, removedMasters, retentionSettings, syncLayers) {
  const rules = Array.isArray(syncLayers) ? syncLayers.filter((layer) => layer && layer.active) : [];
  const rawCandidates = (removedMasters.recordset || []).filter((row) => (
    Number(row.previous_removed) === 0 && Number(row.removed_at_source) === 1
  ));
  const hasLineRules = rules.some((layer) => (layer.rules || []).some((rule) => String(rule?.level || 'header').trim() === 'line'));
  const detailJsonByRecord = hasLineRules
    ? await loadDetailJsonByRecord(
      pool,
      table.id,
      rawCandidates.map((row) => `${row.partition_key}|${row.record_key}`)
    )
    : new Map();
  const candidates = rawCandidates.filter((row) => {
    if (!rules.length) return true;
    const headerJson = parseJson(row.data_json);
    const lineRecords = detailJsonByRecord.get(`${row.partition_key}|${row.record_key}`) || [];
    return recordMatchesAnyLayer(rules, headerJson, lineRecords);
  });
  if (!candidates.length) {
    return { retainedAdded: 0, capReached: false, retainedKeys: new Set() };
  }

  const currentRetained = await countSyncRetainedMasters(pool, table.id);
  const slotsLeft = Math.max(retentionSettings.maxAuto - currentRetained, 0);
  if (!slotsLeft) {
    return { retainedAdded: 0, capReached: true, retainedKeys: new Set() };
  }

  const exclusionRes = await pool.request()
    .input('tableId', sql.BigInt, table.id)
    .query(`
      SELECT partition_key, record_key
      FROM dbo.tb_row_exclusions WITH (NOLOCK)
      WHERE table_id = @tableId
    `);
  const excluded = new Set(
    (exclusionRes.recordset || []).map((row) => `${row.partition_key}|${row.record_key}`)
  );

  const toRetain = candidates
    .filter((row) => !excluded.has(`${row.partition_key}|${row.record_key}`))
    .slice(0, slotsLeft);
  if (!toRetain.length) {
    return { retainedAdded: 0, capReached: slotsLeft <= 0, retainedKeys: new Set() };
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const row of toRetain) {
      await new sql.Request(tx)
        .input('tableId', sql.BigInt, table.id)
        .input('partitionKey', sql.NVarChar(32), row.partition_key)
        .input('recordKey', sql.NVarChar(128), row.record_key)
        .query(`
          UPDATE dbo.tb_cache
          SET sync_retained = 1, sync_retained_at = SYSUTCDATETIME()
          WHERE table_id = @tableId AND scope = 'master'
            AND partition_key = @partitionKey AND record_key = @recordKey
            AND detail_key = ${MASTER_DETAIL_KEY}
            AND sync_retained = 0
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return {
    retainedAdded: toRetain.length,
    capReached: toRetain.length < candidates.filter((row) => !excluded.has(`${row.partition_key}|${row.record_key}`)).length,
    retainedKeys: new Set(toRetain.map((row) => `${row.partition_key}|${row.record_key}`)),
  };
}

async function listRetainedOrderKeys(pool, tableId, fetchBudget) {
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('fetchBudget', sql.Int, fetchBudget)
    .query(`
      SELECT TOP (@fetchBudget) c.partition_key, c.record_key
      FROM dbo.tb_cache c WITH (NOLOCK)
      WHERE c.table_id = @tableId
        AND c.scope = 'master'
        AND c.sync_retained = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.tb_row_exclusions ex WITH (NOLOCK)
          WHERE ex.table_id = @tableId
            AND ex.partition_key = c.partition_key
            AND ex.record_key = c.record_key
        )
      ORDER BY c.sync_retained_at ASC, c.record_key ASC
    `);
  return (result.recordset || []).map((row) => ({
    dataAreaId: row.partition_key,
    orderNumber: row.record_key,
  }));
}

/**
 * Zet retained orders (en hun regels) terug op "aanwezig" na de blanket soft-delete.
 *
 * Uitgesloten rijen (tb_row_exclusions) blijven met rust: die heeft iemand bewust van het bord
 * gehaald. Retourneert het aantal herstelde rijen, puur voor logging.
 */
async function restoreRetainedRowsPresence(pool, tableId) {
  const res = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      UPDATE c
      SET c.removed_at_source = 0
      FROM dbo.tb_cache c
      WHERE c.table_id = @tableId AND c.scope = 'master'
        AND c.sync_retained = 1 AND c.removed_at_source = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.tb_row_exclusions ex
          WHERE ex.table_id = @tableId
            AND ex.partition_key = c.partition_key AND ex.record_key = c.record_key
        );

      UPDATE d
      SET d.removed_at_source = 0
      FROM dbo.tb_cache d
      INNER JOIN dbo.tb_cache m
        ON m.table_id = d.table_id AND m.scope = 'master'
        AND m.partition_key = d.partition_key AND m.record_key = d.record_key
        AND m.sync_retained = 1 AND m.removed_at_source = 0
      WHERE d.table_id = @tableId AND d.scope = 'detail' AND d.removed_at_source = 1;
    `);
  return (res.rowsAffected || []).reduce((sum, n) => sum + n, 0);
}

async function refreshRetainedPurchaseOrders({
  pool,
  table,
  refreshStart,
  refreshJobId,
  masterSource,
  detailSource,
  selectFields,
  lineSelectFields,
  retentionSettings,
  tableKey,
  skipLedger = false,
}) {
  const retainedKeys = await listRetainedOrderKeys(pool, table.id, retentionSettings.fetchBudget);
  const retainedTotal = await countSyncRetainedMasters(pool, table.id);
  if (!retainedKeys.length) {
    return {
      retainedTotal,
      retainedFetched: 0,
      retentionFetchTruncated: retainedTotal > 0,
    };
  }

  updateRefreshProgress(tableKey, {
    retainedPhase: 'fetching',
    retainedTotal,
    retainedFetched: 0,
  });

  const company = (await settingsService.getAsync('D365_ODATA_COMPANY', '')).trim();
  const retainedResult = await fetchPurchaseOrdersByKeys({
    keys: retainedKeys,
    selectFields,
    lineSelectFields,
    maxItems: retentionSettings.fetchBudget,
    onProgress: (progress) => {
      updateRefreshProgress(tableKey, {
        retainedPhase: 'fetching',
        retainedTotal,
        retainedFetched: Number(progress?.fetched) || 0,
      });
    },
  });
  if (retainedResult.droppedSelectFields?.length) {
    await applyDroppedSelectFields(table, retainedResult.droppedSelectFields);
  }
  const retainedRecords = mapPurchaseOrderRecordsToCacheRecords(retainedResult.items, company);
  updateRefreshProgress(tableKey, {
    retainedPhase: 'saving',
    retainedTotal,
    retainedFetched: retainedRecords.length,
  });

  let saved = 0;
  for (let offset = 0; offset < retainedRecords.length; offset += SAVE_CHUNK_SIZE) {
    const chunk = retainedRecords.slice(offset, offset + SAVE_CHUNK_SIZE);
    const { saved: chunkSaved } = await persistRecordsChunk(
      pool,
      table,
      chunk,
      refreshStart,
      masterSource,
      detailSource,
      refreshJobId,
      skipLedger
    );
    saved += chunkSaved;
    updateRefreshProgress(tableKey, {
      retainedPhase: 'saving',
      retainedTotal,
      retainedFetched: saved,
    });
  }

  return {
    retainedTotal,
    retainedFetched: saved,
    retentionFetchTruncated: Boolean(retainedResult.truncated) || retainedTotal > retainedKeys.length,
  };
}

function parseDefaultFilterRules(defaultFilter) {
  if (!defaultFilter) return [];
  try {
    const parsed = JSON.parse(defaultFilter);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function resolvePurchaseOrderSelectFields(table) {
  const selectEnabled = String(await settingsService.getAsync('D365_ODATA_SELECT_ENABLED', 'true'))
    .trim().toLowerCase() !== 'false';
  if (!selectEnabled) {
    return { selectFields: null, lineSelectFields: null };
  }
  const [masterCols, detailCols] = await Promise.all([
    listColumns({ tableId: table.id, scope: 'master', includeInactive: false }),
    listColumns({ tableId: table.id, scope: 'detail', includeInactive: false }),
  ]);
  return {
    selectFields: buildD365SelectFields(REQUIRED_HEADER_D365_FIELDS, masterCols, FORBIDDEN_HEADER_D365_FIELDS),
    lineSelectFields: buildD365SelectFields(REQUIRED_LINE_D365_FIELDS, detailCols, FORBIDDEN_LINE_D365_FIELDS),
  };
}

async function purchaseOrdersFetch(table, { onProgress } = {}) {
  const company = (await settingsService.getAsync('D365_ODATA_COMPANY', '')).trim();
  const rawMax = await settingsService.getAsync('PO_SYNC_MAX_ORDERS', String(table.maxRows || 2500));
  const maxItems = resolveConfiguredMaxItems(rawMax, table.maxRows, 2500);
  let filterChunks = [''];
  try {
    const layers = await getTableSyncLayers(table);
    const resolvedLayers = await resolveSyncLayers(layers, { forD365: true });
    filterChunks = compileSyncLayerChunks(resolvedLayers);
  } catch (err) {
    logger.warn('PO_SYNC_RULES ongeldig; generieke table-sync draait zonder filterregels', { error: err.message });
  }
  const { selectFields, lineSelectFields } = await resolvePurchaseOrderSelectFields(table);
  let activeSelectFields = selectFields;
  let activeLineSelectFields = lineSelectFields;
  const droppedSelectFields = [];
  const seen = new Map();
  let total = 0;
  let truncated = false;
  if (typeof onProgress === 'function') {
    onProgress({ fetched: 0, totalToFetch: maxItems, sourceTotal: null, pagesFetched: 0, truncated: false });
  }
  for (const chunkFilter of filterChunks) {
    const remaining = maxItems - seen.size;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const completedCount = seen.size;
    const result = await fetchPurchaseOrders({
      supplierAccount: null,
      fetchAll: true,
      extraFilter: chunkFilter,
      maxItems: remaining,
      onProgress: typeof onProgress === 'function'
        ? (progress) => onProgress(accumulateChunkFetchProgress(completedCount, progress, maxItems))
        : undefined,
      selectFields: activeSelectFields,
      lineSelectFields: activeLineSelectFields,
    });
    if (result.droppedSelectFields?.length) {
      droppedSelectFields.push(...result.droppedSelectFields);
      activeSelectFields = narrowSelectFields(activeSelectFields, result.droppedSelectFields);
      activeLineSelectFields = narrowSelectFields(activeLineSelectFields, result.droppedSelectFields);
    }
    total += Number(result.total) || 0;
    truncated = truncated || Boolean(result.truncated);
    for (const item of Array.isArray(result.items) ? result.items : []) {
      const raw = item?.raw || {};
      const key = `${String(raw.dataAreaId || company || '').trim()}|${String(item.orderNumber || raw.PurchaseOrderNumber || '').trim()}`;
      if (key !== '|' && !seen.has(key)) seen.set(key, item);
    }
  }
  const items = [...seen.values()];
  const records = mapPurchaseOrderRecordsToCacheRecords(items, company);
  if (droppedSelectFields.length) {
    await applyDroppedSelectFields(table, droppedSelectFields);
  }
  return { records, total, truncated: Boolean(truncated) };
}

// Verplichte D365-velden die altijd mee moeten in $select, los van wat de admin selecteert: de velden die
// de interne mappers (mapPurchaseOrder/mapPurchaseOrderLine), de partitiesleutel (dataAreaId) en het
// watermerk (ModifiedDateTime) nodig hebben. Zonder deze zou het beperken van de kolommen de sync breken.
// LET OP: alleen velden die écht op PurchaseOrderHeaderV2 bestaan (geverifieerd via een $select-loze probe).
// Niet-bestaande fallback-namen (ModifiedDateTime, PurchId, PurchaseOrderId, RecId, VendorAccountNumber,
// VendorName, DocumentStatus, RequestedDeliveryDateTime, CreatedDateTime) laten D365 de hele query met 400
// afwijzen; de mapper valt netjes terug op de geldige varianten. Er is geen modified-veld op deze entiteit,
// dus de incrementele watermark blijft leeg (sync draait volledig) — dat was feitelijk al zo.
const REQUIRED_HEADER_D365_FIELDS = [
  'dataAreaId',
  'PurchaseOrderNumber',
  'OrderVendorAccountNumber', 'InvoiceVendorAccountNumber',
  'PurchaseOrderName', 'PurchaseOrderStatus',
  'CurrencyCode', 'RequestedDeliveryDate', 'AccountingDate',
];
// LET OP: alleen velden die écht op PurchaseOrderLineV2 bestaan. CurrencyCode, RequestedReceiptDate
// en RemainingPurchasePhysicalQuantity bestaan NIET op deze regel-entiteit (LIVE 2026-08-29 /
// $metadata #131-2) — ze in $select opnemen laat D365 de hele query met 400 afwijzen. De mapper
// valt netjes terug op null. fetchPurchaseOrderRecords drop't ongeldige $select-velden na een 400.
const REQUIRED_LINE_D365_FIELDS = [
  'PurchaseOrderNumber', 'LineNumber', 'ItemNumber', 'LineDescription',
  'OrderedPurchaseQuantity', 'PurchaseUnitSymbol', 'LineAmount',
  'RequestedDeliveryDate',
];

function normalizeD365FieldName(field) {
  return String(field || '').trim();
}

function uniqueFieldList(fields) {
  const list = new Set();
  for (const field of fields) {
    const normalized = normalizeD365FieldName(field);
    if (normalized) list.add(normalized);
  }
  return [...list];
}

function resolveConfiguredMaxItems(settingValue, tableMaxRows, fallbackMax = 2000) {
  const parsedSetting = Number.parseInt(String(settingValue ?? ''), 10);
  if (Number.isFinite(parsedSetting) && parsedSetting > 0) return parsedSetting;
  const parsedTable = Number.parseInt(String(tableMaxRows ?? ''), 10);
  if (Number.isFinite(parsedTable) && parsedTable > 0) return parsedTable;
  return fallbackMax;
}

async function listDistinctCacheFieldValues({ tableId, scope, sourceField }) {
  const normalizedScope = scope === 'detail' ? 'detail' : 'master';
  const normalizedField = String(sourceField || '').trim();
  if (!tableId || !normalizedField) return [];
  const pool = await getPool();
  const jsonPath = `$.${normalizedField}`;
  const request = pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('scope', sql.NVarChar(16), normalizedScope)
    .input('jsonPath', sql.NVarChar(160), jsonPath);
  const result = normalizedScope === 'detail'
    ? await request.query(`
      SELECT DISTINCT LTRIM(RTRIM(JSON_VALUE(d.data_json, @jsonPath))) AS lookup_value
      FROM dbo.tb_cache d WITH (NOLOCK)
      INNER JOIN dbo.tb_cache m WITH (NOLOCK)
        ON m.table_id = d.table_id
       AND m.scope = 'master'
       AND m.partition_key = d.partition_key
       AND m.record_key = d.record_key
       AND m.detail_key = ${MASTER_DETAIL_KEY}
       AND m.removed_at_source = 0
      WHERE d.table_id = @tableId
        AND d.scope = @scope
        AND d.removed_at_source = 0
        AND JSON_VALUE(d.data_json, @jsonPath) IS NOT NULL
        AND LTRIM(RTRIM(JSON_VALUE(d.data_json, @jsonPath))) <> ''
    `)
    : await request.query(`
      SELECT DISTINCT LTRIM(RTRIM(JSON_VALUE(data_json, @jsonPath))) AS lookup_value
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId
        AND scope = @scope
        AND removed_at_source = 0
        AND JSON_VALUE(data_json, @jsonPath) IS NOT NULL
        AND LTRIM(RTRIM(JSON_VALUE(data_json, @jsonPath))) <> ''
    `);
  return result.recordset
    .map((row) => String(row.lookup_value || '').trim())
    .filter(Boolean);
}

async function listDistinctMasterRecordKeys(tableId) {
  if (!tableId) return [];
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT DISTINCT LTRIM(RTRIM(record_key)) AS lookup_value
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId
        AND scope = 'master'
        AND detail_key = ${MASTER_DETAIL_KEY}
        AND removed_at_source = 0
        AND LTRIM(RTRIM(record_key)) <> ''
    `);
  return result.recordset
    .map((row) => String(row.lookup_value || '').trim())
    .filter(Boolean);
}

// Set van aanwezige item-sleutels (partition|itemnummer) uit de items-cache — de gefilterde set na
// de sync. Alleen aangeroepen wanneer er een items-syncfilter actief is.
async function loadPresentItemFilterKeys(itemsTableId) {
  if (!itemsTableId) return new Set();
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, itemsTableId)
    .query(`
      SELECT DISTINCT partition_key, record_key
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId AND scope = 'master'
        AND detail_key = ${MASTER_DETAIL_KEY}
        AND removed_at_source = 0
    `);
  const set = new Set();
  for (const row of result.recordset || []) {
    const key = buildItemFilterKey(row.partition_key, row.record_key);
    if (key) set.add(key);
  }
  return set;
}

function usesMasterRecordKeysForInheritedLookup(lookup) {
  const joinKeys = Array.isArray(lookup?.joinKeys) ? lookup.joinKeys : [];
  return (
    lookup?.sourceScope === 'detail'
    && joinKeys.length > 0
    && String(lookup?.targetTableKey || '').trim().toLowerCase() === 'product-receipt-lines'
  );
}

function buildDetailLookupSourceValues(detailJson, recordKey, detailKey) {
  const source = detailJson && typeof detailJson === 'object' ? { ...detailJson } : {};
  const poNumber = source.purchaseOrderNumber ?? source.PurchaseOrderNumber ?? recordKey;
  if (poNumber !== null && poNumber !== undefined && String(poNumber).trim()) {
    source.purchaseOrderNumber = String(poNumber).trim();
  }
  const lineNumber = source.lineNumber ?? source.LineNumber ?? detailKey;
  if (lineNumber !== null && lineNumber !== undefined && String(lineNumber).trim() !== '') {
    const normalizedLine = String(lineNumber).trim();
    source.lineNumber = lineNumber;
    source.purchaseOrderLineNumber = normalizedLine;
  }
  return source;
}

function enrichLookupSourceFromCacheRow(targetTableKey, recordKey, parsed) {
  const source = parsed && typeof parsed === 'object' ? { ...parsed } : {};
  if (String(targetTableKey || '').trim().toLowerCase() !== 'product-receipt-lines') {
    return source;
  }
  const parts = String(recordKey || '').split('|').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return source;
  if (!source.purchaseOrderNumber && parts[0]) {
    source.purchaseOrderNumber = parts[0];
  }
  if (parts.length >= 2) {
    const linePart = parts[1];
    if (!source.purchaseOrderLineNumber) source.purchaseOrderLineNumber = linePart;
    if (!source.lineNumber) source.lineNumber = linePart;
  }
  return source;
}

function ensureKeyFieldColumnsInProjection(activeColumns, allColumns, keyFields) {
  const resultByKey = new Map((Array.isArray(activeColumns) ? activeColumns : []).map((column) => [column.key, column]));
  const allSource = (Array.isArray(allColumns) ? allColumns : []).filter((column) => column.source === 'source');
  for (const keyField of Array.isArray(keyFields) ? keyFields : []) {
    if (/^dataareaid$/i.test(String(keyField || ''))) continue;
    const normalizedKeyField = String(keyField || '').trim().toLowerCase();
    if (!normalizedKeyField) continue;
    const match = allSource.find((column) => (
      String(column.sourceField || '').trim().toLowerCase() === normalizedKeyField
      || String(column.key || '').trim().toLowerCase() === normalizedKeyField
    ));
    if (match) resultByKey.set(match.key, match);
  }
  return [...resultByKey.values()];
}

async function getInheritedPoLookupScopes(table) {
  const tableKey = String(table?.key || '').trim().toLowerCase();
  if (!PO_LOOKUP_SCOPED_TABLE_KEYS.has(tableKey)) return [];

  let purchaseOrdersTable;
  try {
    purchaseOrdersTable = await getTableByKey('purchase-orders');
  } catch {
    return [];
  }

  const lookups = (await getLookups(purchaseOrdersTable.id))
    .filter((lookup) => String(lookup?.targetTableKey || '').trim().toLowerCase() === tableKey);
  if (!lookups.length) return [];

  const [poMasterColumns, poDetailColumns] = await Promise.all([
    listColumns({ tableId: purchaseOrdersTable.id, scope: 'master', includeInactive: true }),
    listColumns({ tableId: purchaseOrdersTable.id, scope: 'detail', includeInactive: true }),
  ]);
  const targetMasterColumns = await listColumns({ tableId: table.id, scope: 'master', includeInactive: true });

  const valuesByTargetField = new Map();
  for (const lookup of lookups) {
    const targetField = resolveLookupTargetSourceField(lookup, targetMasterColumns);
    if (!targetField) continue;
    const sourceScope = lookup.sourceScope === 'detail' ? 'detail' : 'master';
    const sourceColumns = sourceScope === 'detail' ? poDetailColumns : poMasterColumns;
    const resolvedSourceField = resolveLookupSourceKey(lookup, sourceColumns);
    if (!resolvedSourceField && !usesMasterRecordKeysForInheritedLookup(lookup)) continue;

    const sourceValues = usesMasterRecordKeysForInheritedLookup(lookup)
      ? await listDistinctMasterRecordKeys(purchaseOrdersTable.id)
      : await listDistinctCacheFieldValues({
        tableId: purchaseOrdersTable.id,
        scope: sourceScope,
        sourceField: resolvedSourceField,
      });
    if (!sourceValues.length) continue;

    if (!valuesByTargetField.has(targetField)) valuesByTargetField.set(targetField, new Set());
    const setForField = valuesByTargetField.get(targetField);
    sourceValues.forEach((value) => setForField.add(value));
  }

  return [...valuesByTargetField.entries()].map(([targetField, values]) => ({
    targetField,
    values: [...values],
  })).filter((entry) => entry.values.length > 0);
}

async function getPurchaseOrderSyncLayers() {
  const raw = await settingsService.getAsync('PO_SYNC_RULES', '');
  let parsed = [];
  try { parsed = raw ? JSON.parse(raw) : []; } catch { parsed = []; }
  return normalizeSyncLayers(parsed).layers;
}

function resolveLookupTargetSourceField(lookup, targetColumns) {
  const configuredTargetField = String(lookup?.targetKeyField || '').trim();
  if (!configuredTargetField) return '';
  const columns = Array.isArray(targetColumns) ? targetColumns : [];
  const normalizedTargetField = configuredTargetField.toLowerCase();

  const bySourceField = columns.find((column) => (
    String(column?.sourceField || '').trim().toLowerCase() === normalizedTargetField
  ));
  if (bySourceField?.sourceField) return String(bySourceField.sourceField).trim();

  const byKey = columns.find((column) => (
    String(column?.key || '').trim().toLowerCase() === normalizedTargetField
  ));
  if (byKey?.sourceField) return String(byKey.sourceField).trim();

  return configuredTargetField;
}

async function getTableSyncLayers(table) {
  if (table.key === 'purchase-orders') {
    const fromSettings = await getPurchaseOrderSyncLayers();
    if (fromSettings.length) return fromSettings;
  }
  if (READ_ONLY_SYNC_FILTER_TABLE_KEYS.has(String(table.key || '').trim().toLowerCase())) {
    return [];
  }
  return normalizeSyncLayers(parseDefaultFilterRules(table.defaultFilter)).layers;
}

async function listVendorAccountsByGroupsFromCache(groupIds) {
  const groups = [...new Set((Array.isArray(groupIds) ? groupIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  if (!groups.length) return [];
  try {
    const vendorsTable = await getTableByKey('vendors');
    const pool = await getPool();
    const result = await pool.request()
      .input('tableId', sql.BigInt, vendorsTable.id)
      .query(`
        SELECT data_json
        FROM dbo.tb_cache WITH (NOLOCK)
        WHERE table_id = @tableId AND scope = 'master' AND removed_at_source = 0
      `);
    return collectAccountsFromVendorRows(result.recordset, groups);
  } catch {
    return [];
  }
}

async function resolveSyncRules(rules, { forD365 = false } = {}) {
  const list = Array.isArray(rules) ? rules : [];
  const groupIds = listVendorGroupIds(list);
  if (!groupIds.length) return list;
  let accounts = [];
  if (!forD365) accounts = await listVendorAccountsByGroupsFromCache(groupIds);
  if (!accounts.length) accounts = await fetchVendorAccountsByGroups(groupIds);
  return expandVendorGroupRules(list, accounts);
}

// Past resolveSyncRules (vendor-group-expansie) toe per laag; lagen zelf blijven OR-gecombineerd,
// alleen de regels binnen elke laag worden geresolved (#325).
async function resolveSyncLayers(layers, opts) {
  const list = Array.isArray(layers) ? layers : [];
  return Promise.all(list.map(async (layer) => ({
    ...layer,
    rules: await resolveSyncRules(layer.rules, opts),
  })));
}

async function getTableSyncFilter(table) {
  if (table.key === 'purchase-orders') {
    const layers = await getTableSyncLayers(table);
    const resolvedLayers = await resolveSyncLayers(layers, { forD365: true });
    const chunks = compileSyncLayerChunks(resolvedLayers).filter(Boolean);
    return chunks.length ? chunks.map((c) => `(${c})`).join(' or ') : '';
  }
  if (READ_ONLY_SYNC_FILTER_TABLE_KEYS.has(String(table.key || '').trim().toLowerCase())) return '';
  const rules = parseDefaultFilterRules(table.defaultFilter);
  if (!rules.length) return '';
  return compileSyncRules(rules);
}

function normalizeLookupKeyPart(value) {
  return String(value ?? '').trim();
}

function resolveRecordKeys(table, rawRecord, fallbackPartitionKey) {
  const keyFields = Array.isArray(table.keyFields) ? table.keyFields : [];
  const firstKey = keyFields[0];
  const secondKey = keyFields[1];
  const firstValue = firstKey ? rawRecord?.[firstKey] : null;
  const secondValue = secondKey ? rawRecord?.[secondKey] : null;

  if (firstKey && /^dataareaid$/i.test(firstKey) && keyFields.length > 2) {
    const recordParts = keyFields.slice(1).map((field) => normalizeLookupKeyPart(rawRecord?.[field]));
    return {
      partitionKey: normalizeLookupKeyPart(firstValue || fallbackPartitionKey || ''),
      recordKey: recordParts.join('|'),
    };
  }

  if (firstKey && /^dataareaid$/i.test(firstKey) && secondKey) {
    return {
      partitionKey: normalizeLookupKeyPart(firstValue || fallbackPartitionKey || ''),
      recordKey: normalizeLookupKeyPart(secondValue || ''),
    };
  }

  if (firstKey) {
    return {
      partitionKey: String(rawRecord?.dataAreaId || fallbackPartitionKey || '').trim(),
      recordKey: String(firstValue || '').trim(),
    };
  }

  return {
    partitionKey: String(rawRecord?.dataAreaId || fallbackPartitionKey || '').trim(),
    recordKey: String(rawRecord?.id || rawRecord?.RecId || '').trim(),
  };
}

function requiredMasterFieldsFromTable(table) {
  const keyFields = Array.isArray(table.keyFields) ? table.keyFields : [];
  // Niet elke D365-entiteit heeft ModifiedDateTime; dat veld hard forceren in $select
  // veroorzaakt 400's op o.a. VendorsV2. Sleutels volstaan voor generieke fetches.
  return uniqueFieldList(['dataAreaId', ...keyFields]);
}

async function genericMasterD365Fetch(table, { onProgress } = {}) {
  const company = (await settingsService.getAsync('D365_ODATA_COMPANY', '')).trim();
  const maxItems = resolveConfiguredMaxItems(null, table.maxRows, 2000);
  const tableKey = String(table.key || '').trim().toLowerCase();
  const usesInheritedPoFilter = PO_LOOKUP_SCOPED_TABLE_KEYS.has(tableKey);

  let extraFilter = '';
  try {
    extraFilter = await getTableSyncFilter(table);
  } catch (err) {
    logger.warn('Sync filter ongeldig; fetch draait zonder extra filter', { tableKey: table.key, error: err.message });
  }

  const selectEnabled = String(await settingsService.getAsync('D365_ODATA_SELECT_ENABLED', 'true'))
    .trim().toLowerCase() !== 'false';
  let selectFields = null;
  if (selectEnabled) {
    const masterCols = await listColumns({ tableId: table.id, scope: 'master', includeInactive: false });
    selectFields = buildD365SelectFields(requiredMasterFieldsFromTable(table), masterCols);
  }

  let rawItems = [];
  let total = 0;
  let truncated = false;
  let droppedSelectFields = [];

  if (usesInheritedPoFilter) {
    const inheritedScopes = await getInheritedPoLookupScopes(table);
    if (!inheritedScopes.length) {
      return { records: [], total: 0, truncated: false };
    }

    const dedupedRawByRecord = new Map();
    let pagesFetched = 0;
    const reportProgress = () => {
      if (typeof onProgress !== 'function') return;
      onProgress({
        fetched: dedupedRawByRecord.size,
        totalToFetch: null,
        sourceTotal: null,
        pagesFetched,
        truncated,
      });
    };

    for (const scope of inheritedScopes) {
      const chunks = chunkList(scope.values, INHERITED_FILTER_CHUNK_SIZE);
      for (const chunk of chunks) {
        const inheritedFilter = buildOneOfFilterClause(scope.targetField, chunk);
        if (!inheritedFilter) continue;
        const scopedFilter = combineODataFilters(extraFilter, inheritedFilter);
        const chunkResult = await fetchEntityRecords({
          sourceEntity: table.sourceEntity,
          fetchAll: true,
          top: Math.min(Number(table.maxRows) || 2000, 2000),
          skip: 0,
          extraFilter: scopedFilter,
          maxItems,
          selectFields,
        });
        if (chunkResult.droppedSelectFields?.length) {
          droppedSelectFields = mergeDroppedSelectFields(droppedSelectFields, chunkResult.droppedSelectFields);
          selectFields = narrowSelectFields(selectFields, droppedSelectFields);
        }
        pagesFetched += Number(chunkResult.pagesFetched) || 0;
        truncated = truncated || Boolean(chunkResult.truncated);
        for (const raw of Array.isArray(chunkResult.items) ? chunkResult.items : []) {
          const keys = resolveRecordKeys(table, raw, company);
          if (!keys.partitionKey || !keys.recordKey) continue;
          const dedupeKey = `${keys.partitionKey}|${keys.recordKey}`;
          if (tableKey === 'product-receipt-lines') {
            const existing = dedupedRawByRecord.get(dedupeKey);
            if (!existing || shouldReplaceProductReceiptRecord(existing, raw)) {
              dedupedRawByRecord.set(dedupeKey, raw);
            }
          } else {
            dedupedRawByRecord.set(dedupeKey, raw);
          }
        }
        reportProgress();
      }
    }

    rawItems = [...dedupedRawByRecord.values()];
    total = rawItems.length;
  } else {
    const result = await fetchEntityRecords({
      sourceEntity: table.sourceEntity,
      fetchAll: true,
      top: Math.min(Number(table.maxRows) || 2000, 2000),
      skip: 0,
      extraFilter,
      maxItems,
      onProgress,
      selectFields,
    });
    if (result.droppedSelectFields?.length) {
      droppedSelectFields = mergeDroppedSelectFields(droppedSelectFields, result.droppedSelectFields);
    }
    rawItems = Array.isArray(result.items) ? result.items : [];
    total = Number(result.total) || rawItems.length;
    truncated = Boolean(result.truncated);
  }

  if (droppedSelectFields.length) {
    await applyDroppedSelectFields(table, droppedSelectFields);
  }

  const records = rawItems.map((raw) => {
    const normalizedRaw = raw && typeof raw === 'object' ? raw : {};
    const keys = resolveRecordKeys(table, normalizedRaw, company);
    return {
      partitionKey: keys.partitionKey,
      recordKey: keys.recordKey,
      modifiedAt: normalizedRaw.ModifiedDateTime || normalizedRaw.modifiedDateTime || null,
      masterRaw: normalizedRaw,
      master: {},
      details: [],
    };
  });

  return { records, total, truncated };
}

async function vendorsFetch(table, context = {}) {
  return genericMasterD365Fetch(table, context);
}

async function itemsFetch(table, context = {}) {
  return genericMasterD365Fetch(table, context);
}

function shouldReplaceProductReceiptRecord(existing, incoming) {
  if (!existing) return true;
  const existingDate = toDateOrNull(existing?.ProductReceiptDate);
  const incomingDate = toDateOrNull(incoming?.ProductReceiptDate);
  if (existingDate && incomingDate) {
    if (incomingDate.getTime() > existingDate.getTime()) return true;
    if (incomingDate.getTime() < existingDate.getTime()) return false;
  } else if (incomingDate && !existingDate) {
    return true;
  } else if (!incomingDate && existingDate) {
    return false;
  }
  const existingQty = Number(existing?.ReceivedPurchaseQuantity) || 0;
  const incomingQty = Number(incoming?.ReceivedPurchaseQuantity) || 0;
  return incomingQty >= existingQty;
}

const FETCH_ADAPTERS = {
  'purchase-orders': purchaseOrdersFetch,
  vendors: vendorsFetch,
  items: itemsFetch,
  'product-receipt-lines': genericMasterD365Fetch,
  'product-attribute-values': productAttributeValuesFetch,
};

function getFetchAdapter(table) {
  const adapter = FETCH_ADAPTERS[table.key];
  if (!adapter) {
    throw Object.assign(new Error(`No fetch adapter for table '${table.key}' (coming in Phase B via SourceProvider)`), { status: 501 });
  }
  return adapter;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function normalizeOut(value) {
  if (value instanceof Date) return value.toISOString();
  return value === undefined ? null : value;
}
function projectJson(source, sourceColumns) {
  const json = {};
  for (const col of sourceColumns) {
    const directValue = source ? source[col.key] : null;
    const fallbackValue = directValue === undefined && col.sourceField ? source?.[col.sourceField] : undefined;
    json[col.key] = normalizeOut(fallbackValue === undefined ? directValue : fallbackValue);
  }
  return JSON.stringify(json);
}
function parseJson(raw) {
  if (!raw) return {};
  // De collapsed board-read levert data_json al als object aan (JSON_VALUE-projectie i.p.v. blob).
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function normalizeDiffValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

function toLedgerValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function computeChangedFieldKeys(previousValues, nextValues) {
  const previous = isPlainObject(previousValues) ? previousValues : {};
  const next = isPlainObject(nextValues) ? nextValues : {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed = [];
  for (const key of keys) {
    const prev = normalizeDiffValue(previous[key]);
    const nxt = normalizeDiffValue(next[key]);
    if (!Object.is(prev, nxt)) changed.push(key);
  }
  return changed.sort();
}

function buildD365LedgerEntries({
  tableId,
  partitionKey,
  recordKey,
  detailKey = MASTER_DETAIL_KEY,
  action,
  previousValues = {},
  nextValues = {},
  refreshJobId = null,
}) {
  if (!tableId || !partitionKey || !recordKey || !action) return [];
  if (action === 'DELETE') {
    return [{
      tableId,
      partitionKey,
      recordKey,
      detailKey,
      fieldKey: null,
      source: 'D365',
      action,
      oldValue: toLedgerValue(previousValues),
      newValue: null,
      changedByUserId: null,
      correlationId: null,
      refreshJobId,
    }];
  }

  // INSERT is één regel per rij, symmetrisch met DELETE hierboven: bij een nieuwe rij is "deze rij
  // is erbij gekomen" de hele waarheid — per veld loggen gaf ~10x zoveel regels zonder extra
  // informatie. Het bord markeert een nieuwe rij ook als hele rij en negeert changedFieldKeys voor
  // isNew-rijen. Alleen UPDATE blijft per veld; daar is juist wél relevant wát er veranderde.
  // Let op: dit geldt alleen voor de D365-sync. Gebruikersacties (saveCustomValue, correctField)
  // bouwen hun entries zelf en houden hun veldniveau.
  if (action === 'INSERT') {
    return [{
      tableId,
      partitionKey,
      recordKey,
      detailKey,
      fieldKey: null,
      source: 'D365',
      action,
      oldValue: null,
      newValue: toLedgerValue(nextValues),
      changedByUserId: null,
      correlationId: null,
      refreshJobId,
    }];
  }

  const fieldKeys = computeChangedFieldKeys(previousValues, nextValues);

  if (!fieldKeys.length) return [];

  return fieldKeys.map((fieldKey) => ({
    tableId,
    partitionKey,
    recordKey,
    detailKey,
    fieldKey,
    source: 'D365',
    action,
    oldValue: toLedgerValue(previousValues?.[fieldKey]),
    newValue: toLedgerValue(nextValues?.[fieldKey]),
    changedByUserId: null,
    correlationId: null,
    refreshJobId,
  }));
}

// Eén ledger-entry -> de 12 SQL-parameters met een rij-index in de naam (uniek binnen de batch).
function ledgerEntryParams(entry, idx) {
  return [
    { name: `tableId${idx}`, type: sql.BigInt, value: entry.tableId },
    { name: `partitionKey${idx}`, type: sql.NVarChar(32), value: entry.partitionKey },
    { name: `recordKey${idx}`, type: sql.NVarChar(128), value: entry.recordKey },
    { name: `detailKey${idx}`, type: sql.Int, value: Number.isInteger(entry.detailKey) ? entry.detailKey : MASTER_DETAIL_KEY },
    { name: `fieldKey${idx}`, type: sql.NVarChar(128), value: entry.fieldKey || null },
    { name: `source${idx}`, type: sql.NVarChar(16), value: entry.source || 'USER' },
    { name: `action${idx}`, type: sql.NVarChar(16), value: entry.action || 'UPDATE' },
    { name: `oldValue${idx}`, type: sql.NVarChar(sql.MAX), value: entry.oldValue || null },
    { name: `newValue${idx}`, type: sql.NVarChar(sql.MAX), value: entry.newValue || null },
    { name: `changedByUserId${idx}`, type: sql.Int, value: entry.changedByUserId || null },
    { name: `correlationId${idx}`, type: sql.NVarChar(64), value: entry.correlationId || null },
    { name: `refreshJobId${idx}`, type: sql.NVarChar(64), value: entry.refreshJobId || null },
  ];
}

// Bouwt een multi-row INSERT voor één batch entries. Retourneert de VALUES-tuples en de vlakke
// parameterlijst; zo blijft de string-opbouw puur en testbaar los van de mssql-request.
function buildLedgerInsert(chunk) {
  const params = [];
  const tuples = chunk.map((entry, idx) => {
    const cols = ledgerEntryParams(entry, idx);
    params.push(...cols);
    return `(${cols.map((c) => `@${c.name}`).join(', ')})`;
  });
  const text = `
    INSERT INTO dbo.tb_change_ledger
      (table_id, partition_key, record_key, detail_key, field_key, source, action,
       old_value, new_value, changed_by_user_id, correlation_id, refresh_job_id)
    VALUES ${tuples.join(', ')}
  `;
  return { text, params };
}

// SQL Server staat max 2100 parameters per statement toe; 12 per entry -> ~175 max. 100 houdt ruime
// marge. Voorheen ging elke entry als los INSERT-round-trip; bij een refresh scheelt dat duizenden.
const LEDGER_INSERT_CHUNK = 100;

async function writeChangeLedgerEntries(requestFactory, entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return;
  for (let i = 0; i < list.length; i += LEDGER_INSERT_CHUNK) {
    const chunk = list.slice(i, i + LEDGER_INSERT_CHUNK);
    const { text, params } = buildLedgerInsert(chunk);
    const req = requestFactory();
    for (const p of params) req.input(p.name, p.type, p.value);
    await req.query(text);
  }
}

// Heeft deze tabel nog geen enkele cache-rij? Dan is de eerstvolgende refresh een nulmeting.
async function isCacheEmpty(pool, tableId) {
  const res = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query('SELECT TOP (1) 1 AS present FROM dbo.tb_cache WITH (NOLOCK) WHERE table_id = @tableId');
  return !res.recordset.length;
}

// Retentie voor tb_change_ledger. read() leest alleen sinds de laatste sync en RowActivity toont
// recente rij-historie, dus ouder dan dit venster hoeft niet bewaard te blijven. Zonder opschoning
// groeit de tabel onbegrensd (32 MB in 12 dagen op DEV). Instelbaar via env; standaard 90 dagen.
const LEDGER_RETENTION_DAYS = (() => {
  const raw = Number.parseInt(String(process.env.TB_LEDGER_RETENTION_DAYS ?? ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 90;
})();

// Delete in behapbare brokken zodat een grote opschoning het log niet lang op slot zet.
async function pruneChangeLedger(pool, tableId, retentionDays = LEDGER_RETENTION_DAYS) {
  let totalDeleted = 0;
  for (;;) {
    const res = await pool.request()
      .input('tableId', sql.BigInt, tableId)
      .input('days', sql.Int, retentionDays)
      .query(`
        DELETE TOP (5000) FROM dbo.tb_change_ledger
        WHERE table_id = @tableId
          AND created_at < DATEADD(day, -@days, SYSUTCDATETIME())
      `);
    const deleted = res.rowsAffected?.[0] || 0;
    totalDeleted += deleted;
    if (deleted < 5000) break;
  }
  return totalDeleted;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLookupTargetFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  return [...new Set(list.map((field) => String(field || '').trim()).filter(Boolean))];
}

function sanitizeLookupDerivedKey(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH);
}

function ensureUniqueLookupDerivedKey(baseKey, usedKeys) {
  const normalized = sanitizeLookupDerivedKey(baseKey) || 'lookup';
  if (!usedKeys.has(normalized.toLowerCase())) return normalized;
  for (let i = 2; i < 1000; i += 1) {
    const withSuffix = sanitizeLookupDerivedKey(`${normalized}_${i}`) || `lookup_${i}`;
    if (!usedKeys.has(withSuffix.toLowerCase())) return withSuffix;
  }
  throw new Error(`Could not create a unique lookup column key for '${baseKey}'`);
}

function buildLookupFieldMap({ targetTableKey, targetFieldKeys, existingFields = {} }) {
  const selectedTargets = normalizeLookupTargetFields(targetFieldKeys);
  if (!selectedTargets.length) return {};

  const existingEntries = Object.entries(isPlainObject(existingFields) ? existingFields : {});
  const existingDerivedByTarget = new Map();
  existingEntries.forEach(([derivedKey, targetField]) => {
    const normalizedTarget = String(targetField || '').trim();
    const normalizedDerived = String(derivedKey || '').trim();
    if (!normalizedTarget || !normalizedDerived) return;
    if (!existingDerivedByTarget.has(normalizedTarget)) {
      existingDerivedByTarget.set(normalizedTarget, normalizedDerived);
    }
  });

  const usedDerived = new Set();
  const result = {};
  selectedTargets.forEach((targetField) => {
    const preferredExisting = existingDerivedByTarget.get(targetField);
    const generatedBase = `${targetTableKey}_${targetField}`;
    const derived = ensureUniqueLookupDerivedKey(preferredExisting || generatedBase, usedDerived);
    usedDerived.add(derived.toLowerCase());
    result[derived] = targetField;
  });
  return result;
}

function resolveLookupSourceKey(lookup, sourceColumns) {
  const relationSourceField = String(lookup?.sourceField || '').trim();
  if (!relationSourceField) return relationSourceField;

  const candidates = Array.isArray(sourceColumns) ? sourceColumns.filter((column) => column.source === 'source') : [];
  if (!candidates.length) return relationSourceField;

  const byExactKey = candidates.find((column) => String(column.key || '').trim() === relationSourceField);
  if (byExactKey) return String(byExactKey.key || '').trim();

  const byExactSourceField = candidates.find((column) => String(column.sourceField || '').trim() === relationSourceField);
  if (byExactSourceField) return String(byExactSourceField.key || '').trim();

  const sourceFieldLower = relationSourceField.toLowerCase();
  const byInsensitiveKey = candidates.find((column) => String(column.key || '').trim().toLowerCase() === sourceFieldLower);
  if (byInsensitiveKey) return String(byInsensitiveKey.key || '').trim();

  const byInsensitiveSourceField = candidates.find((column) => (
    String(column.sourceField || '').trim().toLowerCase() === sourceFieldLower
  ));
  if (byInsensitiveSourceField) return String(byInsensitiveSourceField.key || '').trim();

  return relationSourceField;
}

function resolveLookupProjectionColumns({ activeColumns, allColumns, lookups, scope }) {
  const normalizedScope = scope === 'detail' ? 'detail' : 'master';
  const sourceColumns = (Array.isArray(activeColumns) ? activeColumns : [])
    .filter((column) => column.source === 'source');
  const allSourceColumns = (Array.isArray(allColumns) ? allColumns : [])
    .filter((column) => column.source === 'source');
  const sourceByKey = new Map(sourceColumns.map((column) => [String(column.key || '').trim(), column]));
  const allSourceByKey = new Map(
    allSourceColumns.map((column) => [String(column.key || '').trim(), column])
  );
  const allSourceByKeyLower = new Map(
    allSourceColumns.map((column) => [String(column.key || '').trim().toLowerCase(), column])
  );

  const lookupSourceKeys = new Set(
    (Array.isArray(lookups) ? lookups : [])
      .filter((lookup) => String(lookup?.sourceScope || 'master').trim() === normalizedScope)
      .map((lookup) => resolveLookupSourceKey(lookup, allSourceColumns))
      .filter(Boolean)
  );
  if (!lookupSourceKeys.size) return sourceColumns;

  lookupSourceKeys.forEach((lookupSourceKey) => {
    if (sourceByKey.has(lookupSourceKey)) return;
    const fallbackColumn = allSourceByKey.get(lookupSourceKey)
      || allSourceByKeyLower.get(String(lookupSourceKey).toLowerCase());
    if (fallbackColumn) sourceByKey.set(lookupSourceKey, fallbackColumn);
  });
  return [...sourceByKey.values()];
}

function buildLookupTargetAliases(activeTargetColumns, allTargetColumns) {
  const activeList = Array.isArray(activeTargetColumns) ? activeTargetColumns : [];
  const allList = Array.isArray(allTargetColumns) ? allTargetColumns : [];
  const aliasesByKey = {};
  activeList.forEach((targetColumn) => {
    const targetKey = String(targetColumn?.key || '').trim();
    if (!targetKey) return;

    const aliasSet = new Set();
    const sourceField = String(targetColumn?.sourceField || '').trim();
    if (sourceField) {
      aliasSet.add(sourceField);
      const sourceFieldLower = sourceField.toLowerCase();
      allList.forEach((column) => {
        const colKey = String(column?.key || '').trim();
        if (!colKey || colKey === targetKey) return;
        if (String(column?.sourceField || '').trim().toLowerCase() === sourceFieldLower) {
          aliasSet.add(colKey);
        }
      });
    }
    aliasesByKey[targetKey] = [...aliasSet];
  });
  return aliasesByKey;
}

function buildLookupDedupeSignature({ sourceScope, sourceFieldKey, targetTableKey }) {
  return [
    String(sourceScope === 'detail' ? 'detail' : 'master').toLowerCase(),
    String(sourceFieldKey || '').trim().toLowerCase(),
    String(targetTableKey || '').trim().toLowerCase(),
  ].join('|');
}

function buildLookupCacheKey(partitionKey, sourceValues, lookup) {
  const joinKeys = Array.isArray(lookup?.joinKeys) ? lookup.joinKeys : [];
  const partitionless = Boolean(lookup?.partitionless);
  if (!joinKeys.length) {
    const sourceField = String(lookup?.sourceFieldKey || lookup?.sourceField || '').trim();
    const fkVal = sourceField && sourceValues && Object.prototype.hasOwnProperty.call(sourceValues, sourceField)
      ? sourceValues[sourceField]
      : null;
    if (fkVal === null || fkVal === undefined || fkVal === '') return null;
    return partitionless
      ? normalizeLookupKeyPart(fkVal)
      : `${String(partitionKey || '').toLowerCase()}|${normalizeLookupKeyPart(fkVal)}`;
  }

  const parts = joinKeys.map(({ sourceKey, targetKey }) => {
    const sourceField = String(sourceKey || '').trim();
    const targetField = String(targetKey || '').trim();
    if (sourceField && sourceValues && Object.prototype.hasOwnProperty.call(sourceValues, sourceField)) {
      return normalizeLookupKeyPart(sourceValues[sourceField]);
    }
    if (targetField && sourceValues && Object.prototype.hasOwnProperty.call(sourceValues, targetField)) {
      return normalizeLookupKeyPart(sourceValues[targetField]);
    }
    return '';
  });
  if (parts.some((part) => !part)) return null;
  return partitionless
    ? parts.join('|')
    : `${String(partitionKey || '').toLowerCase()}|${parts.join('|')}`;
}

function toColumnLabelFromField(field) {
  return String(field || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .slice(0, 128);
}

function slugifyColumnKey(label) {
  const base = String(label || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH);
  return base || 'kolom';
}

function shouldDiscoverSourceField(field, value) {
  const normalizedField = String(field || '').trim();
  if (!normalizedField || normalizedField.startsWith('@')) return false;
  if (Array.isArray(value) || isPlainObject(value)) return false;
  return true;
}

function nextUniqueKey(baseKey, existingKeys) {
  let candidate = String(baseKey || '').slice(0, MAX_KEY_LENGTH) || 'kolom';
  if (!existingKeys.has(candidate.toLowerCase())) return candidate;
  for (let i = 2; i < 1000; i += 1) {
    const withSuffix = `${baseKey}_${i}`.slice(0, MAX_KEY_LENGTH);
    if (!existingKeys.has(withSuffix.toLowerCase())) return withSuffix;
  }
  throw new Error(`Could not determine a unique key for '${baseKey}'`);
}

function collectDiscoveredFields(records, level) {
  const discovered = new Map();
  const list = Array.isArray(records) ? records.slice(0, FIELD_DISCOVERY_SAMPLE_LIMIT) : [];
  for (const record of list) {
    const rawObjects = level === 'line'
      ? (Array.isArray(record.details) ? record.details.map((detail) => detail?.raw).filter(isPlainObject) : [])
      : (isPlainObject(record.masterRaw) ? [record.masterRaw] : []);
    for (const raw of rawObjects) {
      Object.entries(raw).forEach(([field, value]) => {
        if (!shouldDiscoverSourceField(field, value)) return;
        const normalizedField = String(field).trim();
        if (!discovered.has(normalizedField)) {
          discovered.set(normalizedField, {
            field: normalizedField,
            label: toColumnLabelFromField(normalizedField) || normalizedField,
            dataType: inferSourceDataType(value, normalizedField),
            sample: null,
          });
        }
        const current = discovered.get(normalizedField);
        if (isEmptySampleValue(current.sample) && !isEmptySampleValue(value)) {
          current.sample = value;
        }
        const inferredType = inferSourceDataType(value, normalizedField);
        if (current.dataType === 'text' && inferredType !== 'text') current.dataType = inferredType;
      });
    }
  }
  return [...discovered.values()].sort((a, b) => a.field.localeCompare(b.field));
}

async function deleteSourceColumnsByIds(pool, columnIds) {
  const ids = (Array.isArray(columnIds) ? columnIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return 0;
  for (const columnId of ids) {
    await pool.request().input('columnId', sql.BigInt, columnId)
      .query('DELETE FROM dbo.tb_cell_history WHERE column_id = @columnId');
    await pool.request().input('columnId', sql.BigInt, columnId)
      .query('DELETE FROM dbo.tb_field_corrections WHERE column_id = @columnId');
    await pool.request().input('columnId', sql.BigInt, columnId)
      .query("DELETE FROM dbo.tb_columns WHERE id = @columnId AND source = 'source'");
  }
  return ids.length;
}

function mergeDroppedSelectFields(current, extra) {
  const next = [...(Array.isArray(current) ? current : [])];
  const seen = new Set(next.map((field) => String(field).toLowerCase()));
  for (const field of Array.isArray(extra) ? extra : []) {
    const name = String(field || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    next.push(name);
  }
  return next;
}

function narrowSelectFields(selectFields, droppedFields) {
  if (!Array.isArray(selectFields) || !selectFields.length) return selectFields;
  const dropped = new Set((droppedFields || []).map((field) => String(field).toLowerCase()));
  if (!dropped.size) return selectFields;
  return selectFields.filter((field) => !dropped.has(String(field).toLowerCase()));
}

async function dropIllegalSelectSourceColumns(table, droppedFields) {
  const names = [...new Set((droppedFields || []).map((field) => String(field || '').trim()).filter(Boolean))];
  if (!names.length) return [];
  const protectedFields = new Set(uniqueFieldList([
    ...(table.keyFields || []),
    ...requiredMasterFieldsFromTable(table),
    ...(table.key === 'purchase-orders' ? REQUIRED_HEADER_D365_FIELDS : []),
    ...(table.key === 'purchase-orders' ? REQUIRED_LINE_D365_FIELDS : []),
  ]).map((field) => field.toLowerCase()));
  const removable = names.filter((name) => !protectedFields.has(name.toLowerCase()));
  if (!removable.length) return [];
  const [masterCols, detailCols] = await Promise.all([
    listColumns({ tableId: table.id, scope: 'master', includeInactive: true }),
    listColumns({ tableId: table.id, scope: 'detail', includeInactive: true }),
  ]);
  const columns = [...masterCols, ...detailCols];
  const stale = columns.filter((column) => (
    column.source === 'source'
    && removable.some((name) => name.toLowerCase() === String(column.sourceField || '').toLowerCase())
  ));
  if (!stale.length) return [];
  const pool = await getPool();
  await deleteSourceColumnsByIds(pool, stale.map((column) => column.id));
  return stale.map((column) => column.sourceField);
}

async function applyDroppedSelectFields(table, droppedFields) {
  const removed = await dropIllegalSelectSourceColumns(table, droppedFields);
  const notice = formatSelectDropNotice(removed.length ? removed : droppedFields);
  if (notice) refreshRunService.updateEntity(table.key, { notice_text: notice });
  return removed;
}

async function syncSourceColumnsFromRecords(table, records, { prune = false } = {}) {
  if (!Array.isArray(records) || !records.length) return { headerInserted: 0, lineInserted: 0, headerRemoved: 0, lineRemoved: 0 };
  const pool = await getPool();

  async function insertMissingForScope(scope, discoveredFields) {
    if (!discoveredFields.length) return 0;
    const existingColumns = await listColumns({ tableId: table.id, scope, includeInactive: true });
    const existingSourceFields = new Set(
      existingColumns
        .filter((col) => col.source === 'source' && col.sourceField)
        .map((col) => String(col.sourceField).toLowerCase())
    );
    const existingKeys = new Set(existingColumns.map((col) => String(col.key || '').toLowerCase()));
    let nextSortOrder = existingColumns.reduce((maxSort, col) => Math.max(maxSort, Number(col.sortOrder) || 0), 0);
    let inserted = 0;

    const promotions = listSourceColumnsToPromote(existingColumns, discoveredFields);
    for (const promotion of promotions) {
      await pool.request()
        .input('columnId', sql.BigInt, promotion.id)
        .input('dataType', sql.NVarChar(16), promotion.dataType)
        .query(`
          UPDATE dbo.tb_columns
          SET data_type = @dataType, updated_at = SYSUTCDATETIME()
          WHERE id = @columnId AND source = 'source' AND data_type = 'text'
        `);
    }
    if (promotions.length) invalidateTableCache(table.key);

    for (const fieldMeta of discoveredFields) {
      if (existingSourceFields.has(fieldMeta.field.toLowerCase())) continue;
      const baseKey = slugifyColumnKey(fieldMeta.field);
      const key = nextUniqueKey(baseKey, existingKeys);
      existingKeys.add(key.toLowerCase());
      existingSourceFields.add(fieldMeta.field.toLowerCase());
      nextSortOrder += 10;

      await pool.request()
        .input('tableId', sql.BigInt, table.id)
        .input('scope', sql.NVarChar(16), scope)
        .input('key', sql.NVarChar(64), key)
        .input('label', sql.NVarChar(128), fieldMeta.label)
        .input('sourceField', sql.NVarChar(128), fieldMeta.field)
        .input('dataType', sql.NVarChar(16), fieldMeta.dataType)
        .input('sortOrder', sql.Int, nextSortOrder)
        .query(`
          INSERT INTO dbo.tb_columns
            (table_id, scope, [key], label, source, source_field, data_type, writable, write_mechanism,
             is_default_visible, filterable, sortable, is_active, sort_order)
          VALUES
            (@tableId, @scope, @key, @label, 'source', @sourceField, @dataType, 0, NULL, 0, 1, 1, 0, @sortOrder)
        `);
      inserted += 1;
    }
    return inserted;
  }

  const headerFields = collectDiscoveredFields(records, 'header');
  const lineFields = collectDiscoveredFields(records, 'line');
  const [headerInserted, lineInserted] = await Promise.all([
    insertMissingForScope('master', headerFields),
    insertMissingForScope('detail', lineFields),
  ]);
  if (!prune) return { headerInserted, lineInserted, headerRemoved: 0, lineRemoved: 0 };

  const protectedMaster = uniqueFieldList([
    ...(table.keyFields || []),
    ...requiredMasterFieldsFromTable(table),
    ...(table.key === 'purchase-orders' ? REQUIRED_HEADER_D365_FIELDS : []),
  ]);
  const protectedLine = uniqueFieldList([
    ...(table.key === 'purchase-orders' ? REQUIRED_LINE_D365_FIELDS : []),
  ]);
  const [masterCols, detailCols] = await Promise.all([
    listColumns({ tableId: table.id, scope: 'master', includeInactive: true }),
    listColumns({ tableId: table.id, scope: 'detail', includeInactive: true }),
  ]);
  const staleMaster = listStaleSourceColumns(masterCols, headerFields, protectedMaster);
  const staleDetail = listStaleSourceColumns(detailCols, lineFields, protectedLine);
  const [headerRemoved, lineRemoved] = await Promise.all([
    deleteSourceColumnsByIds(pool, staleMaster.map((column) => column.id)),
    deleteSourceColumnsByIds(pool, staleDetail.map((column) => column.id)),
  ]);
  return { headerInserted, lineInserted, headerRemoved, lineRemoved };
}

// Content-hash over de geprojecteerde master- + detail-JSON (bron-neutraal; nieuw/gewijzigd-detectie).
function computeContentHash(masterJson, detailJsons) {
  const detailDigest = [...detailJsons].sort().join('|');
  return crypto.createHash('sha256').update(`${masterJson}¶${detailJsons.length}¶${detailDigest}`).digest('hex');
}

async function getStaleThresholdMinutes(table) {
  return Number.isFinite(table?.staleMinutes) && table.staleMinutes > 0 ? table.staleMinutes : 15;
}

async function getSyncState(tableId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query('SELECT watermark, last_full_sync_at FROM dbo.tb_sync_state WHERE table_id = @tableId');
  const row = result.recordset[0] || {};
  return { watermark: row.watermark || null, lastFullSyncAt: row.last_full_sync_at || null };
}

function dedupeDetailRows(detailRows) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  const byCompositeKey = new Map();
  let duplicateCount = 0;
  for (const row of rows) {
    const compositeKey = `${row.partitionKey}::${row.recordKey}::${row.detailKey}`;
    if (byCompositeKey.has(compositeKey)) duplicateCount += 1;
    byCompositeKey.set(compositeKey, row);
  }
  return { rows: Array.from(byCompositeKey.values()), duplicateCount };
}

// ---------------------------------------------------------------------------
// persistRecordsChunk — schrijft één batch masterrecords (+ hun details) set-based weg naar tb_cache.
// Aanpak: bulk-copy de geprojecteerde rijen naar twee staging-temptabellen op de transactie-connectie,
// draai daarna één MERGE (master) en één DELETE + INSERT (details). Zo verdwijnt het N+1-patroon
// (transactie + losse INSERT per order/regel) dat de refresh traag maakte.
// ---------------------------------------------------------------------------
// skipLedger: nulmeting-modus — wel data wegschrijven, geen dagboekregels (zie refresh()).
async function persistRecordsChunk(pool, table, chunk, refreshStart, masterSource, detailSource, refreshJobId, skipLedger = false) {
  const masterRows = [];
  const detailRows = [];
  let watermark = null;

  for (const rec of chunk) {
    if (!rec.partitionKey || !rec.recordKey) continue;
    const modifiedAt = toDateOrNull(rec.modifiedAt);
    if (modifiedAt && (!watermark || modifiedAt > watermark)) watermark = modifiedAt;

    const masterValues = isPlainObject(rec.masterRaw) ? { ...rec.masterRaw, ...rec.master } : rec.master;
    const masterJson = projectJson(masterValues, masterSource);
    const detailJsons = rec.details.map((d) => {
      const detailValues = isPlainObject(d.raw) ? { ...d.raw, ...d.values } : d.values;
      return projectJson(detailValues, detailSource);
    });
    const contentHash = computeContentHash(masterJson, detailJsons);

    masterRows.push({
      partitionKey: rec.partitionKey,
      recordKey: rec.recordKey,
      dataJson: masterJson,
      modifiedAt,
      contentHash,
    });
    for (let i = 0; i < rec.details.length; i += 1) {
      const detail = rec.details[i];
      if (detail.detailKey === null || detail.detailKey === undefined) continue;
      const detailJson = detailJsons[i];
      detailRows.push({
        partitionKey: rec.partitionKey,
        recordKey: rec.recordKey,
        detailKey: detail.detailKey,
        dataJson: detailJson,
        contentHash: computeContentHash(detailJson, []),
      });
    }
  }

  const { rows: uniqueDetailRows, duplicateCount } = dedupeDetailRows(detailRows);
  if (duplicateCount > 0) {
    logger.warn('Dubbele detailregels in bron gededupliceerd tijdens refresh', {
      tableKey: table?.key || null,
      duplicates: duplicateCount,
      chunkSize: chunk.length,
    });
  }

  if (!masterRows.length) return { saved: 0, watermark, inserted: 0, updated: 0 };

  let inserted = 0;
  let updated = 0;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Staging-temptabellen aanmaken via .batch() (géén sp_executesql), zodat ze op de connectie blijven
    // bestaan voor de bulk-copy en de daaropvolgende MERGE/INSERT binnen dezelfde transactie.
    await new sql.Request(tx).batch(`
      IF OBJECT_ID('tempdb..#stg_master') IS NOT NULL DROP TABLE #stg_master;
      IF OBJECT_ID('tempdb..#stg_detail') IS NOT NULL DROP TABLE #stg_detail;
      CREATE TABLE #stg_master (
        partition_key NVARCHAR(32)  NOT NULL,
        record_key    NVARCHAR(128) NOT NULL,
        data_json     NVARCHAR(MAX) NOT NULL,
        modified_at   DATETIME2     NULL,
        content_hash  NVARCHAR(64)  NOT NULL
      );
      CREATE TABLE #stg_detail (
        partition_key NVARCHAR(32)  NOT NULL,
        record_key    NVARCHAR(128) NOT NULL,
        detail_key    INT           NOT NULL,
        data_json     NVARCHAR(MAX) NOT NULL,
        content_hash  NVARCHAR(64)  NOT NULL
      );
    `);

    const masterTable = new sql.Table('#stg_master');
    masterTable.create = false;
    masterTable.columns.add('partition_key', sql.NVarChar(32), { nullable: false });
    masterTable.columns.add('record_key', sql.NVarChar(128), { nullable: false });
    masterTable.columns.add('data_json', sql.NVarChar(sql.MAX), { nullable: false });
    masterTable.columns.add('modified_at', sql.DateTime2, { nullable: true });
    masterTable.columns.add('content_hash', sql.NVarChar(64), { nullable: false });
    for (const r of masterRows) {
      masterTable.rows.add(r.partitionKey, r.recordKey, r.dataJson, r.modifiedAt, r.contentHash);
    }
    await new sql.Request(tx).bulk(masterTable);

    if (uniqueDetailRows.length) {
      const detailTable = new sql.Table('#stg_detail');
      detailTable.create = false;
      detailTable.columns.add('partition_key', sql.NVarChar(32), { nullable: false });
      detailTable.columns.add('record_key', sql.NVarChar(128), { nullable: false });
      detailTable.columns.add('detail_key', sql.Int, { nullable: false });
      detailTable.columns.add('data_json', sql.NVarChar(sql.MAX), { nullable: false });
      detailTable.columns.add('content_hash', sql.NVarChar(64), { nullable: false });
      for (const r of uniqueDetailRows) {
        detailTable.rows.add(r.partitionKey, r.recordKey, r.detailKey, r.dataJson, r.contentHash);
      }
      await new sql.Request(tx).bulk(detailTable);
    }

    const existingRows = await new sql.Request(tx)
      .input('tableId', sql.BigInt, table.id)
      .query(`
        SELECT c.scope, c.partition_key, c.record_key, c.detail_key, c.data_json, c.removed_at_source
        FROM dbo.tb_cache c
        INNER JOIN #stg_master m
          ON c.partition_key = m.partition_key AND c.record_key = m.record_key
        WHERE c.table_id = @tableId
      `);

    const previousMasterByRecord = new Map();
    const previousDetailByRecord = new Map();
    for (const row of existingRows.recordset) {
      const rowKey = `${row.partition_key}|${row.record_key}`;
      // Bewust óók soft-deleted rijen (removed_at_source = 1) als "vorige staat" meenemen. De
      // twee-fasen-refresh soft-delete een retained order in fase 1 en herplaatst hem in fase 2;
      // zonder deze rij zag fase 2 de order als nieuw en schreef hij per veld een INSERT weg
      // (churn + het bord markeerde ~alles als 'nieuw'). Met de vorige staat erbij wordt het een
      // UPDATE die alleen echt gewijzigde velden logt — en niets als er niets veranderde.
      if (row.scope === 'master') {
        previousMasterByRecord.set(rowKey, parseJson(row.data_json));
        continue;
      }
      if (row.scope !== 'detail') continue;
      if (!previousDetailByRecord.has(rowKey)) previousDetailByRecord.set(rowKey, new Map());
      previousDetailByRecord.get(rowKey).set(Number(row.detail_key), parseJson(row.data_json));
    }

    const ledgerEntries = [];
    const detailRowMapByRecord = new Map();
    for (const row of detailRows) {
      const rowKey = `${row.partitionKey}|${row.recordKey}`;
      if (!detailRowMapByRecord.has(rowKey)) detailRowMapByRecord.set(rowKey, new Map());
      detailRowMapByRecord.get(rowKey).set(Number(row.detailKey), row);
    }

    for (const row of masterRows) {
      const rowKey = `${row.partitionKey}|${row.recordKey}`;
      const previousMaster = previousMasterByRecord.get(rowKey);
      const nextMaster = parseJson(row.dataJson);
      if (!previousMaster) {
        ledgerEntries.push(...buildD365LedgerEntries({
          tableId: table.id,
          partitionKey: row.partitionKey,
          recordKey: row.recordKey,
          detailKey: MASTER_DETAIL_KEY,
          action: 'INSERT',
          nextValues: nextMaster,
          refreshJobId,
        }));
      } else {
        ledgerEntries.push(...buildD365LedgerEntries({
          tableId: table.id,
          partitionKey: row.partitionKey,
          recordKey: row.recordKey,
          detailKey: MASTER_DETAIL_KEY,
          action: 'UPDATE',
          previousValues: previousMaster,
          nextValues: nextMaster,
          refreshJobId,
        }));
      }

      const previousDetails = previousDetailByRecord.get(rowKey) || new Map();
      const nextDetails = detailRowMapByRecord.get(rowKey) || new Map();
      for (const [detailKey, nextDetailRow] of nextDetails.entries()) {
        const nextValues = parseJson(nextDetailRow.dataJson);
        const previousValues = previousDetails.get(detailKey);
        if (!previousValues) {
          ledgerEntries.push(...buildD365LedgerEntries({
            tableId: table.id,
            partitionKey: row.partitionKey,
            recordKey: row.recordKey,
            detailKey,
            action: 'INSERT',
            nextValues,
            refreshJobId,
          }));
        } else {
          ledgerEntries.push(...buildD365LedgerEntries({
            tableId: table.id,
            partitionKey: row.partitionKey,
            recordKey: row.recordKey,
            detailKey,
            action: 'UPDATE',
            previousValues,
            nextValues,
            refreshJobId,
          }));
        }
      }
    }

    // Master: één set-based MERGE (nieuw/gewijzigd-detectie via content_hash blijft identiek).
    const mergeResult = await new sql.Request(tx)
      .input('tableId', sql.BigInt, table.id)
      .input('syncedAt', sql.DateTime2, refreshStart)
      .query(`
        MERGE dbo.tb_cache AS target
        USING (SELECT @tableId AS table_id, partition_key, record_key, data_json, modified_at, content_hash
               FROM #stg_master) AS src
          ON target.table_id = src.table_id AND target.scope = 'master'
             AND target.partition_key = src.partition_key AND target.record_key = src.record_key
             AND target.detail_key = ${MASTER_DETAIL_KEY}
        WHEN MATCHED THEN UPDATE SET
          data_json = src.data_json, source_modified_at = src.modified_at, synced_at = @syncedAt, removed_at_source = 0,
          content_changed_at = CASE WHEN ISNULL(target.content_hash, '') <> src.content_hash THEN @syncedAt ELSE target.content_changed_at END,
          content_hash = src.content_hash
        WHEN NOT MATCHED THEN INSERT
          (table_id, scope, partition_key, record_key, detail_key, data_json, source_modified_at,
           synced_at, first_seen_at, removed_at_source, content_hash, content_changed_at)
          VALUES (@tableId, 'master', src.partition_key, src.record_key, ${MASTER_DETAIL_KEY}, src.data_json, src.modified_at,
           @syncedAt, @syncedAt, 0, src.content_hash, @syncedAt)
        OUTPUT $action AS merge_action, inserted.content_hash AS next_hash, deleted.content_hash AS prev_hash;
      `);
    const mergeCounts = countMergeActions(mergeResult.recordset);
    inserted = mergeCounts.inserted;
    updated = mergeCounts.updated;

    if (uniqueDetailRows.length) {
      await new sql.Request(tx)
        .input('tableId', sql.BigInt, table.id)
        .input('syncedAt', sql.DateTime2, refreshStart)
        .query(`
          MERGE dbo.tb_cache AS target
          USING (
            SELECT @tableId AS table_id, partition_key, record_key, detail_key, data_json, content_hash
            FROM #stg_detail
          ) AS src
            ON target.table_id = src.table_id AND target.scope = 'detail'
               AND target.partition_key = src.partition_key AND target.record_key = src.record_key
               AND target.detail_key = src.detail_key
          WHEN MATCHED THEN UPDATE SET
            data_json = src.data_json,
            synced_at = @syncedAt,
            removed_at_source = 0,
            content_changed_at = CASE WHEN ISNULL(target.content_hash, '') <> src.content_hash THEN @syncedAt ELSE target.content_changed_at END,
            content_hash = src.content_hash
          WHEN NOT MATCHED THEN INSERT
            (table_id, scope, partition_key, record_key, detail_key, data_json,
             synced_at, first_seen_at, removed_at_source, content_hash, content_changed_at)
          VALUES
            (@tableId, 'detail', src.partition_key, src.record_key, src.detail_key, src.data_json,
             @syncedAt, @syncedAt, 0, src.content_hash, @syncedAt);
        `);
    }

    if (ledgerEntries.length && !skipLedger) {
      try {
        await writeChangeLedgerEntries(() => new sql.Request(tx), ledgerEntries);
      } catch (ledgerErr) {
        logger.warn('Change-ledger (D365 insert/update events) wegschrijven mislukt; refresh gaat door', {
          tableKey: table.key,
          error: ledgerErr.message,
        });
      }
    }

    await new sql.Request(tx).batch(`
      IF OBJECT_ID('tempdb..#stg_master') IS NOT NULL DROP TABLE #stg_master;
      IF OBJECT_ID('tempdb..#stg_detail') IS NOT NULL DROP TABLE #stg_detail;
    `);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return { saved: masterRows.length, watermark, inserted, updated };
}

// ---------------------------------------------------------------------------
// refresh — volledige resync vanuit de bron naar tb_cache (master + detail, data_json)
// ---------------------------------------------------------------------------
async function refreshLookupTargetsAfterPurchaseOrders(table, visitedTables) {
  if (!table || table.key !== 'purchase-orders') return;
  const targetKeys = await orderLookupTargetKeys(
    await listRefreshCascadeTargets(table.id),
    getTableByKey,
  );
  const refreshFailures = [];
  for (const targetKey of targetKeys) {
    if (visitedTables.has(targetKey)) continue;
    try {
      await refresh(targetKey, { visitedTables });
    } catch (err) {
      logger.error('Lookup-doeltabel verversen mislukt', {
        tableKey: table.key,
        targetTableKey: targetKey,
        error: err.message,
        status: err.status || null,
      });
      const detail = formatEntityRefreshError(targetKey, err);
      refreshFailures.push(detail);
      refreshRunService.markEntityError(targetKey, detail);
    }
  }
  if (refreshFailures.length) {
    logger.warn('Lookup-doeltabellen konden niet volledig ververst worden; PO-data is opgeslagen', {
      tableKey: table.key,
      failures: refreshFailures,
    });
  }
  return refreshFailures;
}

async function refresh(tableKey, options = {}) {
  const visitedTables = options?.visitedTables instanceof Set
    ? options.visitedTables
    : new Set();
  const table = await getTableByKey(tableKey);
  if (visitedTables.has(table.key)) {
    return { orders: 0, truncated: false, syncedAt: null, skipped: 'already_visited' };
  }
  visitedTables.add(table.key);
  // Verse brondata betekent mogelijk verse lookup-labels; de TTL-cache voor het lazy
  // laden van sublijnen mag daar niet achterlopen.
  invalidateLookupEnrichmentCache();
  if (table.cacheMode === 'never') {
    refreshRunService.markEntityRunning(table.key);
    refreshRunService.markEntityDone(table.key);
    resetRefreshProgress(tableKey, {
      status: 'done',
      finishedAt: new Date().toISOString(),
    });
    return { orders: 0, truncated: false, syncedAt: null, skipped: 'cache_mode=never' };
  }
  const adapter = getFetchAdapter(table);
  const refreshStart = new Date();
  const refreshJobId = `tb-refresh-${table.id}-${refreshStart.getTime()}`;
  refreshRunService.markEntityRunning(table.key);
  resetRefreshProgress(tableKey, {
    status: 'fetching',
    startedAt: refreshStart.toISOString(),
  });

  const handleFetchProgress = (progress) => {
    const fetched = Number(progress?.fetched) || 0;
    const totalToFetchRaw = Number(progress?.totalToFetch);
    const sourceTotalRaw = Number(progress?.sourceTotal);
    const pagesFetched = Number(progress?.pagesFetched) || 0;
    const totalToFetch = Number.isFinite(totalToFetchRaw)
      ? totalToFetchRaw
      : (Number.isFinite(sourceTotalRaw) ? sourceTotalRaw : null);
    updateRefreshProgress(tableKey, {
      status: 'fetching',
      fetched,
      totalToFetch,
      sourceTotal: Number.isFinite(sourceTotalRaw) ? sourceTotalRaw : null,
      pagesFetched,
      truncated: Boolean(progress?.truncated),
      error: null,
    });
    refreshRunService.setEntityProgress(table.key, {
      fetched,
      ...(totalToFetch != null ? { totalToFetch } : {}),
    });
  };

  try {
    const { records, total, truncated, noticeText } = await adapter(table, { onProgress: handleFetchProgress });
    if (noticeText) refreshRunService.updateEntity(table.key, { notice_text: noticeText });
    const progressBeforeSave = getRefreshProgress(tableKey);
    const totalToFetch = Number.isFinite(Number(progressBeforeSave.totalToFetch))
      ? Number(progressBeforeSave.totalToFetch)
      : records.length;
    const sourceTotal = Number.isFinite(Number(progressBeforeSave.sourceTotal))
      ? Number(progressBeforeSave.sourceTotal)
      : (Number.isFinite(Number(total)) ? Number(total) : null);
    const pagesFetched = Number(progressBeforeSave.pagesFetched) || 0;

    updateRefreshProgress(tableKey, {
      status: 'saving',
      fetched: records.length,
      totalToFetch,
      saved: 0,
      totalToSave: records.length,
      sourceTotal,
      pagesFetched,
      truncated: Boolean(truncated),
      error: null,
    });

    try {
      const { headerInserted, lineInserted } = await syncSourceColumnsFromRecords(table, records);
      if (headerInserted || lineInserted) {
        logger.info('tb_columns uitgebreid met ontdekte bronvelden', {
          tableKey,
          headerInserted,
          lineInserted,
        });
      }
    } catch (discoveryErr) {
      logger.warn('Bronveld-discovery voor tb_columns mislukt; refresh gaat door', {
        tableKey,
        error: discoveryErr.message,
      });
    }
    // Alleen de geselecteerde (actieve) bron-kolommen landen in data_json. Zo draagt elke blob precies
    // de kolommen die op het bord staan i.p.v. de volledige bron-entiteit — de grootste payload-besparing
    // op zowel de refresh-write als elke read (#AB:177). Uitgezette kolommen horen niet in de cache.
    const [masterCols, detailCols, allMasterCols, allDetailCols, lookupDefs] = await Promise.all([
      listColumns({ tableId: table.id, scope: 'master', includeInactive: false }),
      listColumns({ tableId: table.id, scope: 'detail', includeInactive: false }),
      listColumns({ tableId: table.id, scope: 'master', includeInactive: true }),
      listColumns({ tableId: table.id, scope: 'detail', includeInactive: true }),
      getLookups(table.id),
    ]);
    const projectedMaster = resolveLookupProjectionColumns({
      activeColumns: masterCols,
      allColumns: allMasterCols,
      lookups: lookupDefs,
      scope: 'master',
    });
    const persistKeyFields = table.key === 'product-attribute-values'
      ? [...(Array.isArray(table.keyFields) ? table.keyFields : []), 'TextValue']
      : table.keyFields;
    const masterSource = (table.key === 'product-receipt-lines' || table.key === 'product-attribute-values')
      ? ensureKeyFieldColumnsInProjection(projectedMaster, allMasterCols, persistKeyFields)
      : projectedMaster;
    const detailSource = resolveLookupProjectionColumns({
      activeColumns: detailCols,
      allColumns: allDetailCols,
      lookups: lookupDefs,
      scope: 'detail',
    });
    if (truncated) {
      logger.warn('tb_cache sync afgekapt op de cap; verfijn de scope voor volledige dekking', {
        tableKey, opgehaald: records.length, totaalInBron: total,
      });
    }

    const pool = await getPool();
    // Nulmeting: de eerste vulling van een tabel is geen verzameling wijzigingen maar een
    // startpunt. Alles zou als "nieuw" in het dagboek belanden en het bord zou na de eerste sync
    // elke rij als nieuw markeren. Automatisch bij een lege cache; de admin kan het ook expliciet
    // forceren (opnieuw inlezen na een datamodel-wijziging) via options.baseline.
    const skipLedger = options.baseline === true || await isCacheEmpty(pool, table.id);
    if (skipLedger) {
      logger.info('Refresh als nulmeting: wijzigingen worden niet in het dagboek vastgelegd', {
        tableKey, reason: options.baseline === true ? 'expliciet' : 'lege cache',
      });
    }
    let watermark = null;
    let saved = 0;

    const validRecords = records.filter((rec) => rec.partitionKey && rec.recordKey);
    for (let offset = 0; offset < validRecords.length; offset += SAVE_CHUNK_SIZE) {
      const chunk = validRecords.slice(offset, offset + SAVE_CHUNK_SIZE);
      const { saved: chunkSaved, watermark: chunkWatermark, inserted: chunkInserted, updated: chunkUpdated } =
        await persistRecordsChunk(pool, table, chunk, refreshStart, masterSource, detailSource, refreshJobId, skipLedger);
      if (chunkWatermark && (!watermark || chunkWatermark > watermark)) watermark = chunkWatermark;
      saved += chunkSaved;
      refreshRunService.updateEntity(table.key, {
        inserted: chunkInserted,
        updated: chunkUpdated,
      });
      updateRefreshProgress(tableKey, {
        status: 'saving',
        fetched: records.length,
        totalToFetch,
        saved,
        totalToSave: records.length,
        sourceTotal,
        pagesFetched,
      truncated: Boolean(truncated),
    });
      refreshRunService.setEntityProgress(table.key, {
        fetched: records.length,
        saved,
        totalToFetch,
      });
    }

    const removedMasters = await pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('refreshStart', sql.DateTime2, refreshStart)
      .query(`
        UPDATE dbo.tb_cache
        SET removed_at_source = CASE WHEN synced_at < @refreshStart THEN 1 ELSE 0 END
        OUTPUT inserted.partition_key, inserted.record_key, inserted.detail_key,
               inserted.data_json, inserted.removed_at_source, deleted.removed_at_source AS previous_removed
        WHERE table_id = @tableId AND scope = 'master'
      `);

    const removedDetails = await pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('refreshStart', sql.DateTime2, refreshStart)
      .query(`
        UPDATE dbo.tb_cache
        SET removed_at_source = CASE WHEN synced_at < @refreshStart THEN 1 ELSE 0 END
        OUTPUT inserted.partition_key, inserted.record_key, inserted.detail_key,
               inserted.data_json, inserted.removed_at_source, deleted.removed_at_source AS previous_removed
        WHERE table_id = @tableId AND scope = 'detail'
      `);

    const removedEntries = [];
    let retentionCapReached = false;
    let retentionFetchTruncated = false;
    let retainedTotal = 0;
    let retainedFetched = 0;
    let retainedKeys = new Set();

    if (table.key === 'purchase-orders') {
      const retentionSettings = await getSyncRetentionSettings();
      const syncLayers = await resolveSyncLayers(await getTableSyncLayers(table), { forD365: false });
      const retentionResult = await applySyncRetainedTransitions(
        pool,
        table,
        removedMasters,
        retentionSettings,
        syncLayers
      );
      retentionCapReached = Boolean(retentionResult.capReached);
      retainedKeys = retentionResult.retainedKeys || new Set();
      retainedTotal = await countSyncRetainedMasters(pool, table.id);
    }

    refreshRunService.updateEntity(table.key, {
      deleted: countSoftDeleted(removedMasters.recordset, retainedKeys),
    });

    for (const row of removedMasters.recordset || []) {
      if (Number(row.previous_removed) === 1 || !Number(row.removed_at_source)) continue;
      const rowKey = `${row.partition_key}|${row.record_key}`;
      if (retainedKeys.has(rowKey)) continue;
      removedEntries.push(...buildD365LedgerEntries({
        tableId: table.id,
        partitionKey: row.partition_key,
        recordKey: row.record_key,
        detailKey: MASTER_DETAIL_KEY,
        action: 'DELETE',
        previousValues: parseJson(row.data_json),
        refreshJobId,
      }));
    }
    for (const row of removedDetails.recordset || []) {
      if (Number(row.previous_removed) === 1 || !Number(row.removed_at_source)) continue;
      // Zelfde guard als de koppen: een regel van een retained order wordt in fase 1 wel
      // soft-deleted maar in fase 2 hersteld — daar hoort geen DELETE-event bij.
      if (retainedKeys.has(`${row.partition_key}|${row.record_key}`)) continue;
      removedEntries.push(...buildD365LedgerEntries({
        tableId: table.id,
        partitionKey: row.partition_key,
        recordKey: row.record_key,
        detailKey: Number(row.detail_key),
        action: 'DELETE',
        previousValues: parseJson(row.data_json),
        refreshJobId,
      }));
    }
    if (removedEntries.length && !skipLedger) {
      try {
        await writeChangeLedgerEntries(() => pool.request(), removedEntries);
      } catch (err) {
        logger.warn('Change-ledger (D365 remove events) opslaan mislukt; refresh gaat door', {
          tableKey,
          error: err.message,
        });
      }
    }

    await pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('refreshStart', sql.DateTime2, refreshStart)
      .query(`
        UPDATE dbo.tb_cache
        SET removed_at_source = CASE WHEN synced_at < @refreshStart THEN 1 ELSE 0 END
        WHERE table_id = @tableId AND scope = 'detail'
      `);

    if (table.key === 'purchase-orders') {
      // Retained orders zijn bewust behouden: ze vallen buiten de sync-scope maar horen in de app
      // te blijven staan. De blanket soft-delete hierboven markeert ze toch als "weg", waarna fase 2
      // ze weer terugzet. In dat gat (een D365-fetch van tientallen seconden) zien andere lezers een
      // uitgedunde PO-cache. Dat is niet onschuldig: items en vendors leiden hun ophaal-scope af uit
      // de PO-cache met removed_at_source = 0, dus een losse items/vendors-refresh in dit venster
      // gooit massaal rijen weg. Daarom hier direct herstellen: retained = niet verwijderd.
      await restoreRetainedRowsPresence(pool, table.id);

      const retentionSettings = await getSyncRetentionSettings();
      const { selectFields, lineSelectFields } = await resolvePurchaseOrderSelectFields(table);
      const phase2 = await refreshRetainedPurchaseOrders({
        pool,
        table,
        refreshStart,
        refreshJobId,
        masterSource,
        detailSource,
        selectFields,
        lineSelectFields,
        retentionSettings,
        tableKey,
        skipLedger,
      });
      retainedTotal = phase2.retainedTotal;
      retainedFetched = phase2.retainedFetched;
      retentionFetchTruncated = Boolean(phase2.retentionFetchTruncated);
    }

    await pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('watermark', sql.DateTime2, watermark)
      .input('syncedAt', sql.DateTime2, refreshStart)
      .query(`
        MERGE dbo.tb_sync_state AS target
        USING (SELECT @tableId AS table_id) AS src ON target.table_id = src.table_id
        WHEN MATCHED THEN UPDATE SET watermark = @watermark, last_full_sync_at = @syncedAt, updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (table_id, watermark, last_full_sync_at) VALUES (@tableId, @watermark, @syncedAt);
      `);

    refreshRunService.markEntityDone(table.key);
    const lookupWarnings = await refreshLookupTargetsAfterPurchaseOrders(table, visitedTables);

    logger.info('tb_cache ververst', { tableKey, records: records.length, truncated, retainedFetched });
    updateRefreshProgress(tableKey, {
      status: 'done',
      fetched: records.length,
      totalToFetch,
      saved: records.length,
      totalToSave: records.length,
      sourceTotal,
      pagesFetched,
      truncated: Boolean(truncated),
      retainedTotal,
      retainedFetched,
      retainedPhase: 'done',
      retentionCapReached,
      retentionFetchTruncated,
      finishedAt: new Date().toISOString(),
      error: null,
      lookupWarnings: lookupWarnings ?? [],
    });
    try {
      const pruned = await pruneChangeLedger(pool, table.id);
      if (pruned) logger.info('Change-ledger opgeschoond', { tableKey, pruned, retentionDays: LEDGER_RETENTION_DAYS });
    } catch (pruneErr) {
      logger.warn('Change-ledger opschonen mislukt; refresh is verder klaar', { tableKey, error: pruneErr.message });
    }

    return {
      orders: records.length,
      truncated: Boolean(truncated),
      syncedAt: refreshStart.toISOString(),
      lookupWarnings: lookupWarnings ?? [],
    };
  } catch (err) {
    updateRefreshProgress(tableKey, {
      status: 'error',
      finishedAt: new Date().toISOString(),
      error: err.message || 'Refresh failed',
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// discoverSourceFields — los, licht discovery-pad voor de datamodel-pagina. Alleen via POST
// /discover-fields (knop "Discover D365 fields"), nooit automatisch bij GET /datamodel. Haalt ALLE
// bronvelden op met een kleine sample (bewust géén $select), voegt ontbrekende velden toe als
// inactieve kolommen en verwijdert bronkolommen die D365 niet teruggeeft. Schrijft NIETS naar
// tb_cache (#AB:177). Een gewone refresh pruned nooit (die sample is $select-beperkt).
// ---------------------------------------------------------------------------
const FIELD_DISCOVERY_ROW_LIMIT = 60;

async function discoverSourceFields(tableKey) {
  const table = await getTableByKey(tableKey);
  let records = [];
  if (table.key === 'purchase-orders') {
    const result = await fetchPurchaseOrders({
      supplierAccount: null,
      top: FIELD_DISCOVERY_ROW_LIMIT,
      skip: 0,
      fetchAll: false,
      maxItems: FIELD_DISCOVERY_ROW_LIMIT,
    });
    records = (Array.isArray(result.items) ? result.items : []).map((order) => ({
      masterRaw: order.raw || {},
      details: (Array.isArray(order.lines) ? order.lines : []).map((line) => ({ raw: line.raw || {} })),
    }));
  } else {
    const sample = await fetchEntityRecords({
      sourceEntity: table.sourceEntity,
      top: FIELD_DISCOVERY_ROW_LIMIT,
      skip: 0,
      fetchAll: false,
      maxItems: FIELD_DISCOVERY_ROW_LIMIT,
      selectFields: null,
    });
    records = (Array.isArray(sample.items) ? sample.items : []).map((raw) => ({
      masterRaw: raw && typeof raw === 'object' ? raw : {},
      details: [],
    }));
  }
  const { headerInserted, lineInserted, headerRemoved, lineRemoved } = await syncSourceColumnsFromRecords(table, records, { prune: true });
  const headerFields = collectDiscoveredFields(records, 'header');
  const lineFields = collectDiscoveredFields(records, 'line');
  logger.info('Veld-discovery uitgevoerd (datamodel)', {
    tableKey, headerInserted, lineInserted, headerRemoved, lineRemoved,
  });
  return {
    headerInserted,
    lineInserted,
    headerRemoved,
    lineRemoved,
    sampledRows: records.length,
    sampleByField: {
      header: sampleMapFromDiscoveredFields(headerFields),
      line: sampleMapFromDiscoveredFields(lineFields),
    },
  };
}

// ---------------------------------------------------------------------------
// fk_join lookup-verrijking (fundament voor de Excel-koppeling #AB:162; overgenomen uit #161):
// read-only afgeleide kolommen uit de cache van een andere tabel. Cache-gedreven, geen bron-call per rij.
// Excel-doeltabellen (provider 'excel') matchen partitie-loos (een Excel kent geen dataAreaId).
// ---------------------------------------------------------------------------
// Laadt de data voor één (gededupliceerde) lookup: doeltabel + doelkolommen + cache-rijen.
// Alle SQL-reads binnen één lookup zijn zo veel mogelijk parallel; retourneert null als de
// lookup overgeslagen moet worden (doeltabel weg, geen kolommen, geen veld-mapping).
/**
 * Bouwt de synthetische kolom voor één lookup-veld. Synthetisch = geen tb_columns-rij, dus id null;
 * hij bestaat alleen in de response.
 */
function buildSyntheticLookupColumn({
  derivedKey, targetColKey, targetColumn, tableId, sourceScope, targetTableKey, targetTableLabel,
}) {
  const tc = targetColumn;
  return {
    id: null,
    tableId,
    scope: sourceScope,
    key: derivedKey,
    label: tc ? `${tc.label} (${targetTableLabel})` : derivedKey,
    source: 'lookup',
    sourceField: null,
    dataType: tc ? tc.dataType : 'text',
    options: null,
    writable: false,
    writeMechanism: null,
    isDefaultVisible: true,
    filterable: false,
    sortable: true,
    isActive: true,
    sortOrder: 9000,
    lookup: {
      targetTableKey,
      targetColumnKey: targetColKey,
      targetTableLabel,
      targetColumnLabel: tc ? tc.label : targetColKey,
    },
  };
}

function lookupTimingLabel(targetTableKey) {
  const slug = String(targetTableKey || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
  return `tb_lookup_${slug}`;
}

async function loadSingleLookup(pool, table, lk, resolvedSourceField) {
  return time(lookupTimingLabel(lk.targetTableKey), async () => {
  let targetTable;
  try {
    targetTable = await getTableByKey(lk.targetTableKey);
  } catch {
    return null; // doeltabel bestaat niet (meer) of is inactief -> lookup overslaan
  }
  const partitionless = targetTable.source && targetTable.source.providerType === 'excel';

  const [targetColumnsRaw, cacheRes] = await Promise.all([
    listColumns({ tableId: targetTable.id, scope: 'master', includeInactive: true }),
    pool.request()
      .input('tableId', sql.BigInt, targetTable.id)
      .query(`SELECT partition_key, record_key, data_json FROM dbo.tb_cache
              WITH (NOLOCK)
              WHERE table_id = @tableId AND scope = 'master' AND removed_at_source = 0`),
  ]);
  const targetColumnsAll = targetColumnsRaw.filter((column) => column.source === 'source');
  const targetColumns = targetColumnsAll.filter((column) => column.isActive);
  const targetColByKeyAll = new Map(targetColumnsAll.map((c) => [c.key, c]));
  const targetColByKey = new Map(targetColumns.map((c) => [c.key, c]));
  const configuredTargetKeys = [
    ...new Set([
      ...Object.values(isPlainObject(lk.fields) ? lk.fields : {}),
      ...targetColumnsAll.map((column) => String(column.key || '').trim()),
    ].filter(Boolean)),
  ];
  if (!configuredTargetKeys.length && !targetColumns.length) return null;
  const targetAliasesByKey = buildLookupTargetAliases(targetColumns, targetColumnsAll);
  const fieldMap = buildLookupFieldMap({
    targetTableKey: lk.targetTableKey,
    targetFieldKeys: configuredTargetKeys,
    existingFields: lk.fields,
  });
  const fieldEntries = Object.entries(fieldMap)
    .filter(([derivedKey, targetColKey]) => (
      Boolean(String(derivedKey || '').trim()) && targetColByKeyAll.has(String(targetColKey || '').trim())
    ))
    .map(([derivedKey, targetColKey]) => [String(derivedKey).trim(), String(targetColKey).trim()]);
  // Alleen actieve doelkolommen in de board-read: inactive velden hoorden hier als null op elke
  // detailregel (~300+ keys × 20k regels ≈ 300 MB JSON in PROD). Admin/datamodel houdt het volledige
  // fieldMap in lk.fields; de read-response mag niet elke inactive lookup-projectie materialiseren.
  const activeFieldEntries = fieldEntries.filter(([, targetColKey]) => targetColByKey.has(targetColKey));
  if (!activeFieldEntries.length) return null;

  const byKey = new Map();
  for (const r of cacheRes.recordset) {
    const parsed = parseJson(r.data_json);
    const lookupSource = enrichLookupSourceFromCacheRow(lk.targetTableKey, r.record_key, parsed);
    let mapKey = buildLookupCacheKey(r.partition_key, lookupSource, {
      ...lk,
      partitionless,
      sourceFieldKey: resolvedSourceField,
    });
    // Fallback: data_json mist het FK-veld (bijv. itemNumber niet in items masterSource opgenomen).
    // record_key IS de natuurlijke sleutel van de doelentiteit en heeft dezelfde waarde als het
    // FK-veld op de bronkant (bijv. PO-regelkolom 'itemNumber' = ItemNumber = record_key van items).
    // Alleen toepassen als het veld écht ontbreekt, anders wordt een al-gebouwde key overschreven.
    if (!mapKey && r.record_key) {
      mapKey = partitionless
        ? String(r.record_key).trim()
        : `${String(r.partition_key || '').toLowerCase()}|${String(r.record_key).trim()}`;
    }
    if (mapKey) byKey.set(mapKey, parsed);
  }

  const synthetic = activeFieldEntries
    .map(([derivedKey, targetColKey]) => buildSyntheticLookupColumn({
      derivedKey,
      targetColKey,
      targetColumn: targetColByKey.get(targetColKey),
      tableId: table.id,
      sourceScope: lk.sourceScope,
      targetTableKey: lk.targetTableKey,
      targetTableLabel: targetTable.label,
    }));

  return {
    synthetic,
    enrichedLookup: {
      ...lk,
      sourceFieldKey: resolvedSourceField,
      targetAliasesByKey,
      fields: fieldMap,
      byKey,
      fieldEntries: activeFieldEntries,
      partitionless,
    },
  };
  });
}

function addLookupColumnsByScope(sourceScope, syntheticColumns, masterCols, detailCols) {
  const targetColumns = sourceScope === 'detail' ? detailCols : masterCols;
  targetColumns.push(...syntheticColumns);
}

async function loadLookupEnrichment(table) {
  const pool = await getPool();
  // getLookups en de bronkolommen zijn onafhankelijk; parallel scheelt een SQL-round-trip.
  const [lookups, lookupSourceMasterCols, lookupSourceDetailCols] = await Promise.all([
    getLookups(table.id),
    listColumns({ tableId: table.id, scope: 'master', includeInactive: true }),
    listColumns({ tableId: table.id, scope: 'detail', includeInactive: true }),
  ]);
  if (!lookups.length) return { lookups: [], masterCols: [], detailCols: [] };

  // Dedupe-pass (sync, volgorde-behoudend), daarna alle lookups parallel laden.
  const seenLookupSignatures = new Set();
  const uniqueLookups = [];
  for (const lk of lookups) {
    const normalizedSourceScope = lk.sourceScope === 'detail' ? 'detail' : 'master';
    const lookupSourceColumns = normalizedSourceScope === 'detail' ? lookupSourceDetailCols : lookupSourceMasterCols;
    const resolvedSourceField = resolveLookupSourceKey(lk, lookupSourceColumns);
    const dedupeSignature = buildLookupDedupeSignature({
      sourceScope: normalizedSourceScope,
      sourceFieldKey: resolvedSourceField,
      targetTableKey: lk.targetTableKey,
    });
    if (seenLookupSignatures.has(dedupeSignature)) continue;
    seenLookupSignatures.add(dedupeSignature);
    uniqueLookups.push({ lk, resolvedSourceField });
  }

  const loaded = await Promise.all(
    uniqueLookups.map(({ lk, resolvedSourceField }) => loadSingleLookup(pool, table, lk, resolvedSourceField))
  );

  const enriched = [];
  const masterCols = [];
  const detailCols = [];
  for (let i = 0; i < loaded.length; i++) {
    const result = loaded[i];
    if (!result) continue;
    const { lk } = uniqueLookups[i];
    addLookupColumnsByScope(lk.sourceScope, result.synthetic, masterCols, detailCols);
    enriched.push(result.enrichedLookup);
  }

  return { lookups: enriched, masterCols, detailCols };
}

function applyLookups(valueBag, partitionKey, enrichedLookups, scope, sourceValues = null) {
  for (const lk of enrichedLookups) {
    if (lk.sourceScope !== scope) continue;
    const lookupSourceValues = sourceValues && typeof sourceValues === 'object' ? sourceValues : valueBag;
    const lookupKey = buildLookupCacheKey(partitionKey, lookupSourceValues, lk);
    const targetData = lookupKey ? lk.byKey.get(lookupKey) : null;
    for (const [derivedKey, targetColKey] of lk.fieldEntries) {
      let value = targetData && targetColKey in targetData ? targetData[targetColKey] : null;
      if ((value === null || value === undefined) && targetData && lk.targetAliasesByKey) {
        const aliases = Array.isArray(lk.targetAliasesByKey[targetColKey]) ? lk.targetAliasesByKey[targetColKey] : [];
        for (const aliasKey of aliases) {
          if (!Object.prototype.hasOwnProperty.call(targetData, aliasKey)) continue;
          const aliasValue = targetData[aliasKey];
          if (aliasValue === null || aliasValue === undefined) continue;
          value = aliasValue;
          break;
        }
      }
      valueBag[derivedKey] = value;
    }
  }
}

// Numerieke 0 is een echte waarde. Lege deliver-remainder (D365-veld bestaat niet op
// PurchaseOrderLineV2) vullen we na de ontvangst-lookup met remaining qty, inclusief 0.
function fillEmptyNumberFromFallback(valueBag, targetKey, fallbackKey) {
  if (!valueBag || typeof valueBag !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(valueBag, targetKey)) return;
  const current = valueBag[targetKey];
  if (current !== null && current !== undefined && current !== '') return;
  const fallback = toLineNumeric(valueBag[fallbackKey]);
  if (fallback === null) return;
  valueBag[targetKey] = fallback;
}

function isFormulaColumn(column) {
  return Boolean(String(column?.formulaExpr || '').trim());
}

function assertCustomColumnWritable(column) {
  if (!column || column.source !== 'custom') {
    throw Object.assign(new Error('Only custom columns are editable'), { status: 400 });
  }
  if (String(column?.dataType || '').toLowerCase() === 'image') {
    throw Object.assign(new Error('Image columns are read-only'), { status: 400 });
  }
  if (String(column?.dataType || '').toLowerCase() === 'date_period') {
    throw Object.assign(new Error('Date period columns are read-only'), { status: 400 });
  }
  if (String(column?.dataType || '').toLowerCase() === 'remarks') {
    throw Object.assign(new Error('Remarks columns do not support direct value writes'), { status: 400 });
  }
  if (isFormulaColumn(column)) {
    throw Object.assign(new Error('Formula columns are read-only'), { status: 400 });
  }
}

function compileFormulaColumns(columns) {
  return (Array.isArray(columns) ? columns : [])
    .filter((column) => isFormulaColumn(column))
    .map((column) => {
      try {
        return {
          column,
          compiled: compileFormula(column.formulaExpr),
          compileError: null,
        };
      } catch (err) {
        return {
          column,
          compiled: null,
          compileError: `Invalid formula: ${err?.message || 'Unknown error'}`,
        };
      }
    });
}

function compileMasterFormulaColumns(masterColumns) {
  return compileFormulaColumns(masterColumns);
}

function buildFormulaEvaluationContext(rowValues, columns, compiledFormulas) {
  const evalValues = withCaseInsensitiveKeys(rowValues);
  const referencedKeys = new Set();
  for (const item of Array.isArray(compiledFormulas) ? compiledFormulas : []) {
    for (const ref of [...(item?.compiled?.references || [])]) {
      referencedKeys.add(String(ref || '').toLowerCase());
    }
  }
  for (const column of Array.isArray(columns) ? columns : []) {
    const keyLower = String(column?.key || '').toLowerCase();
    if (!keyLower || !referencedKeys.has(keyLower)) continue;
    if (column.source !== 'source') continue;
    const value = rowValues?.[column.key];
    evalValues[column.key] = value;
    evalValues[keyLower] = value;
  }
  return evalValues;
}

function withCaseInsensitiveKeys(values) {
  const normalized = { ...(values || {}) };
  for (const [key, value] of Object.entries(values || {})) {
    const lowerKey = String(key || '').toLowerCase();
    if (lowerKey && !Object.prototype.hasOwnProperty.call(normalized, lowerKey)) {
      normalized[lowerKey] = value;
    }
  }
  return normalized;
}

function applyFormulaColumnsToRowValues(rowValues, compiledFormulas, options = {}) {
  const formulaErrors = {};
  const { evaluationValues: providedEvaluationValues = null, today = null } = options;
  const evaluationValues = providedEvaluationValues
    ? withCaseInsensitiveKeys(providedEvaluationValues)
    : withCaseInsensitiveKeys(rowValues);
  for (const item of Array.isArray(compiledFormulas) ? compiledFormulas : []) {
    const formulaKey = item?.column?.key;
    if (!formulaKey) continue;
    if (item.compileError) {
      rowValues[formulaKey] = null;
      evaluationValues[formulaKey] = null;
      evaluationValues[String(formulaKey).toLowerCase()] = null;
      formulaErrors[formulaKey] = item.compileError;
      continue;
    }
    const result = evaluateCompiledFormula(item.compiled, evaluationValues, { resultType: item.column.dataType, today });
    rowValues[formulaKey] = result.value;
    evaluationValues[formulaKey] = result.value;
    evaluationValues[String(formulaKey).toLowerCase()] = result.value;
    if (result.error) formulaErrors[formulaKey] = result.error;
  }
  return formulaErrors;
}

// ---------------------------------------------------------------------------
// Eén rij herberekenen na een cel-edit: zodat een formulekolom die de bewerkte
// kolom refereert direct het nieuwe resultaat toont, zonder een volledige
// board-refresh (2000+ rijen). Alleen déze ene rij wordt opnieuw opgebouwd
// (master-cache-record + customs + lookups + evt. gekoppelde regel-totalen);
// er wordt niets herberekend als de tabel geen formulekolommen heeft.
async function recalculateMasterRowFormulas({ table, masterCols, partitionKey, recordKey, userId }) {
  const compiledMasterFormulas = compileMasterFormulaColumns(masterCols);
  if (!compiledMasterFormulas.length) return { formulaValues: {}, formulaErrors: {} };

  const part = String(partitionKey || '').trim();
  const record = String(recordKey || '').trim();
  if (!part || !record) return { formulaValues: {}, formulaErrors: {} };

  const pool = await getPool();
  const [masterRowResult, customResult, enrichment, runtimeLinks] = await Promise.all([
    pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('partitionKey', sql.NVarChar(32), part)
      .input('recordKey', sql.NVarChar(128), record)
      .query(`
        SELECT data_json FROM dbo.tb_cache WITH (NOLOCK)
        WHERE table_id = @tableId AND scope = 'master'
          AND partition_key = @partitionKey AND record_key = @recordKey
      `),
    pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('partitionKey', sql.NVarChar(32), part)
      .input('recordKey', sql.NVarChar(128), record)
      .input('detailKey', sql.Int, MASTER_DETAIL_KEY)
      .query(`
        SELECT c.[key], cv.value_text, cv.value_number, cv.value_date, cv.value_bool
        FROM dbo.tb_custom_values cv WITH (NOLOCK)
        INNER JOIN dbo.tb_columns c WITH (NOLOCK) ON c.id = cv.column_id
        WHERE cv.table_id = @tableId AND c.is_active = 1
          AND cv.partition_key = @partitionKey AND cv.record_key = @recordKey AND cv.detail_key = @detailKey
      `),
    loadLookupEnrichmentCached(table),
    loadUserRuntimeHeaderLinks(pool, userId, table.key),
  ]);

  if (!masterRowResult.recordset.length) return { formulaValues: {}, formulaErrors: {} };

  const masterJson = parseJson(masterRowResult.recordset[0].data_json);
  const masterCustom = {};
  for (const row of customResult.recordset) {
    masterCustom[row.key] = pickTypedValue({
      text: row.value_text, number: row.value_number, date: row.value_date, bool: row.value_bool,
    });
  }

  const masterValues = buildValuesFromColumns(masterCols, masterJson, masterCustom);
  applyLookups(masterValues, part, enrichment.lookups, 'master', masterJson);

  // Gekoppelde regel-totalen/-waarden vullen alleen ophalen als de gebruiker
  // die koppeling daadwerkelijk heeft ingesteld — anders is dit een no-op en
  // besparen we de (kleine) extra detail-query.
  const hasRuntimeLinks = Boolean(
    runtimeLinks?.lineTotalHeaderLinks?.length || runtimeLinks?.lineValueHeaderLinks?.length
  );
  if (hasRuntimeLinks) {
    const { details } = await readRowDetails({ tableKey: table.key, partitionKey: part, recordKey: record });
    applyRuntimeLinkedHeaderValues(masterValues, details, runtimeLinks);
  }

  const formulaErrors = applyFormulaColumnsToRowValues(masterValues, compiledMasterFormulas, { today: getUtcMidnight() });

  const formulaValues = {};
  for (const item of compiledMasterFormulas) {
    const key = item?.column?.key;
    if (key) formulaValues[key] = masterValues[key];
  }
  return { formulaValues, formulaErrors };
}

function resolveSourceColumnValue(sourceJson, column) {
  const safeSource = sourceJson && typeof sourceJson === 'object' ? sourceJson : {};
  const sourceFieldKey = String(column?.sourceField || '').trim();
  if (sourceFieldKey && Object.prototype.hasOwnProperty.call(safeSource, sourceFieldKey)) {
    return safeSource[sourceFieldKey];
  }
  const columnKey = String(column?.key || '').trim();
  if (columnKey && Object.prototype.hasOwnProperty.call(safeSource, columnKey)) {
    return safeSource[columnKey];
  }
  return null;
}

function normalizeBoardColumnKey(value) {
  return String(value || '').trim().slice(0, 64);
}

function normalizeRuntimeLinkArray(value) {
  const entries = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? [value] : []);
  const seen = new Set();
  return entries.slice(0, MAX_BOARD_LINKS).reduce((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;
    const lineColumnKey = normalizeBoardColumnKey(entry.lineColumnKey);
    const headerColumnKey = normalizeBoardColumnKey(entry.headerColumnKey);
    if (!lineColumnKey || !headerColumnKey) return acc;
    const signature = `${lineColumnKey}|${headerColumnKey}`;
    if (seen.has(signature)) return acc;
    seen.add(signature);
    acc.push({ lineColumnKey, headerColumnKey });
    return acc;
  }, []);
}

async function loadUserRuntimeHeaderLinks(pool, userId, boardKey, options) {
  return loadRuntimeHeaderLinks(pool, userId, boardKey, options);
}

function toLineNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function calculateLinkedLineTotal(details, lineColumnKey) {
  if (!Array.isArray(details) || !lineColumnKey) return 0;
  return details.reduce((total, detail) => {
    const numeric = toLineNumeric(detail?.values?.[lineColumnKey]);
    return numeric === null ? total : total + numeric;
  }, 0);
}

// Distinct ruwe regelwaarden voor een value-link. Ruw, want het board formatteert ze zelf
// met het dataType van de regel-kolom (formatCellValue) voordat het ze samenvoegt.
function collectLinkedLineValues(details, lineColumnKey) {
  if (!Array.isArray(details) || !lineColumnKey) return [];
  const seen = new Set();
  const list = [];
  for (const detail of details) {
    const raw = detail?.values?.[lineColumnKey];
    if (raw === null || raw === undefined || raw === '') continue;
    const dedupeKey = String(raw).trim();
    if (!dedupeKey || dedupeKey === '-' || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    list.push(raw);
  }
  return list;
}

function calculateLinkedLineValues(details, lineColumnKey) {
  const list = collectLinkedLineValues(details, lineColumnKey).map((raw) => String(raw).trim());
  if (!list.length) return '-';
  return list.length === 1 ? list[0] : list.join(', ');
}

// Vult de gekoppelde header-kolommen en geeft de ruwe regelwaarden per header-kolom terug,
// zodat het board die kan formatteren zonder de sublijnen in de payload te hebben.
function applyRuntimeLinkedHeaderValues(masterValues, details, runtimeLinks) {
  if (!masterValues || typeof masterValues !== 'object') return {};
  const totalLinks = Array.isArray(runtimeLinks?.lineTotalHeaderLinks) ? runtimeLinks.lineTotalHeaderLinks : [];
  const valueLinks = Array.isArray(runtimeLinks?.lineValueHeaderLinks) ? runtimeLinks.lineValueHeaderLinks : [];

  for (const link of totalLinks) {
    const headerColumnKey = normalizeBoardColumnKey(link?.headerColumnKey);
    const lineColumnKey = normalizeBoardColumnKey(link?.lineColumnKey);
    if (!headerColumnKey || !lineColumnKey) continue;
    masterValues[headerColumnKey] = calculateLinkedLineTotal(details, lineColumnKey);
  }
  const linkedLineValues = {};
  for (const link of valueLinks) {
    const headerColumnKey = normalizeBoardColumnKey(link?.headerColumnKey);
    const lineColumnKey = normalizeBoardColumnKey(link?.lineColumnKey);
    if (!headerColumnKey || !lineColumnKey) continue;
    masterValues[headerColumnKey] = calculateLinkedLineValues(details, lineColumnKey);
    linkedLineValues[headerColumnKey] = collectLinkedLineValues(details, lineColumnKey);
  }
  return linkedLineValues;
}

// Kolomwaarden voor één cache-record. Gehoist uit read() zodat de detail-projectie
// gedeeld kan worden met readRowDetails (lazy laden bij expanden).
function buildValuesFromColumns(cols, sourceJson, custom) {
  const values = {};
  for (const col of cols) {
    if (isFormulaColumn(col)) values[col.key] = null;
    else if (col.source === 'source') values[col.key] = resolveSourceColumnValue(sourceJson, col);
    else values[col.key] = custom && col.key in custom ? custom[col.key] : null;
  }
  return values;
}

// Eén detailregel projecteren naar de board-vorm. ctx bundelt de gedeelde lookups die
// zowel de board-read als de per-order details-read opbouwen.
function buildDetailRow(d, ctx) {
  const {
    detailCols, customByCell, enrichment, historyByCell, trackMarks,
    lineChanges, compareAgainstBaseline, hasLedgerWindow,
  } = ctx;
  const detailCustom = customByCell.get(`${d.partition_key}|${d.record_key}|${d.detail_key}`) || {};
  const detailJson = parseJson(d.data_json);
  const detailLookupSource = buildDetailLookupSourceValues(detailJson, d.record_key, d.detail_key);
  const detailValues = buildValuesFromColumns(detailCols, detailJson, detailCustom);
  applyLookups(detailValues, d.partition_key, enrichment.lookups, 'detail', detailLookupSource);
  const pavExtras = applyProductAttributePivot(
    detailValues,
    detailValues.itemNumber || detailJson.itemNumber || detailJson.ItemNumber,
    ctx.pavPivot,
    ctx.pavColumns,
  );
  if (Array.isArray(ctx.compiledDetailFormulas) && ctx.compiledDetailFormulas.length) {
    applyFormulaColumnsToRowValues(detailValues, ctx.compiledDetailFormulas, { today: ctx.formulaToday });
  }
  fillEmptyNumberFromFallback(detailValues, 'deliverRemainder', 'remainingPurchaseQuantity');
  fillEmptyNumberFromFallback(detailValues, 'deliverRemainderApprox', 'remainingPurchaseQuantity');
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

function createOrderChangeState() {
  return { isNew: false, isChanged: false, isRemoved: false, changedFieldKeys: new Set() };
}

function createLineChangeState() {
  return { isNew: false, isChanged: false, isRemoved: false, changedFieldKeys: new Set() };
}

function buildD365ChangeState(ledgerRows) {
  const orderChanges = new Map();
  const lineChanges = new Map();
  // Samenvatting per order van wat er met de régels gebeurde. De geaggregeerde detail-read leest de
  // losse regels niet meer, maar heeft deze vlaggen wel nodig voor de activiteitsbalk.
  const lineChangesByOrder = new Map();
  if (!Array.isArray(ledgerRows) || !ledgerRows.length) {
    return { orderChanges, lineChanges, lineChangesByOrder };
  }

  for (const row of ledgerRows) {
    const orderKey = `${row.partition_key}|${row.record_key}`;
    if (!orderChanges.has(orderKey)) orderChanges.set(orderKey, createOrderChangeState());
    const orderState = orderChanges.get(orderKey);
    const detailKey = Number(row.detail_key);
    const fieldKey = String(row.field_key || '').trim();
    const action = String(row.action || '').toUpperCase();

    if (detailKey === MASTER_DETAIL_KEY) {
      // Zelfde last-action-wint als bij regels: DELETE+INSERT (retained restore) mag
      // de order niet als verwijderd laten staan.
      if (action === 'INSERT') {
        orderState.isNew = true;
        orderState.isRemoved = false;
      } else if (action === 'UPDATE') {
        orderState.isChanged = true;
        orderState.isRemoved = false;
      } else if (action === 'DELETE') {
        orderState.isRemoved = true;
        orderState.isNew = false;
        orderState.isChanged = false;
        orderState.changedFieldKeys.clear();
      }
      if (fieldKey) orderState.changedFieldKeys.add(fieldKey);
      continue;
    }

    const lineKey = `${orderKey}|${detailKey}`;
    if (!lineChanges.has(lineKey)) lineChanges.set(lineKey, createLineChangeState());
    const lineState = lineChanges.get(lineKey);
    // Een refresh die een regel opnieuw ophaalt schrijft eerst DELETE en daarna INSERT. Zonder de
    // reset hieronder bleef isRemoved staan en gold een bestaande regel de rest van het
    // ledger-venster als verwijderd — hij verdween dan uit de RCCP-belasting (die filtert op
    // !isRemoved) en werd op het bord als vervallen getoond. De laatste actie wint: INSERT en
    // UPDATE bewijzen dat de regel er weer is.
    if (action === 'INSERT') {
      lineState.isNew = true;
      lineState.isRemoved = false;
    } else if (action === 'UPDATE') {
      lineState.isChanged = true;
      lineState.isRemoved = false;
    } else if (action === 'DELETE') {
      lineState.isRemoved = true;
      lineState.isNew = false;
      lineState.isChanged = false;
      lineState.changedFieldKeys.clear();
    }
    if (fieldKey) lineState.changedFieldKeys.add(fieldKey);
  }

  // Zelfde afleiding als buildDetailRollup(): een regel die nieuw én gewijzigd is telt als nieuw,
  // maar losse gewijzigde velden maken de order altijd "changed".
  for (const [lineKey, lineState] of lineChanges) {
    const orderKey = lineKey.slice(0, lineKey.lastIndexOf('|'));
    if (!lineChangesByOrder.has(orderKey)) {
      lineChangesByOrder.set(orderKey, { hasNewLine: false, hasChangedLine: false, hasRemovedLine: false });
    }
    const summary = lineChangesByOrder.get(orderKey);
    if (lineState.isNew) summary.hasNewLine = true;
    if ((!lineState.isNew && lineState.isChanged) || lineState.changedFieldKeys.size > 0) {
      summary.hasChangedLine = true;
    }
    if (lineState.isRemoved) summary.hasRemovedLine = true;
  }

  return { orderChanges, lineChanges, lineChangesByOrder };
}

// De drie tb_cache-reads (masters, details, custom values) parallel op de pool;
// onafhankelijke queries, dus geen reden om op elkaar te wachten.
// Elk deel krijgt een eigen Server-Timing-label (tb_read_masters/details/custom).
async function readCacheRows(pool, tableId, includeRemoved, recordFilter = null, detailPlanPromise = null) {
  const mastersRequest = pool.request().input('tableId', sql.BigInt, tableId);
  const mastersScope = applyRecordFilter(mastersRequest, recordFilter, 'c');
  const mastersPromise = time('tb_read_masters', () => mastersRequest
    .query(`
      SELECT c.partition_key, c.record_key, c.data_json, c.source_modified_at, c.removed_at_source,
             c.sync_retained, c.first_seen_at, c.content_changed_at
      FROM dbo.tb_cache c WITH (NOLOCK)
      WHERE c.table_id = @tableId AND c.scope = 'master'
      ${includeRemoved ? '' : `AND NOT EXISTS (
          SELECT 1 FROM dbo.tb_row_exclusions ex WITH (NOLOCK)
          WHERE ex.table_id = @tableId AND ex.partition_key = c.partition_key AND ex.record_key = c.record_key
        )`}
      ${mastersScope}
      ORDER BY c.record_key
    `));

  // De detail-read kent drie vormen, van goedkoop naar duur (zie collapsedDetailRollup.js en
  // collapsedDetailFields.js). Blijven de sublijnen buiten de response, dan rekent SQL de rollup
  // per order uit ('aggregate') of levert het alleen de velden die de rollup nog leest ('fields').
  // Lukt geen van beide, dan komt de volledige data_json mee, zoals voorheen.
  const detailsPromise = time('tb_read_details', async () => {
    const plan = detailPlanPromise ? await detailPlanPromise : null;

    if (plan?.mode === 'aggregate') {
      const request = pool.request().input('tableId', sql.BigInt, tableId);
      if (plan.baselineAt) request.input('baselineAt', sql.DateTime2, plan.baselineAt);
      const result = await request.query(plan.sql);
      return {
        recordset: [],
        rollupByRecord: parseCollapsedRollupRows(result.recordset, plan.rollupPlan),
        rollupPlan: plan.rollupPlan,
      };
    }

    const detailFields = plan?.mode === 'fields' ? plan.fields : null;
    const detailsRequest = pool.request().input('tableId', sql.BigInt, tableId);
    const detailsScope = applyRecordFilter(detailsRequest, recordFilter);
    const projection = detailFields ? buildDetailProjectionSql(detailFields) : 'data_json';
    const result = await detailsRequest
      .query(`
        SELECT partition_key, record_key, detail_key, ${projection}, removed_at_source, first_seen_at, content_changed_at
        FROM dbo.tb_cache WITH (NOLOCK)
        WHERE table_id = @tableId AND scope = 'detail'
        ${detailsScope}
        ORDER BY record_key, detail_key
      `);
    if (detailFields) {
      for (const row of result.recordset) {
        row.data_json = buildDetailJsonFromProjection(row, detailFields);
      }
    }
    return result;
  });

  const customRequest = pool.request().input('tableId', sql.BigInt, tableId);
  const customScope = applyRecordFilter(customRequest, recordFilter, 'cv');
  const customPromise = time('tb_read_custom', () => customRequest
    .query(`
      SELECT cv.column_id, c.[key], c.scope, c.data_type, cv.partition_key, cv.record_key,
             cv.detail_key, cv.value_text, cv.value_number, cv.value_date, cv.value_bool
      FROM dbo.tb_custom_values cv WITH (NOLOCK)
      INNER JOIN dbo.tb_columns c WITH (NOLOCK) ON c.id = cv.column_id
      WHERE cv.table_id = @tableId AND c.is_active = 1
      ${customScope}
    `));

  const [mastersResult, detailsResult, customResult] = await Promise.all([
    mastersPromise, detailsPromise, customPromise,
  ]);
  return {
    mastersResult,
    detailsResult,
    customResult,
    rollupByRecord: detailsResult.rollupByRecord || null,
    rollupPlan: detailsResult.rollupPlan || null,
  };
}

function historyCellKey(partitionKey, recordKey, detailKey) {
  return JSON.stringify([String(partitionKey), String(recordKey), Number(detailKey)]);
}

function buildHistoryByCell(rows) {
  const historyByCell = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = historyCellKey(row.partition_key, row.record_key, row.detail_key);
    if (!historyByCell.has(key)) historyByCell.set(key, {});
    historyByCell.get(key)[String(row.column_id)] = true;
  }
  return historyByCell;
}

// recordFilter beperkt de read tot één order — gebruikt door readRowDetails, zodat het
// lazy laden van sublijnen niet de hele historie-tabel hoeft te scannen.
function applyRecordFilter(request, recordFilter, alias = '') {
  if (!recordFilter) return '';
  request.input('partitionKey', sql.NVarChar(32), recordFilter.partitionKey);
  request.input('recordKey', sql.NVarChar(128), recordFilter.recordKey);
  const prefix = alias ? `${alias}.` : '';
  return `AND ${prefix}partition_key = @partitionKey AND ${prefix}record_key = @recordKey`;
}

async function loadHistoryByCell(pool, tableId, recordFilter = null) {
  const request = pool.request().input('tableId', sql.BigInt, tableId);
  const scope = applyRecordFilter(request, recordFilter);
  const result = await request
    .query(`
      SELECT column_id, partition_key, record_key, detail_key
      FROM dbo.tb_cell_history WITH (NOLOCK)
      WHERE table_id = @tableId ${scope}
      GROUP BY column_id, partition_key, record_key, detail_key
      UNION
      SELECT column_id, partition_key, record_key, detail_key
      FROM dbo.tb_field_corrections WITH (NOLOCK)
      WHERE table_id = @tableId ${scope}
      GROUP BY column_id, partition_key, record_key, detail_key
    `);
  return buildHistoryByCell(result.recordset);
}

// ---------------------------------------------------------------------------
// Track changes — streepjes-patronen per cel, meeberekend in de board-read.
// Bronnen: tb_cell_history (custom-kolommen) + tb_field_corrections met
// status='applied' (write-back naar D365-kolommen). Eén query, alleen bij
// ≥1 actieve kolom. Bucketing (week/session) volledig in SQL; JS bouwt alleen
// de kant-en-klare 5-tekenstrings via buildMarkPattern.
// ---------------------------------------------------------------------------
async function loadTrackMarks(pool, tableId, enabledColumns, mode, boundaries, recordFilter = null) {
  const empty = { trackMarksByCell: new Map(), activeOffsetByColumnId: {}, defaultPattern: {} };
  if (!Array.isArray(enabledColumns) || enabledColumns.length === 0) return empty;

  const maxOffset = MARK_COUNT - 1;
  const activeOffsetByColumnId = {};
  const defaultPattern = {};
  const request = pool.request().input('tableId', sql.BigInt, tableId);

  // Week-mode: bereken de active-offset per kolom mét dezelfde kalender als de
  // bucketing (SQL DATEDIFF(week, ...)). JS-datumrekenen met een vaste 7-daagse
  // deling wijkt rond weekgrenzen/DATEFIRST af van DATEDIFF(week) en zou dan
  // onterecht gele/grijze streepjes tonen. SQL is hier de bron van waarheid.
  let weekOffsetByColumnId = null;
  if (mode === 'week') {
    const weekReq = pool.request();
    const weekRows = [];
    enabledColumns.forEach((col, i) => {
      const cId = 'wc' + i;
      const aId = 'wa' + i;
      weekReq.input(cId, sql.BigInt, col.columnId);
      weekReq.input(aId, sql.DateTime2, col.activatedAt);
      weekRows.push(`(@${cId}, @${aId})`);
    });
    const weekResult = await weekReq.query(`
      SELECT v.column_id, DATEDIFF(week, v.activated_at, SYSUTCDATETIME()) AS week_offset
      FROM (VALUES ${weekRows.join(', ')}) AS v(column_id, activated_at)
    `);
    weekOffsetByColumnId = {};
    for (const r of weekResult.recordset) {
      weekOffsetByColumnId[String(r.column_id)] = Number(r.week_offset);
    }
  }

  // VALUES-join met per-kolom activatedAt (fresh start per kolom).
  const valueRows = [];
  enabledColumns.forEach((col, i) => {
    const cId = 'tc_c' + i;
    const aId = 'tc_a' + i;
    request.input(cId, sql.BigInt, col.columnId);
    request.input(aId, sql.DateTime2, col.activatedAt);
    valueRows.push(`(@${cId}, @${aId})`);

    let activeOffset;
    if (mode === 'week') {
      const weeks = weekOffsetByColumnId?.[String(col.columnId)] ?? 0;
      activeOffset = Math.max(0, Math.min(weeks, maxOffset));
    } else {
      const n = boundaries.filter((b) => b.getTime() >= col.activatedAt.getTime()).length;
      activeOffset = Math.max(0, Math.min(n - 1, maxOffset));
    }
    activeOffsetByColumnId[String(col.columnId)] = activeOffset;
    defaultPattern[String(col.columnId)] = buildMarkPattern([], activeOffset);
  });

  let offsetExpr;
  if (mode === 'week') {
    offsetExpr = 'DATEDIFF(week, ch.changed_at, SYSUTCDATETIME())';
  } else {
    if (!Array.isArray(boundaries) || boundaries.length === 0) {
      return { trackMarksByCell: new Map(), activeOffsetByColumnId, defaultPattern };
    }
    const cases = boundaries.map((b, i) => {
      const bId = 'tc_b' + i;
      request.input(bId, sql.DateTime2, b);
      return `WHEN ch.changed_at >= @${bId} THEN ${i}`;
    });
    offsetExpr = `CASE ${cases.join(' ')} ELSE 99 END`;
  }

  // Wijzigingen komen uit twee bronnen: tb_cell_history (custom-kolommen) en
  // tb_field_corrections (write-back naar D365-kolommen). Alleen toegepaste
  // correcties tellen; applied_at is het echte wijzigingsmoment (fallback created_at).
  if (recordFilter) applyRecordFilter(request, recordFilter);
  const scopeFor = (alias) => (recordFilter
    ? `AND ${alias}.partition_key = @partitionKey AND ${alias}.record_key = @recordKey`
    : '');
  const query = `
    ;WITH changes AS (
      SELECT h.column_id, h.partition_key, h.record_key, h.detail_key, h.changed_at
      FROM dbo.tb_cell_history h WITH (NOLOCK)
      WHERE h.table_id = @tableId ${scopeFor('h')}
      UNION ALL
      SELECT f.column_id, f.partition_key, f.record_key, f.detail_key,
             COALESCE(f.applied_at, f.created_at) AS changed_at
      FROM dbo.tb_field_corrections f WITH (NOLOCK)
      WHERE f.table_id = @tableId AND f.status = 'applied' ${scopeFor('f')}
    )
    SELECT ch.column_id, ch.partition_key, ch.record_key, ch.detail_key, ${offsetExpr} AS mark_offset
    FROM changes ch
    INNER JOIN (VALUES ${valueRows.join(', ')}) AS act(column_id, activated_at)
      ON act.column_id = ch.column_id
    WHERE ch.changed_at >= act.activated_at
    GROUP BY ch.column_id, ch.partition_key, ch.record_key, ch.detail_key, ${offsetExpr}
    HAVING ${offsetExpr} BETWEEN 0 AND ${maxOffset}
  `;
  const result = await request.query(query);

  const redByCellColumn = new Map();
  for (const row of result.recordset) {
    const cellKey = historyCellKey(row.partition_key, row.record_key, row.detail_key);
    if (!redByCellColumn.has(cellKey)) redByCellColumn.set(cellKey, new Map());
    const byCol = redByCellColumn.get(cellKey);
    const colKey = String(row.column_id);
    if (!byCol.has(colKey)) byCol.set(colKey, new Set());
    byCol.get(colKey).add(Number(row.mark_offset));
  }

  const trackMarksByCell = new Map();
  for (const [cellKey, byCol] of redByCellColumn) {
    const patterns = {};
    for (const [colKey, offsets] of byCol) {
      patterns[colKey] = buildMarkPattern([...offsets], activeOffsetByColumnId[colKey]);
    }
    trackMarksByCell.set(cellKey, patterns);
  }

  return { trackMarksByCell, activeOffsetByColumnId, defaultPattern };
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

async function resolveCollapsedDetailPlan({
  table, colsPromise, linksPromise, enrichmentPromise, syncStatePromise, viewedPromise,
}) {
  try {
    const [[, detailCols], runtimeLinks, enrichment, itemsFilterActive] = await Promise.all([
      colsPromise, linksPromise, enrichmentPromise, itemsLineFilterConfigured(table),
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

    return planCollapsedDetailFields({ detailCols, runtimeLinks, enrichment });
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
    for (const item of compileFormulaColumns(detailCols)) {
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

// ---------------------------------------------------------------------------
// read — bouw rijen uit tb_cache + actieve kolommen + eigen waarden
// ---------------------------------------------------------------------------
// includeDetails=false laat de sublijnen uit de response: het board rendert de sub-tabel pas bij
// expanden en haalt de regels dan per order op (readRowDetails). De afgeleiden die het board wél
// collapsed nodig heeft (aantal, new/changed/removed-vlaggen, linked kolomwaarden, image-preview)
// blijven meekomen als rollup. Scheelt bij ~2000 orders het leeuwendeel van de payload.
async function readExecute({ tableKey, includeRemoved = false, userId = null, supplierAccount = null, supplierFilterColumn = 'vendorAccount', includeDetails = true, includeChangeDecorations = true, partitionKey = null, recordKey = null } = {}) {
  const table = await time('tb_meta', () => getTableByKey(tableKey));
  const pool = await getPool();
  const recordFilter = (partitionKey && recordKey)
    ? { partitionKey: String(partitionKey), recordKey: String(recordKey) }
    : null;
  const emptyTrackMarks = { trackMarksByCell: new Map(), activeOffsetByColumnId: {}, defaultPattern: {} };

  // Alle reads hieronder zijn onafhankelijk van elkaar (alleen afhankelijk van table.id/userId).
  // Parallel uitvoeren i.p.v. sequentieel scheelt ~7 SQL-round-trips naar de remote database;
  // dat was het leeuwendeel van de responstijd van het board (zie Server-Timing-metrics).
  // De ledger-read hangt af van sync-state + viewed en is daarom als geketende promise in
  // hetzelfde parallelle blok opgenomen.
  // includeChangeDecorations=false: KPI-pad. Alle master/detail-kolommen, lookups en formules
  // blijven; history/ledger/track-marks niet — die maakten de PO-tab-tegels traag.
  const syncStatePromise = time('tb_sync_state', () => getSyncState(table.id));
  const viewedPromise = includeChangeDecorations
    ? time('tb_viewed', () => getLastViewedAt(table.id, userId))
    : Promise.resolve(null);
  // Revision atomair uit hetzelfde read-snapshot berekenen (parallel; ~1 goedkope round-trip),
  // zodat de frontend na deze read exact de bijbehorende revision opslaat.
  const revisionPromise = time('tb_revision', () => getRevisionByTable(table, { userId, supplierAccount }));
  const historyByCellPromise = includeChangeDecorations
    ? time('tb_history_hints', () => loadHistoryByCell(pool, table.id, recordFilter))
    : Promise.resolve(new Map());

  // Track changes: config uit app_settings (in-memory gecached). Alleen bij ≥1 actieve kolom
  // draait er een query; anders geen SQL en geen Server-Timing-metric tb_track_marks.
  const trackConfig = includeChangeDecorations
    ? await trackChangesService.getConfig()
    : { columns: {}, mode: 'session' };
  const trackEnabledColumns = Object.entries(trackConfig.columns || {})
    .map(([id, entry]) => ({ columnId: Number(id), activatedAt: new Date(entry.activatedAt) }))
    .filter((c) => Number.isFinite(c.columnId) && !Number.isNaN(c.activatedAt.getTime()));
  const trackActive = includeChangeDecorations && trackEnabledColumns.length > 0;
  const trackMarksPromise = trackActive
    ? time('tb_track_marks', async () => {
        const boundaries = trackConfig.mode === 'session'
          ? await trackChangesService.getSessionBoundaries()
          : [];
        return loadTrackMarks(pool, table.id, trackEnabledColumns, trackConfig.mode, boundaries, recordFilter);
      })
    : Promise.resolve(emptyTrackMarks);
  const syncLayersPromise = table.key === 'purchase-orders'
    ? time('tb_sync_rules', () => getTableSyncLayers(table))
    : Promise.resolve([]);
  const ledgerPromise = includeChangeDecorations
    ? (async () => {
    const [{ lastFullSyncAt: syncedAtRaw }, viewedAtRaw] = await Promise.all([syncStatePromise, viewedPromise]);
    const sinceMs = resolveLedgerSinceMs({ lastViewedAt: viewedAtRaw, lastFullSyncAt: syncedAtRaw });
    if (sinceMs === null) return { d365LedgerRows: [], hasLedgerWindow: false };
    try {
      const ledgerRequest = pool.request()
        .input('tableId', sql.BigInt, table.id)
        .input('sinceAt', sql.DateTime2, new Date(sinceMs));
      const ledgerScope = applyRecordFilter(ledgerRequest, recordFilter);
      const ledgerResult = await time('tb_ledger', () => ledgerRequest
        .query(`
          SELECT partition_key, record_key, detail_key, field_key, action
          FROM dbo.tb_change_ledger WITH (NOLOCK)
          WHERE table_id = @tableId
            AND source = 'D365'
            AND created_at >= @sinceAt
            ${ledgerScope}
          ORDER BY created_at ASC, id ASC
        `));
      return { d365LedgerRows: ledgerResult.recordset, hasLedgerWindow: true };
    } catch (ledgerErr) {
      logger.warn('Change-ledger uitlezen mislukt; fallback naar cache-only diff', {
        tableKey: table.key,
        error: ledgerErr.message,
      });
      return { d365LedgerRows: [], hasLedgerWindow: false };
    }
  })()
    : Promise.resolve({ d365LedgerRows: [], hasLedgerWindow: false });

  const colsPromise = time('tb_read_cols', () => Promise.all([
    listColumns({ tableId: table.id, scope: 'master', includeInactive: false }),
    listColumns({ tableId: table.id, scope: 'detail', includeInactive: false }),
  ]));
  // Push-total/push-values koppelingen zijn een gedeelde, board-brede instelling (zie
  // 2026-09-02-header-push-line-writeback-design.md), geen persoonlijke voorkeur per staff-lid.
  // Daarom altijd staff-links meenemen, ook voor staff zelf — anders toont het bord een kolom
  // als "los" (bewerkbaar) zodra een ándere staff-gebruiker de koppeling heeft aangemaakt,
  // terwijl de Data model-pagina (die altijd merget) 'm wel als gekoppeld laat zien.
  const linksPromise = time('tb_links', () => loadUserRuntimeHeaderLinks(pool, userId, table.key, {
    includeStaffLinks: true,
  }));
  const enrichmentPromise = time('tb_lookups', () => loadLookupEnrichmentCached(table));
  // Blijven de sublijnen buiten de response, dan hoeft de detail-read niet elke regel op te halen:
  // SQL kan de rollup per order berekenen, of anders alleen de velden leveren die de rollup leest.
  // Het plan hangt af van kolommen, koppelingen en lookups; die laden parallel met de master-read,
  // dus dit kost geen extra wachttijd.
  const detailPlanPromise = (includeDetails || recordFilter)
    ? Promise.resolve(null)
    : planCollapsedDetailRead({
      table, colsPromise, linksPromise, enrichmentPromise, syncStatePromise, viewedPromise,
    });

  const [
    [masterCols, detailCols],
    runtimeLinks,
    { lastFullSyncAt },
    lastViewedAt,
    { mastersResult, detailsResult, customResult, rollupByRecord, rollupPlan },
    enrichment,
    { d365LedgerRows, hasLedgerWindow },
    historyByCell,
    trackMarks,
    syncLayers,
  ] = await Promise.all([
    colsPromise,
    linksPromise,
    syncStatePromise,
    viewedPromise,
    readCacheRows(pool, table.id, includeRemoved, recordFilter, detailPlanPromise),
    enrichmentPromise,
    ledgerPromise,
    historyByCellPromise,
    trackMarksPromise,
    syncLayersPromise,
  ]);
  const resolvedSyncLayers = table.key === 'purchase-orders'
    ? await resolveSyncLayers(syncLayers, { forD365: false })
    : [];
  const compiledMasterFormulas = compileMasterFormulaColumns(masterCols);
  const compiledDetailFormulas = compileFormulaColumns(detailCols);
  const pavColumns = (detailCols || []).filter((column) => column?.options?.kind === 'product-attribute');
  const pavPivot = await loadProductAttributePivot(detailCols);
  // Eén keer per read berekend (niet per rij/formule) zodat TODAY() voor alle
  // rijen in deze response identiek is en er geen extra rekenkosten bijkomen.
  const formulaToday = getUtcMidnight();
  const lastSyncedMs = lastFullSyncAt ? new Date(lastFullSyncAt).getTime() : null;

  const lastViewedMs = lastViewedAt ? new Date(lastViewedAt).getTime() : null;
  const useViewedBaseline = usesViewedBaseline(lastViewedAt);
  const baselineMs = resolveLedgerSinceMs({ lastViewedAt, lastFullSyncAt });
  const compareAgainstBaseline = (valueMs) => {
    if (valueMs === null || baselineMs === null) return false;
    return useViewedBaseline ? valueMs > baselineMs : valueMs >= baselineMs;
  };

  const customByCell = new Map();
  for (const row of customResult.recordset) {
    const cellKey = `${row.partition_key}|${row.record_key}|${row.detail_key}`;
    let value = null;
    if (row.data_type === 'number') value = row.value_number !== null ? Number(row.value_number) : null;
    else if (row.data_type === 'date') value = row.value_date ? new Date(row.value_date).toISOString() : null;
    else if (row.data_type === 'boolean') value = row.value_bool === null ? null : Boolean(row.value_bool);
    else value = row.value_text;
    if (!customByCell.has(cellKey)) customByCell.set(cellKey, {});
    customByCell.get(cellKey)[row.key] = value;
  }

  const detailsByRecord = new Map();
  for (const d of detailsResult.recordset) {
    const recKey = `${d.partition_key}|${d.record_key}`;
    if (!detailsByRecord.has(recKey)) detailsByRecord.set(recKey, []);
    detailsByRecord.get(recKey).push(d);
  }

  const { orderChanges, lineChanges, lineChangesByOrder } = buildD365ChangeState(d365LedgerRows);

  const valuesFor = buildValuesFromColumns;
  const detailContext = {
    detailCols, customByCell, enrichment, historyByCell, trackMarks,
    lineChanges, compareAgainstBaseline, hasLedgerWindow,
    compiledDetailFormulas, formulaToday, pavPivot, pavColumns,
  };

  let newCount = 0;
  let changedCount = 0;
  let scopedRows;
  const activeSyncLayers = Array.isArray(resolvedSyncLayers) ? resolvedSyncLayers.filter((layer) => layer && layer.active) : [];
  const masterJsonByRecKey = new Map(
    mastersResult.recordset.map((m) => [`${m.partition_key}|${m.record_key}`, parseJson(m.data_json)])
  );

  // PO-bord: als er een items-syncfilter actief is, tonen we per order alleen de regels waarvan het
  // item binnen die filter valt, en verbergen we orders zonder enkele matchende regel. Bewust
  // gekoppeld aan de items-filter en alleen actief zodra die is ingesteld (anders geen overhead).
  let itemsFilterKeys = null;
  let itemsFilterField = 'itemNumber';
  if (table.key === 'purchase-orders') {
    try {
      const itemsTable = await getTableByKey('items');
      const itemsFilterRules = parseDefaultFilterRules(itemsTable.defaultFilter);
      if (itemsFilterRules.length) {
        const itemsLookup = (enrichment.lookups || []).find(
          (lk) => String(lk.targetTableKey || '').trim().toLowerCase() === 'items' && lk.sourceScope === 'detail'
        );
        const derivedField = String(itemsLookup?.sourceFieldKey || '').trim();
        if (derivedField) itemsFilterField = derivedField;
        itemsFilterKeys = await loadPresentItemFilterKeys(itemsTable.id);
      }
    } catch {
      itemsFilterKeys = null;
    }
  }
  const itemsLineFilterActive = table.key === 'purchase-orders' && itemsFilterKeys !== null;
  const ordersHiddenByItemsFilter = new Set();

  let masterRows = mastersResult.recordset;
  if (supplierAccount !== null && !recordFilter) {
    const { selectRecKeysMatchingNativeSupplierColumn } = require('../utils/supplierRowAccess');
    const nativeKeys = selectRecKeysMatchingNativeSupplierColumn(
      masterJsonByRecKey,
      supplierAccount,
      supplierFilterColumn || 'vendorAccount',
    );
    if (nativeKeys) {
      masterRows = masterRows.filter((m) => nativeKeys.has(`${m.partition_key}|${m.record_key}`));
      for (const recKey of [...detailsByRecord.keys()]) {
        if (!nativeKeys.has(recKey)) detailsByRecord.delete(recKey);
      }
    }
  }

  await time('tb_build_rows', async () => {
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
      details = rawDetailRows.map((d) => {
        const detail = buildDetailRow(d, detailContext);
        if (detail.isNew || detail.isChanged) hasLineChanges = true;
        return detail;
      });
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

  let visibleRows = rows;
  if (table.key === 'purchase-orders' && (activeSyncLayers.length || itemsLineFilterActive)) {
    visibleRows = rows.filter((row) => {
      const recKey = `${row.partitionKey}|${row.recordKey}`;
      // Items-filter: verberg orders zonder enkele matchende regel (ook retained orders — de
      // gebruiker wil een schoon, op de items-filter gefilterd bord).
      if (itemsLineFilterActive && ordersHiddenByItemsFilter.has(recKey)) return false;
      if (activeSyncLayers.length) {
        if (row.syncRetained) return true;
        const masterJson = masterJsonByRecKey.get(recKey) || {};
        const lineRecords = (detailsByRecord.get(recKey) || []).map((d) => parseJson(d.data_json));
        return recordMatchesAnyLayer(activeSyncLayers, masterJson, lineRecords);
      }
      return true;
    });
    newCount = visibleRows.filter((row) => row.isNew).length;
    changedCount = visibleRows.filter((row) => row.isChanged).length;
  }

  // Supplier-scoping: beperk de rijen tot de eigen leverancier. De admin kiest via een
  // instelling op welke kolom gefilterd wordt (supplierFilterColumn); we vergelijken de
  // afgeleide rijwaarde met het leveranciersaccount van de gebruiker (case-insensitief).
  // Wanneer supplierAccount is meegegeven (ook een lege string) filteren we altijd — een
  // supplier ziet dus nooit onbedoeld alle orders. Staff geeft null door en ziet alles.
  scopedRows = visibleRows;
  if (supplierAccount !== null) {
    const wantedAccount = String(supplierAccount).trim().toLowerCase();
    const filterKey = supplierFilterColumn || 'vendorAccount';
    scopedRows = visibleRows.filter((row) => (
      String(row.values?.[filterKey] ?? '').trim().toLowerCase() === wantedAccount
    ));
    newCount = scopedRows.filter((row) => row.isNew).length;
    changedCount = scopedRows.filter((row) => row.isChanged).length;
  }
  });

  const staleThresholdMinutes = await getStaleThresholdMinutes(table);
  const stale = table.cacheMode === 'never'
    ? false
    : (!lastFullSyncAt || (Date.now() - new Date(lastFullSyncAt).getTime() > staleThresholdMinutes * 60 * 1000));

  let retentionMeta = { retainedCount: 0, retentionWarning: 'none' };
  if (table.key === 'purchase-orders') {
    const retainedCount = scopedRows.filter((row) => row.syncRetained).length;
    const retentionSettings = await time('tb_retention', () => getSyncRetentionSettings());
    retentionMeta = {
      retainedCount,
      retentionWarning: resolveRetentionWarning(retainedCount, retentionSettings),
      retainedMaxAuto: retentionSettings.maxAuto,
      retainedFetchBudget: retentionSettings.fetchBudget,
    };
  }

  const { revision, parts } = await revisionPromise;

  if (table.key === 'purchase-orders' && parts && includeDetails) {
    const { rememberKpiPoRows, contentSignature } = require('./BoardSnapshotCache');
    rememberKpiPoRows({
      tableKey: table.key,
      supplierAccount,
      signature: contentSignature(parts),
      rows: scopedRows,
    });
  }

  if (supplierAccount !== null && !recordFilter) {
    const { rememberSupplierVisibleRowKeys } = require('../utils/supplierRowAccess');
    rememberSupplierVisibleRowKeys(supplierAccount, supplierFilterColumn, scopedRows);
  }

  return {
    table: { key: table.key, label: table.label, hasDetail: Boolean(table.relation && table.relation.kind !== 'none') },
    changeContractVersion: 1,
    revision,
    syncedAt: lastFullSyncAt ? new Date(lastFullSyncAt).toISOString() : null,
    stale,
    hasCache: Boolean(lastFullSyncAt),
    staleThresholdMinutes,
    meta: {
      columns: {
        master: [...masterCols, ...enrichment.masterCols],
        detail: [...detailCols, ...enrichment.detailCols],
      },
      trackChanges: trackActive
        ? {
            mode: trackConfig.mode,
            activeOffsetByColumnId: trackMarks.activeOffsetByColumnId,
            defaultPattern: trackMarks.defaultPattern,
          }
        : null,
    },
    rows: scopedRows,
    total: scopedRows.length,
    lastViewedAt: lastViewedAt ? new Date(lastViewedAt).toISOString() : null,
    newCount,
    changedCount,
    retention: retentionMeta,
  };
}

const _readInflight = new Map();

function readInflightKey({ tableKey, userId, supplierAccount, includeDetails, includeChangeDecorations, partitionKey, recordKey }) {
  return [tableKey, userId, supplierAccount, includeDetails, includeChangeDecorations, partitionKey || '', recordKey || ''].join('\0');
}

async function read(opts = {}) {
  const key = readInflightKey(opts);
  const existing = _readInflight.get(key);
  if (existing) return existing;
  const pending = readExecute(opts).finally(() => {
    if (_readInflight.get(key) === pending) _readInflight.delete(key);
  });
  _readInflight.set(key, pending);
  return pending;
}

// ---------------------------------------------------------------------------
// listVendorValues — lichte read die alleen de master-`data_json` ophaalt om er de
// vendor-kolom(men) uit te projecteren. De volledige board-read() doet daarnaast details,
// custom values, lookups, formules, history, track-marks en ledger over ~2000 orders; dat is
// verspilling wanneer we enkel de vendorlijst nodig hebben (RCCP /vendors, BI-vendorfilter). Dit
// voert één SQL-query uit en projecteert exact zoals de board-read (buildValuesFromColumns), zodat
// de waarden identiek zijn. Alleen source-kolommen zijn relevant; custom values/lookups niet nodig.
//
// Belangrijk: dezelfde zichtbaarheidsregels als read() toepassen — anders blijven vendors in de
// dropdown staan terwijl ze nergens op het bord of in een RCCP/BI-analyse te zien zijn:
// - removed_at_source = 0, zodat orders die D365 niet meer teruggeeft (verwijderd, of nooit
//   bestaande test-/seed-rijen die bij de eerstvolgende volledige sync als removed gemarkeerd
//   worden) niet langer meetellen — dit ontbrak hier terwijl elke andere read-helper in dit
//   bestand het wél toepast.
// - dezelfde actieve-syncfilter-check als read(): orders die niet (meer) aan het D365-syncfilter
//   voldoen (bv. oude demo-data van vóór het instellen van het filter) tellen ook niet mee.
// Regelniveau 'line' vereist regel-data; die halen we alleen op als er ook echt een
// regel-niveau-filterregel actief is (anders blijft dit de lichte master-only-read).
// ---------------------------------------------------------------------------
async function listVendorValues({ tableKey, valueColumnKeys = [], includeRemoved = false } = {}) {
  const table = await getTableByKey(tableKey);
  const pool = await getPool();
  const masterCols = await listColumns({ tableId: table.id, scope: 'master', includeInactive: false });
  const wanted = new Set(valueColumnKeys.filter(Boolean));
  const cols = masterCols.filter((c) => wanted.has(c.key));

  const activeSyncLayers = table.key === 'purchase-orders'
    ? await resolveSyncLayers(await getTableSyncLayers(table), { forD365: false })
    : [];
  const needsLineRecords = activeSyncLayers.some((layer) => (layer.rules || []).some((rule) => String(rule?.level || 'header').trim() === 'line'));

  const mastersResult = await time('tb_vendor_master_only', () => pool.request()
    .input('tableId', sql.BigInt, table.id)
    .query(`
      SELECT c.partition_key, c.record_key, c.data_json, c.sync_retained
      FROM dbo.tb_cache c WITH (NOLOCK)
      WHERE c.table_id = @tableId AND c.scope = 'master'
      ${includeRemoved ? '' : `AND c.removed_at_source = 0
        AND NOT EXISTS (
          SELECT 1 FROM dbo.tb_row_exclusions ex WITH (NOLOCK)
          WHERE ex.table_id = @tableId AND ex.partition_key = c.partition_key AND ex.record_key = c.record_key
        )`}
    `));

  let lineRecordsByRecKey = null;
  if (needsLineRecords) {
    const detailsResult = await time('tb_vendor_line_only', () => pool.request()
      .input('tableId', sql.BigInt, table.id)
      .query(`
        SELECT partition_key, record_key, data_json
        FROM dbo.tb_cache WITH (NOLOCK)
        WHERE table_id = @tableId AND scope = 'detail'${includeRemoved ? '' : ' AND removed_at_source = 0'}
      `));
    lineRecordsByRecKey = new Map();
    for (const d of detailsResult.recordset) {
      const key = `${d.partition_key}|${d.record_key}`;
      if (!lineRecordsByRecKey.has(key)) lineRecordsByRecKey.set(key, []);
      lineRecordsByRecKey.get(key).push(parseJson(d.data_json));
    }
  }

  const rows = [];
  for (const m of mastersResult.recordset) {
    const masterJson = parseJson(m.data_json);
    if (activeSyncLayers.length && !Boolean(m.sync_retained)) {
      const lineRecords = lineRecordsByRecKey?.get(`${m.partition_key}|${m.record_key}`) || [];
      if (!recordMatchesAnyLayer(activeSyncLayers, masterJson, lineRecords)) continue;
    }
    rows.push({
      recordKey: m.record_key,
      partitionKey: m.partition_key,
      values: buildValuesFromColumns(cols, masterJson, null),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// readRowDetails — sublijnen van één order, voor het lazy openklappen op het board.
// Dezelfde projectie als de board-read (buildDetailRow), maar met alle queries
// gefilterd op één order in plaats van de hele tabel.
// ---------------------------------------------------------------------------

// De lookup-verrijking leest complete doeltabellen (vendors/items) en kost honderden ms.
// Voor het openklappen van één order is dat te duur en een paar seconden oude
// lookup-labels zijn ongevaarlijk; de board-read zelf blijft ongecached.
const LOOKUP_ENRICHMENT_TTL_MS = 30 * 1000;
const lookupEnrichmentCache = new Map();

// In-flight loads per tabel, zodat gelijktijdige koude aanvragen (board-read + /columns + bi/meta
// vuren vaak samen bij page-load) op dezelfde load wachten i.p.v. elk de volledige vendor/items-
// doeltabellen te lezen. Voorkomt een "thundering herd" van identieke lookup-reads.
const lookupEnrichmentInflight = new Map();

async function loadLookupEnrichmentCached(table) {
  const cached = lookupEnrichmentCache.get(table.id);
  if (cached && Date.now() - cached.loadedAt < LOOKUP_ENRICHMENT_TTL_MS) return cached.value;
  const pending = lookupEnrichmentInflight.get(table.id);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const value = await loadLookupEnrichment(table);
      lookupEnrichmentCache.set(table.id, { value, loadedAt: Date.now() });
      return value;
    } finally {
      lookupEnrichmentInflight.delete(table.id);
    }
  })();
  lookupEnrichmentInflight.set(table.id, promise);
  return promise;
}

function invalidateLookupEnrichmentCache(tableId = null) {
  if (tableId === null) {
    lookupEnrichmentCache.clear();
    lookupEnrichmentInflight.clear();
  } else {
    lookupEnrichmentCache.delete(tableId);
    lookupEnrichmentInflight.delete(tableId);
  }
}

// Supplier-scoping gebeurt in de route met assertSupplierPurchaseOrderRow (zelfde guard als de
// andere rij-gerichte endpoints); deze functie gaat ervan uit dat de toegang al is gecontroleerd.
async function readRowDetails({ tableKey, partitionKey, recordKey, userId = null } = {}) {
  const table = await getTableByKey(tableKey);
  const pool = await getPool();
  const recordFilter = { partitionKey: String(partitionKey), recordKey: String(recordKey) };

  const detailsPromise = time('tb_row_details_sql', () => pool.request()
    .input('tableId', sql.BigInt, table.id)
    .input('partitionKey', sql.NVarChar(32), recordFilter.partitionKey)
    .input('recordKey', sql.NVarChar(128), recordFilter.recordKey)
    .query(`
      SELECT partition_key, record_key, detail_key, data_json, removed_at_source, first_seen_at, content_changed_at
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId AND scope = 'detail'
        AND partition_key = @partitionKey AND record_key = @recordKey
      ORDER BY detail_key
    `));

  const customPromise = pool.request()
    .input('tableId', sql.BigInt, table.id)
    .input('partitionKey', sql.NVarChar(32), recordFilter.partitionKey)
    .input('recordKey', sql.NVarChar(128), recordFilter.recordKey)
    .query(`
      SELECT cv.column_id, c.[key], c.scope, c.data_type, cv.partition_key, cv.record_key,
             cv.detail_key, cv.value_text, cv.value_number, cv.value_date, cv.value_bool
      FROM dbo.tb_custom_values cv WITH (NOLOCK)
      INNER JOIN dbo.tb_columns c WITH (NOLOCK) ON c.id = cv.column_id
      WHERE cv.table_id = @tableId AND c.is_active = 1
        AND cv.partition_key = @partitionKey AND cv.record_key = @recordKey
    `);

  const trackConfig = await trackChangesService.getConfig();
  const trackEnabledColumns = Object.entries(trackConfig.columns || {})
    .map(([id, entry]) => ({ columnId: Number(id), activatedAt: new Date(entry.activatedAt) }))
    .filter((c) => Number.isFinite(c.columnId) && !Number.isNaN(c.activatedAt.getTime()));
  const trackMarksPromise = trackEnabledColumns.length
    ? (async () => {
        const boundaries = trackConfig.mode === 'session'
          ? await trackChangesService.getSessionBoundaries()
          : [];
        return loadTrackMarks(pool, table.id, trackEnabledColumns, trackConfig.mode, boundaries, recordFilter);
      })()
    : Promise.resolve({ trackMarksByCell: new Map(), activeOffsetByColumnId: {}, defaultPattern: {} });

  const ledgerPromise = (async () => {
    const [{ lastFullSyncAt: syncedAtRaw }, viewedAtRaw] = await Promise.all([
      getSyncState(table.id), getLastViewedAt(table.id, userId),
    ]);
    const sinceMs = resolveLedgerSinceMs({ lastViewedAt: viewedAtRaw, lastFullSyncAt: syncedAtRaw });
    if (sinceMs === null) return { rows: [], hasLedgerWindow: false, sinceMs: null, useViewedBaseline: false };
    const useViewedBaseline = usesViewedBaseline(viewedAtRaw);
    try {
      const result = await pool.request()
        .input('tableId', sql.BigInt, table.id)
        .input('sinceAt', sql.DateTime2, new Date(sinceMs))
        .input('partitionKey', sql.NVarChar(32), recordFilter.partitionKey)
        .input('recordKey', sql.NVarChar(128), recordFilter.recordKey)
        .query(`
          SELECT partition_key, record_key, detail_key, field_key, action
          FROM dbo.tb_change_ledger WITH (NOLOCK)
          WHERE table_id = @tableId AND source = 'D365' AND created_at >= @sinceAt
            AND partition_key = @partitionKey AND record_key = @recordKey
          ORDER BY created_at ASC, id ASC
        `);
      return { rows: result.recordset, hasLedgerWindow: true, sinceMs, useViewedBaseline };
    } catch (ledgerErr) {
      logger.warn('Change-ledger uitlezen mislukt bij regel-details; fallback naar cache-only diff', {
        tableKey: table.key, error: ledgerErr.message,
      });
      return { rows: [], hasLedgerWindow: false, sinceMs, useViewedBaseline };
    }
  })();

  const [detailCols, enrichment, detailsResult, customResult, historyByCell, trackMarks, ledger] = await Promise.all([
    listColumns({ tableId: table.id, scope: 'detail', includeInactive: false }),
    loadLookupEnrichmentCached(table),
    detailsPromise,
    customPromise,
    loadHistoryByCell(pool, table.id, recordFilter),
    trackMarksPromise,
    ledgerPromise,
  ]);

  const customByCell = new Map();
  for (const row of customResult.recordset) {
    const cellKey = `${row.partition_key}|${row.record_key}|${row.detail_key}`;
    let value = null;
    if (row.data_type === 'number') value = row.value_number !== null ? Number(row.value_number) : null;
    else if (row.data_type === 'date') value = row.value_date ? new Date(row.value_date).toISOString() : null;
    else if (row.data_type === 'boolean') value = row.value_bool === null ? null : Boolean(row.value_bool);
    else value = row.value_text;
    if (!customByCell.has(cellKey)) customByCell.set(cellKey, {});
    customByCell.get(cellKey)[row.key] = value;
  }

  const { lineChanges } = buildD365ChangeState(ledger.rows);
  const { sinceMs, useViewedBaseline } = ledger;
  const compareAgainstBaseline = (valueMs) => {
    if (valueMs === null || sinceMs === null) return false;
    return useViewedBaseline ? valueMs > sinceMs : valueMs >= sinceMs;
  };

  const compiledDetailFormulas = compileFormulaColumns(detailCols);
  const pavColumns = (detailCols || []).filter((column) => column?.options?.kind === 'product-attribute');
  const pavPivot = await loadProductAttributePivot(detailCols);
  const detailContext = {
    detailCols, customByCell, enrichment, historyByCell, trackMarks,
    lineChanges, compareAgainstBaseline, hasLedgerWindow: ledger.hasLedgerWindow,
    compiledDetailFormulas, formulaToday: getUtcMidnight(),
    pavPivot, pavColumns,
  };
  const details = detailsResult.recordset.map((d) => {
    const detail = buildDetailRow(d, detailContext);
    delete detail.hasRemovalChange;
    return detail;
  });

  return { partitionKey: recordFilter.partitionKey, recordKey: recordFilter.recordKey, details };
}

// ---------------------------------------------------------------------------
// Nieuw-detectie op basis van admin-view-state (globale baseline voor alle gebruikers)
// ---------------------------------------------------------------------------
async function getLastViewedAt(tableId, userId) {
  if (!userId) return null;
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('userId', sql.Int, userId)
    .query(`
      SELECT vs.last_viewed_at
      FROM dbo.tb_user_view_state vs WITH (NOLOCK)
      WHERE vs.table_id = @tableId
        AND vs.user_id = @userId
    `);
  return result.recordset[0]?.last_viewed_at || null;
}

// ---------------------------------------------------------------------------
// Revision-check — lichtgewicht "is het board gewijzigd?"-token, zodat een terugkeer
// naar de main table een volledige read() kan overslaan als er niets veranderde.
// De parts moeten álle inputs van read() dekken; een gemiste part = stille stale data.
// ---------------------------------------------------------------------------

// Zet een DATETIME2/waarde om naar een stabiele string (of null) voor de hash.
function revisionPartValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

// Deterministische hash over een key-gesorteerde serialisatie van alle parts. Pure functie:
// zelfde parts → zelfde revision; één gewijzigde part → andere revision. Apart unit-testbaar.
function computeRevision(parts) {
  const stable = {};
  for (const key of Object.keys(parts || {}).sort()) {
    stable[key] = revisionPartValue(parts[key]);
  }
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

// Berekent de revision voor een reeds opgeloste tabel (gebruikt binnen read() in hetzelfde snapshot).
async function getRevisionByTable(table, { userId = null, supplierAccount = null } = {}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, table.id)
    .input('userId', sql.Int, userId)
    .input('boardKey', sql.NVarChar(64), table.key)
    .query(`
      SELECT
        (SELECT last_full_sync_at FROM dbo.tb_sync_state WITH (NOLOCK) WHERE table_id = @tableId) AS syncedAt,
        (SELECT MAX(content_changed_at) FROM dbo.tb_cache WITH (NOLOCK) WHERE table_id = @tableId) AS maxContentChangedAt,
        (SELECT MAX(first_seen_at) FROM dbo.tb_cache WITH (NOLOCK) WHERE table_id = @tableId) AS maxFirstSeenAt,
        (SELECT MAX(updated_at) FROM dbo.tb_custom_values WITH (NOLOCK) WHERE table_id = @tableId) AS maxCustomValueAt,
        (SELECT MAX(created_at) FROM dbo.tb_change_ledger WITH (NOLOCK) WHERE table_id = @tableId) AS maxLedgerAt,
        (SELECT MAX(updated_at) FROM dbo.tb_columns WITH (NOLOCK) WHERE table_id = @tableId) AS maxColumnsAt,
        (SELECT COUNT(*) FROM dbo.tb_row_exclusions WITH (NOLOCK) WHERE table_id = @tableId) AS exclusionCount,
        (SELECT MAX(excluded_at) FROM dbo.tb_row_exclusions WITH (NOLOCK) WHERE table_id = @tableId) AS maxExclusionAt,
        (SELECT vs.last_viewed_at
           FROM dbo.tb_user_view_state vs WITH (NOLOCK)
          WHERE vs.table_id = @tableId AND vs.user_id = @userId) AS userViewedAt,
        (SELECT MAX(updated_at) FROM dbo.user_board_settings WITH (NOLOCK)
          WHERE user_id = @userId AND board_key = @boardKey) AS userBoardSettingsAt,
        (SELECT MAX(updated_at) FROM dbo.app_settings WITH (NOLOCK)) AS settingsAt
    `);
  const row = result.recordset[0] || {};
  const parts = {
    syncedAt: revisionPartValue(row.syncedAt),
    maxContentChangedAt: revisionPartValue(row.maxContentChangedAt),
    maxFirstSeenAt: revisionPartValue(row.maxFirstSeenAt),
    maxCustomValueAt: revisionPartValue(row.maxCustomValueAt),
    maxLedgerAt: revisionPartValue(row.maxLedgerAt),
    maxColumnsAt: revisionPartValue(row.maxColumnsAt),
    exclusionCount: Number(row.exclusionCount) || 0,
    maxExclusionAt: revisionPartValue(row.maxExclusionAt),
    userViewedAt: revisionPartValue(row.userViewedAt),
    userBoardSettingsAt: revisionPartValue(row.userBoardSettingsAt),
    settingsAt: revisionPartValue(row.settingsAt),
    supplierAccount: supplierAccount || null,
  };
  return { revision: computeRevision(parts), parts };
}

// Publieke revision-check op basis van tableKey (los endpoint).
async function getRevision({ tableKey, userId = null, supplierAccount = null } = {}) {
  const table = await getTableByKey(tableKey);
  return getRevisionByTable(table, { userId, supplierAccount });
}

async function markViewed(userId, tableKey, { supplierAccount = null } = {}) {
  if (!userId) throw Object.assign(new Error('No user'), { status: 401 });
  const table = await getTableByKey(tableKey);
  const pool = await getPool();
  await pool.request()
    .input('userId', sql.Int, userId)
    .input('tableId', sql.BigInt, table.id)
    .query(`
      MERGE dbo.tb_user_view_state AS target
      USING (SELECT @tableId AS table_id, @userId AS user_id) AS src
        ON target.table_id = src.table_id AND target.user_id = src.user_id
      WHEN MATCHED THEN UPDATE SET last_viewed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (table_id, user_id, last_viewed_at) VALUES (@tableId, @userId, SYSUTCDATETIME());
    `);
  // Revision teruggeven zodat de client de sessie-cache kan bijwerken zonder een full board-read.
  try {
    const { revision } = await time('tb_viewed_revision', () => (
      getRevisionByTable(table, { userId, supplierAccount })
    ));
    return { success: true, revision };
  } catch {
    return { success: true, revision: null };
  }
}

// ---------------------------------------------------------------------------
// saveCustomValue — instant SQL-write van een app-native kolomwaarde
// ---------------------------------------------------------------------------
async function saveCustomValue({ tableKey, columnId, partitionKey, recordKey, detailKey, value }, user) {
  // Backwards compat: sommige interne callers gaven tot dusver een kaal userId door.
  const userId = (user && typeof user === 'object') ? user.id : user;
  const table = await getTableByKey(tableKey);
  const { getColumnById } = require('./TableRegistryService');
  const column = await getColumnById(columnId);
  if (!column || !column.isActive || column.tableId !== table.id) {
    throw Object.assign(new Error('Column not found'), { status: 404 });
  }
  assertNotPavWritable(tableKey, column);
  assertCustomColumnWritable(column);
  // Vendors mogen alleen bewerken op kolommen die de admin expliciet als vendor-editable heeft
  // aangemerkt (Data model). Rij-scope wordt al vóór deze aanroep afgedwongen (assertSupplierPurchaseOrderRow).
  if (String(user?.role || '') === ROLES.SUPPLIER && !column.vendorEditable) {
    throw Object.assign(new Error('This column cannot be edited by vendors'), { status: 403 });
  }

  const part = String(partitionKey || '').trim();
  const record = String(recordKey || '').trim();
  if (!part || !record) throw Object.assign(new Error('partitionKey and recordKey are required'), { status: 400 });
  if (part.length > 32 || record.length > 128) {
    throw Object.assign(new Error('partitionKey or recordKey is too long'), { status: 400 });
  }
  if (part.length > 32 || record.length > 128) {
    throw Object.assign(new Error('partitionKey or recordKey is too long'), { status: 400 });
  }
  if (part.length > 32 || record.length > 128) throw Object.assign(new Error('partitionKey or recordKey is too long'), { status: 400 });

  let resolvedDetail = MASTER_DETAIL_KEY;
  if (column.scope === 'detail') {
    const dk = toNumberOrNull(detailKey);
    if (dk === null) throw Object.assign(new Error('detailKey is required for a detail column'), { status: 400 });
    resolvedDetail = dk;
  }

  let valueText = null, valueNumber = null, valueDate = null, valueBool = null;
  const empty = value === null || value === undefined || value === '';
  if (!empty) {
    if (column.dataType === 'number') {
      valueNumber = toNumberOrNull(value);
      if (valueNumber === null) throw Object.assign(new Error('Value must be a number'), { status: 400 });
    } else if (column.dataType === 'date') {
      valueDate = toDateOrNull(value);
      if (valueDate === null) throw Object.assign(new Error('Value must be a date'), { status: 400 });
    } else if (column.dataType === 'boolean') {
      valueBool = value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0;
    } else if (column.dataType === 'select') {
      const allowed = Array.isArray(column.options) ? column.options : [];
      const str = String(value);
      if (allowed.length && !allowed.includes(str)) throw Object.assign(new Error('Value is outside the choice list'), { status: 400 });
      valueText = str;
    } else if (column.dataType === 'status') {
      const { getAllowedStatusLabels } = require('../utils/statusColumnOptions');
      const allowed = getAllowedStatusLabels(column.options);
      const str = String(value ?? '').trim();
      if (str && allowed.length && !allowed.includes(str)) {
        throw Object.assign(new Error('Value is outside the status labels'), { status: 400 });
      }
      valueText = str || null;
    } else {
      valueText = String(value);
    }
  }

  const pool = await getPool();
  // Waarde opslaan (primair) + de oude/nieuwe waarde opvangen in een table-variable. OUTPUT ... INTO mag
  // niet rechtstreeks naar tb_cell_history (FK/CHECK-doel verboden); we schrijven de historie daarna weg.
  const result = await pool.request()
    .input('columnId', sql.BigInt, columnId)
    .input('tableId', sql.BigInt, table.id)
    .input('scope', sql.NVarChar(16), column.scope)
    .input('partitionKey', sql.NVarChar(32), part)
    .input('recordKey', sql.NVarChar(128), record)
    .input('detailKey', sql.Int, resolvedDetail)
    .input('valueText', sql.NVarChar(sql.MAX), valueText)
    .input('valueNumber', sql.Decimal(38, 10), valueNumber)
    .input('valueDate', sql.DateTime2, valueDate)
    .input('valueBool', sql.Bit, valueBool)
    .input('userId', sql.Int, userId || null)
    .query(`
      DECLARE @changes TABLE (
        action NVARCHAR(16),
        old_value_text NVARCHAR(MAX), old_value_number DECIMAL(38,10), old_value_date DATETIME2, old_value_bool BIT,
        new_value_text NVARCHAR(MAX), new_value_number DECIMAL(38,10), new_value_date DATETIME2, new_value_bool BIT
      );
      MERGE dbo.tb_custom_values AS target
      USING (SELECT @columnId AS column_id, @partitionKey AS partition_key,
                    @recordKey AS record_key, @detailKey AS detail_key) AS src
        ON target.column_id = src.column_id AND target.partition_key = src.partition_key
           AND target.record_key = src.record_key AND target.detail_key = src.detail_key
      WHEN MATCHED THEN UPDATE SET
        value_text = @valueText, value_number = @valueNumber, value_date = @valueDate, value_bool = @valueBool,
        updated_by = @userId, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT
        (column_id, table_id, scope, partition_key, record_key, detail_key, value_text, value_number, value_date, value_bool, updated_by)
        VALUES (@columnId, @tableId, @scope, @partitionKey, @recordKey, @detailKey, @valueText, @valueNumber, @valueDate, @valueBool, @userId)
      OUTPUT
        CASE
          WHEN $action = 'INSERT' THEN 'insert'
          WHEN @valueText IS NULL AND @valueNumber IS NULL AND @valueDate IS NULL AND @valueBool IS NULL THEN 'clear'
          ELSE 'update'
        END,
        deleted.value_text, deleted.value_number, deleted.value_date, deleted.value_bool,
        inserted.value_text, inserted.value_number, inserted.value_date, inserted.value_bool
      INTO @changes (action, old_value_text, old_value_number, old_value_date, old_value_bool,
                     new_value_text, new_value_number, new_value_date, new_value_bool);
      SELECT action, old_value_text, old_value_number, old_value_date, old_value_bool,
             new_value_text, new_value_number, new_value_date, new_value_bool FROM @changes;
    `);

  // Cel-geschiedenis best-effort wegschrijven; een fout hier mag de (al opgeslagen) waarde niet laten mislukken.
  const change = result.recordset && result.recordset[0];
  if (change) {
    const ledgerAction = String(change.action || '').toLowerCase() === 'insert'
      ? 'INSERT'
      : (String(change.action || '').toLowerCase() === 'clear' ? 'DELETE' : 'UPDATE');
    const oldLedgerValue = pickTypedValue({
      text: change.old_value_text,
      number: change.old_value_number,
      date: change.old_value_date,
      bool: change.old_value_bool,
    });
    const newLedgerValue = pickTypedValue({
      text: change.new_value_text,
      number: change.new_value_number,
      date: change.new_value_date,
      bool: change.new_value_bool,
    });
    try {
      await writeChangeLedgerEntries(() => pool.request(), [{
        tableId: table.id,
        partitionKey: part,
        recordKey: record,
        detailKey: resolvedDetail,
        fieldKey: column.key,
        source: 'USER',
        action: ledgerAction,
        oldValue: toLedgerValue(oldLedgerValue),
        newValue: toLedgerValue(newLedgerValue),
        changedByUserId: userId || null,
        correlationId: crypto.randomUUID(),
        refreshJobId: null,
      }]);
    } catch (ledgerErr) {
      logger.warn('Change-ledger (user custom value) wegschrijven mislukt', { error: ledgerErr.message });
    }

    try {
      await pool.request()
        .input('columnId', sql.BigInt, columnId)
        .input('tableId', sql.BigInt, table.id)
        .input('scope', sql.NVarChar(16), column.scope)
        .input('partitionKey', sql.NVarChar(32), part)
        .input('recordKey', sql.NVarChar(128), record)
        .input('detailKey', sql.Int, resolvedDetail)
        .input('action', sql.NVarChar(16), change.action)
        .input('oldText', sql.NVarChar(sql.MAX), change.old_value_text)
        .input('oldNumber', sql.Decimal(38, 10), change.old_value_number)
        .input('oldDate', sql.DateTime2, change.old_value_date)
        .input('oldBool', sql.Bit, change.old_value_bool)
        .input('newText', sql.NVarChar(sql.MAX), change.new_value_text)
        .input('newNumber', sql.Decimal(38, 10), change.new_value_number)
        .input('newDate', sql.DateTime2, change.new_value_date)
        .input('newBool', sql.Bit, change.new_value_bool)
        .input('userId', sql.Int, userId || null)
        .query(`
          INSERT INTO dbo.tb_cell_history
            (column_id, table_id, scope, partition_key, record_key, detail_key, action,
             old_value_text, old_value_number, old_value_date, old_value_bool,
             new_value_text, new_value_number, new_value_date, new_value_bool, changed_by)
          VALUES (@columnId, @tableId, @scope, @partitionKey, @recordKey, @detailKey, @action,
             @oldText, @oldNumber, @oldDate, @oldBool, @newText, @newNumber, @newDate, @newBool, @userId);
        `);
    } catch (histErr) {
      logger.warn('tb-cel-geschiedenis wegschrijven mislukt (waarde zelf is opgeslagen)', { error: histErr.message });
    }
  }

  // Formulekolommen die deze kolom refereren direct meesturen (#formulekolom live-update),
  // zodat de UI de rij in één keer kan patchen zonder een volledige board-refresh. Alleen
  // relevant voor master-scope: formules mogen nooit een detail-kolom refereren, en de
  // helper zelf is al een no-op zonder actieve formulekolommen.
  let formulaValues = {};
  let formulaErrors = {};
  if (column.scope === 'master') {
    try {
      const masterCols = await listColumns({ tableId: table.id, scope: 'master', includeInactive: false });
      const recalculated = await recalculateMasterRowFormulas({
        table, masterCols, partitionKey: part, recordKey: record, userId,
      });
      formulaValues = recalculated.formulaValues;
      formulaErrors = recalculated.formulaErrors;
    } catch (err) {
      // Best-effort: de waarde zelf is al opgeslagen; de formule volgt anders bij de volgende board-refresh.
      logger.warn('Formulekolommen herberekenen na cel-edit mislukt (waarde zelf is opgeslagen)', { error: err.message });
    }
  }

  return {
    columnId, partitionKey: part, recordKey: record, detailKey: resolvedDetail, value: empty ? null : value,
    formulaValues, formulaErrors,
  };
}

// ---------------------------------------------------------------------------
// Row-exclusions (#AB:171): "SQL-only verwijderen" van masterrijen. Verwijderen = een persistente
// exclusion (geen harde delete), zodat een refresh de rij wel opnieuw ophaalt maar read() hem eruit
// filtert zolang de exclusion bestaat. Generalisatie van po_row_exclusions (master-niveau, per tabel).
// ---------------------------------------------------------------------------
const MAX_EXCLUSION_BATCH = 500;

// Pure normalisatie: accepteert [{partitionKey, recordKey}], trimt en dedupliceert, weert ongeldige.
function normalizeExclusionRows(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const partitionKey = String(row?.partitionKey ?? '').trim();
    const recordKey = String(row?.recordKey ?? '').trim();
    if (!partitionKey || !recordKey) continue;
    if (partitionKey.length > 32 || recordKey.length > 128) continue;
    const dedupKey = `${partitionKey}|${recordKey}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({ partitionKey, recordKey });
  }
  return out;
}

async function excludeRows({ tableKey, rows }, userId) {
  const table = await getTableByKey(tableKey);
  const normalized = normalizeExclusionRows(rows);
  if (!normalized.length) throw Object.assign(new Error('No valid rows to delete'), { status: 400 });
  if (normalized.length > MAX_EXCLUSION_BATCH) {
    throw Object.assign(new Error(`Maximum ${MAX_EXCLUSION_BATCH} rows at a time`), { status: 400 });
  }
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const { partitionKey, recordKey } of normalized) {
      await new sql.Request(tx)
        .input('tableId', sql.BigInt, table.id)
        .input('partitionKey', sql.NVarChar(32), partitionKey)
        .input('recordKey', sql.NVarChar(128), recordKey)
        .input('by', sql.Int, userId || null)
        .query(`
          MERGE dbo.tb_row_exclusions AS target
          USING (SELECT @tableId AS table_id, @partitionKey AS partition_key, @recordKey AS record_key) AS src
            ON target.table_id = src.table_id AND target.partition_key = src.partition_key AND target.record_key = src.record_key
          WHEN NOT MATCHED THEN
            INSERT (table_id, partition_key, record_key, reason, excluded_by)
            VALUES (@tableId, @partitionKey, @recordKey, 'manual_delete', @by);
        `);
      await new sql.Request(tx)
        .input('tableId', sql.BigInt, table.id)
        .input('partitionKey', sql.NVarChar(32), partitionKey)
        .input('recordKey', sql.NVarChar(128), recordKey)
        .query(`
          UPDATE dbo.tb_cache
          SET sync_retained = 0, sync_retained_at = NULL
          WHERE table_id = @tableId AND scope = 'master'
            AND partition_key = @partitionKey AND record_key = @recordKey
            AND detail_key = ${MASTER_DETAIL_KEY}
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  try {
    const correlationId = crypto.randomUUID();
    await writeChangeLedgerEntries(() => pool.request(), normalized.map(({ partitionKey, recordKey }) => ({
      tableId: table.id,
      partitionKey,
      recordKey,
      detailKey: MASTER_DETAIL_KEY,
      fieldKey: null,
      source: 'USER',
      action: 'DELETE',
      oldValue: null,
      newValue: null,
      changedByUserId: userId || null,
      correlationId,
      refreshJobId: null,
    })));
  } catch (ledgerErr) {
    logger.warn('Change-ledger (exclude rows) wegschrijven mislukt', { error: ledgerErr.message });
  }
  return { excluded: normalized.length };
}

async function includeRows({ tableKey, rows }, userId) {
  const table = await getTableByKey(tableKey);
  const normalized = normalizeExclusionRows(rows);
  if (!normalized.length) throw Object.assign(new Error('No valid rows to restore'), { status: 400 });
  if (normalized.length > MAX_EXCLUSION_BATCH) {
    throw Object.assign(new Error(`Maximum ${MAX_EXCLUSION_BATCH} rows at a time`), { status: 400 });
  }
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const { partitionKey, recordKey } of normalized) {
      await new sql.Request(tx)
        .input('tableId', sql.BigInt, table.id)
        .input('partitionKey', sql.NVarChar(32), partitionKey)
        .input('recordKey', sql.NVarChar(128), recordKey)
        .query(`DELETE FROM dbo.tb_row_exclusions
                WHERE table_id = @tableId AND partition_key = @partitionKey AND record_key = @recordKey`);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  try {
    const correlationId = crypto.randomUUID();
    await writeChangeLedgerEntries(() => pool.request(), normalized.map(({ partitionKey, recordKey }) => ({
      tableId: table.id,
      partitionKey,
      recordKey,
      detailKey: MASTER_DETAIL_KEY,
      fieldKey: null,
      source: 'USER',
      action: 'INSERT',
      oldValue: null,
      newValue: null,
      changedByUserId: userId || null,
      correlationId,
      refreshJobId: null,
    })));
  } catch (ledgerErr) {
    logger.warn('Change-ledger (include rows) wegschrijven mislukt', { error: ledgerErr.message });
  }
  return { included: normalized.length };
}

// Verborgen rijen die na de laatste sync nóg door de bron-scope zijn opgehaald (removed_at_source=0):
// die matchen de filter dus nog, maar zijn handmatig verborgen — signaal om terug te zetten. Toont de
// masterkolommen die admin voor de verwijder-popup zichtbaar zette (visibleAtDelete).
async function listHiddenInFilterRows(tableKey) {
  const table = await getTableByKey(tableKey);
  const pool = await getPool();
  const masterCols = (await listColumns({ tableId: table.id, scope: 'master', includeInactive: true }))
    .filter((col) => col.visibleAtDelete);

  const result = await pool.request()
    .input('tableId', sql.BigInt, table.id)
    .query(`
      SELECT c.partition_key, c.record_key, c.data_json, ex.excluded_at
      FROM dbo.tb_row_exclusions ex
      INNER JOIN dbo.tb_cache c
        ON c.table_id = ex.table_id AND c.scope = 'master'
       AND c.partition_key = ex.partition_key AND c.record_key = ex.record_key
      WHERE ex.table_id = @tableId AND c.removed_at_source = 0
      ORDER BY c.record_key
    `);

  const columns = masterCols.map((col) => ({ key: col.key, label: col.label, dataType: col.dataType }));
  const rows = result.recordset.map((r) => {
    const json = parseJson(r.data_json);
    const values = {};
    for (const col of masterCols) values[col.key] = col.key in json ? json[col.key] : null;
    return { partitionKey: r.partition_key, recordKey: r.record_key, excludedAt: normalizeOut(r.excluded_at), values };
  });
  return { count: rows.length, columns, rows };
}

// ---------------------------------------------------------------------------
// correctField — write-back van een bron-veld naar D365 (#AB:172, board-cutover Fase 3).
// Generalisatie van de po_*-write-back: valideert de tb_kolom (writable + mechanisme 'patch' + source_field),
// legt een tb_field_corrections-audit vast (pending -> applied/failed), en schrijft terug via de bestaande
// D365-writeBackField (met etag/concurrency-check). Bij succes wordt de tb_cache best-effort bijgewerkt.
// LET OP: writeBackField is nog PO-entiteit-gebonden (PurchaseOrderHeaders/Lines). Voor de purchase-orders-
// tabel klopt de mapping 1-op-1 (partitionKey=dataAreaId, recordKey=orderNumber, detailKey=lineNumber).
// TODO(#177): generieke PATCH via de SourceProvider zodra andere schrijfbare tabellen nodig zijn.
async function correctField({ tableKey, columnId, partitionKey, recordKey, detailKey, value, basedOnValue }, user) {
  // Backwards compat: sommige interne callers gaven tot dusver een kaal userId door.
  const userId = (user && typeof user === 'object') ? user.id : user;
  const table = await getTableByKey(tableKey);
  const { getColumnById } = require('./TableRegistryService');
  const column = await getColumnById(columnId);
  if (!column || !column.isActive || column.tableId !== table.id) {
    throw Object.assign(new Error('Column not found'), { status: 404 });
  }
  assertNotPavWritable(tableKey, column);
  if (column.source !== 'source' || !column.writable || column.writeMechanism !== 'patch' || !column.sourceField) {
    throw Object.assign(new Error('This column is not configured for write-back to D365'), { status: 400 });
  }
  // Vendors mogen alleen naar D365 terugschrijven op kolommen die de admin expliciet als
  // vendor-editable heeft aangemerkt (Data model). Rij-scope is al afgedwongen vóór deze aanroep.
  if (String(user?.role || '') === ROLES.SUPPLIER && !column.vendorEditable) {
    throw Object.assign(new Error('This column cannot be edited by vendors'), { status: 403 });
  }

  const part = String(partitionKey || '').trim();
  const record = String(recordKey || '').trim();
  if (!part || !record) throw Object.assign(new Error('partitionKey and recordKey are required'), { status: 400 });

  const level = column.scope === 'detail' ? 'line' : 'header';
  let resolvedDetail = MASTER_DETAIL_KEY;
  if (column.scope === 'detail') {
    const dk = toNumberOrNull(detailKey);
    if (dk === null) throw Object.assign(new Error('detailKey is required for a line column'), { status: 400 });
    resolvedDetail = dk;
  }

  let newValue;
  if (column.dataType === 'number') newValue = toNumberOrNull(value);
  else if (column.dataType === 'date') { const d = toDateOrNull(value); newValue = d ? d.toISOString() : null; }
  else if (column.dataType === 'boolean') newValue = value === true || value === 'true' || value === 1 || value === '1';
  else newValue = value === null || value === undefined ? null : String(value);

  const pool = await getPool();
  // 1) Audit: pending
  const ins = await pool.request()
    .input('columnId', sql.BigInt, columnId)
    .input('tableId', sql.BigInt, table.id)
    .input('scope', sql.NVarChar(16), column.scope)
    .input('partitionKey', sql.NVarChar(32), part)
    .input('recordKey', sql.NVarChar(128), record)
    .input('detailKey', sql.Int, resolvedDetail)
    .input('sourceField', sql.NVarChar(128), column.sourceField)
    .input('old', sql.NVarChar(sql.MAX), basedOnValue === null || basedOnValue === undefined ? null : String(basedOnValue))
    .input('new', sql.NVarChar(sql.MAX), newValue === null || newValue === undefined ? null : String(newValue))
    .input('by', sql.Int, userId || null)
    .query(`
      INSERT INTO dbo.tb_field_corrections
        (column_id, table_id, scope, partition_key, record_key, detail_key, source_field, old_value, new_value, status, created_by)
      OUTPUT INSERTED.id
      VALUES (@columnId, @tableId, @scope, @partitionKey, @recordKey, @detailKey, @sourceField, @old, @new, 'pending', @by);
    `);
  const correctionId = ins.recordset[0].id;

  // 2) Terugschrijven naar D365 (etag + concurrency-check zit in writeBackField).
  try {
    await writeBackField({
      level, dataAreaId: part, orderNumber: record, lineNumber: resolvedDetail,
      d365Field: column.sourceField, newValue, basedOnValue, dataType: column.dataType,
    });
  } catch (err) {
    await pool.request()
      .input('id', sql.BigInt, correctionId)
      .input('err', sql.NVarChar(sql.MAX), err.message || 'Unknown error')
      .query("UPDATE dbo.tb_field_corrections SET status = 'failed', error = @err WHERE id = @id");
    throw err;
  }

  // 3) Applied + tb_cache best-effort bijwerken (data_json op kolom-key; volgende refresh corrigeert hoe dan ook).
  await pool.request()
    .input('id', sql.BigInt, correctionId)
    .query("UPDATE dbo.tb_field_corrections SET status = 'applied', applied_at = SYSUTCDATETIME() WHERE id = @id");

  try {
    await writeChangeLedgerEntries(() => pool.request(), [{
      tableId: table.id,
      partitionKey: part,
      recordKey: record,
      detailKey: resolvedDetail,
      fieldKey: column.key,
      source: 'USER',
      action: basedOnValue === null || basedOnValue === undefined ? 'INSERT' : 'UPDATE',
      oldValue: toLedgerValue(basedOnValue),
      newValue: toLedgerValue(newValue),
      changedByUserId: userId || null,
      correlationId: crypto.randomUUID(),
      refreshJobId: null,
    }]);
  } catch (ledgerErr) {
    logger.warn('Change-ledger (user D365 correction) wegschrijven mislukt', { error: ledgerErr.message });
  }

  try {
    const cacheRow = await pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('scope', sql.NVarChar(16), column.scope)
      .input('partitionKey', sql.NVarChar(32), part)
      .input('recordKey', sql.NVarChar(128), record)
      .input('detailKey', sql.Int, resolvedDetail)
      .query(`SELECT data_json FROM dbo.tb_cache
              WHERE table_id = @tableId AND scope = @scope AND partition_key = @partitionKey
                AND record_key = @recordKey AND detail_key = @detailKey`);
    if (cacheRow.recordset.length) {
      const json = parseJson(cacheRow.recordset[0].data_json);
      json[column.key] = newValue;
      await pool.request()
        .input('tableId', sql.BigInt, table.id)
        .input('scope', sql.NVarChar(16), column.scope)
        .input('partitionKey', sql.NVarChar(32), part)
        .input('recordKey', sql.NVarChar(128), record)
        .input('detailKey', sql.Int, resolvedDetail)
        .input('dataJson', sql.NVarChar(sql.MAX), JSON.stringify(json))
        .query(`UPDATE dbo.tb_cache SET data_json = @dataJson
                WHERE table_id = @tableId AND scope = @scope AND partition_key = @partitionKey
                  AND record_key = @recordKey AND detail_key = @detailKey`);
    }
  } catch (err) {
    logger.warn('tb_cache bijwerken na write-back mislukt (niet-kritiek)', { error: err.message });
  }

  // Zie saveCustomValue: formulekolommen die deze kolom refereren direct meesturen zodat de
  // UI de rij kan patchen zonder volledige board-refresh. Alleen relevant voor header-scope.
  let formulaValues = {};
  let formulaErrors = {};
  if (level === 'header') {
    try {
      const masterCols = await listColumns({ tableId: table.id, scope: 'master', includeInactive: false });
      const recalculated = await recalculateMasterRowFormulas({
        table, masterCols, partitionKey: part, recordKey: record, userId,
      });
      formulaValues = recalculated.formulaValues;
      formulaErrors = recalculated.formulaErrors;
    } catch (err) {
      logger.warn('Formulekolommen herberekenen na write-back mislukt (waarde zelf is opgeslagen)', { error: err.message });
    }
  }

  return {
    success: true, columnId, partitionKey: part, recordKey: record, detailKey: resolvedDetail, value: newValue,
    formulaValues, formulaErrors,
  };
}

const GENERIC_DETAIL_WRITEBACK_FAIL = 'Write-back to D365 failed';

async function loadDetailLinesFromCache({ tableId, partitionKey, recordKey }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('partitionKey', sql.NVarChar(32), partitionKey)
    .input('recordKey', sql.NVarChar(128), recordKey)
    .query(`
      SELECT detail_key, data_json, removed_at_source
      FROM dbo.tb_cache
      WHERE table_id = @tableId AND scope = 'detail'
        AND partition_key = @partitionKey AND record_key = @recordKey
      ORDER BY detail_key
    `);
  return (result.recordset || []).map((row) => ({
    detailKey: row.detail_key,
    values: parseJson(row.data_json),
    removed: row.removed_at_source === true || row.removed_at_source === 1,
  }));
}

// Fan-out vanaf een gepushte header-cel: alle detailregels van één PO via bestaand correctField.
async function correctAllDetailFields(
  { tableKey, columnId, partitionKey, recordKey, value },
  user,
  deps = {},
) {
  const role = String(user?.role || '');
  const isStaffUser = role === ROLES.ADMIN || role === ROLES.EMPLOYEE;
  if (!isStaffUser && role !== ROLES.SUPPLIER) {
    throw Object.assign(new Error('Access denied — insufficient permissions'), { status: 403 });
  }

  return time('tb_correct_all_details', async () => {
    if (tableKey !== 'purchase-orders') {
      throw Object.assign(new Error('Header write-back is only supported for purchase orders'), { status: 400 });
    }

    const resolveTable = deps.getTableByKey || getTableByKey;
    const { getColumnById } = require('./TableRegistryService');
    const resolveColumn = deps.getColumnById || getColumnById;
    const table = await resolveTable(tableKey);
    const column = await resolveColumn(columnId);
    if (!column || !column.isActive || column.tableId !== table.id) {
      throw Object.assign(new Error('Column not found'), { status: 404 });
    }
    if (column.source !== 'source' || !column.writable || column.writeMechanism !== 'patch' || !column.sourceField) {
      throw Object.assign(new Error('This column is not configured for write-back to D365'), { status: 400 });
    }
    // Vendors mogen deze header-fan-out alleen op kolommen die de admin expliciet als
    // vendor-editable heeft aangemerkt (Data model). Rij-scope is al afgedwongen vóór deze aanroep.
    if (!isStaffUser && !column.vendorEditable) {
      throw Object.assign(new Error('This column cannot be edited by vendors'), { status: 403 });
    }
    if (column.scope !== 'detail') {
      throw Object.assign(new Error('Header write-back requires a writable line column'), { status: 400 });
    }

    const part = String(partitionKey || '').trim();
    const record = String(recordKey || '').trim();
    if (!part || !record) {
      throw Object.assign(new Error('partitionKey and recordKey are required'), { status: 400 });
    }

    const loadLines = deps.loadDetailLines || loadDetailLinesFromCache;
    const lines = await loadLines({ tableId: table.id, partitionKey: part, recordKey: record });
    const plan = planFanout({
      lines,
      columnKey: column.key,
      targetValue: value,
      valuesEqual: (current, target) => valuesEqualForConcurrency(current, target, column.dataType),
    });
    if (plan.tooMany) {
      throw Object.assign(new Error('Too many lines to write back from the header.'), { status: 400 });
    }

    const correctOne = deps.correctOne || correctField;
    const updatedDetailKeys = [];
    const failures = [];

    for (const line of plan.toPatch) {
      try {
        await correctOne({
          tableKey,
          columnId,
          partitionKey: part,
          recordKey: record,
          detailKey: line.detailKey,
          value,
          basedOnValue: line.values?.[column.key],
        }, user?.id);
        updatedDetailKeys.push(line.detailKey);
      } catch (err) {
        if (isBusinessWriteBackError(err)) {
          failures.push({
            detailKey: line.detailKey,
            message: err.message || GENERIC_DETAIL_WRITEBACK_FAIL,
          });
          continue;
        }
        if (updatedDetailKeys.length === 0) throw err;
        failures.push({ detailKey: line.detailKey, message: GENERIC_DETAIL_WRITEBACK_FAIL });
        break;
      }
    }

    return {
      attempted: plan.toPatch.length,
      updated: updatedDetailKeys.length,
      skipped: plan.skipped.length,
      failed: failures.length,
      failures: failures.slice(0, 200),
      remainingValues: remainingValuesAfterPass({
        lines,
        columnKey: column.key,
        targetValue: value,
        updatedDetailKeys,
        failedDetailKeys: failures.map((entry) => entry.detailKey),
      }),
      updatedDetailKeys,
    };
  });
}

// ---------------------------------------------------------------------------
// Cel-geschiedenis (#AB:173, cutover Fase 4): verenigde per-cel tijdlijn van eigen-kolom-edits
// (tb_cell_history) + D365-veldcorrecties (tb_field_corrections). Generalisatie van po_ getCellHistory.
// ---------------------------------------------------------------------------
function pickTypedValue({ text, number, date, bool }) {
  if (number !== null && number !== undefined) return Number(number);
  if (date !== null && date !== undefined) return date instanceof Date ? date.toISOString() : date;
  if (bool !== null && bool !== undefined) return Boolean(bool);
  return text === undefined ? null : text;
}

function formatHistoryRow(row) {
  return {
    source: row.source,                       // 'custom' | 'writeback'
    action: row.action,                       // 'insert' | 'update' | 'clear' | 'correct'
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    oldValue: pickTypedValue({ text: row.old_value_text, number: row.old_value_number, date: row.old_value_date, bool: row.old_value_bool }),
    newValue: pickTypedValue({ text: row.new_value_text, number: row.new_value_number, date: row.new_value_date, bool: row.new_value_bool }),
    status: row.status || null,               // alleen write-back (pending/applied/failed)
    reason: row.change_reason || null,
    user: row.user_name
      ? { name: row.user_name }
      : null,
  };
}

async function getCellHistory({ tableKey, columnId, partitionKey, recordKey, detailKey }) {
  const table = await getTableByKey(tableKey);
  const { getColumnById } = require('./TableRegistryService');
  const column = await getColumnById(columnId);
  if (!column || !column.isActive || column.tableId !== table.id) {
    throw Object.assign(new Error('Column not found'), { status: 404 });
  }
  const part = String(partitionKey || '').trim();
  const record = String(recordKey || '').trim();
  if (!part || !record) throw Object.assign(new Error('partitionKey and recordKey are required'), { status: 400 });
  if (part.length > 32 || record.length > 128) throw Object.assign(new Error('partitionKey or recordKey is too long'), { status: 400 });

  let resolvedDetail = MASTER_DETAIL_KEY;
  if (column.scope === 'detail') {
    const dk = toNumberOrNull(detailKey);
    if (dk === null) throw Object.assign(new Error('detailKey is required for a line column'), { status: 400 });
    resolvedDetail = dk;
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('columnId', sql.BigInt, columnId)
    .input('partitionKey', sql.NVarChar(32), part)
    .input('recordKey', sql.NVarChar(128), record)
    .input('detailKey', sql.Int, resolvedDetail)
    .query(`
      SELECT 'custom' AS source, h.action, h.changed_at AS at,
             h.old_value_text, h.old_value_number, h.old_value_date, h.old_value_bool,
             h.new_value_text, h.new_value_number, h.new_value_date, h.new_value_bool,
             CAST(NULL AS NVARCHAR(16)) AS status, h.change_reason,
             u.display_name AS user_name
      FROM dbo.tb_cell_history h
      LEFT JOIN dbo.users u ON u.id = h.changed_by
      WHERE h.column_id = @columnId AND h.partition_key = @partitionKey
        AND h.record_key = @recordKey AND h.detail_key = @detailKey
      UNION ALL
      SELECT 'writeback' AS source, 'correct' AS action, c.created_at AS at,
             c.old_value AS old_value_text, CAST(NULL AS DECIMAL(38,10)) AS old_value_number, CAST(NULL AS DATETIME2) AS old_value_date, CAST(NULL AS BIT) AS old_value_bool,
             c.new_value AS new_value_text, CAST(NULL AS DECIMAL(38,10)) AS new_value_number, CAST(NULL AS DATETIME2) AS new_value_date, CAST(NULL AS BIT) AS new_value_bool,
             c.status, CAST(NULL AS NVARCHAR(512)) AS change_reason,
             u2.display_name AS user_name
      FROM dbo.tb_field_corrections c
      LEFT JOIN dbo.users u2 ON u2.id = c.created_by
      WHERE c.column_id = @columnId AND c.partition_key = @partitionKey
        AND c.record_key = @recordKey AND c.detail_key = @detailKey
      ORDER BY at DESC;
    `);
  return result.recordset.map(formatHistoryRow);
}

// ---------------------------------------------------------------------------
// getDataModel (#AB:174/#175, cutover Fase 5/6): admin-datamodel-payload op de tb_*-laag — entiteiten,
// relatie, kolommen (incl. verborgen, gemapt naar de admin-vorm), cache-stats en sync-filter. Vervangt
// het po_*-specifieke /datamodel zodat de admin-pagina generiek wordt. De D365-filtercatalogus wordt
// (voorlopig) hergebruikt uit de PO-cacheservice; in Fase 8 verhuist die mee naar de generieke laag.
const PURCHASE_ORDER_SYNC_TEMPLATES = [
  { id: 'open_orders', label: 'Open orders', rules: [{ level: 'header', field: 'PurchaseOrderStatus', operator: 'eq', valueType: 'enum', enumType: 'PurchStatus', value: 'Backorder' }] },
  { id: 'received_orders', label: 'Received orders', rules: [{ level: 'header', field: 'PurchaseOrderStatus', operator: 'eq', valueType: 'enum', enumType: 'PurchStatus', value: 'Received' }] },
  { id: 'vendor_group', label: 'Vendor group', rules: [{ level: 'header', field: 'VendorGroupId', operator: 'eq', valueType: 'text', value: '' }] },
];

function syncTemplatesForTable(tableKey) {
  return tableKey === 'purchase-orders' ? PURCHASE_ORDER_SYNC_TEMPLATES : [];
}

// tb_-kolom -> admin-vorm die DataPreviewTables/useDataModelAdmin verwacht (level i.p.v. scope, d365 i.p.v. source).
function toAdminColumn(col) {
  return {
    id: col.id,
    key: col.key,
    label: col.label,
    level: col.scope === 'detail' ? 'line' : 'header',
    scope: col.scope,
    source: col.source === 'source' ? 'd365' : col.source, // admin-UI kent 'd365' | 'custom'
    dataType: col.dataType,
    options: col.options,
    d365Field: col.sourceField || null,
    writableToD365: Boolean(col.writable),
    writeMechanism: col.writeMechanism || null,
    isActive: Boolean(col.isActive),
    isDefaultVisible: Boolean(col.isDefaultVisible),
    visibleAtDelete: Boolean(col.visibleAtDelete),
    filterable: Boolean(col.filterable),
    sortable: Boolean(col.sortable),
    sortOrder: col.sortOrder,
    formulaExpr: col.formulaExpr || null,
  };
}

function buildPreviewTableFromCacheRows(columns, cacheRows) {
  const d365Columns = (Array.isArray(columns) ? columns : []).filter(
    (column) => column.source === 'd365' && column.d365Field
  );
  const d365Fields = [...new Set(d365Columns.map((column) => String(column.d365Field)))];
  const rows = (Array.isArray(cacheRows) ? cacheRows : []).map((cacheRow) => {
    const source = parseJson(cacheRow?.data_json);
    const values = {};
    for (const column of d365Columns) {
      const preferred = lookupRawFieldValue(source, column.key);
      const fallback = preferred === undefined ? lookupRawFieldValue(source, column.d365Field) : preferred;
      values[column.d365Field] = fallback === undefined ? null : fallback;
    }
    return { values };
  });

  const sampleByField = {};
  for (const field of d365Fields) {
    sampleByField[field] = '—';
    for (let i = 0; i < rows.length; i += 1) {
      const candidate = rows[i]?.values?.[field];
      if (isEmptySampleValue(candidate)) continue;
      sampleByField[field] = formatSampleValue(candidate);
      break;
    }
  }

  return {
    columns: d365Fields,
    rows,
    sampledRows: rows.length,
    sampleByField,
  };
}

function getMissingPreviewFields(columns, sampleByField) {
  const fields = [...new Set(
    (Array.isArray(columns) ? columns : [])
      .filter((column) => column.source === 'd365' && column.d365Field)
      .map((column) => String(column.d365Field))
  )];
  return fields.filter((field) => {
    const current = sampleByField?.[field];
    return !current || current === '—';
  });
}

// Board-kolomdefinities inclusief lookup-verrijking (zelfde set als de board-read).
async function getBoardColumnDefinitions(tableKey, { scope = null } = {}) {
  const table = await getTableByKey(tableKey);
  const enrichment = await loadLookupEnrichmentCached(table);
  const scopes = scope && ['master', 'detail'].includes(scope) ? [scope] : ['master', 'detail'];
  const result = { master: [], detail: [] };
  await Promise.all(scopes.map(async (entryScope) => {
    const cols = await listColumns({ tableId: table.id, scope: entryScope, includeInactive: false });
    result[entryScope] = entryScope === 'master'
      ? [...cols, ...enrichment.masterCols]
      : [...cols, ...enrichment.detailCols];
  }));
  return result;
}

async function getDataModel(tableKey) {
  const table = await getTableByKey(tableKey);
  const pool = await getPool();
  const [masterCols, detailCols] = await Promise.all([
    listColumns({ tableId: table.id, scope: 'master', includeInactive: true }),
    listColumns({ tableId: table.id, scope: 'detail', includeInactive: true }),
  ]);
  // lookup-kolommen zijn afgeleid/read-only en horen niet in de admin-config.
  let headerCols = masterCols.filter((c) => c.source !== 'lookup').map(toAdminColumn);
  const lineCols = detailCols.filter((c) => c.source !== 'lookup').map(toAdminColumn);

  const hasDetail = Boolean(table.relation && table.relation.kind && table.relation.kind !== 'none');
  // Alleen bij custom headerkolommen: markeer "push to header"-koppelingen. Draait parallel
  // met de preview-queries en hergebruikt de 60s staff-links-cache — geen extra werk op het board.
  const hasCustomHeader = headerCols.some((column) => column.source === 'custom');

  const [headerPreviewRowsRes, linePreviewRowsRes, runtimeHeaderLinks] = await Promise.all([
    pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('rowLimit', sql.Int, DATA_MODEL_PREVIEW_ROW_LIMIT)
      .query(`
        SELECT TOP (@rowLimit) data_json
        FROM dbo.tb_cache WITH (NOLOCK)
        WHERE table_id = @tableId AND scope = 'master' AND removed_at_source = 0
        ORDER BY synced_at DESC, record_key ASC
      `),
    hasDetail
      ? pool.request()
        .input('tableId', sql.BigInt, table.id)
        .input('rowLimit', sql.Int, DATA_MODEL_PREVIEW_ROW_LIMIT)
        .query(`
          SELECT TOP (@rowLimit) data_json
          FROM dbo.tb_cache WITH (NOLOCK)
          WHERE table_id = @tableId AND scope = 'detail'
          ORDER BY synced_at DESC, record_key ASC, detail_key ASC
        `)
      : Promise.resolve({ recordset: [] }),
    hasCustomHeader
      ? time('dm_header_links', () => loadStaffRuntimeHeaderLinks(pool, table.key))
      : Promise.resolve(null),
  ]);
  if (runtimeHeaderLinks) {
    headerCols = annotateAdminColumnsWithLineLinks(headerCols, runtimeHeaderLinks);
  }

  const [baseUrl, company] = await Promise.all([
    settingsService.getAsync('D365_ODATA_BASE_URL', ''),
    settingsService.getAsync('D365_ODATA_COMPANY', ''),
  ]);
  const syncLayers = await getTableSyncLayers(table);
  const compiledLayers = syncLayers.map((layer) => {
    let compiled = '';
    try { compiled = compileSyncRules(layer.rules); } catch { compiled = ''; }
    return { ...layer, compiled };
  });
  const isInheritedSyncFilterTable = READ_ONLY_SYNC_FILTER_TABLE_KEYS.has(String(table.key || '').trim().toLowerCase());
  const usesPoLookupScope = PO_LOOKUP_SCOPED_TABLE_KEYS.has(String(table.key || '').trim().toLowerCase());
  let inheritedLayers = [];
  let inheritedCompiledFilter = '';
  if (isInheritedSyncFilterTable || usesPoLookupScope) {
    inheritedLayers = await getPurchaseOrderSyncLayers();
    const inheritedChunks = inheritedLayers
      .filter((layer) => layer.active)
      .map((layer) => { try { return compileSyncRules(layer.rules); } catch { return ''; } })
      .filter(Boolean);
    inheritedCompiledFilter = inheritedChunks.length ? inheritedChunks.map((c) => `(${c})`).join(' or ') : '';
  }

  // Cache-stats uit tb_cache + tb_sync_state.
  const statsRes = await pool.request().input('t', sql.BigInt, table.id).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.tb_cache WHERE table_id = @t AND scope = 'master' AND removed_at_source = 0) AS master_rows,
      (SELECT COUNT(*) FROM dbo.tb_cache WHERE table_id = @t AND scope = 'detail') AS detail_rows,
      (SELECT COUNT(*) FROM dbo.tb_cache WHERE table_id = @t AND scope = 'master' AND sync_retained = 1) AS retained_rows`);
  const { lastFullSyncAt } = await getSyncState(table.id);
  const retainedRows = Number(statsRes.recordset[0]?.retained_rows) || 0;
  const retentionSettings = table.key === 'purchase-orders'
    ? await getSyncRetentionSettings()
    : null;
  const cache = {
    masterRows: Number(statsRes.recordset[0]?.master_rows) || 0,
    detailRows: Number(statsRes.recordset[0]?.detail_rows) || 0,
    lastSyncedAt: lastFullSyncAt ? new Date(lastFullSyncAt).toISOString() : null,
    retainedRows,
    retentionWarning: retentionSettings
      ? resolveRetentionWarning(retainedRows, retentionSettings)
      : 'none',
    retainedMaxAuto: retentionSettings?.maxAuto || null,
    retainedFetchBudget: retentionSettings?.fetchBudget || null,
  };

  // D365-filtercatalogus uit de admin-gemapte kolommen (generiek; geen po_-afhankelijkheid meer).
  const { buildFilterCatalogPayload } = require('../utils/tbSyncFilterCatalog');
  const filterMeta = buildFilterCatalogPayload([...headerCols, ...lineCols]);
  if (table.key === 'purchase-orders') {
    const header = Array.isArray(filterMeta.catalog?.header) ? filterMeta.catalog.header : [];
    const withoutNativeGroup = header.filter((entry) => entry.field !== 'VendorGroupId');
    filterMeta.catalog.header = [
      vendorGroupCatalogEntry(),
      ...withoutNativeGroup.map((entry) => (
        isRecommendedFilterField(entry.field) ? { ...entry, recommended: true } : entry
      )),
    ];
  }
  let previewTables = {
    header: buildPreviewTableFromCacheRows(headerCols, headerPreviewRowsRes.recordset),
    line: buildPreviewTableFromCacheRows(lineCols, linePreviewRowsRes.recordset),
  };
  const missingHeaderFields = getMissingPreviewFields(headerCols, previewTables.header.sampleByField);
  const missingLineFields = getMissingPreviewFields(lineCols, previewTables.line.sampleByField);
  if ((missingHeaderFields.length || missingLineFields.length) && table.key === 'purchase-orders') {
    try {
      const resolvedPreviewLayers = await resolveSyncLayers(compiledLayers, { forD365: true });
      const previewChunks = compileSyncLayerChunks(resolvedPreviewLayers);
      const fallbackSample = await fetchPurchaseOrders({
        supplierAccount: null,
        top: DATA_MODEL_PREVIEW_ROW_LIMIT,
        skip: 0,
        fetchAll: false,
        extraFilter: previewChunks[0] || '',
        maxItems: DATA_MODEL_PREVIEW_ROW_LIMIT,
      });
      const headerRawRows = (fallbackSample.items || []).map((item) => item?.raw || {});
      const lineRawRows = (fallbackSample.items || []).flatMap((item) => (
        Array.isArray(item?.lines) ? item.lines.map((line) => line?.raw || {}) : []
      ));
      previewTables = {
        header: fillMissingSamplesFromRawRows(previewTables.header, missingHeaderFields, headerRawRows),
        line: fillMissingSamplesFromRawRows(previewTables.line, missingLineFields, lineRawRows),
      };
    } catch (err) {
      logger.warn('Fallback sample preview uit D365 mislukt; cache-samples blijven leidend', {
        tableKey,
        error: err.message,
      });
    }
  }

  const lookups = await getLookups(table.id);
  const lookupEntities = await Promise.all(lookups.map(async (lookup) => {
    let targetLabel = lookup.targetTableKey;
    let targetColumns = [];
    try {
      const target = await getTableByKey(lookup.targetTableKey);
      targetLabel = target.label;
      const columns = await listColumns({ tableId: target.id, scope: 'master', includeInactive: true });
      targetColumns = columns
        .filter((column) => column.source === 'source')
        .map((column) => ({
          key: column.key,
          label: column.label,
          dataType: column.dataType,
          isActive: Boolean(column.isActive),
        }));
    } catch {
      // Doeltabel ontbreekt/inactief; key blijft als label zichtbaar in het diagram.
    }
    const selectedTargetColumns = targetColumns.filter((column) => column.isActive).map((column) => column.key);
    return {
      id: lookup.id,
      sourceScope: lookup.sourceScope,
      sourceField: lookup.sourceField,
      targetTableKey: lookup.targetTableKey,
      targetTableLabel: targetLabel,
      targetKeyField: lookup.targetKeyField,
      fields: lookup.fields,
      selectedTargetColumns,
      targetColumns,
    };
  }));

  const firstActiveLayer = compiledLayers.find((layer) => layer.active);
  const syncFilterPayload = isInheritedSyncFilterTable
    ? {
        layers: [],
        rules: [],
        compiled: '',
        inheritedLayers,
        inheritedRules: inheritedLayers.flatMap((layer) => (layer.active ? layer.rules : [])),
        inheritedCompiled: inheritedCompiledFilter,
        readOnly: true,
        inheritedFromTable: 'purchase-orders',
        message: 'This table automatically inherits the active Purchase Orders sync filter.',
        operators: OPERATORS,
        maxRules: MAX_RULES,
        maxLayers: MAX_LAYERS,
        templates: [],
      }
    : {
        // Nieuwe, primaire vorm (#325): meerdere additieve (OR) filter-lagen.
        layers: compiledLayers,
        // Backwards compat voor oudere clients: eerste actieve laag als platte "rules"/"compiled".
        rules: firstActiveLayer ? firstActiveLayer.rules : [],
        compiled: firstActiveLayer ? firstActiveLayer.compiled : '',
        readOnly: false,
        operators: OPERATORS,
        maxRules: MAX_RULES,
        maxLayers: MAX_LAYERS,
        templates: syncTemplatesForTable(table.key),
        // Items zijn bewerkbaar maar blijven beperkt tot de PO lookup scope (itemnummers uit
        // gesyncte inkooporders). De PO-filter tonen we informatief; het eigen filter werkt binnen die scope.
        ...(usesPoLookupScope
          ? {
              poLookupScoped: true,
              inheritedCompiled: inheritedCompiledFilter,
              inheritedFromTable: 'purchase-orders',
              poScopeHint: 'Items are limited to item numbers on synced purchase orders. Filters below apply within that scope.',
            }
          : {}),
      };

  return {
    entities: [
      { id: 'header', name: table.sourceEntity, title: `${table.label} (kop)`, path: table.sourceEntity, keys: table.keyFields, cacheTable: 'tb_cache' },
      ...(hasDetail ? [{ id: 'line', name: table.relation.detailSourceEntity || 'lines', title: `${table.label} (regels)`, expandedVia: table.relation.detailSourceEntity || null, keys: [...table.keyFields, 'LineNumber'], cacheTable: 'tb_cache' }] : []),
    ],
    relation: hasDetail ? {
      from: 'header', to: 'line', cardinality: '1:n', onFields: table.keyFields,
      description: 'Eén kop heeft meerdere regels (via $expand).',
    } : null,
    connection: { baseUrl: baseUrl.trim() || null, company: company.trim() || null },
    columns: { header: headerCols, line: lineCols },
    cache,
    syncFilter: syncFilterPayload,
    filterCatalog: filterMeta.catalog,
    previewTables,
    lookups: lookupEntities,
    discovery: null,
  };
}

async function saveTableDefaultFilter(tableId, rules) {
  const pool = await getPool();
  await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('defaultFilterJson', sql.NVarChar(sql.MAX), JSON.stringify(rules))
    .query(`
      UPDATE dbo.tb_tables
      SET default_filter_json = @defaultFilterJson,
          updated_at = SYSUTCDATETIME()
      WHERE id = @tableId
    `);
  // default_filter_json zit in de gecachte tabel-metadata; alleen tableId bekend -> alles leegmaken.
  invalidateTableCache();
}

// Sync-filter-LAGEN per tabel opslaan (#325: meerdere additieve OR-lagen i.p.v. één vervangende
// regel-lijst). Accepteert zowel { layers: [...] } als de legacy platte rules-array (auto-wrap via
// normalizeSyncLayers) voor backwards compatibility.
async function saveSyncFilters(tableKey, payload) {
  const table = await getTableByKey(tableKey);
  if (READ_ONLY_SYNC_FILTER_TABLE_KEYS.has(String(table.key || '').trim().toLowerCase())) {
    throw Object.assign(new Error('This table automatically inherits the Purchase Orders filter and cannot be changed manually.'), { status: 400 });
  }
  const { layers } = normalizeSyncLayers(payload);
  for (const layer of layers) {
    if (layer.rules.some(isVendorGroupRule)) expandVendorGroupRules(layer.rules, ['ok']);
  }
  const compiledLayers = layers.map((layer) => {
    let compiled = '';
    try { compiled = compileSyncRules(layer.rules.filter((rule) => !isVendorGroupRule(rule))); } catch { compiled = ''; }
    return { ...layer, compiled };
  });

  if (table.key === 'purchase-orders') {
    await settingsService.set('PO_SYNC_RULES', JSON.stringify({ layers }));
    const pool = await getPool();
    const activeLayers = layers.filter((layer) => layer.active);
    if (activeLayers.length) {
      const resolvedLayers = await resolveSyncLayers(activeLayers, { forD365: false });
      // Alleen rijen buiten de nieuwe combinatie van actieve lagen markeren als out-of-scope —
      // niet meer blind alle sync_retained resetten (dat verloor eerder ten onrechte de scope/
      // retentie van niet-gewijzigde lagen, zie AC #2 work item #325).
      await markOutOfScopeCacheRows(pool, table.id, resolvedLayers);
      // Rijen die weer matchen (bv. een laag opnieuw actief) direct herstellen, zodat eerder
      // gecachte data direct terugkomt zonder op de nachtrun te wachten (AC #3, unmarkInScopeCacheRows).
      await unmarkInScopeCacheRows(pool, table.id, resolvedLayers);
    } else {
      await clearSyncRetainedForTable(pool, table.id);
    }
  }
  await saveTableDefaultFilter(table.id, layers.flatMap((layer) => (layer.active ? layer.rules : [])));
  // Deze actie verandert wélke rijen in scope zijn (removed_at_source / sync_retained) zonder
  // content_changed_at of last_full_sync_at te raken. De gedeelde BI/RCCP-snapshots moeten dus
  // expliciet weg, anders tonen die tot de volgende signatuurwijziging out-of-scope rijen.
  // eslint-disable-next-line global-require
  require('./BoardSnapshotCache').invalidateBoardSnapshots({ tableKey: table.key });
  return { layers: compiledLayers };
}

// Tel hoeveel bron-rijen ÉÉN regel-set matcht (interne helper, hergebruikt per laag).
async function countSyncFilterForRules(table, rules) {
  const resolved = table.key === 'purchase-orders' ? await resolveSyncRules(rules, { forD365: true }) : rules;
  const compiled = compileSyncRules(resolved);
  const filterChunks = compileSyncRulesChunks(resolved);

  // PO lookup scoped tabellen (items): tel binnen de PO-scope. Combineer het eigen filter (AND) met
  // de one-of clausules op de lookup-sleutels. Chunks zijn disjuncte itemnummers → som is exact.
  if (PO_LOOKUP_SCOPED_TABLE_KEYS.has(String(table.key || '').trim().toLowerCase())) {
    const scopes = await getInheritedPoLookupScopes(table);
    if (!scopes.length) return { total: 0, compiled };
    let total = 0;
    for (const scope of scopes) {
      for (const chunk of chunkList(scope.values, INHERITED_FILTER_CHUNK_SIZE)) {
        const oneOf = buildOneOfFilterClause(scope.targetField, chunk);
        if (!oneOf) continue;
        for (const ownFilter of filterChunks) {
          const chunkResult = await fetchEntityRecords({
            sourceEntity: table.sourceEntity,
            top: 1,
            skip: 0,
            fetchAll: false,
            extraFilter: combineODataFilters(ownFilter, oneOf),
            maxItems: 1,
            selectFields: null,
          });
          total += Number(chunkResult.total) || 0;
        }
      }
    }
    return { total, compiled };
  }

  let total = 0;
  for (const extraFilter of filterChunks) {
    let result;
    if (table.key === 'purchase-orders') {
      result = await fetchPurchaseOrders({
        supplierAccount: null,
        top: 1,
        skip: 0,
        fetchAll: false,
        extraFilter,
        maxItems: 1,
      });
    } else {
      result = await fetchEntityRecords({
        sourceEntity: table.sourceEntity,
        top: 1,
        skip: 0,
        fetchAll: false,
        extraFilter,
        maxItems: 1,
        selectFields: null,
      });
    }
    total += Number(result.total) || 0;
  }
  return { total, compiled };
}

// Tel hoeveel bron-rijen de sync-filter-LAGEN matchen (impact-preview vóór verversen, #325).
// Accepteert { layers: [...] } of de legacy platte rules-array. Som over actieve lagen is een
// bovengrens (een rij die door 2 lagen matcht telt dubbel) — zelfde pragmatische aanpak als de
// bestaande grote-one-of-chunking, ruim voldoende voor een impact-indicatie.
async function countSyncFilter(tableKey, payload) {
  const table = await getTableByKey(tableKey);
  if (READ_ONLY_SYNC_FILTER_TABLE_KEYS.has(String(table.key || '').trim().toLowerCase())) {
    throw Object.assign(new Error('This table automatically uses the Purchase Orders filter.'), { status: 400 });
  }
  const { layers } = normalizeSyncLayers(payload);
  const activeLayers = layers.filter((layer) => layer.active);
  if (!activeLayers.length) return { total: 0, compiled: '', layers: [] };

  const perLayer = [];
  let total = 0;
  for (const layer of activeLayers) {
    const result = await countSyncFilterForRules(table, layer.rules);
    perLayer.push({ id: layer.id, name: layer.name, total: result.total, compiled: result.compiled });
    total += result.total;
  }
  const compiled = perLayer.map((l) => l.compiled).filter(Boolean).map((c) => `(${c})`).join(' or ');
  return { total, compiled, layers: perLayer };
}

module.exports = {
  startRefresh,
  isRefreshRunning,
  refresh,
  getRefreshProgress,
  read,
  listVendorValues,
  readRowDetails,
  loadLookupEnrichment,
  buildDetailRollup,
  detailMatchesItemsFilter,
  buildItemFilterKey,
  invalidateLookupEnrichmentCache,
  saveCustomValue,
  correctField,
  correctAllDetailFields,
  getCellHistory,
  getDataModel,
  getBoardColumnDefinitions,
  discoverSourceFields,
  saveSyncFilters,
  countSyncFilter,
  getSyncState,
  getLastViewedAt,
  getRevision,
  computeRevision,
  markViewed,
  computeContentHash,
  computeChangedFieldKeys,
  buildHistoryByCell,
  dedupeDetailRows,
  addLookupColumnsByScope,
  applyLookups,
  fillEmptyNumberFromFallback,
  isFormulaColumn,
  resolveConfiguredMaxItems,
  requiredMasterFieldsFromTable,
  assertCustomColumnWritable,
  compileMasterFormulaColumns,
  compileFormulaColumns,
  applyFormulaColumnsToRowValues,
  recalculateMasterRowFormulas,
  resolveSourceColumnValue,
  resolveRecordKeys,
  buildLookupCacheKey,
  buildDetailLookupSourceValues,
  enrichLookupSourceFromCacheRow,
  ensureKeyFieldColumnsInProjection,
  usesMasterRecordKeysForInheritedLookup,
  calculateLinkedLineTotal,
  toAdminColumn,
  applyRuntimeLinkedHeaderValues,
  normalizeExclusionRows,
  excludeRows,
  includeRows,
  listHiddenInFilterRows,
  buildLookupFieldMap,
  buildSyntheticLookupColumn,
  buildD365ChangeState,
  buildD365LedgerEntries,
  buildLedgerInsert,
  resolveLookupSourceKey,
  resolveLookupTargetSourceField,
  resolveLookupProjectionColumns,
  buildLookupDedupeSignature,
  buildLookupTargetAliases,
  combineODataFilters,
  buildOneOfFilterClause,
  FETCH_ADAPTERS,
};
