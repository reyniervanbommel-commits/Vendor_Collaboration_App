'use strict';

/**
 * PO-segmenten voor de RCCP Capacity vs load-grafiek.
 * Puur: geen Date.now, geen RccpAnalysisService-import.
 */

const { getIsoWeek, getIsoWeekYear, isoWeekKey, buildWeekRange } = require('./isoWeek');
const {
  toNumber,
  pickValue,
  pickConfiguredValue,
  resolveLineMeasureQty,
  isHeaderOnlyMeasure,
  lineDateValue,
  isSentinelDate,
  parsePlanningDateMode,
  planningDateValue,
  collectDateSlots,
  collectPlanningSlots,
} = require('./rccpPoRow');
const { calendarDaysBetween } = require('./rccpKpis');

function compareIsoWeek(aYear, aWeek, bYear, bWeek) {
  if (aYear !== bYear) return aYear - bYear;
  return aWeek - bWeek;
}

function emptyWeekBucket() {
  return new Map();
}

function lineItemNumber(lineValues, masterValues) {
  return String(pickValue(lineValues, 'itemNumber') ?? pickValue(masterValues, 'itemNumber') ?? '').trim();
}

function resolveDataAreaId(row, masterValues) {
  const fromRow = String(row?.partitionKey || row?.dataAreaId || '').trim();
  if (fromRow) return fromRow;
  return String(pickValue(masterValues, 'dataAreaId') || '').trim();
}

function bump(weekMap, week, itemNumber, status, qty, late = false, dataAreaId = '', flags = {}) {
  if (!(qty > 0) || !week) return;
  let itemMap = weekMap.get(week);
  if (!itemMap) {
    itemMap = emptyWeekBucket();
    weekMap.set(week, itemMap);
  }
  const poNumber = flags.poNumber || '';
  const key = `${poNumber}\0${itemNumber}`;
  const current = itemMap.get(key) || {
    poNumber,
    itemNumber,
    open: 0, received: 0, ordered: 0, late: false, receivedLate: false, receivedOnTime: false,
    planned1900: false, dataAreaId: '',
  };
  if (!current.dataAreaId && dataAreaId) current.dataAreaId = dataAreaId;
  current.planned1900 = current.planned1900 || Boolean(flags.planned1900);
  if (status === 'open') {
    current.open += qty;
    current.late = current.late || Boolean(late);
  } else if (status === 'ordered') {
    current.ordered += qty;
  } else {
    current.received += qty;
    current.receivedLate = current.receivedLate || Boolean(late);
    current.receivedOnTime = current.receivedOnTime || Boolean(flags.onTime);
  }
  itemMap.set(key, current);
}

function emitSegment(itemNumber, qty, status, late, dataAreaId, flags = {}) {
  return {
    itemNumber,
    poNumber: flags.poNumber || '',
    qty,
    status,
    late: Boolean(late),
    onTime: Boolean(flags.onTime),
    planned1900: Boolean(flags.planned1900),
    dataAreaId: dataAreaId || '',
  };
}

function emitAbove(itemMap) {
  const keys = [...itemMap.keys()].sort((a, b) => String(a).localeCompare(String(b)));
  const ordered = [];
  const remaining = [];
  for (const key of keys) {
    const entry = itemMap.get(key);
    const flags = { planned1900: entry.planned1900, poNumber: entry.poNumber };
    if (entry.ordered > 0) {
      ordered.push(emitSegment(entry.itemNumber, entry.ordered, 'ordered', false, entry.dataAreaId, flags));
    }
    if (entry.open > 0) {
      remaining.push(emitSegment(entry.itemNumber, entry.open, 'open', Boolean(entry.late), entry.dataAreaId, flags));
    }
  }
  return [...ordered, ...remaining];
}

function emitBelow(itemMap) {
  const keys = [...itemMap.keys()].sort((a, b) => String(a).localeCompare(String(b)));
  const out = [];
  for (const key of keys) {
    const entry = itemMap.get(key);
    if (entry.received > 0) {
      out.push(emitSegment(
        entry.itemNumber,
        entry.received,
        'received',
        Boolean(entry.receivedLate),
        entry.dataAreaId,
        { onTime: entry.receivedOnTime, planned1900: entry.planned1900, poNumber: entry.poNumber },
      ));
    }
  }
  return out;
}

function spreadHeaderQty(weekMap, slots, masterValues, status, total, lateForSlot, dataAreaId, poNumber) {
  if (!(total > 0) || !slots.length) return;
  const shareQty = total / slots.length;
  for (const slot of slots) {
    const late = typeof lateForSlot === 'function' ? lateForSlot(slot) : false;
    bump(
      weekMap,
      slot.key,
      lineItemNumber(slot.lineValues, masterValues),
      status,
      shareQty,
      late,
      dataAreaId,
      { poNumber },
    );
  }
}

