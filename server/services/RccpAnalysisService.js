'use strict';

const { time } = require('../utils/timing');
const tableDataService = require('./TableDataService');
const { readRccpPoRows } = require('./BoardSnapshotCache');
const capacityService = require('./RccpCapacityService');
const settingsService = require('./RccpSettingsService');
const { CAPACITY_MEASURE_KEY, OVERCAPACITY_MEASURE_KEY, WARNING_MEASURE_KEY } = require('./RccpSettingsService');

// Vaste kleur voor de afgeleide overcapaciteit-lijn (Fluent purple). Niet configureerbaar: het is
// geen door de gebruiker toegevoegde measure maar een berekende regel.
const OVERCAPACITY_COLOR = '#8764B8';
const { getIsoWeek, getIsoWeekYear, buildWeekRange, isIsoWeekInWindow } = require('../utils/isoWeek');
const { computeRccpStatus } = require('../utils/rccpStatus');
const {
  toNumber,
  pickValue,
  pickConfiguredValue,
  resolveLineMeasureQty,
  isHeaderOnlyMeasure,
  lineDateValue,
  isSentinelDate,
  collectDateSlots,
  collectPlanningSlots,
  parsePlanningDateMode,
  planningDateValue,
} = require('../utils/rccpPoRow');
const { buildPoSegments, mergeSegmentsIntoChart } = require('../utils/rccpPoSegments');
const { buildRccpPoKpisPair, buildRccpPoKpiByOrder, buildRccpCapacityKpis } = require('../utils/rccpKpis');
const { buildItemPickerLookupMap } = require('../utils/rccpItemPickerLookup');
const { storageColumnKey } = require('../utils/rccpColumnRef');

const PO_TABLE_KEY = 'purchase-orders';

function collectInWindowSlots(details, masterValues, config, window, excludedSet, masterStatus, planningDateMode) {
  return collectPlanningSlots(
    details,
    masterValues,
    config.dateColumnKey,
    config.confirmedDateColumnKey,
    window,
    excludedSet,
    masterStatus,
    planningDateMode,
  );
}

function isDeliveredMeasure(config, measureKey) {
  const deliveredKey = String(config.deliveredMeasureKey || '').trim();
  return Boolean(deliveredKey && measureKey === deliveredKey);
}

/** Receipt week when that date exists; otherwise the planning week (same as the chart stack below). */
function deliveredBucketDate(lineValues, masterValues, config, plannedDate) {
  const receiptKey = String(config.receiptDateColumnKey || '').trim();
  const rawReceipt = receiptKey ? lineDateValue(lineValues, masterValues, receiptKey) : null;
  if (rawReceipt && !isSentinelDate(rawReceipt)) return rawReceipt;
  return plannedDate && !isSentinelDate(plannedDate) ? plannedDate : null;
}

function collectDeliveredSlots(details, masterValues, config, window, excludedSet, masterStatus, dateMode) {
  const receiptKey = String(config.receiptDateColumnKey || '').trim();
  const receiptSlots = receiptKey
    ? collectDateSlots(details, masterValues, receiptKey, null, window, excludedSet, masterStatus)
    : [];
  if (receiptSlots.length) return receiptSlots;
  return collectInWindowSlots(details, masterValues, config, window, excludedSet, masterStatus, dateMode);
}

function measureSlots(details, masterValues, config, window, excludedSet, masterStatus, dateMode, measureKey) {
  if (isDeliveredMeasure(config, measureKey)) {
    return collectDeliveredSlots(details, masterValues, config, window, excludedSet, masterStatus, dateMode);
  }
  return collectInWindowSlots(details, masterValues, config, window, excludedSet, masterStatus, dateMode);
}

function cellKey(vendor, year, week, measureKey) {
  return `${vendor}|${year}|${week}|${measureKey}`;
}

function parseCellKey(key) {
  const [vendorAccount, periodYear, isoWeek, ...rest] = String(key).split('|');
  return {
    vendorAccount,
    periodYear: Number(periodYear),
    isoWeek: Number(isoWeek),
    measureKey: rest.join('|'),
  };
}

function compareIsoWeek(aYear, aWeek, bYear, bWeek) {
  if (aYear !== bYear) return aYear - bYear;
  return aWeek - bWeek;
}

