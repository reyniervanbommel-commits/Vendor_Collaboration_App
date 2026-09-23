'use strict';

// D365 PurchStatus enum-members vs. the labels shown on D365 forms.
// OData stores Backorder; the form label is Open order. Display-only — never write this back.

const PURCH_STATUS_DISPLAY_BY_VALUE = Object.freeze({
  backorder: 'Open order',
});

const PURCH_STATUS_STORED_BY_DISPLAY = Object.freeze({
  'open order': 'Backorder',
});

const NEGATIVE_TEXT_OPS = new Set(['notContains', 'notStartsWith']);

function isPurchaseOrderStatusColumn(column = {}) {
  const field = String(column?.d365Field || '').trim().toLowerCase();
  if (field === 'purchaseorderstatus') return true;
  const key = String(column?.columnKey || column?.key || '').trim().toLowerCase();
  return key === 'status' || key === 'purchaseorderstatus' || key === 'purchase_order_status';
}

function formatPurchStatusDisplay(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  return PURCH_STATUS_DISPLAY_BY_VALUE[text.toLowerCase()] || text;
}

function toPurchStatusStoredValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  return PURCH_STATUS_STORED_BY_DISPLAY[text.toLowerCase()] || text;
}

function isPurchStatusAliasText(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'backorder' || text === 'open order';
}

function purchStatusValuesEquivalent(left, right) {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  if (!isPurchStatusAliasText(a) && !isPurchStatusAliasText(b)) return false;
  return toPurchStatusStoredValue(a).toLowerCase() === toPurchStatusStoredValue(b).toLowerCase();
}

function filterValueLooksLikePurchStatus(filter) {
  if (!filter) return false;
  if (filter.operator === 'oneOf') {
    const options = Array.isArray(filter.value) ? filter.value : [filter.value];
    return options.some((entry) => isPurchStatusAliasText(entry));
  }
  return isPurchStatusAliasText(filter.value);
}

function shouldMatchPurchStatusAlias(column, rawValue, filter) {
  return isPurchaseOrderStatusColumn(column)
    || isPurchStatusAliasText(rawValue)
    || filterValueLooksLikePurchStatus(filter);
}

function matchTextFilterWithPurchStatusAlias(rawValue, filter, matchFn) {
  const display = formatPurchStatusDisplay(rawValue);
  const stored = toPurchStatusStoredValue(rawValue);
  if (NEGATIVE_TEXT_OPS.has(filter?.operator)) {
    return matchFn(rawValue, filter) && matchFn(display, filter) && matchFn(stored, filter);
  }
  return matchFn(rawValue, filter) || matchFn(display, filter) || matchFn(stored, filter);
}

function resolvePurchStatusRefValue(columnKey, value) {
  if (!isPurchaseOrderStatusColumn({ key: columnKey })) return value;
  return formatPurchStatusDisplay(value) || value;
}

module.exports = {
  isPurchaseOrderStatusColumn,
  formatPurchStatusDisplay,
  toPurchStatusStoredValue,
  isPurchStatusAliasText,
  purchStatusValuesEquivalent,
  shouldMatchPurchStatusAlias,
  matchTextFilterWithPurchStatusAlias,
  resolvePurchStatusRefValue,
};
