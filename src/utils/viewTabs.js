import { applyOpacity } from './hexColor';
import { STATUS_COLOR_PALETTE } from './statusColumnUtils';
import {
  buildFilterFromCellValue,
  columnValueMatchesFilter,
  COLOR_FILTER_OPERATOR,
  DATE_FILTER_OPERATORS,
  hasActiveFilter,
  isDateColumn,
  isNumberColumn,
  NUMBER_FILTER_OPERATORS,
  REMARKS_FILTER_OPERATORS,
  resolveFilterModel,
  TEXT_FILTER_OPERATORS,
} from './tableViewFilterUtils';

const SELECTABLE_STATUS_COLORS = STATUS_COLOR_PALETTE.slice(1);

export const ALL_TAB_ID = 'all';
export const MAX_EXTRA_TABS = 200;

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function cloneFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  return {
    operator: String(filter.operator || '').slice(0, 32),
    value: Array.isArray(filter.value) ? filter.value.map((entry) => String(entry)) : String(filter.value ?? ''),
    secondaryValue: String(filter.secondaryValue ?? ''),
    colors: Array.isArray(filter.colors) ? filter.colors.filter(Boolean) : undefined,
  };
}

export function filtersEqual(left, right) {
  return JSON.stringify(cloneFilter(left) || null) === JSON.stringify(cloneFilter(right) || null);
}

export function mergeFilters(baseFilters, extraFilters) {
  const base = baseFilters && typeof baseFilters === 'object' ? baseFilters : {};
  const extra = extraFilters && typeof extraFilters === 'object' ? extraFilters : {};
  return { ...base, ...extra };
}

export function splitExtraFilters(liveFilters, baseFilters) {
  const live = liveFilters && typeof liveFilters === 'object' ? liveFilters : {};
  const base = baseFilters && typeof baseFilters === 'object' ? baseFilters : {};
  const extra = {};
  const keys = new Set([...Object.keys(live), ...Object.keys(base)]);
  keys.forEach((key) => {
    if (filtersEqual(live[key], base[key])) return;
    // Key present in base but cleared on this tab: store an explicit null so the
    // merge doesn't fall back to the base filter when switching tabs back in.
    extra[key] = live[key] ? cloneFilter(live[key]) : null;
  });
  return extra;
}

export function extraFiltersEqual(left, right) {
  const a = normalizeExtraFilters(left);
  const b = normalizeExtraFilters(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!filtersEqual(a[key], b[key])) return false;
  }
  return true;
}

/** Extra filters on a tab excluding the group-split column. */
export function nonGroupExtraFilters(tab) {
  const extra = normalizeExtraFilters(tab?.extraFilters);
  const groupKey = inferGroupColumnKey(tab);
  if (!groupKey || !extra[groupKey]) return extra;
  const rest = { ...extra };
  delete rest[groupKey];
  return rest;
}

function extraHasFiltersOthersLack(mine, other) {
  const needle = normalizeExtraFilters(mine);
  const hay = normalizeExtraFilters(other);
  return Object.keys(needle).some((key) => !filtersEqual(needle[key], hay[key]));
}

/**
 * True when this grouped tab has extra filters that at least one sibling in the
 * same group does not have. Siblings without those extras stay unmarked.
 */
export function tabHasUnsharedExtraFilters(tab, extraTabs) {
  const groupKey = inferGroupColumnKey(tab);
  if (!groupKey) return false;
  const mine = nonGroupExtraFilters(tab);
  if (!Object.keys(mine).length) return false;
  const siblings = (extraTabs || []).filter((entry) => (
    entry.id !== tab.id && inferGroupColumnKey(entry) === groupKey
  ));
  if (!siblings.length) return true;
  return siblings.some((sibling) => extraHasFiltersOthersLack(mine, nonGroupExtraFilters(sibling)));
}

