'use strict';

/**
 * RccpSettingsService — RCCP config in dbo.app_settings (#AB:224).
 */

const settingsService = require('./SettingsService');
const dataService = require('./TableDataService');
const { resolveRccpQuantityEligibility } = require('./TableColumnsService');
const { isHexColor } = require('../utils/hexColor');
const { findScopedColumn, toScopedColumnKey } = require('../utils/rccpColumnRef');

const CONFIG_KEY = 'RCCP_CONFIG';
const PO_TABLE_KEY = 'purchase-orders';
const VALID_DUPLICATE_POLICIES = Object.freeze(['update', 'skip']);
const VALID_PERIOD_MODES = Object.freeze(['week', 'month']);
const VALID_CHART_TYPES = Object.freeze(['line', 'bar']);
const MEASURE_COLORS = Object.freeze(['#D13438', '#0078D4', '#8764B8', '#CA5010', '#107C10', '#5C2D91']);
const CAPACITY_MEASURE_KEY = '__capacity__';
// KPI-tegels die de admin per stuk mag aan-/uitzetten voor het rechterdeel van de
// Performance & Planning-tab op de PO-tabel-pagina (zie #AB:315 — split-panel KPI tiles).
// Alle 10 kaarten uit RccpKpiCards zijn kiesbaar; capaciteits-KPI's hebben geen per-order
// match-set, dus een klik daarop filtert de PO-tabel niet (zie RccpSplitKpiPanel).
const SPLIT_PANEL_KPI_KEYS = Object.freeze([
  'ordered', 'delivered', 'open', 'lateDelivery', 'onTime', 'openLate',
  'lateItems', 'unconfirmed', 'capacityShortfall', 'overloadedWeeks',
]);
const SPLIT_PANEL_KPI_LIMIT = SPLIT_PANEL_KPI_KEYS.length;
// Synthetische measure-sleutel voor de "overcapaciteit"-regel (capaciteit min de openstaande
// measure). Geen tb_columns-kolom; alleen een afgeleide matrix/chart-regel.
const OVERCAPACITY_MEASURE_KEY = '__overcapacity__';
// Synthetische measure-sleutel voor de waarschuwingsdrempel (greenMax % van capaciteit).
// Getoond als gestippelde lijn in de grafiek; niet zichtbaar in de matrix.
const WARNING_MEASURE_KEY = '__warning__';

const SLOT_DEFAULT_KEYS = Object.freeze({
  vendor: 'vendorAccount',
  requested: 'requestedDeliveryDate',
  confirmed: 'confirmedDeliveryDate',
  receipt: 'productReceiptDate',
  open: 'remainingPurchaseQuantity',
  received: 'receivedPurchaseQuantity',
  ordered: 'quantity',
});

function defaultQuantityMeasures() {
  return [{
    columnKey: SLOT_DEFAULT_KEYS.ordered,
    label: 'Quantity',
    chartType: 'line',
    color: '#D13438',
    showInChart: true,
  }];
}

function measureForKey(columnKey, index, byKey) {
  const prev = byKey.get(columnKey);
  return {
    columnKey,
    label: prev?.label || columnKey,
    chartType: prev?.chartType || 'line',
    color: prev?.color || MEASURE_COLORS[index % MEASURE_COLORS.length],
    showInChart: prev ? prev.showInChart !== false : true,
  };
}

function parseOptionalKey(raw, fieldName) {
  const value = String(raw ?? '').trim();
  if (value.length > 128) {
    return { error: `${fieldName} must be at most 128 characters` };
  }
  if (value && !/^(?:(?:master|detail):)?[A-Za-z0-9_]+$/.test(value)) {
    return { error: `${fieldName} may only contain letters, numbers and underscores` };
  }
  return { value };
}

function parseRequiredKey(raw, fallback, fieldName) {
  const parsed = parseOptionalKey(raw ?? fallback, fieldName);
  if (parsed.error) return parsed;
  const value = parsed.value || String(fallback || '').trim();
  if (!value) return { error: `${fieldName} is required` };
  return { value };
}