/**
 * @param {object[]} rows PO-snapshot
 * @param {object} config RCCP-config
 * @param {{ fromYear: number, fromWeek: number, toYear: number, toWeek: number }} window
 * @param {{ now: Date, vendorAccount?: string|null }} options
 * @returns {Map<string, { segmentsAbove: object[], segmentsBelow: object[] }>}
 */
function buildPoSegments(rows, config, window, { now, vendorAccount, planningDateMode } = {}) {
  const openKey = String(config.openMeasureKey || '').trim();
  const deliveredKey = String(config.deliveredMeasureKey || '').trim();
  const orderedKey = String(config.orderedMeasureKey || '').trim();
  const dateKey = config.dateColumnKey;
  const receiptKey = String(config.receiptDateColumnKey || '').trim();
  const dateMode = parsePlanningDateMode(planningDateMode);
  const vendorCol = config.vendorColumnKey;
  const excludedSet = new Set((config.excludedStatuses || []).map((s) => String(s).toLowerCase()));
  const nowYear = getIsoWeekYear(now);
  const nowWeek = getIsoWeek(now);
  const periods = buildWeekRange(window.fromYear, window.fromWeek, window.toYear, window.toWeek);
  const periodSet = new Set(periods.map((p) => p.key));

  const above = new Map();
  const below = new Map();

  const clipBump = (weekMap, week, itemNumber, status, qty, late, dataAreaId, flags) => {
    if (!periodSet.has(week)) return;
    bump(weekMap, week, itemNumber, status, qty, late, dataAreaId, flags);
  };

  for (const row of rows || []) {
    const masterValues = row.values || {};
    const poNumber = String(row.recordKey || '').trim();
    // pickConfiguredValue, niet pickValue: config-keys zijn scoped opgeslagen ("master:vendorAccount")
    // zodra de RCCP-instellingen een keer bewaard zijn. Met de rauwe key vindt niets meer een vendor
    // en verdwijnen alle PO-staven uit de grafiek.
    const vendor = String(pickConfiguredValue(masterValues, vendorCol) || '').trim();
    if (!vendor) continue;
    if (vendorAccount && vendor !== vendorAccount) continue;
    const dataAreaId = resolveDataAreaId(row, masterValues);

    const masterStatus = pickValue(masterValues, 'status') ?? pickValue(masterValues, 'purchaseOrderStatus');
    const details = (Array.isArray(row.details) ? row.details : []).filter((d) => !d.isRemoved);
    const headerOnlyOpen = Boolean(openKey && isHeaderOnlyMeasure(details, masterValues, openKey));
    const headerOnlyDelivered = Boolean(deliveredKey && isHeaderOnlyMeasure(details, masterValues, deliveredKey));
    const headerOnlyOrdered = Boolean(orderedKey && isHeaderOnlyMeasure(details, masterValues, orderedKey));
    const lineOpen = Boolean(openKey && !headerOnlyOpen);
    const lineDelivered = Boolean(deliveredKey && !headerOnlyDelivered);
    const lineOrdered = Boolean(orderedKey && !headerOnlyOrdered);
    // Mismatch: open staat op headerniveau (bv. een master-formule als "OVER") maar ordered op
    // regelniveau ("Aantal"). Het open-aandeel wordt pas na de regel-loop via spreadHeaderQty
    // toegevoegd, dus per regel is er niets om orderedQty tegen af te zetten. Zonder correctie
    // telt de 'ordered'-balk daardoor de volledige regelhoeveelheid, en komt het open-aandeel er
    // via de header-spread nog eens bovenop — "Aantal" = ordered (volledig) + open (nogmaals).
    // Fix: 'ordered' per regel hier op 0 zetten en pas na de loop, op headerniveau, het verschil
    // (totale regelhoeveelheid − header-open) over dezelfde slots verdelen — net als bij een
    // volledig header-only ordered-measure. Zo ontstaat geen scheve verdeling door ongelijke
    // regelaantallen.
    const orderedMismatchesHeaderOpen = lineOrdered && headerOnlyOpen;
    let totalOrderedQtyForHeaderOpen = 0;

    const processLine = (lineValues) => {
      const status = pickValue(lineValues, 'status') ?? masterStatus;
      if (status && excludedSet.has(String(status).toLowerCase())) return;

      const itemNumber = lineItemNumber(lineValues, masterValues);
      const plannedDate = planningDateValue(
        lineValues, masterValues, dateKey, config.confirmedDateColumnKey, dateMode,
      );
      const confirmedDate = planningDateValue(
        lineValues, masterValues, dateKey, config.confirmedDateColumnKey, 'confirmed',
      );
      const rawReceipt = receiptKey ? lineDateValue(lineValues, masterValues, receiptKey) : null;
      const hasReceipt = Boolean(rawReceipt) && !isSentinelDate(rawReceipt);
      const belowDate = hasReceipt ? rawReceipt : plannedDate;
      const planned1900 = isSentinelDate(plannedDate);
      const share = details.length ? 1 / details.length : 1;
      const openQty = lineOpen ? resolveLineMeasureQty(lineValues, masterValues, openKey, share) : 0;
      const deliveredQty = lineDelivered
        ? resolveLineMeasureQty(lineValues, masterValues, deliveredKey, share)
        : 0;
      const orderedQty = lineOrdered
        ? resolveLineMeasureQty(lineValues, masterValues, orderedKey, share)
        : 0;
      if (orderedMismatchesHeaderOpen) totalOrderedQtyForHeaderOpen += orderedQty;
      const orderedFilled = orderedMismatchesHeaderOpen
        ? 0
        : Math.max(0, orderedQty - openQty);

      if (plannedDate) {
        const plannedYear = getIsoWeekYear(plannedDate);
        const plannedWeek = getIsoWeek(plannedDate);
        if (plannedYear && plannedWeek) {
          const plannedKey = isoWeekKey(plannedYear, plannedWeek);
          const late = Boolean(
            nowYear && nowWeek && compareIsoWeek(plannedYear, plannedWeek, nowYear, nowWeek) < 0,
          );
          clipBump(above, plannedKey, itemNumber, 'ordered', orderedFilled, false, dataAreaId, { planned1900, poNumber });
          clipBump(above, plannedKey, itemNumber, 'open', openQty, late, dataAreaId, { planned1900, poNumber });
        }
      }

      if (deliveredQty > 0 && belowDate && !isSentinelDate(belowDate)) {
        const receiptYear = getIsoWeekYear(belowDate);
        const receiptWeek = getIsoWeek(belowDate);
        if (receiptYear && receiptWeek) {
          const days = plannedDate && !planned1900
            ? calendarDaysBetween(belowDate, plannedDate)
            : (confirmedDate ? calendarDaysBetween(belowDate, confirmedDate) : 0);
          clipBump(
            below,
            isoWeekKey(receiptYear, receiptWeek),
            itemNumber,
            'received',
            deliveredQty,
            days > 0,
            dataAreaId,
            { onTime: days !== null && days <= 0, planned1900, poNumber },
          );
        }
      }
    };

    if (lineOpen || lineDelivered || lineOrdered) {
      if (!details.length) processLine(masterValues);
      else {
        for (const detail of details) processLine(detail.values || {});
      }
    }

    const plannedSlots = (headerOnlyOpen || headerOnlyOrdered)
      ? collectPlanningSlots(
        details, masterValues, dateKey, config.confirmedDateColumnKey, window, excludedSet, masterStatus, dateMode,
      )
      : [];
    if (headerOnlyOpen) {
      spreadHeaderQty(
        above,
        plannedSlots,
        masterValues,
        'open',
        toNumber(pickConfiguredValue(masterValues, openKey)),
        (slot) => Boolean(nowYear && nowWeek && compareIsoWeek(slot.year, slot.week, nowYear, nowWeek) < 0),
        dataAreaId,
        poNumber,
      );
    }
    if (headerOnlyOrdered) {
      const orderedTotal = toNumber(pickConfiguredValue(masterValues, orderedKey));
      const openTotal = headerOnlyOpen ? toNumber(pickConfiguredValue(masterValues, openKey)) : 0;
      spreadHeaderQty(above, plannedSlots, masterValues, 'ordered', Math.max(0, orderedTotal - openTotal), false, dataAreaId, poNumber);
    } else if (orderedMismatchesHeaderOpen) {
      const openTotal = toNumber(pickConfiguredValue(masterValues, openKey));
      const orderedFilledTotal = Math.max(0, totalOrderedQtyForHeaderOpen - openTotal);
      spreadHeaderQty(above, plannedSlots, masterValues, 'ordered', orderedFilledTotal, false, dataAreaId, poNumber);
    }
    if (headerOnlyDelivered) {
      const deliveredTotal = toNumber(pickConfiguredValue(masterValues, deliveredKey));
      let receiptSlots = receiptKey
        ? collectDateSlots(
          details, masterValues, receiptKey, null, window, excludedSet, masterStatus,
        )
        : [];
      if (!receiptSlots.length) {
        receiptSlots = collectPlanningSlots(
          details, masterValues, dateKey, config.confirmedDateColumnKey, window, excludedSet, masterStatus, dateMode,
        );
      }
      spreadHeaderQty(below, receiptSlots, masterValues, 'received', deliveredTotal, false, dataAreaId, poNumber);
    }
  }

  const byWeek = new Map();
  for (const period of periods) {
    byWeek.set(period.key, {
      segmentsAbove: emitAbove(above.get(period.key) || emptyWeekBucket()),
      segmentsBelow: emitBelow(below.get(period.key) || emptyWeekBucket()),
    });
  }
  return byWeek;
}

function mergeSegmentsIntoChart(chart, segmentsByWeek) {
  return (chart || []).map((point) => {
    const segs = segmentsByWeek.get(point.key) || { segmentsAbove: [], segmentsBelow: [] };
    return {
      ...point,
      segmentsAbove: segs.segmentsAbove,
      segmentsBelow: segs.segmentsBelow,
    };
  });
}

module.exports = {
  buildPoSegments,
  mergeSegmentsIntoChart,
};
