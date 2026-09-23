// Pure filter-/operator-helpers voor de PO-tabel én de BI-builder.
// Geen React/side effects, dus los unit-testbaar. De semantiek is bewust identiek aan de
// server-side aggregatie (server/utils/biAggregate.js) zodat een filter in de tabel exact
// hetzelfde resultaat geeft als in een grafiek (#AB:220).

import { columnUsesNumberSemantics } from './datePeriodColumnUtils';
import { dateMatchesFilter } from './dateFilterUtils';
import { matchTextFilterWithPurchStatusAlias, shouldMatchPurchStatusAlias } from './purchStatusDisplay';

// Kleurfilter (client-only): matcht op de getoonde celkleur (status/conditional
// formatting). Bewust NIET onderdeel van columnValueMatchesFilter, want kleur wordt
// client-side afgeleid en heeft geen server/BI-tegenhanger (biAggregate.js).
export const COLOR_FILTER_OPERATOR = 'colorIs';

export const TEXT_FILTER_OPERATORS = {
  equals: 'is exactly',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  notStartsWith: 'does not start with',
  oneOf: 'is one of',
};

export const REMARKS_FILTER_OPERATORS = {
  contains: 'contains',
  hasComment: 'has a comment',
};

export const DATE_FILTER_OPERATORS = {
  equals: 'is exactly',
  before: 'is before',
  after: 'is after',
  between: 'is between',
  inNextWeeks: 'is in the next xx weeks',
  inNextDays: 'is in the next xx days',
  nextWeek: 'is next week',
};

export const NUMBER_FILTER_OPERATORS = {
  equals: 'is exactly',
  oneOf: 'is one of',
  gt: 'is greater than',
  lt: 'is less than',
  gte: 'is greater than or equal to',
  lte: 'is less than or equal to',
  between: 'is between',
};

// filterDataType wordt gezet voor "Push values to header"-kolommen wiens gekoppelde
// line-kolom een datum is (die headers zijn zelf dataType 'text' — #AB:date-filter).
export function isDateColumn(column) {
  return column?.dataType === 'date' || column?.filterDataType === 'date';
}

