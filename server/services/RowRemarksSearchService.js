'use strict';

const sql = require('mssql');
const { getSqlPool } = require('../utils/sqlPool');
const { time } = require('../utils/timing');
const { ROLES, isStaffRole } = require('../constants/roles');
const { getSupplierAccount } = require('../utils/supplierScope');
const {
  filterRowsForSupplier,
  getSupplierFilterColumnKey,
  loadSupplierVisibleRowKeys,
} = require('../utils/supplierRowAccess');
const { readVisibilityFilter, visibilitySql } = require('../utils/remarkVisibility');
const { getTableByKey } = require('./TableRegistryService');
const {
  normalizePositiveId,
  normalizeSearchQuery,
  normalizeTableKey,
} = require('./RowRemarksValidation');

const defaultDependencies = {
  getPool: getSqlPool,
  getTable: getTableByKey,
};
let dependencies = { ...defaultDependencies };

function setTestDependencies(overrides = null) {
  dependencies = overrides ? { ...defaultDependencies, ...overrides } : { ...defaultDependencies };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeActor(actor) {
  const id = normalizePositiveId(actor?.id, 'actor');
  const role = actor?.role;
  if (role !== ROLES.SUPPLIER && !isStaffRole(role)) {
    throw httpError(403, 'Insufficient permissions');
  }
  return {
    id,
    role,
    isAdmin: role === ROLES.ADMIN,
    isSupplier: role === ROLES.SUPPLIER,
    visibilityFilter: readVisibilityFilter(role),
  };
}

// Voert de gedeelde remarks-rowkey-query uit (base where-clause: actieve remark op de masterrij)
// en past daarna, indien nodig, de supplier-vendor-scope toe. `applyInputs`/`extraCondition` laten
// searchRemarks (contains) en hasRemarks (has a comment) dezelfde basis + supplier-scope delen.
async function queryRemarkRowKeys(tableKey, actor, { extraCondition = '', applyInputs = () => {} } = {}) {
  const normalizedActor = normalizeActor(actor);
  const table = await dependencies.getTable(normalizeTableKey(tableKey));
  const pool = await dependencies.getPool();
  const request = pool.request().input('tableId', sql.BigInt, table.id);
  if (normalizedActor.visibilityFilter) {
    request.input('visibility', sql.NVarChar(16), normalizedActor.visibilityFilter);
  }
  applyInputs(request);
  const result = await request.query(`
    SELECT DISTINCT r.partition_key, r.record_key
    FROM dbo.tb_row_remarks r
    WHERE r.table_id = @tableId
      AND r.detail_key = -1
      AND r.is_deleted = 0
      ${visibilitySql('r', normalizedActor.visibilityFilter)}
      ${extraCondition};
  `);
  let rows = result.recordset;
  if (normalizedActor.isSupplier) {
    const supplierFilterColumn = await getSupplierFilterColumnKey();
    const visibleKeys = await loadSupplierVisibleRowKeys(
      getSupplierAccount(actor),
      supplierFilterColumn,
      actor?.id ?? null,
    );
    rows = filterRowsForSupplier(rows, visibleKeys);
  }
  return {
    keys: rows.map((row) => ({
      partitionKey: row.partition_key,
      recordKey: row.record_key,
    })),
  };
}

async function searchRemarks(tableKey, query, actor) {
  const normalizedQuery = normalizeSearchQuery(query);
  return time('remarks_search_sql', () => queryRemarkRowKeys(tableKey, actor, {
    extraCondition: 'AND CHARINDEX(@q, r.body COLLATE Latin1_General_CI_AS) > 0',
    applyInputs: (request) => request.input('q', sql.NVarChar(200), normalizedQuery),
  }));
}

// Rijen die minstens één actieve remark hebben (los van de tekst) — voedt de operator
// "has a comment" van het Remarks-kolommenu.
async function hasRemarks(tableKey, actor) {
  return time('remarks_has_comment_sql', () => queryRemarkRowKeys(tableKey, actor));
}

module.exports = {
  hasRemarks,
  searchRemarks,
  setTestDependencies,
};