function normalizeChartWeekRanges(raw) {
  const list = Array.isArray(raw?.chartWeekRanges) ? raw.chartWeekRanges : [];
  return list.map((entry, index) => {
    const fromYear = Number(entry?.fromYear);
    const fromWeek = Number(entry?.fromWeek);
    const toYear = Number(entry?.toYear);
    const toWeek = Number(entry?.toWeek);
    if (!Number.isFinite(fromYear) || !Number.isFinite(fromWeek)
      || !Number.isFinite(toYear) || !Number.isFinite(toWeek)) return null;
    if (fromWeek < 1 || fromWeek > 53 || toWeek < 1 || toWeek > 53) return null;
    if (fromYear * 100 + fromWeek > toYear * 100 + toWeek) return null;
    const color = isHexColor(entry?.color)
      ? String(entry.color).toLowerCase()
      : MEASURE_COLORS[index % MEASURE_COLORS.length];
    const label = String(entry?.label || '').trim();
    return {
      fromYear,
      fromWeek,
      toYear,
      toWeek,
      color,
      ...(label ? { label } : {}),
    };
  }).filter(Boolean).slice(0, 12);
}

function defaultConfig() {
  const byKey = new Map();
  return {
    dateColumnKey: SLOT_DEFAULT_KEYS.requested,
    receiptDateColumnKey: '',
    confirmedDateColumnKey: '',
    vendorColumnKey: SLOT_DEFAULT_KEYS.vendor,
    quantityMeasures: [
      measureForKey(SLOT_DEFAULT_KEYS.open, 0, byKey),
      measureForKey(SLOT_DEFAULT_KEYS.received, 1, byKey),
      measureForKey(SLOT_DEFAULT_KEYS.ordered, 2, byKey),
    ],
    openMeasureKey: SLOT_DEFAULT_KEYS.open,
    deliveredMeasureKey: SLOT_DEFAULT_KEYS.received,
    orderedMeasureKey: SLOT_DEFAULT_KEYS.ordered,
    showCapacityLine: true,
    showWarningLine: true,
    showCapacityRows: true,
    matrixColorFill: true,
    confirmedColor: '#8A8886',
    chartWeekRanges: [],
    excludedStatuses: ['Canceled', 'Closed'],
    itemPickerColumnKeys: [],
    splitPanelKpiKeys: ['ordered', 'open', 'lateDelivery'],
    thresholds: { greenMax: 80, orangeMax: 100 },
    duplicatePolicy: 'update',
    periodMode: 'week',
  };
}

const LEGACY_COLUMN_KEY_MAP = Object.freeze({
  orderedPurchaseQuantity: 'quantity',
});

function normalizeQuantityMeasures(raw) {
  const list = Array.isArray(raw?.quantityMeasures) ? raw.quantityMeasures : [];
  if (list.length) {
    return list.map((entry, index) => {
      const columnKey = String(entry?.columnKey || '').trim();
      if (!columnKey) return null;
      const chartType = VALID_CHART_TYPES.includes(entry?.chartType) ? entry.chartType : 'line';
      const color = isHexColor(entry?.color)
        ? String(entry.color).toLowerCase()
        : MEASURE_COLORS[index % MEASURE_COLORS.length];
      return {
        columnKey,
        label: String(entry?.label || columnKey).trim() || columnKey,
        chartType,
        color,
        showInChart: entry?.showInChart !== false,
      };
    }).filter(Boolean).slice(0, 8);
  }

  const legacyKey = String(raw?.quantityColumnKey || 'quantity').trim();
  const mapped = LEGACY_COLUMN_KEY_MAP[legacyKey] || legacyKey;
  return [{
    columnKey: mapped,
    label: mapped,
    chartType: 'line',
    color: MEASURE_COLORS[0],
    showInChart: true,
  }];
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || '').trim()).filter(Boolean))];
}

// Max 3 tegels, alleen geldige KPI-sleutels, geen duplicaten. Onbekende sleutels (bv. van een
// oudere/nieuwere client) worden stilzwijgend genegeerd zodat opslaan nooit faalt.
function normalizeSplitPanelKpiKeys(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const keys = [];
  for (const entry of list) {
    const key = String(entry || '').trim();
    if (!key || !SPLIT_PANEL_KPI_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= SPLIT_PANEL_KPI_LIMIT) break;
  }
  return keys;
}

const ITEM_NUMBER_COLUMN_KEYS = new Set(['itemnumber', 'itemid', 'item_id']);
const ITEM_PICKER_COLUMN_LIMIT = 8;

