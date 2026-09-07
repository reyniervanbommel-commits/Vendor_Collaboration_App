import {
  isoWeekStartUtc,
  RCCP_CHART_Y_AXIS_WIDTH,
  RCCP_WEEK_COL_WIDTH,
} from './rccpUtils';

export const RCCP_PO_BAR_SIZE = Math.round(RCCP_WEEK_COL_WIDTH * 0.75);

/**
 * De balk onder de as (received) houdt altijd deze vaste breedte — 65% van de weekkolom —
 * los van de boven-de-as-layout (normaal of dual/requested+confirmed smaller).
 */
export const RCCP_PO_BAR_SIZE_BELOW = Math.round(RCCP_WEEK_COL_WIDTH * 0.65);

/** Requested and confirmed bars overlap by a quarter of their width. */
export const RCCP_DUAL_BAR_OVERLAP = 0.25;

/**
 * Bar width used when both load dates are drawn side by side: two bars that overlap by
 * RCCP_DUAL_BAR_OVERLAP fit inside one ISO-week column, met dezelfde marge langs de weekgrens
 * als een enkele balk (RCCP_PO_BAR_SIZE is 75% van de kolom).
 */
export const RCCP_DUAL_PO_BAR_SIZE = Math.floor(
  RCCP_PO_BAR_SIZE / (2 - RCCP_DUAL_BAR_OVERLAP),
);

/**
 * Center a bar of `barWidth` inside the ISO-week band at `index`, shifted by `offset` pixels
 * (used to lay the confirmed series next to the requested one).
 */
export function weekBarBox(index, barWidth, offset = 0) {
  const bandX = RCCP_CHART_Y_AXIS_WIDTH + Number(index) * RCCP_WEEK_COL_WIDTH;
  const width = Math.min(Math.max(0, Number(barWidth) || 0), RCCP_WEEK_COL_WIDTH);
  const shift = Number(offset) || 0;
  return { x: bandX + (RCCP_WEEK_COL_WIDTH - width) / 2 + shift, width };
}

/**
 * Bar width and per-series x-offset for the load-date series. One active mode keeps the full
 * centred bar; two active modes shrink the bars and pull them apart until they overlap by
 * exactly RCCP_DUAL_BAR_OVERLAP of their width, requested on the left.
 * @param {boolean} dual
 * @returns {{ barSize: number, primaryOffset: number, secondaryOffset: number }}
 */
export function rccpLoadDateBarLayout(dual) {
  // Bij één balk boven de as (requested óf confirmed) krijgt die dezelfde 65%-breedte als de
  // balk onder de as, zodat boven en onder altijd gelijk breed zijn wanneer er niets dual is.
  if (!dual) return { barSize: RCCP_PO_BAR_SIZE_BELOW, primaryOffset: 0, secondaryOffset: 0 };
  const barSize = RCCP_DUAL_PO_BAR_SIZE;
  const shift = (barSize * (1 - RCCP_DUAL_BAR_OVERLAP)) / 2;
  return { barSize, primaryOffset: -shift, secondaryOffset: shift };
}

function utcDayDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** @returns {{ year: number, week: number, key: string, weekday: number }} weekday 1=Mon … 7=Sun */
export function isoWeekPartsUtc(date) {
  const utc = utcDayDate(date);
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const year = utc.getUTCFullYear();
  const week1Monday = isoWeekStartUtc(year, 1);
  const week1Thursday = new Date(week1Monday);
  week1Thursday.setUTCDate(week1Monday.getUTCDate() + 3);
  const week = 1 + Math.round((utc - week1Thursday) / (7 * 24 * 60 * 60 * 1000));
  return { year, week, key: `${year}-W${String(week).padStart(2, '0')}`, weekday };
}

/**
 * X-coordinate of the Today line inside the chart plot.
 * `null` when the current ISO week is not in `periods`.
 */
export function todayLineX(periods, now = new Date()) {
  const band = todayBand(periods, now);
  return band ? band.todayX : null;
}

/**
 * Current-period highlight: full column band plus the today line inside it.
 * `null` when the current period is outside the window.
 */
