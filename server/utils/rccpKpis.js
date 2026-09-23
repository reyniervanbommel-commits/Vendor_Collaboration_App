'use strict';

/**
 * RCCP dashboard KPI's binnen vendor + ISO-weekvenster.
 * Puur: geen Date.now, geen service-imports.
 */

const { getIsoWeek, getIsoWeekYear, isIsoWeekInWindow } = require('./isoWeek');
const {
  toNumber,
  pickValue,
  pickConfiguredValue,
  resolveLineMeasureQty,
  isHeaderOnlyMeasure,
  lineDateValue,
  isSentinelDate,
  collectDateSlots,
  planningDateValue,
} = require('./rccpPoRow');
const { compactByOrder } = require('./rccpKpiCompact');

const WIDE_WINDOW = { fromYear: 2000, fromWeek: 1, toYear: 2100, toWeek: 53 };

function compareIsoWeek(aYear, aWeek, bYear, bWeek) {
  if (aYear !== bYear) return aYear - bYear;
  return aWeek - bWeek;
}

function utcDayValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (isSentinelDate(date)) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function calendarDaysBetween(later, earlier) {
  const a = utcDayValue(later);
  const b = utcDayValue(earlier);
  if (a === null || b === null) return null;
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function percentOf(part, whole) {
  if (!(whole > 0)) return 0;
  return (part / whole) * 100;
}

function addSku(set, itemNumber) {
  const sku = String(itemNumber || '').trim();
  if (sku) set.add(sku);
}

function openLateDays(line, now, nowYear, nowWeek) {
  if (
    !(line.openQty > 0)
    || !line.plannedYear
    || !nowYear
    || !nowWeek
    || compareIsoWeek(line.plannedYear, line.plannedWeek, nowYear, nowWeek) >= 0
  ) return null;
  const days = calendarDaysBetween(now, line.plannedDate);
  return days !== null && days > 0 ? days : null;
}

function visitUniverseLine(acc, line, nowYear, nowWeek) {
  acc.totalOpen += line.openQty;
  acc.totalDelivered += line.deliveredQty;
  const pairQty = (Number(line.openQty) || 0) + (Number(line.deliveredQty) || 0);
  if (pairQty > 0 && line.hasConfirmedDate) {
    acc.confirmedUnits += pairQty;
  }
  // "Not confirmed" telt alleen nog open regels zonder bevestigde datum (niet meer delivered).
  if (line.openQty > 0 && !line.hasConfirmedDate) {
    acc.unconfirmedUnits += line.openQty;
    addSku(acc.unconfirmedSkus, line.itemNumber);
  }
  const itemNumber = line.itemNumber;
  if (line.openQty > 0) addSku(acc.openSkus, itemNumber);
  if (isSentinelDate(line.plannedDate)) {
    const qty = (Number(line.openQty) || 0) + (Number(line.deliveredQty) || 0);
    if (qty > 0) {
      acc.planned1900Units += qty;
      addSku(acc.planned1900Skus, itemNumber);
    }
  }
  if (line.deliveredQty > 0 && line.receiptDate && line.plannedDate) {
    const days = calendarDaysBetween(line.receiptDate, line.plannedDate);
    if (days > 0) {
      acc.lateDeliveryDays.push(days);
      acc.lateDeliveryUnits += line.deliveredQty;
      addSku(acc.lateDeliverySkus, itemNumber);
    } else if (days !== null) {
      acc.onTimeUnits += line.deliveredQty;
      addSku(acc.onTimeSkus, itemNumber);
    }
  }
  const openDays = openLateDays(line, acc.now, nowYear, nowWeek);
  if (openDays !== null) {
    acc.openLateDays.push(openDays);
    acc.openLateUnits += line.openQty;
    addSku(acc.openLateSkus, itemNumber);
  }
}

function emptyAcc(now) {
  return {
    now,
    totalOpen: 0,
    totalDelivered: 0,
    lateDeliveryDays: [],
    lateDeliveryUnits: 0,
    lateDeliverySkus: new Set(),
    onTimeUnits: 0,
    onTimeSkus: new Set(),
    openSkus: new Set(),
    openLateDays: [],
    openLateSkus: new Set(),
    openLateUnits: 0,
    planned1900Units: 0,
    planned1900Skus: new Set(),
    confirmedUnits: 0,
    unconfirmedUnits: 0,
    unconfirmedSkus: new Set(),
  };
}

function emptyOrderStats() {
  return {
    openQty: 0,
    deliveredQty: 0,
    lateSum: 0,
    lateCount: 0,
    lateUnits: 0,
    lateSkus: new Set(),
    onTimeUnits: 0,
    onTimeSkus: new Set(),
    openSkus: new Set(),
    openLateSum: 0,
    openLateCount: 0,
    openLateUnits: 0,
    openLateSkus: new Set(),
    planned1900Units: 0,
    planned1900Skus: new Set(),
    unconfirmedUnits: 0,
    unconfirmedSkus: new Set(),
  };
}

function addLineToOrderStats(entry, line, now, nowYear, nowWeek) {
  entry.openQty += line.openQty;
  entry.deliveredQty += line.deliveredQty;
  const sku = String(line.itemNumber || '').trim();
  if (line.openQty > 0 && sku) entry.openSkus.add(sku);
  // "Not confirmed" telt alleen nog open regels zonder bevestigde datum (niet meer delivered).
  if (line.openQty > 0 && !line.hasConfirmedDate) {
    entry.unconfirmedUnits += line.openQty;
    if (sku) entry.unconfirmedSkus.add(sku);
  }
  if (isSentinelDate(line.plannedDate)) {
    const qty = (Number(line.openQty) || 0) + (Number(line.deliveredQty) || 0);
    if (qty > 0) {
      entry.planned1900Units += qty;
      if (sku) entry.planned1900Skus.add(sku);
    }
  }
  if (line.deliveredQty > 0 && line.receiptDate && line.plannedDate) {
    const days = calendarDaysBetween(line.receiptDate, line.plannedDate);
    if (days > 0) {
      entry.lateSum += days;
      entry.lateCount += 1;
      entry.lateUnits += line.deliveredQty;
      if (sku) entry.lateSkus.add(sku);
    } else if (days !== null) {
      entry.onTimeUnits += line.deliveredQty;
      if (sku) entry.onTimeSkus.add(sku);
    }
  }
  const days = openLateDays(line, now, nowYear, nowWeek);
  if (days !== null) {
    entry.openLateSum += days;
    entry.openLateCount += 1;
    entry.openLateUnits += line.openQty;
    if (sku) entry.openLateSkus.add(sku);
  }
}

function walkRccpPoKpiLines(rows, config, window, { now, vendorAccount, skipWindow = false, planningDateMode = 'requested' }, onLine) {
  const openKey = String(config.openMeasureKey || '').trim();
  const deliveredKey = String(config.deliveredMeasureKey || '').trim();
  const confirmedKey = config.confirmedDateColumnKey;
  // 'confirmed': gebruik de confirmed-datumkolom als "planned"-basis (valt terug op
  // requested wanneer er geen confirmed date is) — voedt de C/R-omdraaibare KPI-tegels.
  const dateKey = planningDateMode === 'confirmed' && confirmedKey ? confirmedKey : config.dateColumnKey;
  const receiptKey = String(config.receiptDateColumnKey || '').trim();
  const vendorCol = config.vendorColumnKey;
  const excludedSet = new Set((config.excludedStatuses || []).map((s) => String(s).toLowerCase()));
  const slotWindow = skipWindow ? WIDE_WINDOW : window;

  for (const row of rows || []) {
    const masterValues = row.values || {};
    const vendor = String(pickConfiguredValue(masterValues, vendorCol) || '').trim();
    if (!vendor) continue;
    if (vendorAccount && vendor !== vendorAccount) continue;
    const poNumber = row.recordKey;
    if (!poNumber) continue;

    const masterStatus = pickValue(masterValues, 'status') ?? pickValue(masterValues, 'purchaseOrderStatus');
    const details = (Array.isArray(row.details) ? row.details : []).filter((d) => !d.isRemoved);
    const headerOnlyOpen = Boolean(openKey && isHeaderOnlyMeasure(details, masterValues, openKey));
    const headerOnlyDelivered = Boolean(deliveredKey && isHeaderOnlyMeasure(details, masterValues, deliveredKey));
    const lineOpen = Boolean(openKey && !headerOnlyOpen);
    const lineDelivered = Boolean(deliveredKey && !headerOnlyDelivered);

    const emit = (lineValues, openQty, deliveredQty) => {
      const status = pickValue(lineValues, 'status') ?? masterStatus;
      if (status && excludedSet.has(String(status).toLowerCase())) return;
      const plannedDate = lineDateValue(lineValues, masterValues, dateKey);
      const plannedYear = plannedDate ? getIsoWeekYear(plannedDate) : null;
      const plannedWeek = plannedDate ? getIsoWeek(plannedDate) : null;
      if (!skipWindow) {
        if (!plannedDate || !plannedYear || !plannedWeek) return;
        if (!isIsoWeekInWindow(plannedYear, plannedWeek, window)) return;
      }
      if (!(openQty > 0 || deliveredQty > 0)) return;
      const rawReceipt = receiptKey ? lineDateValue(lineValues, masterValues, receiptKey) : null;
      const receiptDate = utcDayValue(rawReceipt) === null ? null : rawReceipt;
      onLine({
        poNumber,
        itemNumber: pickValue(lineValues, 'itemNumber') ?? pickValue(masterValues, 'itemNumber'),
        openQty: Math.max(0, openQty),
        deliveredQty: Math.max(0, deliveredQty),
        plannedDate,
        receiptDate,
        plannedYear,
        plannedWeek,
        hasConfirmedDate: Boolean(planningDateValue(
          lineValues, masterValues, dateKey, confirmedKey, 'confirmed',
        )),
      });
    };

    if (lineOpen || lineDelivered) {
      const sources = details.length ? details : [{ values: masterValues }];
      const share = details.length ? 1 / details.length : 1;
      for (const detail of sources) {
        const lineValues = detail.values || {};
        emit(
          lineValues,
          lineOpen ? resolveLineMeasureQty(lineValues, masterValues, openKey, share) : 0,
          lineDelivered ? resolveLineMeasureQty(lineValues, masterValues, deliveredKey, share) : 0,
        );
      }
    }

    if (headerOnlyOpen || headerOnlyDelivered) {
      const plannedSlots = collectDateSlots(
        details, masterValues, dateKey, null, slotWindow, excludedSet, masterStatus,
      );
      if (plannedSlots.length) {
        const openShare = headerOnlyOpen ? toNumber(pickConfiguredValue(masterValues, openKey)) / plannedSlots.length : 0;
        const deliveredShare = headerOnlyDelivered
          ? toNumber(pickConfiguredValue(masterValues, deliveredKey)) / plannedSlots.length
          : 0;
        for (const slot of plannedSlots) {
          emit(slot.lineValues, headerOnlyOpen ? openShare : 0, headerOnlyDelivered ? deliveredShare : 0);
        }
      }
    }
  }
}

function summarizeAcc(acc) {
  const totalOpen = acc.totalOpen;
  const totalDelivered = acc.totalDelivered;
  const totalOrdered = totalOpen + totalDelivered;
  return {
    totalOrdered,
    totalDelivered,
    totalOpen,
    deliveredPercent: percentOf(totalDelivered, totalOrdered),
    openPercent: percentOf(totalOpen, totalOrdered),
    lateDeliveryAvgDays: mean(acc.lateDeliveryDays),
    lateDeliveryItemCount: acc.lateDeliverySkus.size,
    lateDeliveryUnits: acc.lateDeliveryUnits,
    lateDeliveryPercent: percentOf(acc.lateDeliveryUnits, totalOrdered),
    onTimeItemCount: acc.onTimeSkus.size,
    onTimeUnits: acc.onTimeUnits,
    onTimePercent: percentOf(acc.onTimeUnits, totalOrdered),
    openItemCount: acc.openSkus.size,
    openLateItemCount: acc.openLateSkus.size,
    openLateUnits: acc.openLateUnits,
    openLateAvgDays: mean(acc.openLateDays),
    planned1900Units: acc.planned1900Units,
    planned1900ItemCount: acc.planned1900Skus.size,
    confirmedUnits: acc.confirmedUnits,
    confirmedPercent: percentOf(acc.confirmedUnits, totalOrdered),
    unconfirmedUnits: acc.unconfirmedUnits,
    unconfirmedItemCount: acc.unconfirmedSkus.size,
    unconfirmedPercent: percentOf(acc.unconfirmedUnits, totalOrdered),
  };
}

function buildRccpPoKpis(rows, config, window, { now, vendorAccount, skipWindow = false, planningDateMode = 'requested' } = {}) {
  const nowYear = getIsoWeekYear(now);
  const nowWeek = getIsoWeek(now);
  const acc = emptyAcc(now);
  walkRccpPoKpiLines(rows, config, window, { now, vendorAccount, skipWindow, planningDateMode }, (line) => {
    visitUniverseLine(acc, line, nowYear, nowWeek);
  });
  return summarizeAcc(acc);
}

function buildRccpPoKpisPair(rows, config, window, { now, vendorAccount, planningDateMode = 'requested' } = {}) {
  const nowYear = getIsoWeekYear(now);
  const nowWeek = getIsoWeek(now);
  const accWindow = emptyAcc(now);
  const accAll = emptyAcc(now);
  walkRccpPoKpiLines(rows, config, window, { now, vendorAccount, skipWindow: true, planningDateMode }, (line) => {
    visitUniverseLine(accAll, line, nowYear, nowWeek);
    if (line.plannedYear && line.plannedWeek && isIsoWeekInWindow(line.plannedYear, line.plannedWeek, window)) {
      visitUniverseLine(accWindow, line, nowYear, nowWeek);
    }
  });
  return { windowed: summarizeAcc(accWindow), all: summarizeAcc(accAll) };
}

function buildRccpPoKpiByOrder(rows, config, { now, vendorAccount, window = null, planningDateMode = 'requested' } = {}) {
  const byOrder = {};
  const nowYear = getIsoWeekYear(now);
  const nowWeek = getIsoWeek(now);
  // Zonder `window` (PO-board-tab): alle orders, geen week-venster.
  // Met `window` (RCCP-dashboard cross-filter): zelfde venster als de KPI-tegels,
  // zodat de per-order match-sets 1-op-1 aansluiten op de getoonde totalen.
  const effectiveWindow = window || WIDE_WINDOW;
  walkRccpPoKpiLines(rows, config, effectiveWindow, { now, vendorAccount, skipWindow: !window, planningDateMode }, (line) => {
    const entry = byOrder[line.poNumber] || emptyOrderStats();
    addLineToOrderStats(entry, line, now, nowYear, nowWeek);
    byOrder[line.poNumber] = entry;
  });
  return compactByOrder(byOrder);
}

function buildRccpCapacityKpis(chart, measureRows, capacityMeasureKey) {
  const openKeys = (measureRows || [])
    .filter((row) => !row.isCapacity && !row.isOvercapacity && !row.isWarning && !row.isDelivered)
    .map((row) => row.measureKey);
  let capacityShortfall = 0;
  let overloadedWeeks = 0;
  for (const point of chart || []) {
    const capacity = Number(point[capacityMeasureKey] || 0);
    const load = openKeys.reduce((sum, key) => sum + Number(point[key] || 0), 0);
    if (load > capacity) {
      capacityShortfall += load - capacity;
      overloadedWeeks += 1;
    }
  }
  return { capacityShortfall, overloadedWeeks };
}

module.exports = {
  buildRccpPoKpis,
  buildRccpPoKpisPair,
  buildRccpPoKpiByOrder,
  buildRccpCapacityKpis,
  calendarDaysBetween,
};
