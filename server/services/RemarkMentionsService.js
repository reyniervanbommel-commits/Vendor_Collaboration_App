'use strict';

// @mentions in remarks: welke kolommen mogen genoemd worden, suggesties tijdens typen en het
// resolven van een @waarde naar de purchase orders waar de opmerking op komt (momentopname).
// Waarden staan in tb_cache.data_json op pad $.{column.key}; het pad komt altijd uit tb_columns.

const sql = require('mssql');
const { getSqlPool } = require('../utils/sqlPool');
const { time } = require('../utils/timing');
const { ROLES } = require('../constants/roles');
const { getSupplierAccount } = require('../utils/supplierScope');
const { formatPurchStatusDisplay, toPurchStatusStoredValue } = require('../utils/purchStatusDisplay');
const {
  getSupplierFilterColumnKey,
  loadSupplierVisibleRowKeys,
} = require('../utils/supplierRowAccess');

const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 10;
const MAX_MENTIONS = 5;
const MAX_TARGETS = 200;
const MAX_VALUE_LENGTH = 200;

async function loadMentionableColumns(tableId) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .query(`
      SELECT id, [key], label, scope
      FROM dbo.tb_columns
      WHERE table_id = @tableId AND mentionable = 1 AND is_active = 1
        AND source = 'source' AND data_type = 'text'
    `);
  return result.recordset.map((row) => ({
    id: Number(row.id), key: row.key, label: row.label, scope: row.scope,
  }));
}

async function loadVisibleKeys(actor, vendorField) {
  return loadSupplierVisibleRowKeys(getSupplierAccount(actor), vendorField, actor?.id ?? null);
}

const defaultDependencies = {
  getPool: getSqlPool,
  loadColumns: loadMentionableColumns,
  getVendorField: getSupplierFilterColumnKey,
  loadVisibleKeys,
};
let dependencies = { ...defaultDependencies };

