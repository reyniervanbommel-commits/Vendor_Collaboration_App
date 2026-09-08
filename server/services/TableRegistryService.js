'use strict';

// Gedeelde lees-helpers voor het Table Builder-metamodel (tb_tables / tb_columns / tb_relations).
// Fase A (#AB:152). Bron-neutraal: tableKey -> definitie + kolommen + master-detail-relatie.
// Schrijfacties op de definitie horen in TableColumnsService (app-native kolommen) of de latere
// TableBuilderService (admin); deze module leest alleen.

const sql = require('mssql');
const { getSqlPool } = require('../utils/sqlPool');

const SCOPES = ['master', 'detail'];
const DATA_TYPES = ['text', 'number', 'date', 'boolean', 'select', 'image', 'remarks', 'status', 'date_period'];

function getPool() {
  return getSqlPool();
}

function mapColumnRow(row) {
  let options = null;
  if (row.options_json) {
    try {
      options = JSON.parse(row.options_json);
    } catch {
      options = null;
    }
  }
  return {
    id: Number(row.id),
    tableId: Number(row.table_id),
    scope: row.scope,
    // UI-compat: PO-board componenten verwachten level=header|line.
    // tb_columns gebruikt scope=master|detail; map dat hier één-op-één.
    level: row.scope === 'detail' ? 'line' : 'header',
    key: row.key,
    label: row.label,
    // Label zoals het was bij aanmaken (D365-veld of custom), blijft staan na een rename.
    // Alleen tonen als afwijkend van het huidige label (zie columnOriginMeta.js in de UI).
    originalLabel: row.original_label || row.label,
    source: row.source,
    sourceField: row.source_field || null,
    dataType: row.data_type,
    options,
    writable: Boolean(row.writable),
    writeMechanism: row.write_mechanism || null,
    isDefaultVisible: Boolean(row.is_default_visible),
    filterable: Boolean(row.filterable),
    sortable: Boolean(row.sortable),
    isActive: Boolean(row.is_active),
    // Los van is_active: zichtbaar in de "verborgen orders in D365-filter"-popup (#AB:170).
    visibleAtDelete: Boolean(row.visible_at_delete),
    sortOrder: Number(row.sort_order),
    formulaExpr: row.formula_expr || null,
  };
}

const COLUMN_SELECT = `
  SELECT id, table_id, scope, [key], label, original_label, source, source_field, data_type, options_json,
         writable, write_mechanism, is_default_visible, filterable, sortable, is_active, sort_order,
         visible_at_delete, formula_expr
  FROM dbo.tb_columns
`;

// Korte in-memory cache voor tabel-metadata. tb_tables/tb_sources/tb_relations wijzigen alleen
// bij zeldzame admin-acties (Excel-koppeling publiceren, default-filter opslaan); elke board-read
// betaalde er wél een SQL-round-trip (~80-200ms) voor — twee zelfs, want lookups resolven hun
// doeltabel ook via getTableByKey. Schrijvende paden roepen invalidateTableCache() aan; de TTL
// vangt wijzigingen door andere replica's af.
const TABLE_META_CACHE_TTL_MS = 30 * 1000;
const tableMetaCache = new Map();

function invalidateTableCache(tableKey = null) {
  if (tableKey === null || tableKey === undefined) {
    tableMetaCache.clear();
    return;
  }
  tableMetaCache.delete(String(tableKey));
}

// Resolve een tabel + bron + relatie op natuurlijke sleutel. Gooit 404 als de tabel onbekend/inactief is.
async function getTableByKey(tableKey) {
  const cacheKey = String(tableKey);
  const cached = tableMetaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchTableByKey(tableKey);
  tableMetaCache.set(cacheKey, { value, expiresAt: Date.now() + TABLE_META_CACHE_TTL_MS });
  return value;
}

