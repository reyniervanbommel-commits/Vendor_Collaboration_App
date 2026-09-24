'use strict';

const { ROLES } = require('../constants/roles');
const settingsService = require('../services/SettingsService');
const { getSupplierAccount } = require('./supplierScope');

const SUPPLIER_FILTER_COLUMN_KEY = 'SUPPLIER_FILTER_COLUMN_KEY';
const DEFAULT_SUPPLIER_FILTER_COLUMN = 'vendorAccount';
const PURCHASE_ORDERS_TABLE = 'purchase-orders';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function buildRowKey(partitionKey, recordKey) {
  return `${partitionKey}|${recordKey}`;
}

function cacheKeyFor(supplierAccount, supplierFilterColumn) {
  return `${supplierAccount}:${supplierFilterColumn}`;
}

function keysFromRows(rows) {
  const keys = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    keys.add(buildRowKey(
      row.partitionKey || row.partition_key,
      row.recordKey || row.record_key,
    ));
  }
  return keys;
}

async function getSupplierFilterColumnKey() {
  return settingsService.getAsync(SUPPLIER_FILTER_COLUMN_KEY, DEFAULT_SUPPLIER_FILTER_COLUMN);
}

const _visibleKeyCache = new Map();
const _inflightKeyLoads = new Map();
const _CACHE_TTL_MS = 60_000;

function rememberSupplierVisibleRowKeys(supplierAccount, supplierFilterColumn, rows) {
  const keys = keysFromRows(rows);
  _visibleKeyCache.set(cacheKeyFor(supplierAccount, supplierFilterColumn), { keys, ts: Date.now() });
  return keys;
}

function clearSupplierVisibleRowKeyCache() {
  _visibleKeyCache.clear();
  _inflightKeyLoads.clear();
}

// Native JSON-veld: recKeys vooraf selecteren. Null = kolom ontbreekt (waarschijnlijk lookup).
function selectRecKeysMatchingNativeSupplierColumn(masterJsonByRecKey, supplierAccount, filterColumn) {
  const wanted = String(supplierAccount || '').trim().toLowerCase();
  const column = String(filterColumn || '').trim();
  if (!wanted || !column || !(masterJsonByRecKey instanceof Map)) return null;

  let seenNative = false;
  const keys = new Set();
  for (const [recKey, json] of masterJsonByRecKey) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
    if (!Object.prototype.hasOwnProperty.call(json, column)) continue;
    seenNative = true;
    if (String(json[column] ?? '').trim().toLowerCase() === wanted) keys.add(recKey);
  }
  return seenNative ? keys : null;
}

let readPurchaseOrders = null;

function configureSupplierRowAccess({ read } = {}) {
  if (typeof read !== 'function') {
    throw new Error('configureSupplierRowAccess requires read');
  }
  readPurchaseOrders = read;
}

function boardRead() {
  if (!readPurchaseOrders) {
    throw new Error('Board read is not configured');
  }
  return readPurchaseOrders;
}

async function loadSupplierVisibleRowKeys(supplierAccount, supplierFilterColumn, userId = null) {
  const cacheKey = cacheKeyFor(supplierAccount, supplierFilterColumn);
  const cached = _visibleKeyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < _CACHE_TTL_MS) return cached.keys;

  const inflight = _inflightKeyLoads.get(cacheKey);
  if (inflight) return inflight;

  const pending = (async () => {
    const data = await boardRead()({
      tableKey: PURCHASE_ORDERS_TABLE,
      userId,
      supplierAccount,
      supplierFilterColumn,
      includeDetails: false,
    });
    return rememberSupplierVisibleRowKeys(supplierAccount, supplierFilterColumn, data?.rows);
  })().finally(() => {
    if (_inflightKeyLoads.get(cacheKey) === pending) _inflightKeyLoads.delete(cacheKey);
  });

  _inflightKeyLoads.set(cacheKey, pending);
  return pending;
}

// Een order door dezelfde read-pipeline (lookups/sync/supplier-filter), niet de hele board-keyset.
async function assertSupplierPurchaseOrderRow(user, { tableKey, partitionKey, recordKey }) {
  if (!user || user.role !== ROLES.SUPPLIER) return;
  if (String(tableKey || '').trim() !== PURCHASE_ORDERS_TABLE) {
    throw httpError(403, 'Access denied - insufficient permissions');
  }

  const partition = String(partitionKey ?? '').trim();
  const record = String(recordKey ?? '').trim();
  if (!partition || !record) throw httpError(400, 'partitionKey and recordKey are required');

  const supplierAccount = getSupplierAccount(user);
  const supplierFilterColumn = await getSupplierFilterColumnKey();
  const data = await boardRead()({
    tableKey: PURCHASE_ORDERS_TABLE,
    userId: user.id,
    supplierAccount,
    supplierFilterColumn,
    includeDetails: false,
    partitionKey: partition,
    recordKey: record,
  });
  const allowed = (Array.isArray(data?.rows) ? data.rows : []).some((row) => (
    buildRowKey(row.partitionKey, row.recordKey) === buildRowKey(partition, record)
  ));
  if (!allowed) throw httpError(403, 'Access denied - order not in your vendor scope');
}

function filterRowsForSupplier(rows, visibleKeys) {
  return rows.filter((row) => (
    visibleKeys.has(buildRowKey(row.partitionKey || row.partition_key, row.recordKey || row.record_key))
  ));
}

module.exports = {
  PURCHASE_ORDERS_TABLE,
  assertSupplierPurchaseOrderRow,
  clearSupplierVisibleRowKeyCache,
  filterRowsForSupplier,
  getSupplierFilterColumnKey,
  loadSupplierVisibleRowKeys,
  configureSupplierRowAccess,
  rememberSupplierVisibleRowKeys,
  selectRecKeysMatchingNativeSupplierColumn,
};