function setTestDependencies(overrides = null) {
  dependencies = overrides ? { ...defaultDependencies, ...overrides } : { ...defaultDependencies };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function rowKey(partitionKey, recordKey) {
  return `${partitionKey}|${recordKey}`;
}

// D365 slaat een openstaande (regel)status op als Backorder; de app toont overal "Open order".
// Typen van "op"/"open" moet die status dus ook vinden.
const OPEN_ORDER_LABEL = 'open order';

function aliasStoredValue(query) {
  const text = query.trim().toLowerCase();
  return text.length >= 2 && OPEN_ORDER_LABEL.startsWith(text) ? toPurchStatusStoredValue('Open order') : null;
}

function escapeLike(value) {
  return value.replace(/[%_[]/g, '[$&]');
}

// Supplier: alleen eigen zichtbare PO's, in SQL gefilterd zodat geen TOP eigen PO's afkapt.
const SUPPLIER_SCOPE_JOIN = `
      INNER JOIN OPENJSON(@visibleKeys) WITH (p NVARCHAR(32) '$.p', r NVARCHAR(128) '$.r') vk
        ON vk.p = m.partition_key AND vk.r = m.record_key`;

// Bron van de waarde: detail-kolommen via hun masterregel, master-kolommen direct.
function valueSource(column, scoped) {
  const scope = scoped ? SUPPLIER_SCOPE_JOIN : '';
  return column.scope === 'detail'
    ? `
      FROM dbo.tb_cache d WITH (NOLOCK)
      INNER JOIN dbo.tb_cache m WITH (NOLOCK)
        ON m.table_id = d.table_id AND m.scope = 'master' AND m.partition_key = d.partition_key
       AND m.record_key = d.record_key AND m.detail_key = -1 AND m.removed_at_source = 0${scope}
      WHERE d.table_id = @tableId AND d.scope = 'detail' AND d.removed_at_source = 0`
    : `
      FROM dbo.tb_cache m WITH (NOLOCK)${scope}
      WHERE m.table_id = @tableId AND m.scope = 'master' AND m.detail_key = -1
        AND m.removed_at_source = 0`;
}

function visibleKeysJson(visibleKeys) {
  return JSON.stringify([...visibleKeys].map((key) => {
    const separator = key.indexOf('|');
    return { p: key.slice(0, separator), r: key.slice(separator + 1) };
  }));
}

function valueExpr(column) {
  return `LTRIM(RTRIM(JSON_VALUE(${column.scope === 'detail' ? 'd' : 'm'}.data_json, @jsonPath)))`;
}

async function suggestForColumn(pool, { table, column, prefix, aliasValue, visibleKeys }) {
  const request = pool.request()
    .input('tableId', sql.BigInt, table.id)
    .input('jsonPath', sql.NVarChar(160), `$.${column.key}`)
    .input('prefix', sql.NVarChar(210), prefix)
    .input('aliasValue', sql.NVarChar(MAX_VALUE_LENGTH), aliasValue);
  if (visibleKeys) request.input('visibleKeys', sql.NVarChar(sql.MAX), visibleKeysJson(visibleKeys));
  const result = await request.query(`
    SELECT TOP (${MAX_SUGGESTIONS}) v.value, COUNT(DISTINCT CONCAT(v.partition_key, '|', v.record_key)) AS order_count
    FROM (
      SELECT ${valueExpr(column)} AS value, m.partition_key, m.record_key
      ${valueSource(column, Boolean(visibleKeys))}
        AND (${valueExpr(column)} LIKE @prefix COLLATE Latin1_General_CI_AS
          OR (@aliasValue IS NOT NULL AND ${valueExpr(column)} = @aliasValue))
    ) v
    GROUP BY v.value
    ORDER BY v.value;
  `);
  return result.recordset.map((row) => ({
    columnId: column.id,
    columnLabel: column.label,
    value: formatPurchStatusDisplay(row.value),
    orderCount: Number(row.order_count),
  }));
}

async function suggestMentions({ table, q, actor }) {
  const query = String(q ?? '').trim();
  if (query.length < MIN_QUERY_LENGTH) return [];
  const columns = await dependencies.loadColumns(table.id);
  if (!columns.length) return [];
  const isSupplier = actor?.role === ROLES.SUPPLIER;
  const visibleKeys = isSupplier
    ? await dependencies.loadVisibleKeys(actor, await dependencies.getVendorField())
    : null;
  const pool = await dependencies.getPool();
  const prefix = `${escapeLike(query.slice(0, MAX_VALUE_LENGTH))}%`;
  const perColumn = await time('remarks_mention_sql', () => Promise.all(columns.map((column) => (
    suggestForColumn(pool, { table, column, prefix, aliasValue: aliasStoredValue(query), visibleKeys })
  ))));
  return perColumn.flat()
    .sort((a, b) => a.value.localeCompare(b.value) || a.columnLabel.localeCompare(b.columnLabel))
    .slice(0, MAX_SUGGESTIONS);
}

function normalizeMentions(mentions, columns) {
  if (!Array.isArray(mentions) || mentions.length < 1 || mentions.length > MAX_MENTIONS) {
    throw httpError(400, `Use between 1 and ${MAX_MENTIONS} mentions`);
  }
  const byId = new Map(columns.map((column) => [column.id, column]));
  return mentions.map((mention) => {
    const value = String(mention?.value ?? '').trim();
    if (!value || value.length > MAX_VALUE_LENGTH) throw httpError(400, 'Invalid mention value');
    const column = byId.get(Number(mention?.columnId));
    if (!column) throw httpError(400, 'This value cannot be mentioned');
    return { column, value };
  });
}

// Mentions per kolom bundelen (dubbele waarden één keer), in volgorde van eerste voorkomen.
function groupByColumn(normalized) {
  const groups = new Map();
  for (const { column, value } of normalized) {
    const group = groups.get(column.id) || { column, values: [] };
    if (!group.values.includes(value)) group.values.push(value);
    groups.set(column.id, group);
  }
  return [...groups.values()];
}

async function resolveMentionTargets({ table, mentions, actor, currentRow }) {
  const columns = await dependencies.loadColumns(table.id);
  const normalized = normalizeMentions(mentions, columns);
  const isSupplier = actor?.role === ROLES.SUPPLIER;
  const vendorField = await dependencies.getVendorField();
  const visibleKeys = isSupplier ? await dependencies.loadVisibleKeys(actor, vendorField) : null;
  const pool = await dependencies.getPool();
  const vendorPath = `$.${vendorField}`;
  const targets = new Map();

  await time('remarks_mention_sql', async () => {
    const current = await pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('partitionKey', sql.NVarChar(32), currentRow.partitionKey)
      .input('recordKey', sql.NVarChar(128), currentRow.recordKey)
      .input('vendorPath', sql.NVarChar(160), vendorPath)
      .query(`
        SELECT JSON_VALUE(m.data_json, @vendorPath) AS current_vendor
        FROM dbo.tb_cache m WITH (NOLOCK)
        WHERE m.table_id = @tableId AND m.scope = 'master' AND m.detail_key = -1
          AND m.partition_key = @partitionKey AND m.record_key = @recordKey;
      `);
    if (!current.recordset.length) throw httpError(404, 'Master row not found');
    targets.set(rowKey(currentRow.partitionKey, currentRow.recordKey), {
      partitionKey: currentRow.partitionKey,
      recordKey: currentRow.recordKey,
      vendor: current.recordset[0]?.current_vendor || null,
    });

    // Verschillende kolommen = EN, dezelfde kolom = OF. Regelkolommen moeten op dezelfde
    // orderregel kloppen (één EXISTS); kopkolommen op de PO zelf.
    const groups = groupByColumn(normalized);
    const request = pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('vendorPath', sql.NVarChar(160), vendorPath);
    if (visibleKeys) request.input('visibleKeys', sql.NVarChar(sql.MAX), visibleKeysJson(visibleKeys));
    const masterConditions = [];
    const detailConditions = [];
    groups.forEach(({ column, values }, groupIndex) => {
      request.input(`p${groupIndex}`, sql.NVarChar(160), `$.${column.key}`);
      const params = values.map((value, valueIndex) => {
        request.input(`v${groupIndex}_${valueIndex}`, sql.NVarChar(MAX_VALUE_LENGTH), toPurchStatusStoredValue(value));
        return `@v${groupIndex}_${valueIndex}`;
      });
      const alias = column.scope === 'detail' ? 'd' : 'm';
      const condition = `LTRIM(RTRIM(JSON_VALUE(${alias}.data_json, @p${groupIndex}))) IN (${params.join(', ')})`;
      (column.scope === 'detail' ? detailConditions : masterConditions).push(condition);
    });
    const detailExists = detailConditions.length
      ? `AND EXISTS (
          SELECT 1 FROM dbo.tb_cache d WITH (NOLOCK)
          WHERE d.table_id = m.table_id AND d.scope = 'detail' AND d.partition_key = m.partition_key
            AND d.record_key = m.record_key AND d.removed_at_source = 0
            AND ${detailConditions.join(' AND ')}
        )`
      : '';
    const result = await request.query(`
      SELECT DISTINCT TOP (${MAX_TARGETS + 2}) m.partition_key, m.record_key,
             JSON_VALUE(m.data_json, @vendorPath) AS vendor_value
      FROM dbo.tb_cache m WITH (NOLOCK)${visibleKeys ? SUPPLIER_SCOPE_JOIN : ''}
      WHERE m.table_id = @tableId AND m.scope = 'master' AND m.detail_key = -1
        AND m.removed_at_source = 0
        ${masterConditions.map((condition) => `AND ${condition}`).join(' ')}
        ${detailExists};
    `);
    if (!result.recordset.length) {
      const label = groups.flatMap(({ values }) => values).map((value) => `@${value}`).join(' ');
      throw httpError(400, `No purchase orders found for ${label}`);
    }
    for (const row of result.recordset) {
      targets.set(rowKey(row.partition_key, row.record_key), {
        partitionKey: row.partition_key, recordKey: row.record_key, vendor: row.vendor_value || null,
      });
    }
    if (targets.size > MAX_TARGETS) throw httpError(400, `Too many purchase orders (max ${MAX_TARGETS})`);
  });

  const list = [...targets.values()];
  const vendors = new Set(list.map((target) => target.vendor).filter(Boolean));
  return {
    rows: list.map(({ partitionKey, recordKey }) => ({ partitionKey, recordKey })),
    orderCount: list.length,
    vendorCount: isSupplier ? 1 : Math.max(vendors.size, 1),
  };
}

module.exports = {
  MAX_TARGETS,
  loadMentionableColumns,
  resolveMentionTargets,
  setTestDependencies,
  suggestMentions,
};
