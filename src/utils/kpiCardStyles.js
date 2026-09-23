import { isHexColor, normalizeHexColor } from './hexColor';

export const KPI_STYLE_KEYS = Object.freeze(['delivered', 'open', 'lateDelivery', 'onTime', 'unconfirmed']);
export const KPI_CARDS_BOARD_KEY = 'kpi-cards';

/**
 * Neutral, fully opaque grays for the pie's uncolored slice. Solid (not
 * transparent) so an accent color on the other slice never bleeds through.
 */
export const KPI_PIE_GRAY = '#c4c4c4';
export const KPI_PIE_GRAY_LIGHT = '#e6e6e6';

/** Which of the 2 pie values gets the picked color; the other one stays gray. */
export const KPI_COLOR_TARGET_VALUE = 'value';
export const KPI_COLOR_TARGET_OTHER = 'other';

const DEFAULT_STYLE = Object.freeze({ color: null, colorTarget: KPI_COLOR_TARGET_VALUE });

export function defaultKpiCardStyle() {
  return DEFAULT_STYLE;
}

function colorTargetValue(value) {
  return value === KPI_COLOR_TARGET_OTHER ? KPI_COLOR_TARGET_OTHER : KPI_COLOR_TARGET_VALUE;
}

function colorValue(value) {
  return isHexColor(value) ? normalizeHexColor(value) : null;
}

export function normalizeKpiCardStyle(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    color: colorValue(input.color),
    colorTarget: colorTargetValue(input.colorTarget),
  };
}

export function normalizeKpiCardStyles(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const next = {};
  KPI_STYLE_KEYS.forEach((key) => {
    next[key] = normalizeKpiCardStyle(input[key]);
  });
  return next;
}
