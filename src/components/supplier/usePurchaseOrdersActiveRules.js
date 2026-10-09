import { useMemo } from 'react';
import { COLOR_FILTER_OPERATOR } from '../../utils/tableViewFilterUtils';
import { normalizeColumnFormatRuleSet } from './columnFormatRuleUtils';
import {
  isColumnFilterActive,
  isColumnFormatRuleSetActive,
} from './purchaseOrderColumnFilterMenuConstants';

/**
 * @typedef {'header' | 'line'} ActiveRuleScope
 * @typedef {{
 *   id: string,
 *   columnKey: string,
 *   columnLabel: string,
 *   scope: ActiveRuleScope,
 *   column: object,
 *   summary: string,
 *   filter?: object,
 *   ruleSet?: object,
 * }} ActiveRuleItem
 */

export const EMPTY_ACTIVE_RULE_GROUPS = Object.freeze({
  header: Object.freeze([]),
  line: Object.freeze([]),
});

function stringifyFilterValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

function summarizeOneRule(filter) {
  if (filter?.operator === COLOR_FILTER_OPERATOR) {
    return `${Array.isArray(filter.colors) ? filter.colors.length : 0} colors`;
  }
  if (filter?.operator === 'between') {
    return `${filter.operator} ${stringifyFilterValue(filter.value)} and ${stringifyFilterValue(filter.secondaryValue)}`;
  }
  return `${filter?.operator || ''} ${stringifyFilterValue(filter?.value)}`.trim();
}

function listValueRules(filter) {
  const rules = Array.isArray(filter?.rules) ? filter.rules : [];
  if (rules.length) return rules;
  if (filter?.operator && filter.operator !== COLOR_FILTER_OPERATOR) return [filter];
  return [];
}

function partsForRule(filter) {
  if (filter?.operator === COLOR_FILTER_OPERATOR) {
    const count = Array.isArray(filter.colors) ? filter.colors.length : 0;
    return [
      { type: 'operator', text: 'color is' },
      { type: 'value', text: `${count} ${count === 1 ? 'color' : 'colors'}` },
    ];
  }
  if (filter?.operator === 'between') {
    return [
      { type: 'operator', text: filter.operator },
      { type: 'value', text: stringifyFilterValue(filter.value) },
      { type: 'and', text: 'and' },
      { type: 'value', text: stringifyFilterValue(filter.secondaryValue) },
    ].filter((part) => part.text);
  }
  const value = stringifyFilterValue(filter?.value);
  return [
    { type: 'operator', text: filter?.operator || '' },
    value ? { type: 'value', text: value } : null,
  ].filter((part) => part?.text);
}

export function columnFilterSummaryParts(column, filter) {
  const parts = [];
  listValueRules(filter).forEach((rule, index) => {
    if (index > 0) parts.push({ type: 'and', text: 'and' });
    parts.push(...partsForRule(rule));
  });
  if (Array.isArray(filter?.colors) && filter.colors.length && filter.operator !== COLOR_FILTER_OPERATOR) {
    if (parts.length) parts.push({ type: 'and', text: 'and' });
    parts.push(...partsForRule({ operator: COLOR_FILTER_OPERATOR, colors: filter.colors }));
  }
  if (!parts.length && filter) return partsForRule(filter);
  return parts;
}

export function summarizeColumnFilter(column, filter) {
  return columnFilterSummaryParts(column, filter)
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || summarizeOneRule(filter);
}

export function summarizeFormatRuleSet(ruleSet) {
  const count = normalizeColumnFormatRuleSet(ruleSet)?.rules?.length || 0;
  return `${count} ${count === 1 ? 'rule' : 'rules'}`;
}

function buildActiveItems({
  columns,
  scope,
  sourceByColumn,
  isActive,
  summarize,
  payloadKey,
  datePeriodDisplayModes,
}) {
  return (Array.isArray(columns) ? columns : []).reduce((items, column) => {
    const columnKey = column?.key;
    const source = sourceByColumn?.[columnKey];
    const active = payloadKey === 'filter'
      ? isActive(column, source, datePeriodDisplayModes)
      : isActive(source);
    if (!columnKey || !active) return items;
    items.push({
      id: `${scope}:${columnKey}`,
      columnKey,
      columnLabel: column.label || columnKey,
      scope,
      column,
      summary: summarize(column, source),
      summaryParts: payloadKey === 'filter' ? columnFilterSummaryParts(column, source) : undefined,
      [payloadKey]: source,
    });
    return items;
  }, []);
}