export function todayBand(periods, now = new Date()) {
  if (!Array.isArray(periods) || !periods.length) return null;
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let index = -1;
  let fraction = 0.5;
  if (periods[0].month) {
    const year = utc.getUTCFullYear();
    const month = utc.getUTCMonth() + 1;
    index = periods.findIndex((period) => period.year === year && period.month === month);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    fraction = (utc.getUTCDate() - 0.5) / daysInMonth;
  } else {
    const parts = isoWeekPartsUtc(now);
    index = periods.findIndex((period) => period.key === parts.key);
    fraction = (parts.weekday - 0.5) / 7;
  }
  if (index < 0) return null;
  const bandX = RCCP_CHART_Y_AXIS_WIDTH + index * RCCP_WEEK_COL_WIDTH;
  return {
    index,
    bandX,
    bandWidth: RCCP_WEEK_COL_WIDTH,
    todayX: bandX + fraction * RCCP_WEEK_COL_WIDTH,
  };
}

/** True when a matrix/chart period column is the current ISO week or calendar month. */
export function isCurrentMatrixPeriod(period, now = new Date()) {
  if (!period) return false;
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period.month) {
    return period.year === utc.getUTCFullYear() && Number(period.month) === utc.getUTCMonth() + 1;
  }
  return period.key === isoWeekPartsUtc(now).key;
}

/**
 * Recharts geeft bij negatieve waarden y = ver-einde en height < 0.
 * Normaliseer naar SVG-rect: y = top (as-kant), height > 0.
 */
export function normalizeBarBox(barY, barHeight) {
  const signed = Number(barHeight) || 0;
  const top = signed < 0 ? Number(barY) + signed : Number(barY);
  return { y: top, height: Math.abs(signed) };
}

/**
 * Stack layout from the axis outward. Segments are drawn in array order
 * (ordered filled first, then open).
 */
export function stackRectLayout(segments, barY, barHeight, side) {
  const list = Array.isArray(segments) ? segments : [];
  const total = list.reduce((sum, seg) => sum + Number(seg.qty || 0), 0);
  const { y: top, height } = normalizeBarBox(barY, barHeight);
  if (!total || !height) return [];
  let cursor = side === 'above' ? top + height : top;
  return list.map((segment) => {
    const segHeight = (Number(segment.qty || 0) / total) * height;
    if (side === 'above') cursor -= segHeight;
    const y = cursor;
    if (side === 'below') cursor += segHeight;
    return { y, height: segHeight, segment };
  });
}

/**
 * Received-vakjes onder de as en ordered-vakjes boven horen bij hetzelfde item.
 */
export function isReceivedPairHighlight(segment, highlightItem) {
  return Boolean(
    highlightItem
    && (segment?.status === 'received' || segment?.status === 'ordered')
    && segment.itemNumber === highlightItem
  );
}

const PAIR_STROKE = '#323130';

/** Confirmed load is drawn as a dark grey outline instead of a filled bar. */
export const RCCP_OUTLINE_STROKE_COLOR = '#605E5C';
export const RCCP_OUTLINE_STROKE_WIDTH = 1.5;

/** Hover pair outline only — late receipts have no extra frame. */
export function poSegmentStroke(_segment, highlighted) {
  if (highlighted) return { stroke: PAIR_STROKE, strokeWidth: 2.5 };
  return { stroke: 'none', strokeWidth: 0 };
}

/**
 * Remaining (open) against the axis, quantity (ordered) grouped at the top.
 * Remaining stays visible when quantity is toggled off.
 */
export function visibleAboveSegments(segments, { openVisible, orderedVisible } = {}) {
  const ordered = [];
  const remaining = [];
  for (const segment of segments || []) {
    if (segment?.status === 'open') {
      if (openVisible) remaining.push(segment);
    } else if (segment?.status === 'ordered') {
      if (orderedVisible) ordered.push(segment);
    }
  }
  return [...remaining, ...ordered];
}

/**
 * Steps the Y extent may snap to, as a mantissa of 10^n. Finer than 1-2-5 so the axis stays
 * close to the highest bar (1600 → 2000 instead of 5000), while every step still halves into a
 * readable mid-tick.
 */
const NICE_Y_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Snap a magnitude up to the next round step (100, 150, 200, 250, 300, 400, 500, 600, 800, …),
 * so the scale follows the data instead of jumping to the next power of ten.
 */