function normalizeItemPickerColumnKeys(raw) {
  const list = Array.isArray(raw?.itemPickerColumnKeys) ? raw.itemPickerColumnKeys : [];
  const seen = new Set();
  const keys = [];
  for (const entry of list) {
    const key = String(entry || '').trim();
    if (!key || !/^[A-Za-z0-9_]+$/.test(key)) continue;
    if (ITEM_NUMBER_COLUMN_KEYS.has(key.toLowerCase())) continue;
    const id = key.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(key);
    if (keys.length >= ITEM_PICKER_COLUMN_LIMIT) break;
  }
  return keys;
}

function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Config must be an object' };
  }

  const base = defaultConfig();
  const dateParsed = parseRequiredKey(raw.dateColumnKey, base.dateColumnKey, 'dateColumnKey');
  if (dateParsed.error) return { valid: false, error: dateParsed.error };
  const vendorParsed = parseRequiredKey(raw.vendorColumnKey, base.vendorColumnKey, 'vendorColumnKey');
  if (vendorParsed.error) return { valid: false, error: vendorParsed.error };
  const receiptParsed = parseOptionalKey(raw.receiptDateColumnKey ?? '', 'receiptDateColumnKey');
  if (receiptParsed.error) return { valid: false, error: receiptParsed.error };
  const confirmedParsed = parseOptionalKey(raw.confirmedDateColumnKey ?? '', 'confirmedDateColumnKey');
  if (confirmedParsed.error) return { valid: false, error: confirmedParsed.error };

  const existing = normalizeQuantityMeasures(raw);
  const byKey = new Map(existing.map((entry) => [entry.columnKey, entry]));

  const openParsed = parseRequiredKey(raw.openMeasureKey, base.openMeasureKey, 'openMeasureKey');
  if (openParsed.error) return { valid: false, error: openParsed.error };
  const deliveredParsed = parseRequiredKey(
    raw.deliveredMeasureKey, base.deliveredMeasureKey, 'deliveredMeasureKey',
  );
  if (deliveredParsed.error) return { valid: false, error: deliveredParsed.error };
  const orderedParsed = parseRequiredKey(
    raw.orderedMeasureKey ?? raw.remainingMeasureKey,
    base.orderedMeasureKey,
    'orderedMeasureKey',
  );
  if (orderedParsed.error) return { valid: false, error: orderedParsed.error };

  const openMeasureKey = openParsed.value;
  const deliveredMeasureKey = deliveredParsed.value;
  const orderedMeasureKey = orderedParsed.value;
  if (new Set([openMeasureKey, deliveredMeasureKey, orderedMeasureKey]).size < 3) {
    return { valid: false, error: 'Each quantity slot must use a different column' };
  }

  const quantityMeasures = [
    measureForKey(openMeasureKey, 0, byKey),
    measureForKey(deliveredMeasureKey, 1, byKey),
    measureForKey(orderedMeasureKey, 2, byKey),
  ];

  const showCapacityLine = raw.showCapacityLine !== false;
  const showWarningLine = raw.showWarningLine !== false;
  const showCapacityRows = raw.showCapacityRows !== false;
  const matrixColorFill = raw.matrixColorFill !== false;
  const confirmedColor = isHexColor(raw.confirmedColor)
    ? String(raw.confirmedColor).toLowerCase()
    : base.confirmedColor;

  const chartWeekRanges = normalizeChartWeekRanges(raw);
  const excludedStatuses = normalizeStringArray(raw.excludedStatuses ?? base.excludedStatuses);
  const itemPickerColumnKeys = normalizeItemPickerColumnKeys(raw);
  const splitPanelKpiKeys = normalizeSplitPanelKpiKeys(raw.splitPanelKpiKeys ?? base.splitPanelKpiKeys);
  const duplicatePolicy = String(raw.duplicatePolicy ?? base.duplicatePolicy);
  if (!VALID_DUPLICATE_POLICIES.includes(duplicatePolicy)) {
    return { valid: false, error: 'duplicatePolicy must be update or skip' };
  }

  const periodMode = String(raw.periodMode ?? base.periodMode);
  if (!VALID_PERIOD_MODES.includes(periodMode)) {
    return { valid: false, error: 'periodMode must be week or month' };
  }

  const thresholdsRaw = raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : base.thresholds;
  const greenMax = Number(thresholdsRaw.greenMax ?? base.thresholds.greenMax);
  const orangeMax = Number(thresholdsRaw.orangeMax ?? base.thresholds.orangeMax);
  if (!Number.isFinite(greenMax) || !Number.isFinite(orangeMax) || greenMax < 0 || orangeMax < greenMax) {
    return { valid: false, error: 'Invalid thresholds' };
  }

  return {
    valid: true,
    config: {
      dateColumnKey: dateParsed.value,
      receiptDateColumnKey: receiptParsed.value,
      confirmedDateColumnKey: confirmedParsed.value,
      vendorColumnKey: vendorParsed.value,
      quantityMeasures,
      openMeasureKey,
      deliveredMeasureKey,
      orderedMeasureKey,
      showCapacityLine,
      showWarningLine,
      showCapacityRows,
      matrixColorFill,
      confirmedColor,
      chartWeekRanges,
      excludedStatuses,
      itemPickerColumnKeys,
      splitPanelKpiKeys,
      thresholds: { greenMax, orangeMax },
      duplicatePolicy,
      periodMode,
    },
  };
}

