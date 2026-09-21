'use strict';

const {
  formatPurchStatusDisplay,
  isPurchaseOrderStatusColumn,
  matchTextFilterWithPurchStatusAlias,
  shouldMatchPurchStatusAlias,
} = require('./purchStatusDisplay');

// Pure aggregatie-laag voor de BI-feature (#AB:219 / #AB:220).
// rows in → chart-ready series out. Geen I/O, dus los unit-testbaar.
//
// De filter-operator-semantiek is IDENTIEK aan de client (usePurchaseOrderTableView /
// tableViewFilterUtils), zodat een `>`-filter in de tabel exact hetzelfde resultaat geeft
// als in een grafiek (#AB:220-acceptatiecriterium).

const AGGREGATIONS = Object.freeze(['sum', 'avg', 'count', 'min', 'max']);
const CHART_TYPES = Object.freeze(['bar', 'line', 'pie', 'kpi']);
const DATE_GROUPINGS = Object.freeze(['none', 'day', 'week', 'month', 'year']);
const MAX_MEASURES = 5;
const MAX_GROUPS = 200;

function isDateType(dataType) {
  return dataType === 'date';
}

function isNumberType(dataType) {
  return dataType === 'number';
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function textMatchesPlain(rawValue, filter) {
  const normalized = normalizeText(rawValue);
  const query = normalizeText(filter.value);
  if (!query && filter.operator !== 'oneOf' && filter.operator !== 'equals') return true;
  switch (filter.operator) {
    case 'equals': return normalized === query;
    case 'contains': return normalized.includes(query);
    case 'notContains': return !normalized.includes(query);
    case 'startsWith': return normalized.startsWith(query);
    case 'notStartsWith': return !normalized.startsWith(query);
    case 'oneOf': {
      const options = String(filter.value || '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
      return options.length ? options.includes(normalized) : true;
    }
    default: return true;
  }
}

function textMatches(rawValue, filter) {
  if (shouldMatchPurchStatusAlias(null, rawValue, filter)) {
    return matchTextFilterWithPurchStatusAlias(rawValue, filter, textMatchesPlain);
  }
  return textMatchesPlain(rawValue, filter);
}

function numberMatches(rawValue, filter) {
  const rowNum = parseNumber(rawValue);
  const target = parseNumber(filter.value);
  if (filter.operator === 'between') {
    const from = parseNumber(filter.value);
    const to = parseNumber(filter.secondaryValue);
    if (from === null || to === null) return true;
    if (rowNum === null) return false;
    return rowNum >= Math.min(from, to) && rowNum <= Math.max(from, to);
  }
  if (target === null) return true;
  if (rowNum === null) return false;
  switch (filter.operator) {
    case 'equals': return rowNum === target;
    case 'gt': return rowNum > target;
    case 'lt': return rowNum < target;
    case 'gte': return rowNum >= target;
    case 'lte': return rowNum <= target;
    default: return true;
  }
}

function dateMatches(rawValue, filter) {
  const rowTime = parseDate(rawValue);
  const target = parseDate(filter.value);
  if (filter.operator === 'between') {
    const from = parseDate(filter.value);
    const to = parseDate(filter.secondaryValue);
    if (from === null || to === null) return true;
    if (rowTime === null) return false;
    return rowTime >= Math.min(from, to) && rowTime <= Math.max(from, to);
  }
  if (target === null) return true;
  if (rowTime === null) return false;
  if (filter.operator === 'before') return rowTime < target;
  if (filter.operator === 'after') return rowTime > target;
  if (filter.operator === 'equals') {
    const a = new Date(rowTime);
    const b = new Date(target);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  return true;
}

// Past één filter toe op een celwaarde, met de juiste semantiek voor het kolomtype.
function matchesFilter(rawValue, filter, dataType) {
  if (!filter || !filter.operator) return true;
  if (isDateType(dataType)) return dateMatches(rawValue, filter);
  if (isNumberType(dataType)) return numberMatches(rawValue, filter);
  return textMatches(rawValue, filter);
}

function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function groupLabelForDate(rawValue, grouping) {
  const time = parseDate(rawValue);
  if (time === null) return '(none)';
  const d = new Date(time);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (grouping === 'year') return `${yyyy}`;
  if (grouping === 'month') return `${yyyy}-${mm}`;
  if (grouping === 'week') return isoWeekLabel(d);
  return `${yyyy}-${mm}-${dd}`;
}

function resolveMeasures(config) {
  if (!config || typeof config !== 'object') return [];
  if (Array.isArray(config.measures) && config.measures.length) {
    return config.measures.slice(0, MAX_MEASURES).filter(Boolean);
  }
  return config.measure ? [config.measure] : [];
}

function groupLabel(rawValue, column, dateGrouping) {
  if (column && isDateType(column.dataType) && dateGrouping && dateGrouping !== 'none') {
    return groupLabelForDate(rawValue, dateGrouping);
  }
  if (rawValue === null || rawValue === undefined || rawValue === '') return '(none)';
  if (isPurchaseOrderStatusColumn(column)) {
    return formatPurchStatusDisplay(rawValue) || String(rawValue);
  }
  return String(rawValue);
}

function applyAggregation(aggregation, acc) {
  switch (aggregation) {
    case 'count': return acc.count;
    case 'sum': return acc.sum;
    case 'avg': return acc.count ? acc.sum / acc.count : 0;
    case 'min': return acc.min === null ? 0 : acc.min;
    case 'max': return acc.max === null ? 0 : acc.max;
    default: return acc.sum;
  }
}

// Bereken de series voor één chart-config over de (al gefilterde) dataset.
function computeSeries(rows, columnByKey, config) {
  const dimensionCol = columnByKey.get(config.dimension) || null;
  const measureKeys = resolveMeasures(config);
  const aggregation = AGGREGATIONS.includes(config.aggregation) ? config.aggregation : 'sum';
  const dateGrouping = DATE_GROUPINGS.includes(config.dateGrouping) ? config.dateGrouping : 'none';
  const multiMeasure = measureKeys.length > 1;

  const filters = Array.isArray(config.filters) ? config.filters : [];
  const groups = new Map();

  for (const row of rows) {
    const values = row.values || {};
    let keep = true;
    for (const f of filters) {
      const col = columnByKey.get(f.columnKey);
      if (!col) continue;
      if (!matchesFilter(values[f.columnKey], f, col.dataType)) { keep = false; break; }
    }
    if (!keep) continue;

    const label = groupLabel(dimensionCol ? values[config.dimension] : '(all)', dimensionCol, dateGrouping);
    if (!groups.has(label)) {
      groups.set(label, multiMeasure
        ? Object.fromEntries(measureKeys.map((key) => [key, { count: 0, sum: 0, min: null, max: null }]))
        : { count: 0, sum: 0, min: null, max: null });
    }
    const acc = groups.get(label);

    if (aggregation === 'count' || !measureKeys.length) {
      const bucket = multiMeasure ? acc[measureKeys[0]] || acc : acc;
      bucket.count += 1;
      continue;
    }

    if (multiMeasure) {
      for (const measureKey of measureKeys) {
        const measureCol = columnByKey.get(measureKey) || null;
        const bucket = acc[measureKey];
        bucket.count += 1;
        if (measureCol) {
          const num = parseNumber(values[measureKey]);
          if (num !== null) {
            bucket.sum += num;
            bucket.min = bucket.min === null ? num : Math.min(bucket.min, num);
            bucket.max = bucket.max === null ? num : Math.max(bucket.max, num);
          }
        }
      }
      continue;
    }

    const measureCol = columnByKey.get(measureKeys[0]) || null;
    acc.count += 1;
    if (aggregation !== 'count' && measureCol) {
      const num = parseNumber(values[measureKeys[0]]);
      if (num !== null) {
        acc.sum += num;
        acc.min = acc.min === null ? num : Math.min(acc.min, num);
        acc.max = acc.max === null ? num : Math.max(acc.max, num);
      }
    }
  }

  let series;
  if (multiMeasure) {
    series = Array.from(groups.entries()).map(([name, measureAccs]) => {
      const point = { name };
      measureKeys.forEach((measureKey) => {
        const value = Math.round(applyAggregation(aggregation, measureAccs[measureKey]) * 100) / 100;
        point[measureKey] = value;
      });
      point.value = point[measureKeys[0]] ?? 0;
      return point;
    });
  } else {
    series = Array.from(groups.entries()).map(([name, acc]) => ({
      name,
      value: Math.round(applyAggregation(aggregation, acc) * 100) / 100,
    }));
  }

  const sortByLabel = dimensionCol && isDateType(dimensionCol.dataType) && dateGrouping !== 'none';
  if (sortByLabel) {
    series.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const sortKey = multiMeasure ? measureKeys[0] : 'value';
    series.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  }
  return series.slice(0, MAX_GROUPS);
}

/**
 * Aggregeer meerdere chart-configs over ÉÉN dataset-read.
 * @param {object} params
 * @param {Array<object>} params.rows - rijen uit TableDataService.read (elk met .values)
 * @param {Array<object>} params.columns - kolom-metadata (elk met .key, .dataType, .label)
 * @param {Array<object>} params.charts - chart-configs { type, dimension, measure, aggregation, filters, dateGrouping }
 * @returns {{ results: Array<{ series: Array<{ name: string, value: number }> }> }}
 */
function aggregateCharts({ rows, columns, charts }) {
  const columnByKey = new Map((columns || []).map((c) => [c.key, c]));
  const safeCharts = Array.isArray(charts) ? charts : [];
  const results = safeCharts.map((config) => ({
    series: computeSeries(rows || [], columnByKey, config || {}),
  }));
  return { results };
}

module.exports = {
  AGGREGATIONS,
  CHART_TYPES,
  DATE_GROUPINGS,
  matchesFilter,
  aggregateCharts,
  resolveMeasures,
};