function expandDataRange(range, year, week) {
  if (!range) return { fromYear: year, fromWeek: week, toYear: year, toWeek: week };
  if (compareIsoWeek(year, week, range.fromYear, range.fromWeek) < 0) {
    range.fromYear = year;
    range.fromWeek = week;
  }
  if (compareIsoWeek(year, week, range.toYear, range.toWeek) > 0) {
    range.toYear = year;
    range.toWeek = week;
  }
  return range;
}

function pickDataWindow(dataRangeByVendor, vendorFilter) {
  if (vendorFilter) return dataRangeByVendor.get(vendorFilter) || null;
  let merged = null;
  for (const range of dataRangeByVendor.values()) {
    merged = expandDataRange(
      merged ? { ...merged } : null,
      range.fromYear,
      range.fromWeek,
    );
    merged = expandDataRange(merged, range.toYear, range.toWeek);
  }
  return merged;
}

function aggregatePoLoad(rows, config, window, planningDateMode) {
  const dateMode = parsePlanningDateMode(planningDateMode);
  const confirmedByCell = new Map();
  const missingDates = [];
  const measures = config.quantityMeasures || [];
  const excludedSet = new Set(config.excludedStatuses.map((s) => s.toLowerCase()));
  const diagnostics = {
    orderCount: rows.length,
    lineCount: 0,
    excludedLines: 0,
    missingVendorOrders: 0,
    missingDateLines: 0,
    outOfWindowLines: 0,
    zeroQuantityLines: 0,
    countedLines: 0,
    totalConfirmedQty: 0,
  };
  const dataRangeByVendor = new Map();

  const noteDataRange = (vendor, year, week) => {
    dataRangeByVendor.set(vendor, expandDataRange(dataRangeByVendor.get(vendor), year, week));
  };

  const addLoad = (vendor, year, week, measureKey, qty) => {
    if (qty <= 0) return;
    diagnostics.countedLines += 1;
    diagnostics.totalConfirmedQty += qty;
    const key = cellKey(vendor, year, week, measureKey);
    confirmedByCell.set(key, (confirmedByCell.get(key) || 0) + qty);
  };

  for (const row of rows) {
    const masterValues = row.values || {};
    const vendor = String(pickConfiguredValue(masterValues, config.vendorColumnKey) || '').trim();
    if (!vendor) {
      diagnostics.missingVendorOrders += 1;
      continue;
    }

    const masterStatus = pickValue(masterValues, 'status') ?? pickValue(masterValues, 'purchaseOrderStatus');
    const details = (Array.isArray(row.details) ? row.details : []).filter((d) => !d.isRemoved);
    const headerOnlyKeys = new Set(
      measures
        .filter((measure) => isHeaderOnlyMeasure(details, masterValues, measure.columnKey))
        .map((measure) => measure.columnKey),
    );
    const lineMeasures = measures.filter((measure) => !headerOnlyKeys.has(measure.columnKey));

    const processLine = (lineNumber, lineValues) => {
      diagnostics.lineCount += 1;
      const share = details.length ? 1 / details.length : 1;
      const measureQty = (measure) => (
        resolveLineMeasureQty(lineValues, masterValues, measure.columnKey, share)
      );

      const status = pickValue(lineValues, 'status') ?? masterStatus;
      if (status && excludedSet.has(String(status).toLowerCase())) {
        diagnostics.excludedLines += 1;
        return;
      }

      const plannedDate = planningDateValue(
        lineValues, masterValues, config.dateColumnKey, config.confirmedDateColumnKey, dateMode,
      );
      if (!plannedDate) {
        diagnostics.missingDateLines += 1;
        missingDates.push({
          orderNumber: row.recordKey,
          lineNumber,
          vendorAccount: vendor,
          quantity: lineMeasures.length ? measureQty(lineMeasures[0]) : 0,
          dateFromHeader: false,
        });
        return;
      }

      const plannedYear = getIsoWeekYear(plannedDate);
      const plannedWeek = getIsoWeek(plannedDate);
      if (!plannedYear || !plannedWeek) return;

      const plannedInWindow = isIsoWeekInWindow(plannedYear, plannedWeek, window);
      let hasQty = false;
      lineMeasures.forEach((measure) => {
        const qty = measureQty(measure);
        if (qty <= 0) return;
        hasQty = true;
        const dateValue = isDeliveredMeasure(config, measure.columnKey)
          ? deliveredBucketDate(lineValues, masterValues, config, plannedDate)
          : plannedDate;
        if (!dateValue) return;
        const year = getIsoWeekYear(dateValue);
        const week = getIsoWeek(dateValue);
        if (!year || !week) return;
        noteDataRange(vendor, year, week);
        if (isIsoWeekInWindow(year, week, window)) {
          addLoad(vendor, year, week, measure.columnKey, qty);
        }
      });
      if (!plannedInWindow) {
        diagnostics.outOfWindowLines += 1;
        return;
      }
      if (!hasQty && lineMeasures.length) diagnostics.zeroQuantityLines += 1;
    };

    if (!details.length) {
      processLine(null, masterValues);
    } else {
      for (const detail of details) {
        processLine(detail.detailKey, detail.values || {});
      }
    }

    if (!headerOnlyKeys.size) continue;
    for (const measure of measures) {
      if (!headerOnlyKeys.has(measure.columnKey)) continue;
      const total = toNumber(pickConfiguredValue(masterValues, measure.columnKey));
      if (total <= 0) continue;
      const slots = measureSlots(
        details, masterValues, config, window, excludedSet, masterStatus, dateMode, measure.columnKey,
      );
      if (!slots.length) continue;
      const shareQty = total / slots.length;
      for (const slot of slots) {
        noteDataRange(vendor, slot.year, slot.week);
        addLoad(vendor, slot.year, slot.week, measure.columnKey, shareQty);
      }
    }
  }

  return { confirmedByCell, missingDates, diagnostics, dataRangeByVendor };
}