async function getConfig() {
  const raw = await settingsService.getAsync(CONFIG_KEY, '');
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw);
    const result = validateConfig(parsed);
    if (!result.valid) return defaultConfig();
    return result.config;
  } catch {
    return defaultConfig();
  }
}

function applyScopedColumnKeys(config, defs) {
  const all = [...(defs.master || []), ...(defs.detail || [])];
  const scopeKey = (stored) => toScopedColumnKey(stored, all);
  return {
    ...config,
    dateColumnKey: scopeKey(config.dateColumnKey),
    receiptDateColumnKey: scopeKey(config.receiptDateColumnKey),
    confirmedDateColumnKey: scopeKey(config.confirmedDateColumnKey),
    vendorColumnKey: scopeKey(config.vendorColumnKey),
    openMeasureKey: scopeKey(config.openMeasureKey),
    deliveredMeasureKey: scopeKey(config.deliveredMeasureKey),
    orderedMeasureKey: scopeKey(config.orderedMeasureKey),
    quantityMeasures: (config.quantityMeasures || []).map((entry) => ({
      ...entry,
      columnKey: scopeKey(entry.columnKey),
    })),
  };
}

async function assertSlotsExist(config) {
  const defs = await dataService.getBoardColumnDefinitions(PO_TABLE_KEY);
  const master = defs.master || [];
  const all = [...master, ...(defs.detail || [])];

  const vendorCol = findScopedColumn(master, config.vendorColumnKey);
  if (!vendorCol || vendorCol.dataType !== 'text' || vendorCol.isActive === false) {
    const err = new Error(`Vendor column is not an active header text field: ${config.vendorColumnKey}`);
    err.status = 400;
    throw err;
  }

  const assertDate = (key, label) => {
    if (!key) return;
    const col = findScopedColumn(all, key);
    const ok = col && col.isActive !== false
      && (col.dataType === 'date' || col.dataType === 'date_period');
    if (!ok) {
      const err = new Error(`${label} is not an active date column: ${key}`);
      err.status = 400;
      throw err;
    }
  };
  assertDate(config.dateColumnKey, 'Requested delivery date');
  assertDate(config.confirmedDateColumnKey, 'Confirmed delivery date');
  assertDate(config.receiptDateColumnKey, 'Receipt date');

  const qtyKeys = [config.openMeasureKey, config.deliveredMeasureKey, config.orderedMeasureKey];
  for (const key of qtyKeys) {
    const col = findScopedColumn(all, key);
    const { eligible, reason } = resolveRccpQuantityEligibility(col);
    if (!eligible) {
      const err = new Error(reason || `Quantity column is not eligible: ${key}`);
      err.status = 400;
      throw err;
    }
  }

  return defs;
}

async function saveConfig(raw, userId = null) {
  const result = validateConfig(raw);
  if (!result.valid) {
    const err = new Error(result.error);
    err.status = 400;
    throw err;
  }
  const defs = await assertSlotsExist(result.config);
  const scoped = applyScopedColumnKeys(result.config, defs);
  await settingsService.set(CONFIG_KEY, JSON.stringify(scoped), userId);
  return scoped;
}

module.exports = {
  CONFIG_KEY,
  CAPACITY_MEASURE_KEY,
  OVERCAPACITY_MEASURE_KEY,
  WARNING_MEASURE_KEY,
  SLOT_DEFAULT_KEYS,
  SPLIT_PANEL_KPI_KEYS,
  SPLIT_PANEL_KPI_LIMIT,
  defaultConfig,
  normalizeSplitPanelKpiKeys,
  normalizeQuantityMeasures,
  normalizeChartWeekRanges,
  normalizeItemPickerColumnKeys,
  validateConfig,
  getConfig,
  saveConfig,
};