export function isNumberColumn(column) {
  return column?.dataType === 'number';
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function parseOneOfValues(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function parseNumberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// Zet een legacy kommagescheiden 'oneOf'-string om naar een array met behoud van originele
// casing/spelling (voor weergave als chips) — matching normaliseert apart via normalizeText.
// Commas gevolgd door een spatie (bijv. "Acme, Inc.") worden als onderdeel van de waarde
// beschouwd; alleen bare commas worden als scheidingsteken gebruikt.
function splitLegacyOneOfString(value) {
  const parts = String(value || '').split(',');
  const result = [];
  for (const part of parts) {
    if (part.startsWith(' ') && result.length > 0) {
      result[result.length - 1] += ',' + part;
    } else {
      result.push(part);
    }
  }
  return result.map((part) => part.trim()).filter(Boolean);
}

function normalizeOneOfValue(rawValue) {
  if (Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue === 'string' && rawValue) return splitLegacyOneOfString(rawValue);
  return [];
}

// Bepaalt het standaard filter-model voor een kolomtype.
export function resolveFilterModel(column, filter, datePeriodDisplayModes = {}) {
  if (filter?.operator === COLOR_FILTER_OPERATOR) {
    return {
      operator: COLOR_FILTER_OPERATOR,
      colors: Array.isArray(filter.colors) ? filter.colors.filter(Boolean) : [],
      value: '',
      secondaryValue: '',
    };
  }
  if (filter?.operator === 'oneOf') {
    return {
      operator: 'oneOf',
      value: normalizeOneOfValue(filter.value),
      secondaryValue: '',
    };
  }
  if (isDateColumn(column)) {
    return {
      operator: filter?.operator || 'before',
      value: filter?.value || '',
      secondaryValue: filter?.secondaryValue || '',
    };
  }
  if (columnUsesNumberSemantics(column, datePeriodDisplayModes)) {
    return {
      operator: filter?.operator || 'equals',
      value: filter?.value || '',
      secondaryValue: filter?.secondaryValue || '',
    };
  }
  return {
    operator: filter?.operator || 'contains',
    value: filter?.value || '',
    secondaryValue: '',
  };
}

export function hasActiveFilter(column, filter, datePeriodDisplayModes = {}) {
  if (!filter) return false;
  if (filter.operator === COLOR_FILTER_OPERATOR) {
    return Array.isArray(filter.colors) && filter.colors.length > 0;
  }
  if (filter.operator === 'oneOf') {
    return Array.isArray(filter.value) && filter.value.length > 0;
  }
  if (isDateColumn(column)) {
    if (filter.operator === 'nextWeek') return true;
    if (filter.operator === 'between') return Boolean(filter.value && filter.secondaryValue);
    if (filter.operator === 'equals' && filter.value === '') return true;
    return Boolean(filter.value);
  }
  if (columnUsesNumberSemantics(column, datePeriodDisplayModes)) {
    if (filter.operator === 'between') return Boolean(filter.value !== '' && filter.secondaryValue !== '');
    return filter.value !== '' && filter.value !== null && filter.value !== undefined;
  }
  if (column?.dataType === 'remarks' && filter.operator === 'hasComment') return true;
  if (filter.operator === 'equals' && filter.value === '') return true;
  return Boolean(filter.value);
}

export function textMatchesFilter(rawValue, filter) {
  const normalized = normalizeText(rawValue);
  if (filter.operator === 'oneOf') {
    const options = (Array.isArray(filter.value) ? filter.value : parseOneOfValues(filter.value))
      .map(normalizeText);
    return options.length ? options.includes(normalized) : true;
  }
  const query = normalizeText(filter.value);
  if (!query && filter.operator !== 'equals') return true;
  if (filter.operator === 'equals') return normalized === query;
  if (filter.operator === 'contains') return normalized.includes(query);
  if (filter.operator === 'notContains') return !normalized.includes(query);
  if (filter.operator === 'startsWith') return normalized.startsWith(query);
  if (filter.operator === 'notStartsWith') return !normalized.startsWith(query);
  return true;
}

export function numberMatchesFilter(rawValue, filter) {
  if (filter.operator === 'oneOf') {
    const targets = (Array.isArray(filter.value) ? filter.value : [])
      .map(parseNumberValue)
      .filter((num) => num !== null);
    if (!targets.length) return true;
    const rowNum = parseNumberValue(rawValue);
    if (rowNum === null) return false;
    return targets.includes(rowNum);
  }
  if (filter.operator === 'between') {
    const from = parseNumberValue(filter.value);
    const to = parseNumberValue(filter.secondaryValue);
    if (from === null || to === null) return true;
    const rowNum = parseNumberValue(rawValue);
    if (rowNum === null) return false;
    return rowNum >= Math.min(from, to) && rowNum <= Math.max(from, to);
  }
  const target = parseNumberValue(filter.value);
  if (target === null) return true;
  const rowNum = parseNumberValue(rawValue);
  if (rowNum === null) return false;
  if (filter.operator === 'equals') return rowNum === target;
  if (filter.operator === 'gt') return rowNum > target;
  if (filter.operator === 'lt') return rowNum < target;
  if (filter.operator === 'gte') return rowNum >= target;
  if (filter.operator === 'lte') return rowNum <= target;
  return true;
}

export function isRemarksSearchTermValid(value) {
  const term = String(value ?? '').trim();
  return term.length >= 2 && term.length <= 200;
}

// De Remarks-kolom kent twee operators: 'contains' (zoekterm van 2-200 tekens verplicht) en
// 'hasComment' (geen zoekterm nodig — matcht rijen met minstens één actieve remark).
export function isRemarksFilterOperatorReady(operator, value) {
  if (operator === 'hasComment') return true;
  return isRemarksSearchTermValid(value);
}

// Dispatcht op kolomtype naar de juiste match-functie.
export function columnValueMatchesFilter(column, rawValue, filter, datePeriodDisplayModes = {}) {
  if (column?.dataType === 'remarks') return true;
  if (isDateColumn(column)) return dateMatchesFilter(rawValue, filter);
  if (columnUsesNumberSemantics(column, datePeriodDisplayModes)) return numberMatchesFilter(rawValue, filter);
  if (shouldMatchPurchStatusAlias(column, rawValue, filter)) {
    return matchTextFilterWithPurchStatusAlias(rawValue, filter, textMatchesFilter);
  }
  return textMatchesFilter(rawValue, filter);
}

/**
 * Filtert items op alle actieve waarde-filters, met uitzondering van het filter op
 * `excludeColumnKey` en van kleurfilters (colorIs — die hebben de volledige rij + format-regels
 * nodig, niet alleen de ruwe celwaarde, en vallen buiten deze cascading-berekening).
 */
export function filterItemsByColumnFilters(items, columns, filterByColumn, datePeriodDisplayModes = {}, excludeColumnKey = null) {
  const activeFilters = columns
    .filter((column) => column.key !== excludeColumnKey)
    .map((column) => [column, resolveFilterModel(column, filterByColumn?.[column.key], datePeriodDisplayModes)])
    .filter(([column, filter]) => (
      filter.operator !== COLOR_FILTER_OPERATOR && hasActiveFilter(column, filter, datePeriodDisplayModes)
    ));
  if (!activeFilters.length) return items;
  return items.filter((item) => activeFilters.every(([column, filter]) => (
    columnValueMatchesFilter(column, item?.values?.[column.key], filter, datePeriodDisplayModes)
  )));
}

/**
 * Zet een ruwe celwaarde om naar de filterwaarde die in filterByColumn wordt opgeslagen.
 */
export function serializeRawValueForFilter(column, rawValue) {
  if (rawValue === null || rawValue === undefined) return '';
  if (isDateColumn(column)) {
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) return String(rawValue);
    return `${parsed.getFullYear()}-${padDatePart(parsed.getMonth() + 1)}-${padDatePart(parsed.getDate())}`;
  }
  return String(rawValue);
}

/**
 * Bouwt een equals-filter op basis van de ruwe celwaarde.
 */
export function buildFilterFromCellValue(column, rawValue) {
  return {
    operator: 'equals',
    value: serializeRawValueForFilter(column, rawValue),
    secondaryValue: '',
  };
}

/**
 * Bepaalt of het contextmenu op een cel uitgeschakeld moet zijn.
 */
export function isCellContextMenuDisabled(column) {
  if (!column?.key) return true;
  return false;
}

/**
 * Kopieert een celwaarde naar het klembord.
 */
export async function copyCellValueToClipboard(column, rawValue) {
  const text = serializeRawValueForFilter(column, rawValue);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}