export function rccpNiceYExtent(value) {
  const n = Math.abs(Number(value) || 0);
  if (n === 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = 10 ** exp;
  const mantissa = n / base;
  const step = NICE_Y_STEPS.find((candidate) => mantissa <= candidate + 1e-9) || 10;
  return step * base;
}

/** Mantissas that read as a round tick step (300, 1250, 4000, …). */
const NICE_STEP_MANTISSAS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];

function isNiceStep(value) {
  const n = Math.abs(Number(value) || 0);
  if (!n) return false;
  const base = 10 ** Math.floor(Math.log10(n));
  const mantissa = n / base;
  return NICE_STEP_MANTISSAS.some((candidate) => Math.abs(candidate - mantissa) < 1e-9);
}

/** Splits `extent` into the first candidate count that lands on a round step. */
function niceTickStep(extent, counts) {
  for (const count of counts) {
    const step = extent / count;
    if (isNiceStep(step)) return step;
  }
  return extent / counts[0];
}

/**
 * Gridline and label values for the Y-axis. One list feeds both the chart's horizontal lines
 * and the sticky axis labels, so every line carries a number. Aims for four steps on a
 * zero-based axis and two per side on a symmetric one, always on round values.
 * @returns {{ extent: number, negative: boolean, step: number, ticks: number[] }}
 */
export function rccpChartYTicks(yDomain) {
  const rawMin = Number(yDomain?.[0]) || 0;
  const rawMax = Number(yDomain?.[1]) || 0;
  const extent = rccpNiceYExtent(Math.max(Math.abs(rawMin), Math.abs(rawMax)));
  const negative = rawMin < 0;
  const step = niceTickStep(extent, negative ? [2, 3, 4] : [4, 5, 3, 6]);
  const to = Math.round(extent / step);
  const from = negative ? -to : 0;
  const ticks = [];
  for (let i = to; i >= from; i -= 1) ticks.push(Math.round(i * step * 1e6) / 1e6);
  return { extent, negative, step, ticks };
}

/**
 * Y-domain for Capacity vs load. Custom PO-stack bars are ignored by Recharts 3,
 * so a negative-only received series would otherwise hide quantity above the axis.
 * With load below the axis (received) the two sides share the same absolute scale; without it
 * the axis starts at zero, so the bars use the full chart height instead of half of it.
 */
export function rccpChartYDomain(points, measureKeys = []) {
  let min = 0;
  let max = 0;
  for (const point of points || []) {
    max = Math.max(max, Number(point.__stackAbove) || 0, Number(point.__stackAboveAlt) || 0);
    min = Math.min(min, Number(point.__stackBelow) || 0);
    for (const key of measureKeys) {
      const value = Number(point[key]) || 0;
      max = Math.max(max, value);
      min = Math.min(min, value);
    }
  }
  if (min === 0 && max === 0) return [0, 1];
  const extent = rccpNiceYExtent(Math.max(Math.abs(min), Math.abs(max)));
  return min < 0 ? [-extent, extent] : [0, extent];
}

/**
 * Recharts 3 discards a numeric Y domain unless allowDataOverflow is set.
 * Without that, custom PO bars are ignored and the axis falls back to [0, auto].
 * An all-positive domain keeps the zero line at the bottom — no empty scale below the axis.
 */
export function rccpChartYAxisScale(yDomain) {
  const { extent, negative, ticks } = rccpChartYTicks(yDomain);
  return {
    type: 'number',
    domain: negative ? [-extent, extent] : [0, extent],
    allowDataOverflow: true,
    ticks: [...ticks].reverse(),
  };
}

export function rccpPoStackBarFlags({
  openVisible, orderedVisible, deliveredVisible, dual = false,
}) {
  const showAbove = Boolean(openVisible || orderedVisible || deliveredVisible);
  return {
    showAbove,
    // Tweede load-date-serie (confirmed naast requested); received onder de as blijft één reeks,
    // die volgt de ontvangstweek en niet de gekozen leverdatum.
    showAboveAlt: showAbove && Boolean(dual),
    showBelow: Boolean(deliveredVisible),
  };
}