async function fetchTableByKey(tableKey) {
  const pool = await getPool();
  const result = await pool.request()
    .input('key', sql.NVarChar(64), tableKey)
    .query(`
      SELECT t.id, t.[key], t.label, t.description, t.source_id, t.source_entity, t.key_fields,
             t.default_filter_json, t.cache_mode, t.stale_minutes, t.max_rows, t.is_active,
             s.[key] AS source_key, s.provider_type, s.config_json,
             r.detail_source_entity, r.relation_kind, r.detail_key_fields, r.join_keys_json
      FROM dbo.tb_tables t
      INNER JOIN dbo.tb_sources s ON s.id = t.source_id
      LEFT JOIN dbo.tb_relations r ON r.table_id = t.id
      WHERE t.[key] = @key
    `);
  const row = result.recordset[0];
  if (!row || !row.is_active) {
    throw Object.assign(new Error(`Table '${tableKey}' not found`), { status: 404 });
  }
  return {
    id: Number(row.id),
    key: row.key,
    label: row.label,
    description: row.description || null,
    sourceId: Number(row.source_id),
    sourceEntity: row.source_entity,
    keyFields: row.key_fields ? row.key_fields.split(',').map((f) => f.trim()).filter(Boolean) : [],
    defaultFilter: row.default_filter_json || null,
    cacheMode: row.cache_mode,
    staleMinutes: Number(row.stale_minutes),
    maxRows: Number(row.max_rows),
    source: {
      key: row.source_key,
      providerType: row.provider_type,
      config: row.config_json ? safeJson(row.config_json) : {},
    },
    relation: row.relation_kind
      ? {
          detailSourceEntity: row.detail_source_entity || null,
          kind: row.relation_kind,
          detailKeyFields: row.detail_key_fields || null,
          joinKeys: row.join_keys_json ? safeJson(row.join_keys_json) : null,
        }
      : null,
  };
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function listColumns({ tableId, scope = null, includeInactive = false }) {
  const pool = await getPool();
  const request = pool.request().input('tableId', sql.BigInt, tableId);
  const conditions = ['table_id = @tableId'];
  if (scope) {
    request.input('scope', sql.NVarChar(16), scope);
    conditions.push('scope = @scope');
  }
  if (!includeInactive) conditions.push('is_active = 1');
  const result = await request.query(`
    ${COLUMN_SELECT}
    WHERE ${conditions.join(' AND ')}
    ORDER BY scope, sort_order, label
  `);
  return result.recordset.map(mapColumnRow);
}

async function getColumnById(columnId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .query(`${COLUMN_SELECT} WHERE id = @id`);
  return result.recordset.length ? mapColumnRow(result.recordset[0]) : null;
}

// fk_join lookup-relaties van een tabel (relation_role='lookup'). Minimaal fk_join-fundament voor de
// Excel-koppeling (#AB:162); identiek aan #161's getLookups zodat een latere merge triviaal blijft.
async function getLookups(tableId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT id, source_scope, source_field, target_table_key, target_key_field, join_keys_json, lookup_fields_json
      FROM dbo.tb_relations
      WHERE table_id = @tableId AND relation_role = 'lookup'
    `);
  return result.recordset.map((r) => ({
    id: Number(r.id),
    sourceScope: r.source_scope || 'master',
    sourceField: r.source_field || null,
    targetTableKey: r.target_table_key || null,
    targetKeyField: r.target_key_field || null,
    joinKeys: r.join_keys_json ? safeJson(r.join_keys_json) : [],
    fields: r.lookup_fields_json ? safeJson(r.lookup_fields_json) : {},
  })).filter((l) => l.sourceField && l.targetTableKey);
}

function mergeCascadeTargetKeys(lookupKeys, pivotKeys) {
  return [...new Set([
    ...(lookupKeys || []).map((k) => String(k || '').trim()).filter(Boolean),
    ...(pivotKeys || []).map((k) => String(k || '').trim()).filter(Boolean),
  ])];
}

async function listRefreshCascadeTargets(tableId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT target_table_key, relation_role
      FROM dbo.tb_relations
      WHERE table_id = @tableId AND relation_role IN ('lookup', 'pivot')
    `);
  const lookupKeys = [];
  const pivotKeys = [];
  for (const row of result.recordset) {
    const key = String(row.target_table_key || '').trim();
    if (!key) continue;
    if (String(row.relation_role || '') === 'pivot') pivotKeys.push(key);
    else lookupKeys.push(key);
  }
  return mergeCascadeTargetKeys(lookupKeys, pivotKeys);
}

module.exports = {
  SCOPES,
  DATA_TYPES,
  getPool,
  getTableByKey,
  invalidateTableCache,
  listColumns,
  getColumnById,
  getLookups,
  listRefreshCascadeTargets,
  mergeCascadeTargetKeys,
  mapColumnRow,
};