export function createTabId() {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeExtraFilters(rawFilters) {
  if (!rawFilters || typeof rawFilters !== 'object' || Array.isArray(rawFilters)) return {};
  const extra = {};
  Object.keys(rawFilters).slice(0, 80).forEach((rawKey) => {
    const key = String(rawKey).slice(0, 64);
    const cloned = cloneFilter(rawFilters[rawKey]);
    if (key && cloned && cloned.operator) extra[key] = cloned;
  });
  return extra;
}

export function inferGroupColumnKey(tab) {
  if (!tab) return '';
  if (tab.groupColumnKey) return String(tab.groupColumnKey);
  const extra = tab.extraFilters || {};
  const equalsKey = Object.keys(extra).find((key) => extra[key]?.operator === 'equals');
  return equalsKey || Object.keys(extra)[0] || '';
}

export function normalizeTabsState(rawTabs) {
  const input = rawTabs && typeof rawTabs === 'object' ? rawTabs : {};
  const extraTabs = Array.isArray(input.extraTabs) ? input.extraTabs : [];
  const groups = Array.isArray(input.groups) ? input.groups : [];

  const normalizedTabs = extraTabs.slice(0, MAX_EXTRA_TABS).map((tab, index) => {
    if (!tab || typeof tab !== 'object') return null;
    const id = normalizeText(tab.id) || `tab_${index}`;
    const name = normalizeText(tab.name).slice(0, 120) || `Tab ${index + 1}`;
    const extraFilters = normalizeExtraFilters(tab.extraFilters);
    const groupColumnKey = String(tab.groupColumnKey || inferGroupColumnKey({ extraFilters }) || '').slice(0, 64);
    return { id, name, extraFilters, groupColumnKey };
  }).filter(Boolean);

  const normalizedGroups = groups.slice(0, 80).map((group) => {
    if (!group || typeof group !== 'object') return null;
    const columnKey = String(group.columnKey || '').slice(0, 64);
    const color = String(group.color || '');
    if (!columnKey) return null;
    return { columnKey, color };
  }).filter(Boolean);

  return { extraTabs: normalizedTabs, groups: normalizedGroups };
}

export function filterRowsByFilters(rows, columns, filterByColumn, datePeriodDisplayModes = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(columns) ? columns : [];
  const active = cols
    .map((column) => [column, resolveFilterModel(column, filterByColumn?.[column.key], datePeriodDisplayModes)])
    .filter(([column, filter]) => hasActiveFilter(column, filter, datePeriodDisplayModes));
  if (!active.length) return list;
  return list.filter((row) => active.every(([column, filter]) => (
    columnValueMatchesFilter(column, row?.values?.[column.key], filter, datePeriodDisplayModes)
  )));
}

export function uniqueColumnValues(rows, columnKey) {
  if (!columnKey || !Array.isArray(rows)) return [];
  const seen = new Set();
  const values = [];
  rows.forEach((row) => {
    const raw = row?.values?.[columnKey];
    const label = normalizeText(raw);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(raw);
  });
  return values;
}

export function existingEqualsValues(extraTabs, columnKey) {
  const seen = new Set();
  (extraTabs || []).forEach((tab) => {
    const filter = tab?.extraFilters?.[columnKey];
    if (!filter || filter.operator !== 'equals') return;
    const value = normalizeText(filter.value).toLowerCase();
    if (value) seen.add(value);
  });
  return seen;
}

export function nextGroupColor(groups) {
  const used = new Set((groups || []).map((group) => String(group.color || '').toLowerCase()));
  const palette = SELECTABLE_STATUS_COLORS || [];
  const unused = palette.find((color) => !used.has(String(color).toLowerCase()));
  return unused || palette[groups.length % Math.max(palette.length, 1)] || '#579bfc';
}

export const TAB_LABEL_MAX_CHARS = 10;

export function formatTabName(value) {
  return normalizeText(value).slice(0, 120);
}

export function truncateTabLabel(name, maxChars = TAB_LABEL_MAX_CHARS) {
  const text = String(name || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

export function buildBulkTabs({ column, columnKey, values, existingTabs }) {
  const existing = existingEqualsValues(existingTabs, columnKey);
  const created = [];
  (values || []).forEach((rawValue) => {
    const label = normalizeText(rawValue);
    if (!label) return;
    if (existing.has(label.toLowerCase())) return;
    existing.add(label.toLowerCase());
    created.push({
      id: createTabId(),
      name: formatTabName(label),
      groupColumnKey: columnKey,
      extraFilters: {
        [columnKey]: column ? buildFilterFromCellValue(column, rawValue) : {
          operator: 'equals',
          value: label,
          secondaryValue: '',
        },
      },
    });
  });
  return created.slice(0, Math.max(0, MAX_EXTRA_TABS - (existingTabs || []).length));
}

export function removeTabsByScope(extraTabs, tabId, scope = 'tab') {
  const list = extraTabs || [];
  const tab = list.find((entry) => entry.id === tabId);
  if (!tab) return list;
  if (scope === 'group') {
    const groupKey = inferGroupColumnKey(tab);
    if (groupKey) return list.filter((entry) => inferGroupColumnKey(entry) !== groupKey);
  }
  return list.filter((entry) => entry.id !== tabId);
}

export function copyGroupExtraFilters(sourceTab, extraTabs, groupColumnKey) {
  const sourceExtra = sourceTab?.extraFilters || {};
  return (extraTabs || []).map((tab) => {
    if (tab.id === sourceTab.id) return sourceTab;
    if (inferGroupColumnKey(tab) !== groupColumnKey) return tab;
    const nextExtra = { ...normalizeExtraFilters(sourceExtra) };
    if (groupColumnKey && tab.extraFilters?.[groupColumnKey]) {
      nextExtra[groupColumnKey] = cloneFilter(tab.extraFilters[groupColumnKey]);
    }
    return { ...tab, extraFilters: nextExtra, groupColumnKey };
  });
}

export function preferredSplitColumnKey(columns) {
  const keys = (columns || []).map((column) => column?.key);
  return ['vendorAccount', 'vendorAccountNumber', 'VendorAccount'].find((key) => keys.includes(key))
    || keys[0]
    || '';
}

export function groupColorForTab(tab, groups) {
  const columnKey = inferGroupColumnKey(tab);
  const group = (groups || []).find((entry) => entry.columnKey === columnKey);
  return group?.color || '';
}

export const TAB_UNDERLINE_ACTIVE_OPACITY = 100;
export const TAB_UNDERLINE_INACTIVE_OPACITY = 25;

export function tabUnderlineColor(groupColor, isActive) {
  return applyOpacity(groupColor, isActive ? TAB_UNDERLINE_ACTIVE_OPACITY : TAB_UNDERLINE_INACTIVE_OPACITY);
}

export function hasExtraViewTabs(extraTabs) {
  return Array.isArray(extraTabs) && extraTabs.length > 0;
}

export function upsertGroup(groups, columnKey, color) {
  if (!columnKey) return groups || [];
  const next = [...(groups || [])];
  const index = next.findIndex((group) => group.columnKey === columnKey);
  const prev = index >= 0 ? next[index] : {};
  const entry = {
    columnKey,
    color: color || prev.color || '',
  };
  if (index >= 0) next[index] = entry;
  else next.push(entry);
  return next;
}

function operatorPhrase(column, operator) {
  if (operator === COLOR_FILTER_OPERATOR) return 'color is';
  if (column?.dataType === 'remarks') return REMARKS_FILTER_OPERATORS[operator] || operator;
  if (isDateColumn(column)) return DATE_FILTER_OPERATORS[operator] || operator;
  if (isNumberColumn(column)) return NUMBER_FILTER_OPERATORS[operator] || operator;
  return TEXT_FILTER_OPERATORS[operator] || operator;
}

function formatFilterDisplayValue(filter) {
  if (!filter) return '';
  if (Array.isArray(filter.colors) && filter.colors.length) return filter.colors.join(', ');
  if (Array.isArray(filter.value)) return filter.value.join(', ');
  const value = normalizeText(filter.value);
  const secondary = normalizeText(filter.secondaryValue);
  if (filter.operator === 'between' && (value || secondary)) return `${value} – ${secondary}`;
  return value;
}

export function describeTabExtraFilters(tab, columns = []) {
  const extra = normalizeExtraFilters(tab?.extraFilters);
  return Object.keys(extra).map((key) => {
    const column = columns.find((entry) => entry.key === key);
    const label = column?.label || key;
    const filter = extra[key];
    const phrase = operatorPhrase(column, filter.operator);
    const value = formatFilterDisplayValue(filter);
    return {
      label: `${label}:`,
      detail: value ? `${phrase} ${value}` : phrase,
    };
  });
}

export function tabHoverFilterRows(tab, columns = []) {
  if (!tab || tab.id === ALL_TAB_ID) return [{ label: '', detail: 'View filters only' }];
  const rows = describeTabExtraFilters(tab, columns);
  return rows.length ? rows : [{ label: '', detail: 'No extra filters' }];
}

export function normalizeVendorAccount(value) {
  return normalizeText(value).slice(0, 64);
}

export function viewVendorAccount(view) {
  if (!view || view.scope !== 'vendor') return '';
  return normalizeVendorAccount(view.vendorAccount || view.viewState?.vendorAccount);
}

export function vendorCanSeeView(view, supplierAccount) {
  if (!view || view.scope !== 'vendor') return true;
  const assigned = normalizeVendorAccount(view.vendorAccount || view.viewState?.vendorAccount);
  if (!assigned) return true;
  return assigned.toLowerCase() === normalizeText(supplierAccount).toLowerCase();
}