function sumCapacityByVendorWeek(capacityRows, vendorFilter) {
  const totals = new Map();
  for (const row of capacityRows) {
    if (vendorFilter && row.vendorAccount !== vendorFilter) continue;
    const key = `${row.vendorAccount}|${row.periodYear}|${row.isoWeek}`;
    totals.set(key, (totals.get(key) || 0) + Number(row.availableQty || 0));
  }
  return totals;
}

function buildMatrixCells({
  capacityRows, confirmedByCell, config, window, vendorFilter = null,
}) {
  const measures = config.quantityMeasures || [];
  const openMeasureKey = config.openMeasureKey || '';
  const deliveredMeasureKey = config.deliveredMeasureKey || '';
  const capacityTotals = sumCapacityByVendorWeek(capacityRows, vendorFilter);
  const periods = buildWeekRange(window.fromYear, window.fromWeek, window.toYear, window.toWeek);
  const cells = [];

  const vendors = new Set();
  for (const key of confirmedByCell.keys()) vendors.add(parseCellKey(key).vendorAccount);
  for (const key of capacityTotals.keys()) vendors.add(key.split('|')[0]);

  for (const vendor of vendors) {
    if (vendorFilter && vendor !== vendorFilter) continue;

    for (const period of periods) {
      const capKey = `${vendor}|${period.year}|${period.week}`;
      const available = capacityTotals.get(capKey) || 0;

      for (const measure of measures) {
        const confirmed = confirmedByCell.get(cellKey(vendor, period.year, period.week, measure.columnKey)) || 0;
        const status = computeRccpStatus(available, confirmed, config.thresholds);
        cells.push({
          vendorAccount: vendor,
          periodYear: period.year,
          isoWeek: period.week,
          measureKey: measure.columnKey,
          availableQty: available,
          confirmedQty: confirmed,
          remainingQty: available - confirmed,
          utilPercent: status.utilPercent,
          statusColor: status.color,
          statusLabel: status.label,
        });
      }

      // Capaciteitsregel altijd tonen (ook zonder capaciteit in deze week), zodat de regel niet
      // per week in en uit springt.
      cells.push({
        vendorAccount: vendor,
        periodYear: period.year,
        isoWeek: period.week,
        measureKey: CAPACITY_MEASURE_KEY,
        availableQty: available,
        confirmedQty: 0,
        remainingQty: available,
        utilPercent: null,
        statusColor: 'green',
        statusLabel: 'OK',
      });

      // Waarschuwingsdrempel = greenMax% van de beschikbare capaciteit; getoond als gestippelde
      // lijn in de grafiek zodat de gebruiker de "comfortzone" snel afleest.
      const greenMax = Number(config.thresholds?.greenMax ?? 80);
      cells.push({
        vendorAccount: vendor,
        periodYear: period.year,
        isoWeek: period.week,
        measureKey: WARNING_MEASURE_KEY,
        availableQty: available,
        confirmedQty: available > 0 ? Math.round(available * greenMax / 100 * 10) / 10 : 0,
        remainingQty: 0,
        utilPercent: null,
        statusColor: 'grey',
        statusLabel: 'N/A',
      });

      // Overcapaciteit = beschikbare capaciteit − de als "openstaand" gekozen measure. Negatief =
      // tekort; dat toont de matrix rood en de grafiek onder de nullijn.
      if (openMeasureKey) {
        const openLoad = confirmedByCell.get(cellKey(vendor, period.year, period.week, openMeasureKey)) || 0;
        const over = available - openLoad;
        cells.push({
          vendorAccount: vendor,
          periodYear: period.year,
          isoWeek: period.week,
          measureKey: OVERCAPACITY_MEASURE_KEY,
          availableQty: available,
          confirmedQty: over,
          remainingQty: over,
          utilPercent: null,
          statusColor: over < 0 ? 'red' : 'green',
          statusLabel: over < 0 ? 'Shortage' : 'OK',
        });
      }
    }
  }

  const openLabel = openMeasureKey
    ? (measures.find((m) => m.columnKey === openMeasureKey)?.label || openMeasureKey)
    : '';

  const measureRows = [
    ...measures.map((m) => ({
      measureKey: m.columnKey,
      label: m.label || m.columnKey,
      chartType: m.chartType,
      color: m.color,
      showInChart: m.showInChart !== false,
      isCapacity: false,
      isOpen: Boolean(openMeasureKey && m.columnKey === openMeasureKey),
      isDelivered: Boolean(deliveredMeasureKey && m.columnKey === deliveredMeasureKey),
      isOrdered: Boolean(config.orderedMeasureKey && m.columnKey === config.orderedMeasureKey),
    })),
    {
      measureKey: CAPACITY_MEASURE_KEY,
      label: 'Available capacity',
      chartType: 'line',
      color: '#107C10',
      showInChart: config.showCapacityLine !== false,
      isCapacity: true,
    },
    ...(openMeasureKey ? [{
      measureKey: OVERCAPACITY_MEASURE_KEY,
      label: `Overcapacity (vs ${openLabel})`,
      chartType: 'line',
      color: OVERCAPACITY_COLOR,
      showInChart: true,
      isCapacity: false,
      isOvercapacity: true,
    }] : []),
    {
      measureKey: WARNING_MEASURE_KEY,
      label: 'Warning threshold',
      chartType: 'line',
      color: '#FF8C00',
      showInChart: config.showWarningLine !== false,
      isCapacity: false,
      isWarning: true,
      isDashed: true,
    },
  ];

  return { cells, measureRows, periods };
}

