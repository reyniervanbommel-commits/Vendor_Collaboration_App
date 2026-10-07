// Helpers voor "filter by color" in het PO-board kolommenu.
// De effectieve celkleur volgt exact dezelfde volgorde als de weergave in
// PurchaseOrderBoardRow (cell-format wint, anders de status-kleur). Row-target
// format-regels zijn rij-breed en tellen bewust niet mee voor een kolom-kleurfilter.

import { evalFormatRules } from './columnFormatRuleUtils';
import { isStatusColumn, normalizeStatusOptions, resolveStatusCellColor } from '../../utils/statusColumnUtils';
import { COLOR_FILTER_OPERATOR } from '../../utils/tableViewFilterUtils';

import { HEX_COLOR_PATTERN } from '../../utils/hexColor';

// Sentinel voor "rijen zonder opmaakkleur/status".
export const NO_COLOR_FILTER_VALUE = 'none';

export { COLOR_FILTER_OPERATOR };

function normalizeHex(value) {
  const hex = String(value || '').trim().toLowerCase();
  return HEX_COLOR_PATTERN.test(hex) ? hex : '';
}

/**
 * Bepaalt de kleur die een cel in deze kolom toont, voor kleurfiltering.
 * Lege cellen (geen status/geen match) leveren '' op en filteren dus niet mee.
 */
export function resolveColumnFilterCellColor(column, order, ruleSet) {
  if (!order || order.removedInD365) return '';
  const statusOptions = isStatusColumn(column) ? column.options : null;
  if (ruleSet?.target === 'cell') {
    const cellColor = evalFormatRules(order?.values?.[column.key], ruleSet, order?.values || {}, statusOptions);
    if (cellColor) return normalizeHex(cellColor);
  }
  if (isStatusColumn(column)) {
    const raw = order?.values?.[column.key];
    if (raw === null || raw === undefined || String(raw).trim() === '') return '';
    return normalizeHex(resolveStatusCellColor(raw, column.options));
  }
  return '';
}

/**
 * De rij-kleur die een order toont door een row-target conditional-formatting regel
 * (op welke kolom dan ook). Spiegelt resolveRowFormatColor uit PurchaseOrderBoardRow.
 */
export function resolveRowFilterColor(order, columns = [], columnFormatRules = {}) {
  if (!order || order.removedInD365) return '';
  for (const column of (columns || [])) {
    const ruleSet = columnFormatRules[column.key];
    if (ruleSet?.target !== 'row') continue;
    const statusOptions = isStatusColumn(column) ? column.options : null;
    const color = evalFormatRules(order?.values?.[column.key], ruleSet, order?.values || {}, statusOptions);
    if (color) return normalizeHex(color);
  }
  return '';
}

/** Alle kleuren uit row-target regelsets over alle kolommen heen. */
export function getRowFormatFilterColors(columns = [], columnFormatRules = {}) {
  const colors = [];
  (columns || []).forEach((column) => {
    const ruleSet = columnFormatRules[column.key];
    if (ruleSet?.target !== 'row' || !Array.isArray(ruleSet.rules)) return;
    ruleSet.rules.forEach((rule) => {
      const hex = normalizeHex(rule.color);
      if (hex) colors.push(hex);
    });
  });
  return Array.from(new Set(colors));
}

/**
 * De kleuren die als filter-swatches worden aangeboden voor deze kolom:
 * status-optie-kleuren of de kleuren uit een cell-target format-regelset.
 */
export function getColumnAvailableFilterColors(column, ruleSet) {
  const colors = [];
  if (isStatusColumn(column)) {
    normalizeStatusOptions(column.options).forEach((option) => {
      const hex = normalizeHex(option.color);
      if (hex) colors.push(hex);
    });
  }
  if (ruleSet?.target === 'cell' && Array.isArray(ruleSet.rules)) {
    ruleSet.rules.forEach((rule) => {
      const hex = normalizeHex(rule.color);
      if (hex) colors.push(hex);
    });
  }
  return Array.from(new Set(colors));
}

export function columnSupportsColorFilter(column, ruleSet) {
  return getColumnAvailableFilterColors(column, ruleSet).length > 0;
}

/** True wanneer een filter een actief kleurfilter is. */
export function isColorFilterActive(filter) {
  return Boolean(filter && Array.isArray(filter.colors) && filter.colors.length > 0);
}

/** Normaliseert een lijst kleuren tot geldige, unieke hex-waarden (+ de 'none'-sentinel). */
export function normalizeFilterColors(colors) {
  if (!Array.isArray(colors)) return [];
  const normalized = colors
    .map((entry) => (entry === NO_COLOR_FILTER_VALUE ? NO_COLOR_FILTER_VALUE : normalizeHex(entry)))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}
