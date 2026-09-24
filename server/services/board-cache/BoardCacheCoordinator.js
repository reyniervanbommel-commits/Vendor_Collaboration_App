'use strict';

const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;
const SUPPLIER_KEYS_TTL_MS = 60 * 1000;
const VARIANTS = new Set(['snapshot', 'kpi', 'supplier-keys']);

const stores = {
  snapshot: new Map(),
  kpi: new Map(),
  'supplier-keys': new Map(),
};

function ttlFor(variant) {
  return variant === 'supplier-keys' ? SUPPLIER_KEYS_TTL_MS : SNAPSHOT_TTL_MS;
}

function cacheKey({ tableKey, supplierAccount = null, variant, supplierFilterColumn = '' }) {
  const account = supplierAccount || '';
  if (variant === 'supplier-keys') {
    return `${tableKey}::${account}::${supplierFilterColumn || ''}`;
  }
  return `${tableKey}::${account}`;
}

function live(entry, variant) {
  return Boolean(entry) && (Date.now() - entry.cachedAt) < ttlFor(variant);
}

async function getOrLoad({ tableKey, supplierAccount = null, variant, signature, supplierFilterColumn = '' }, loader) {
  if (!VARIANTS.has(variant)) throw new Error(`Unknown cache variant: ${variant}`);
  const key = cacheKey({ tableKey, supplierAccount, variant, supplierFilterColumn });
  const store = stores[variant];
  const cached = store.get(key);
  if (cached && cached.signature === signature && live(cached, variant)) return cached.value;
  const value = await loader();
  store.set(key, { value, signature, cachedAt: Date.now() });
  return value;
}

function peek({ tableKey, supplierAccount = null, variant, signature, supplierFilterColumn = '' }) {
  const key = cacheKey({ tableKey, supplierAccount, variant, supplierFilterColumn });
  const cached = stores[variant].get(key);
  if (!cached || cached.signature !== signature || !live(cached, variant)) return null;
  return cached.value;
}

function rememberSupplierVisibleKeys({ tableKey, supplierAccount, supplierFilterColumn, signature }, keys) {
  const key = cacheKey({
    tableKey, supplierAccount, variant: 'supplier-keys', supplierFilterColumn,
  });
  stores['supplier-keys'].set(key, {
    value: keys,
    signature: signature || 'live',
    cachedAt: Date.now(),
  });
  return keys;
}

function clearVariant(variant, tableKey = null) {
  if (!VARIANTS.has(variant)) throw new Error(`Unknown cache variant: ${variant}`);
  const store = stores[variant];
  if (!tableKey) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(`${tableKey}::`)) store.delete(key);
  }
}

function invalidate(tableKey, reason) {
  if (reason && !['content-write', 'column-schema', 'sync-settings', 'refresh-complete', 'lookup-schema', 'row-exclusion'].includes(reason)) {
    throw new Error(`Unknown invalidation reason: ${reason}`);
  }
  for (const store of Object.values(stores)) {
    if (!tableKey) {
      store.clear();
      continue;
    }
    for (const key of store.keys()) {
      if (key.startsWith(`${tableKey}::`)) store.delete(key);
    }
  }
}

module.exports = {
  getOrLoad,
  peek,
  invalidate,
  rememberSupplierVisibleKeys,
  clearVariant,
  cacheKey,
  SNAPSHOT_TTL_MS,
  SUPPLIER_KEYS_TTL_MS,
};