function buildChartSeries(cells, periods, measureRows) {
  // Open/remaining measures (niet delivered, niet afgeleid) voor de overload-berekening.
  const userLoadKeys = measureRows
    .filter((r) => !r.isCapacity && !r.isOvercapacity && !r.isWarning && !r.isDelivered)
    .map((r) => r.measureKey);

  return periods.map(({ year, week, key }) => {
    const point = { key, year, week };
    for (const row of measureRows) {
      const slice = cells.filter(
        (c) => c.periodYear === year && c.isoWeek === week && c.measureKey === row.measureKey,
      );
      point[row.measureKey] = slice.reduce(
        (s, c) => s + (row.isCapacity ? c.availableQty : c.confirmedQty),
        0,
      );
    }

    // Overload vlag: open/remaining load overschrijdt beschikbare capaciteit.
    const capacityQty = point[CAPACITY_MEASURE_KEY] || 0;
    const totalLoad = userLoadKeys.reduce((s, k) => s + (point[k] || 0), 0);
    point.__overloaded__ = capacityQty > 0 && totalLoad > capacityQty;

    // Delivered waarden worden negatief gespiegeld (weergave onder de x-as).
    for (const row of measureRows) {
      if (row.isDelivered && point[row.measureKey] > 0) {
        point[row.measureKey] = -point[row.measureKey];
      }
    }

    return point;
  });
}

