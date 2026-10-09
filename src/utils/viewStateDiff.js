import {
  COLOR_FILTER_OPERATOR,
  DATE_FILTER_OPERATORS,
  NUMBER_FILTER_OPERATORS,
  REMARKS_FILTER_OPERATORS,
  TEXT_FILTER_OPERATORS,
  isDateColumn,
  isNumberColumn,
} from './tableViewFilterUtils';
import { filtersEqual } from './viewTabs';

export const VIEW_STATE_DIFF_MAX_ROWS = 8;

function normalizeForComparison(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeForComparison(value[key]);
        return result;
      }, {});
  }
  return value;
}

export function stableSerializeViewState(value) {
  return JSON.stringify(normalizeForComparison(value));
}

function valuesEqual(left, right) {
  return stableSerializeViewState(left) === stableSerializeViewState(right);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function columnLabel(key, columns) {
  const column = (columns || []).find((entry) => entry.key === key);
  return column?.label || key;
}

function formatFilterValue(filter) {
  if (!filter) return '';
  if (Array.isArray(filter.colors) && filter.colors.length) return filter.colors.join(', ');
  if (Array.isArray(filter.value)) return filter.value.join(', ');
  const value = String(filter.value ?? '').trim();
  const secondary = String(filter.secondaryValue ?? '').trim();
  if (filter.operator === 'between' && (value || secondary)) return `${value} – ${secondary}`;
  return value;
}

function operatorPhrase(column, operator) {
  if (operator === COLOR_FILTER_OPERATOR) return 'color is';
  if (column?.dataType === 'remarks') return REMARKS_FILTER_OPERATORS[operator] || operator;
  if (isDateColumn(column)) return DATE_FILTER_OPERATORS[operator] || operator;
  if (isNumberColumn(column)) return NUMBER_FILTER_OPERATORS[operator] || operator;
  return TEXT_FILTER_OPERATORS[operator] || operator;
}

function describeFilter(columnKey, filter, columns) {
  const column = (columns || []).find((entry) => entry.key === columnKey);
  const name = column?.label || columnKey;
  const rules = Array.isArray(filter?.rules) ? filter.rules : [];
  const valueRules = rules.length
    ? rules
    : (filter?.operator && filter.operator !== COLOR_FILTER_OPERATOR ? [filter] : []);
  const parts = valueRules.map((rule) => {
    const phrase = operatorPhrase(column, rule.operator);
    const value = formatFilterValue(rule);
    return value ? `${phrase} ${value}` : phrase;
  });
  if (Array.isArray(filter?.colors) && filter.colors.length) {
    parts.push(`color is ${filter.colors.join(', ')}`);
  }
  if (!parts.length) return filter?.operator ? `${name} ${operatorPhrase(column, filter.operator)}` : name;
  return `${name} ${parts.join(' and ')}`;
}

function push(rows, kind, label, detail) {
  if (!detail) return;
  rows.push({ kind, label, detail });
}

function listKeys(savedList, currentList) {
  const saved = asArray(savedList).map(String);
  const current = asArray(currentList).map(String);
  const savedSet = new Set(saved);
  const currentSet = new Set(current);
  return {
    added: current.filter((key) => !savedSet.has(key)),
    removed: saved.filter((key) => !currentSet.has(key)),
    orderChanged: saved.length === current.length
      && saved.every((key) => currentSet.has(key))
      && saved.some((key, index) => key !== current[index]),
  };
}

function pushFilters(rows, saved, current, columns) {
  const from = asObject(saved.table?.filterByColumn);
  const to = asObject(current.table?.filterByColumn);
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  keys.forEach((key) => {
    const had = from[key];
    const has = to[key];
    if (!had && has) push(rows, 'filter', 'Filter added:', describeFilter(key, has, columns));
    else if (had && !has) push(rows, 'filter', 'Filter removed:', columnLabel(key, columns));
    else if (!filtersEqual(had, has)) push(rows, 'filter', 'Filter changed:', describeFilter(key, has, columns));
  });
}

function pushVisibleColumns(rows, saved, current, columns) {
  const diff = listKeys(saved.columns?.visibleColumns, current.columns?.visibleColumns);
  diff.added.forEach((key) => push(rows, 'column', 'Column shown:', columnLabel(key, columns)));
  diff.removed.forEach((key) => push(rows, 'column', 'Column hidden:', columnLabel(key, columns)));
  const savedOrder = asArray(saved.columns?.columnOrder).map(String);
  const currentOrder = asArray(current.columns?.columnOrder).map(String);
  const savedVisible = asArray(saved.columns?.visibleColumns).map(String);
  const currentVisible = asArray(current.columns?.visibleColumns).map(String);
  const orderIsJustVisible = valuesEqual(savedOrder, savedVisible) && valuesEqual(currentOrder, currentVisible);
  if (!orderIsJustVisible && listKeys(savedOrder, currentOrder).orderChanged) {
    push(rows, 'column', 'Column order:', 'changed');
  }
}

function pushTabs(rows, saved, current) {
  const from = asArray(saved.tabs?.extraTabs);
  const to = asArray(current.tabs?.extraTabs);
  const fromById = new Map(from.map((tab) => [String(tab?.id || ''), tab]));
  const toById = new Map(to.map((tab) => [String(tab?.id || ''), tab]));
  to.forEach((tab) => {
    const id = String(tab?.id || '');
    if (!id) return;
    if (!fromById.has(id)) push(rows, 'category', 'Tab added:', tab.name || id);
  });
  from.forEach((tab) => {
    const id = String(tab?.id || '');
    if (!id) return;
    if (!toById.has(id)) push(rows, 'category', 'Tab removed:', tab.name || id);
  });
  to.forEach((tab) => {
    const id = String(tab?.id || '');
    const previous = fromById.get(id);
    if (!previous) return;
    if (!valuesEqual(previous.extraFilters, tab.extraFilters) || previous.name !== tab.name) {
      push(rows, 'category', 'Tab changed:', tab.name || id);
    }
  });
  if (!valuesEqual(saved.tabs?.groups, current.tabs?.groups)) {
    push(rows, 'category', 'Tab groups:', 'changed');
  }
}

function groupingDetail(state, columns) {
  const keys = asArray(state.table?.grouping?.columnKeys).filter(Boolean);
  if (!keys.length && state.table?.grouping?.columnKey) keys.push(state.table.grouping.columnKey);
  if (!keys.length) return 'none';
  return keys.map((key) => columnLabel(key, columns)).join(', ');
}

function pushGrouping(rows, saved, current, columns) {
  if (valuesEqual(saved.table?.grouping, current.table?.grouping)) return;
  push(rows, 'category', 'Grouping:', groupingDetail(current, columns));
}

const FORMAT_COLUMN_KEYS = [
  'headerColumnFormatRules',
  'lineColumnFormatRules',
  'headerColumnTextStyles',
  'lineColumnTextStyles',
];

function describedColumnKeys() {
  return new Set([
    'visibleColumns',
    'columnOrder',
    'stickyColumnKeys',
    ...FORMAT_COLUMN_KEYS,
  ]);
}

function pickColumnSlice(source, keys) {
  const result = {};
  keys.forEach((key) => {
    result[key] = source[key];
  });
  return result;
}

function pushLayoutCatchAll(rows, saved, current) {
  const from = asObject(saved.columns);
  const to = asObject(current.columns);
  if (!valuesEqual(pickColumnSlice(from, FORMAT_COLUMN_KEYS), pickColumnSlice(to, FORMAT_COLUMN_KEYS))) {
    push(rows, 'format', 'Conditional formatting:', 'changed');
  }
  const skip = describedColumnKeys();
  const restSaved = {};
  const restCurrent = {};
  Object.keys({ ...from, ...to }).forEach((key) => {
    if (skip.has(key)) return;
    restSaved[key] = from[key];
    restCurrent[key] = to[key];
  });
  if (!valuesEqual(restSaved, restCurrent)) push(rows, 'column', 'Column layout:', 'changed');
}

function pushHistory(rows, saved, current) {
  const from = saved.showHistoryIndicators !== false;
  const to = current.showHistoryIndicators !== false;
  if (from === to) return;
  push(rows, 'column', 'History indicators:', to ? 'on' : 'off');
}

function pushOtherTable(rows, saved, current, columns) {
  if (!valuesEqual(saved.table?.sortState, current.table?.sortState)) {
    const key = current.table?.sortState?.columnKey || current.table?.sortState?.key;
    push(rows, 'sort', 'Sort:', key ? columnLabel(key, columns) : 'changed');
  }
  if (!valuesEqual(saved.table?.activityFilter, current.table?.activityFilter)) {
    push(rows, 'filter', 'Activity filter:', String(current.table?.activityFilter || 'all'));
  }
  if (!valuesEqual(saved.table?.columnSumKeys, current.table?.columnSumKeys)) {
    push(rows, 'column', 'Column sums:', 'changed');
  }
  if (!valuesEqual(saved.columns?.stickyColumnKeys, current.columns?.stickyColumnKeys)) {
    push(rows, 'column', 'Sticky columns:', 'changed');
  }
}

/**
 * Human-readable delta between saved and live viewState.
 * Does not scan order rows — call only on hover / menu open.
 */
export function describeViewStateDiff(saved, current, options = {}) {
  const columns = options.columns || [];
  const maxRows = Number.isFinite(options.maxRows) ? options.maxRows : VIEW_STATE_DIFF_MAX_ROWS;
  const from = asObject(saved);
  const to = asObject(current);
  const rows = [];
  pushHistory(rows, from, to);
  pushFilters(rows, from, to, columns);
  pushVisibleColumns(rows, from, to, columns);
  pushTabs(rows, from, to);
  pushGrouping(rows, from, to, columns);
  pushOtherTable(rows, from, to, columns);
  pushLayoutCatchAll(rows, from, to);
  const visible = rows.slice(0, Math.max(0, maxRows));
  return {
    rows: visible,
    moreCount: Math.max(0, rows.length - visible.length),
  };
}
