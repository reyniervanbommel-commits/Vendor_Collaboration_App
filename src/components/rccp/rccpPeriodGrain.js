import { isoWeekStartUtc } from './rccpUtils';

export const RCCP_PERIOD_GRAIN_WEEK = 'week';
export const RCCP_PERIOD_GRAIN_MONTH = 'month';
export const RCCP_PLANNING_DATE_REQUESTED = 'requested';
export const RCCP_PLANNING_DATE_CONFIRMED = 'confirmed';

export function parseRccpPlanningDateMode(raw) {
  return String(raw || '').toLowerCase() === RCCP_PLANNING_DATE_CONFIRMED
    ? RCCP_PLANNING_DATE_CONFIRMED
    : RCCP_PLANNING_DATE_REQUESTED;
}

export function parseRccpPeriodGrain(raw) {
  return String(raw || '').toLowerCase() === RCCP_PERIOD_GRAIN_MONTH
    ? RCCP_PERIOD_GRAIN_MONTH
    : RCCP_PERIOD_GRAIN_WEEK;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Calendar month of the Monday that starts the ISO week.
 * @returns {{ year: number, month: number, key: string }}
 */
export function monthBucketFromIsoWeek(year, week) {
  const monday = isoWeekStartUtc(year, week);
  const calendarYear = monday.getUTCFullYear();
  const month = monday.getUTCMonth() + 1;
  return {
    year: calendarYear,
    month,
    key: `${calendarYear}-M${pad2(month)}`,
  };
}

function sumQty(group, field) {
  return group.reduce((sum, cell) => sum + (Number(cell[field]) || 0), 0);
}

/** Same measure and week from several vendors becomes one summed cell. */
function mergeVendorCells(group) {
  if (group.length < 2) return group[0];
  const worst = worstStatus(group);
  return {
    ...worst,
    confirmedQty: sumQty(group, 'confirmedQty'),
    availableQty: sumQty(group, 'availableQty'),
    remainingQty: sumQty(group, 'remainingQty'),
  };
}

function buildCellMap(cells) {
  const grouped = new Map();
  for (const cell of cells || []) {
    const token = cell.periodMonth || cell.isoWeek;
    const key = `${cell.measureKey}|${cell.periodYear}|${token}`;
    const list = grouped.get(key);
    if (list) list.push(cell);
    else grouped.set(key, [cell]);
  }
  const map = new Map();
  for (const [key, group] of grouped) map.set(key, mergeVendorCells(group));
  return map;
}

const SKIP_CHART_KEYS = new Set([
  'key', 'year', 'week', 'month', 'lastWeek', 'lastYear',
  'segmentsAbove', 'segmentsBelow', '__overloaded__',
  '__stackAbove', '__stackBelow', '__openColor', '__receivedColor',
  '__barWidthAbove', '__barWidthBelow',
]);

function mergeSegments(lists) {
  const map = new Map();
  for (const segment of lists.flat()) {
    if (!segment) continue;
    const id = `${segment.itemNumber}\0${segment.status}\0${Number(Boolean(segment.late))}\0${Number(Boolean(segment.onTime))}\0${Number(Boolean(segment.planned1900))}`;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, { ...segment, qty: Number(segment.qty) || 0 });
      continue;
    }
    prev.qty += Number(segment.qty) || 0;
    prev.late = Boolean(prev.late || segment.late);
    prev.onTime = Boolean(prev.onTime || segment.onTime);
    prev.planned1900 = Boolean(prev.planned1900 || segment.planned1900);
    if (!prev.dataAreaId && segment.dataAreaId) prev.dataAreaId = segment.dataAreaId;
  }
  return [...map.values()].sort((a, b) => {
    const byStatus = Number(a.status === 'open') - Number(b.status === 'open');
    if (byStatus) return byStatus;
    return String(a.itemNumber || '').localeCompare(String(b.itemNumber || ''));
  });
}

function sumChartGroup(points, bucket, first, last) {
  const next = {
    key: bucket.key,
    year: bucket.year,
    week: first.week,
    month: bucket.month,
    lastWeek: last.week,
    lastYear: last.year,
    segmentsAbove: mergeSegments(points.map((point) => point.segmentsAbove || [])),
    segmentsBelow: mergeSegments(points.map((point) => point.segmentsBelow || [])),
  };
  for (const point of points) {
    Object.keys(point).forEach((key) => {
      if (SKIP_CHART_KEYS.has(key)) return;
      const value = point[key];
      if (typeof value !== 'number') return;
      next[key] = (Number(next[key]) || 0) + value;
    });
  }
  const capacity = Number(next.__capacity__) || 0;
  const load = Object.entries(next).reduce((sum, [key, value]) => {
    if (SKIP_CHART_KEYS.has(key) || key.startsWith('__') || typeof value !== 'number' || value <= 0) {
      return sum;
    }
    return sum + value;
  }, 0);
  next.__overloaded__ = capacity > 0 && load > capacity;
  return next;
}

const STATUS_RANK = { red: 3, orange: 2, green: 1, grey: 0 };

function worstStatus(cells) {
  return cells.reduce((best, cell) => {
    const rank = STATUS_RANK[cell.statusColor] || 0;
    if (rank > (STATUS_RANK[best.statusColor] || 0)) return cell;
    return best;
  }, cells[0] || {});
}

function sumCellGroup(group, bucket) {
  return {
    ...mergeVendorCells(group),
    periodYear: bucket.year,
    isoWeek: bucket.month,
    periodMonth: bucket.month,
  };
}