async function analyze({
  vendorAccount = null,
  fromYear,
  fromWeek,
  toYear,
  toWeek,
  supplierAccount = null,
  planningDateMode = null,
} = {}) {
  const dateMode = parsePlanningDateMode(planningDateMode);
  const config = await settingsService.getConfig();
  const effectiveVendor = supplierAccount || vendorAccount || null;
  const window = {
    fromYear: Number(fromYear),
    fromWeek: Number(fromWeek),
    toYear: Number(toYear),
    toWeek: Number(toWeek),
  };

  const { rows: poRows } = await time('rccp_po_read', () => readRccpPoRows({
    tableKey: PO_TABLE_KEY,
    supplierAccount: supplierAccount || null,
  }));

  const { confirmedByCell, missingDates, diagnostics, dataRangeByVendor } = aggregatePoLoad(
    poRows, config, window, dateMode,
  );

  const allCapacity = await time('rccp_capacity', () => capacityService.listCapacity({
    vendorAccount: effectiveVendor,
  }));
  const capacityRows = allCapacity.filter(
    (row) => isIsoWeekInWindow(row.periodYear, row.isoWeek, window),
  );

  const { cells, measureRows, periods } = buildMatrixCells({
    capacityRows,
    confirmedByCell,
    config,
    window,
    vendorFilter: effectiveVendor,
  });

  const chart = buildChartSeries(cells, periods, measureRows);
  const now = new Date();
  const segmentsByWeek = await time('rccp_po_segments', () => buildPoSegments(poRows, config, window, {
    now,
    vendorAccount: effectiveVendor,
    planningDateMode: dateMode,
  }));
  const poKpiPair = await time('rccp_kpis', () => buildRccpPoKpisPair(poRows, config, window, {
    now,
    vendorAccount: effectiveVendor,
  }));
  const capacityKpis = buildRccpCapacityKpis(chart, measureRows, CAPACITY_MEASURE_KEY);
  const kpis = { ...poKpiPair.windowed, ...capacityKpis };
  const kpisAll = { ...poKpiPair.all, ...capacityKpis };

  // Confirmed-datum-basis (i.p.v. requested delivery date) — voedt de omdraaibare
  // C/R-kant van de KPI-tegels. Zelfde structuur als hierboven, andere datumkolom.
  const poKpiPairConfirmed = await time('rccp_kpis_confirmed', () => buildRccpPoKpisPair(poRows, config, window, {
    now,
    vendorAccount: effectiveVendor,
    planningDateMode: 'confirmed',
  }));
  const kpisConfirmed = { ...poKpiPairConfirmed.windowed, ...capacityKpis };
  const kpisAllConfirmed = { ...poKpiPairConfirmed.all, ...capacityKpis };

  return {
    config,
    window,
    vendorAccount: effectiveVendor,
    cells,
    measureRows,
    periods,
    missingDates: effectiveVendor
      ? missingDates.filter((m) => m.vendorAccount === effectiveVendor)
      : missingDates,
    diagnostics,
    kpis,
    kpisAll,
    kpisConfirmed,
    kpisAllConfirmed,
    dataWindow: pickDataWindow(dataRangeByVendor, effectiveVendor),
    chart: mergeSegmentsIntoChart(chart, segmentsByWeek),
  };
}

/**
 * Per-PO KPI-stats uit een lichte cache-read (geen ledger/historie), zonder weekvenster.
 * De PO-board-tab aggregeert dit client-side over de zichtbare ordernummers.
 */
const BOARD_KPI_CACHE_LIMIT = 8;
const boardKpiCache = new Map();