function headerHasActiveFilter(column, filterByColumn, datePeriodDisplayModes) {
  const columnKey = column?.key;
  if (!columnKey) return false;
  return isColumnFilterActive(column, filterByColumn?.[columnKey], datePeriodDisplayModes);
}

function columnHasActiveFormat(column, formatRules) {
  const columnKey = column?.key;
  if (!columnKey) return false;
  return isColumnFormatRuleSetActive(formatRules?.[columnKey]);
}

/**
 * Cheap presence check for the overview icon. Same rules as the flyout lists
 * (header filters + header/line format rules; no line filters, no cell scans).
 */
export function hasActivePurchaseOrderRules({
  headerColumns = [],
  lineColumns = [],
  filterByColumn = {},
  headerColumnFormatRules = {},
  lineColumnFormatRules = {},
  datePeriodDisplayModes = {},
} = {}) {
  for (const column of headerColumns) {
    if (headerHasActiveFilter(column, filterByColumn, datePeriodDisplayModes)) return true;
    if (columnHasActiveFormat(column, headerColumnFormatRules)) return true;
  }
  for (const column of lineColumns) {
    if (columnHasActiveFormat(column, lineColumnFormatRules)) return true;
  }
  return false;
}

/**
 * Derives active PO board filters and format rules for the overview flyout.
 *
 * @param {{
 *   headerColumns: object[],
 *   lineColumns: object[],
 *   filterByColumn: object,
 *   headerColumnFormatRules: object,
 *   lineColumnFormatRules: object,
 *   datePeriodDisplayModes?: object,
 *   open?: boolean,
 * }} options
 * @returns {{ hasActive: boolean, filters: { header: ActiveRuleItem[], line: ActiveRuleItem[] }, formatRules: { header: ActiveRuleItem[], line: ActiveRuleItem[] } }}
 */
export function usePurchaseOrdersActiveRules({
  headerColumns = [],
  lineColumns = [],
  filterByColumn = {},
  headerColumnFormatRules = {},
  lineColumnFormatRules = {},
  datePeriodDisplayModes = {},
  open = true,
}) {
  const hasActive = useMemo(() => hasActivePurchaseOrderRules({
    headerColumns,
    lineColumns,
    filterByColumn,
    headerColumnFormatRules,
    lineColumnFormatRules,
    datePeriodDisplayModes,
  }), [
    datePeriodDisplayModes,
    filterByColumn,
    headerColumnFormatRules,
    headerColumns,
    lineColumnFormatRules,
    lineColumns,
  ]);

  const filters = useMemo(() => {
    if (!open) return EMPTY_ACTIVE_RULE_GROUPS;
    return {
      header: buildActiveItems({
        columns: headerColumns,
        scope: 'header',
        sourceByColumn: filterByColumn,
        isActive: isColumnFilterActive,
        summarize: summarizeColumnFilter,
        payloadKey: 'filter',
        datePeriodDisplayModes,
      }),
      line: [],
    };
  }, [datePeriodDisplayModes, filterByColumn, headerColumns, open]);

  const formatRules = useMemo(() => {
    if (!open) return EMPTY_ACTIVE_RULE_GROUPS;
    return {
      header: buildActiveItems({
        columns: headerColumns,
        scope: 'header',
        sourceByColumn: headerColumnFormatRules,
        isActive: isColumnFormatRuleSetActive,
        summarize: (_column, ruleSet) => summarizeFormatRuleSet(ruleSet),
        payloadKey: 'ruleSet',
      }),
      line: buildActiveItems({
        columns: lineColumns,
        scope: 'line',
        sourceByColumn: lineColumnFormatRules,
        isActive: isColumnFormatRuleSetActive,
        summarize: (_column, ruleSet) => summarizeFormatRuleSet(ruleSet),
        payloadKey: 'ruleSet',
      }),
    };
  }, [headerColumnFormatRules, headerColumns, lineColumnFormatRules, lineColumns, open]);

  return { hasActive, filters, formatRules };
}