function groupByMonthKey(items, getYearWeek) {
  const groups = [];
  const indexByKey = new Map();
  for (const item of items) {
    const { year, week } = getYearWeek(item);
    const bucket = monthBucketFromIsoWeek(year, week);
    let group = indexByKey.get(bucket.key);
    if (!group) {
      group = { bucket, items: [] };
      indexByKey.set(bucket.key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/**
 * Week grain returns the source series. Month grain rolls ISO weeks into
 * calendar months (Monday of each week) for the capacity chart and matrix.
 */
export function resolveRccpChartView({ grain, periods, chart, cells }) {
  const safePeriods = periods || [];
  const safeChart = chart || [];
  const safeCells = cells || [];
  if (grain !== RCCP_PERIOD_GRAIN_MONTH) {
    return { periods: safePeriods, chart: safeChart, cellMap: buildCellMap(safeCells) };
  }

  const periodGroups = groupByMonthKey(safePeriods, (period) => ({
    year: period.year, week: period.week,
  }));
  const chartByKey = new Map(safeChart.map((point) => [point.key, point]));
  const nextPeriods = periodGroups.map(({ bucket, items }) => {
    const first = items[0];
    const last = items[items.length - 1];
    return {
      year: bucket.year,
      month: bucket.month,
      key: bucket.key,
      week: first.week,
      lastWeek: last.week,
      lastYear: last.year,
    };
  });
  const nextChart = periodGroups.map(({ bucket, items }) => {
    const points = items.map((period) => chartByKey.get(period.key)).filter(Boolean);
    const first = items[0];
    const last = items[items.length - 1];
    return sumChartGroup(points, bucket, first, last);
  });
  const cellGroups = groupByMonthKey(safeCells, (cell) => ({
    year: cell.periodYear, week: cell.isoWeek,
  }));
  const cellsByMonthMeasure = new Map();
  for (const { bucket, items } of cellGroups) {
    const byMeasure = new Map();
    for (const cell of items) {
      const list = byMeasure.get(cell.measureKey) || [];
      list.push(cell);
      byMeasure.set(cell.measureKey, list);
    }
    cellsByMonthMeasure.set(bucket.key, { bucket, byMeasure });
  }
  const nextCells = [];
  for (const period of nextPeriods) {
    const group = cellsByMonthMeasure.get(period.key);
    if (!group) continue;
    for (const measureCells of group.byMeasure.values()) {
      nextCells.push(sumCellGroup(measureCells, group.bucket));
    }
  }

  return { periods: nextPeriods, chart: nextChart, cellMap: buildCellMap(nextCells) };
}

/** Both load-date modes, requested first — the order the chart and matrix render them in. */
export const RCCP_PLANNING_DATE_MODES = [
  RCCP_PLANNING_DATE_REQUESTED,
  RCCP_PLANNING_DATE_CONFIRMED,
];

/**
 * Active load-date modes as a `{ requested, confirmed }` flag pair. Accepts the legacy single
 * mode string, an array of modes, or an already-parsed flag object. At least one mode stays on:
 * an empty selection falls back to requested.
 * @returns {{ requested: boolean, confirmed: boolean }}
 */
export function parseRccpPlanningDateModes(raw) {
  let requested = false;
  let confirmed = false;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const mode = String(entry || '').toLowerCase();
      if (mode === RCCP_PLANNING_DATE_REQUESTED) requested = true;
      if (mode === RCCP_PLANNING_DATE_CONFIRMED) confirmed = true;
    }
  } else if (raw && typeof raw === 'object') {
    requested = Boolean(raw.requested);
    confirmed = Boolean(raw.confirmed);
  } else if (raw) {
    const mode = parseRccpPlanningDateMode(raw);
    requested = mode === RCCP_PLANNING_DATE_REQUESTED;
    confirmed = mode === RCCP_PLANNING_DATE_CONFIRMED;
  }
  if (!requested && !confirmed) return { requested: true, confirmed: false };
  return { requested, confirmed };
}

/** Active modes as a list, requested first. Never empty. */
export function rccpPlanningDateModeList(modes) {
  const flags = parseRccpPlanningDateModes(modes);
  return RCCP_PLANNING_DATE_MODES.filter((mode) => flags[mode]);
}

/** The mode that drives KPIs, capacity rows and the primary chart series. */
export function primaryRccpPlanningDateMode(modes) {
  return rccpPlanningDateModeList(modes)[0];
}

/** The overlay mode, or null when only one mode is active. */
export function secondaryRccpPlanningDateMode(modes) {
  return rccpPlanningDateModeList(modes)[1] || null;
}

/** True when both series must be drawn side by side. */
export function isRccpDualPlanningDate(modes) {
  const flags = parseRccpPlanningDateModes(modes);
  return flags.requested && flags.confirmed;
}

/**
 * Flip one mode on or off. Turning off the last active mode is ignored — the chart always
 * shows at least one load date.
 */
export function toggleRccpPlanningDateMode(modes, mode, on) {
  const flags = parseRccpPlanningDateModes(modes);
  const key = String(mode || '').toLowerCase();
  if (key !== RCCP_PLANNING_DATE_REQUESTED && key !== RCCP_PLANNING_DATE_CONFIRMED) return flags;
  const next = { ...flags, [key]: Boolean(on) };
  if (!next.requested && !next.confirmed) return flags;
  return next;
}

/** Superscript marker shown behind a matrix quantity for its load-date mode. */
export function rccpPlanningDateMarker(mode) {
  return parseRccpPlanningDateMode(mode) === RCCP_PLANNING_DATE_CONFIRMED ? 'C' : 'R';
}