function boardKpiCacheKey(supplierAccount, revision, config, now) {
  return [
    supplierAccount || '',
    revision || '',
    config.openMeasureKey || '',
    config.deliveredMeasureKey || '',
    config.dateColumnKey || '',
    config.receiptDateColumnKey || '',
    config.confirmedDateColumnKey || '',
    config.vendorColumnKey || '',
    (config.excludedStatuses || []).join(','),
    getIsoWeekYear(now),
    getIsoWeek(now),
  ].join('|');
}

function rememberBoardKpis(key, payload) {
  if (boardKpiCache.has(key)) boardKpiCache.delete(key);
  boardKpiCache.set(key, payload);
  while (boardKpiCache.size > BOARD_KPI_CACHE_LIMIT) {
    const oldest = boardKpiCache.keys().next().value;
    boardKpiCache.delete(oldest);
  }
}

async function boardKpis({ supplierAccount = null } = {}) {
  const config = await settingsService.getConfig();
  const { revision, parts } = await time('rccp_board_kpis_rev', () => tableDataService.getRevision({
    tableKey: PO_TABLE_KEY,
    supplierAccount: supplierAccount || null,
  }));
  const now = new Date();
  const cacheKey = boardKpiCacheKey(supplierAccount, revision, config, now);
  const cached = boardKpiCache.get(cacheKey);
  if (cached) return cached;

  const { rows: poRows } = await time('rccp_board_kpis_read', () => readRccpPoRows({
    tableKey: PO_TABLE_KEY,
    supplierAccount: supplierAccount || null,
    revision,
    parts,
  }));
  const compact = await time('rccp_board_kpis', () => buildRccpPoKpiByOrder(poRows, config, {
    now,
    vendorAccount: supplierAccount || null,
  }));
  // Confirmed-datum-basis — voedt de omdraaibare C/R-kant van de PO-board KPI-tegels.
  const compactConfirmed = await time('rccp_board_kpis_confirmed', () => buildRccpPoKpiByOrder(poRows, config, {
    now,
    vendorAccount: supplierAccount || null,
    planningDateMode: 'confirmed',
  }));
  const payload = {
    ...compact,
    confirmed: compactConfirmed,
    configured: Boolean(
      String(config.openMeasureKey || '').trim() || String(config.deliveredMeasureKey || '').trim(),
    ),
    // Meegeven zodat de client de KPI-formuletekst kan opbouwen met de labels
    // die de gebruiker in de RCCP-instellingen (Quantities-tab) heeft gekozen.
    config: {
      openMeasureKey: config.openMeasureKey,
      deliveredMeasureKey: config.deliveredMeasureKey,
      quantityMeasures: config.quantityMeasures,
    },
  };
  rememberBoardKpis(cacheKey, payload);
  return payload;
}

