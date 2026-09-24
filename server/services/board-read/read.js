'use strict';

const READ_DEFAULTS = Object.freeze({
  includeRemoved: false,
  userId: null,
  supplierAccount: null,
  supplierFilterColumn: 'vendorAccount',
  includeDetails: true,
  includeChangeDecorations: true,
  partitionKey: null,
  recordKey: null,
  hideRemarksColumns: false,
});

function normalizeReadOptions(opts = {}) {
  const tableKey = opts.tableKey;
  if (!tableKey) {
    throw Object.assign(new Error('tableKey is required'), { status: 400 });
  }
  return {
    tableKey,
    includeRemoved: opts.includeRemoved ?? READ_DEFAULTS.includeRemoved,
    userId: opts.userId ?? READ_DEFAULTS.userId,
    supplierAccount: opts.supplierAccount ?? READ_DEFAULTS.supplierAccount,
    supplierFilterColumn: opts.supplierFilterColumn ?? READ_DEFAULTS.supplierFilterColumn,
    includeDetails: opts.includeDetails ?? READ_DEFAULTS.includeDetails,
    includeChangeDecorations: opts.includeChangeDecorations ?? READ_DEFAULTS.includeChangeDecorations,
    partitionKey: opts.partitionKey ?? READ_DEFAULTS.partitionKey,
    recordKey: opts.recordKey ?? READ_DEFAULTS.recordKey,
    hideRemarksColumns: opts.hideRemarksColumns ?? READ_DEFAULTS.hideRemarksColumns,
  };
}

function readInflightKey(options) {
  const normalized = normalizeReadOptions(options);
  return JSON.stringify([
    normalized.tableKey,
    normalized.includeRemoved,
    normalized.userId,
    normalized.supplierAccount,
    normalized.supplierFilterColumn,
    normalized.includeDetails,
    normalized.includeChangeDecorations,
    normalized.partitionKey,
    normalized.recordKey,
    normalized.hideRemarksColumns,
  ]);
}

function createInflightRead(readExecute) {
  const inflight = new Map();
  return async function read(opts = {}) {
    const normalized = normalizeReadOptions(opts);
    const key = readInflightKey(normalized);
    const existing = inflight.get(key);
    if (existing) return existing;
    const pending = Promise.resolve(readExecute(normalized)).finally(() => {
      if (inflight.get(key) === pending) inflight.delete(key);
    });
    inflight.set(key, pending);
    return pending;
  };
}

module.exports = {
  READ_DEFAULTS,
  normalizeReadOptions,
  readInflightKey,
  createInflightRead,
};