function buildDrillDownRows(rows, config, cell, window, planningDateMode) {
  const dateMode = parsePlanningDateMode(planningDateMode);
  const result = [];
  const excludedSet = new Set(config.excludedStatuses.map((s) => s.toLowerCase()));
  const measureKey = cell.measureKey;
  // Capaciteit en overcapaciteit zijn afgeleide regels zonder onderliggende PO-regels.
  if (!measureKey || measureKey === CAPACITY_MEASURE_KEY || measureKey === OVERCAPACITY_MEASURE_KEY) return result;

  for (const row of rows) {
    const masterValues = row.values || {};
    const vendor = String(pickConfiguredValue(masterValues, config.vendorColumnKey) || '').trim();
    if (vendor !== cell.vendorAccount) continue;

    const masterStatus = pickValue(masterValues, 'status') ?? pickValue(masterValues, 'purchaseOrderStatus');
    const details = (Array.isArray(row.details) ? row.details : []).filter((d) => !d.isRemoved);
    const share = details.length ? 1 / details.length : 1;

    if (isHeaderOnlyMeasure(details, masterValues, measureKey)) {
      const slots = measureSlots(
        details, masterValues, config, window, excludedSet, masterStatus, dateMode, measureKey,
      );
      const total = toNumber(pickConfiguredValue(masterValues, measureKey));
      if (total <= 0 || !slots.length) continue;
      const shareQty = total / slots.length;
      for (const slot of slots) {
        if (slot.year !== cell.periodYear || slot.week !== cell.isoWeek) continue;
        result.push({
          orderNumber: row.recordKey,
          lineNumber: slot.lineNumber,
          itemNumber: pickValue(slot.lineValues, 'itemNumber') ?? pickValue(masterValues, 'itemNumber'),
          quantity: shareQty,
          deliveryDate: slot.dateValue,
          status: (pickValue(slot.lineValues, 'status') ?? masterStatus) || '',
          dateFromHeader: slot.dateFromHeader,
        });
      }
      continue;
    }

    const lineBucketDate = (lineValues) => {
      const plannedDate = planningDateValue(
        lineValues, masterValues, config.dateColumnKey, config.confirmedDateColumnKey, dateMode,
      );
      if (isDeliveredMeasure(config, measureKey)) {
        return deliveredBucketDate(lineValues, masterValues, config, plannedDate);
      }
      return plannedDate;
    };

    const pushLine = (lineNumber, lineValues, dateValue, dateFromHeader) => {
      const status = pickValue(lineValues, 'status') ?? masterStatus;
      if (status && excludedSet.has(String(status).toLowerCase())) return;
      if (!dateValue) return;

      const year = getIsoWeekYear(dateValue);
      const week = getIsoWeek(dateValue);
      if (year !== cell.periodYear || week !== cell.isoWeek) return;
      if (!isIsoWeekInWindow(year, week, window)) return;

      const qty = resolveLineMeasureQty(lineValues, masterValues, measureKey, share);
      if (qty <= 0) return;

      result.push({
        orderNumber: row.recordKey,
        lineNumber,
        itemNumber: pickValue(lineValues, 'itemNumber') ?? pickValue(masterValues, 'itemNumber'),
        quantity: qty,
        deliveryDate: dateValue,
        status: status || '',
        dateFromHeader,
      });
    };

    if (!details.length) {
      pushLine(null, masterValues, lineBucketDate(masterValues), true);
      continue;
    }

    for (const detail of details) {
      const lineValues = detail.values || {};
      const dateValue = lineBucketDate(lineValues);
      const dateFromHeader = Boolean(dateValue)
        && !pickConfiguredValue(lineValues, config.dateColumnKey)
        && !pickConfiguredValue(lineValues, config.confirmedDateColumnKey)
        && !pickConfiguredValue(lineValues, config.receiptDateColumnKey);
      pushLine(detail.detailKey, lineValues, dateValue, dateFromHeader);
    }
  }

  return result;
}

async function getDrillDown(params) {
  const config = await settingsService.getConfig();
  const window = {
    fromYear: Number(params.fromYear),
    fromWeek: Number(params.fromWeek),
    toYear: Number(params.toYear),
    toWeek: Number(params.toWeek),
  };
  const { rows: poRows } = await time('rccp_drilldown_po_read', () => readRccpPoRows({
    tableKey: PO_TABLE_KEY,
    supplierAccount: params.supplierAccount || null,
  }));
  const cell = {
    vendorAccount: params.vendorAccount,
    periodYear: Number(params.periodYear),
    isoWeek: Number(params.isoWeek),
    measureKey: params.measureKey,
  };
  return {
    cell,
    rows: buildDrillDownRows(poRows, config, cell, window, parsePlanningDateMode(params.planningDateMode)),
  };
}

function extractVendorsFromRows(rows, vendorColumnKey) {
  const vendors = new Set();
  for (const row of rows || []) {
    const vendor = String(pickConfiguredValue(row.values, vendorColumnKey) || '').trim();
    if (vendor) vendors.add(vendor);
  }
  return [...vendors].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Maps each vendor value to the vendor name on its order rows. The vendor column is
 * configurable while vendorName is a fixed master field, so vendors without a name
 * are simply absent from the map and fall back to their code in the UI.
 */
function extractVendorNamesFromRows(rows, vendorColumnKey) {
  const names = {};
  for (const row of rows || []) {
    const vendor = String(pickConfiguredValue(row.values, vendorColumnKey) || '').trim();
    if (!vendor || names[vendor]) continue;
    const name = String(pickValue(row.values, 'vendorName') || '').trim();
    if (name) names[vendor] = name;
  }
  return names;
}

// Revisie-gated cache voor de vendorlijst. De lijst verandert alleen als de PO-masterdata wijzigt;
// die wijziging weerspiegelt zich in de PO-revision (zelfde hash als het board gebruikt). We bewaren
// per supplier-scope het laatst berekende resultaat en serveren dat instant zolang de revision
// gelijk blijft. Zo kost /vendors na de eerste keer nog maar één goedkope revision-query i.p.v. een
// volledige tabel-read.
const vendorListCache = new Map();

async function listMainTableVendors({ supplierAccount = null } = {}) {
  const config = await settingsService.getConfig();
  const cacheKey = supplierAccount || '__all__';

  let revision = null;
  try {
    ({ revision } = await time('rccp_vendor_revision', () => tableDataService.getRevision({
      tableKey: PO_TABLE_KEY,
      supplierAccount: supplierAccount || null,
    })));
    const cached = vendorListCache.get(cacheKey);
    if (cached && revision && cached.revision === revision) return cached.payload;
  } catch {
    // Revision-check faalt (bv. DB-hik) → val terug op een verse berekening zonder cache.
    revision = null;
  }

  const vendorStorageKey = storageColumnKey(config.vendorColumnKey) || config.vendorColumnKey;
  const rows = await time('rccp_vendor_list', () => tableDataService.listVendorValues({
    tableKey: PO_TABLE_KEY,
    valueColumnKeys: [vendorStorageKey, 'vendorName'],
  }));
  const scoped = supplierAccount
    ? rows.filter((r) => String(pickConfiguredValue(r.values, config.vendorColumnKey) || '').trim()
        === String(supplierAccount).trim())
    : rows;

  const payload = {
    vendorColumnKey: vendorStorageKey,
    vendors: extractVendorsFromRows(scoped, config.vendorColumnKey),
    vendorNames: extractVendorNamesFromRows(scoped, config.vendorColumnKey),
  };
  if (revision) vendorListCache.set(cacheKey, { revision, payload });
  return payload;
}

const ITEMS_TABLE_KEY = 'items';
const ITEM_LOOKUP_LIMIT = 500;
const itemLookupCache = new Map();

async function listItemPickerLookup({ itemNumbers = [] } = {}) {
  const config = await settingsService.getConfig();
  const columnKeys = config.itemPickerColumnKeys || [];
  const wanted = [...new Set(
    (itemNumbers || []).map((value) => String(value || '').trim()).filter(Boolean),
  )].slice(0, ITEM_LOOKUP_LIMIT);
  if (!columnKeys.length || !wanted.length) {
    return { columns: [], byItem: {} };
  }

  const cacheKey = columnKeys.join(',');
  let revision = null;
  try {
    ({ revision } = await tableDataService.getRevision({ tableKey: ITEMS_TABLE_KEY }));
    const cached = itemLookupCache.get(cacheKey);
    if (cached && revision && cached.revision === revision) {
      return {
        columns: cached.columns,
        byItem: buildItemPickerLookupMap(cached.rows, wanted, columnKeys),
      };
    }
  } catch {
    revision = null;
  }

  let labelByKey = new Map();
  try {
    const defs = await tableDataService.getBoardColumnDefinitions(ITEMS_TABLE_KEY, { scope: 'master' });
    for (const col of defs.master || []) {
      labelByKey.set(col.key, col.label || col.key);
    }
  } catch {
    labelByKey = new Map();
  }

  const rows = await time('rccp_item_lookup', () => tableDataService.listVendorValues({
    tableKey: ITEMS_TABLE_KEY,
    valueColumnKeys: columnKeys,
  }));
  const columns = columnKeys.map((key) => ({ key, label: labelByKey.get(key) || key }));
  if (revision) itemLookupCache.set(cacheKey, { revision, columns, rows });

  return {
    columns,
    byItem: buildItemPickerLookupMap(rows, wanted, columnKeys),
  };
}

module.exports = {
  aggregatePoLoad,
  buildDrillDownRows,
  buildMatrixCells,
  analyze,
  boardKpis,
  getDrillDown,
  listMainTableVendors,
  listItemPickerLookup,
  extractVendorsFromRows,
  extractVendorNamesFromRows,
  cellKey,
  parseCellKey,
  pickDataWindow,
};
