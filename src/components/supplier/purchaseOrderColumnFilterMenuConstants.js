import { columnUsesNumberSemantics } from '../../utils/datePeriodColumnUtils';
import { HEX_COLOR_PATTERN } from '../../utils/hexColor';
import { COLOR_FILTER_OPERATOR, hasActiveFilter, REMARKS_FILTER_OPERATORS } from '../../utils/tableViewFilterUtils';
import { formatColumnOriginTooltip, getColumnOriginMeta } from '../../utils/columnOriginMeta';
import {
  FORMAT_RULE_COLOR_PALETTE,
  FORMAT_RULE_OPERATORS,
  normalizeColumnFormatRuleSet,
} from './columnFormatRuleUtils';

export { HEX_COLOR_PATTERN, REMARKS_FILTER_OPERATORS };

export const NEW_COLUMN_TYPES = [
  { key: 'status', label: 'Status', dataType: 'status' },
  { key: 'text', label: 'Text', dataType: 'text' },
  { key: 'number', label: 'Numbers', dataType: 'number' },
  { key: 'date', label: 'Date', dataType: 'date' },
  { key: 'date_wm', label: 'Date W/M', dataType: 'date_period' },
  { key: 'boolean', label: 'Yes/No', dataType: 'boolean' },
  { key: 'image', label: 'Image', dataType: 'image' },
  { key: 'remarks', label: 'Remarks', dataType: 'remarks' },
  { key: 'formula', label: 'Formula', dataType: 'number' },
];

const COLUMN_TYPE_META = {
  connected: { key: 'connected', label: 'Connected' },
  text: { key: 'text', label: 'Text' },
  number: { key: 'number', label: 'Number' },
  date: { key: 'date', label: 'Date' },
  boolean: { key: 'boolean', label: 'Yes/No' },
  select: { key: 'select', label: 'Select' },
  status: { key: 'status', label: 'Status' },
  image: { key: 'image', label: 'Image' },
  remarks: { key: 'remarks', label: 'Remarks' },
  formula: { key: 'formula', label: 'Formula' },
  date_period: { key: 'date_period', label: 'Date W/M' },
};

export function getColumnSourceMeta(column) {
  const origin = getColumnOriginMeta(column);
  return {
    key: origin.key,
    label: formatColumnOriginTooltip(origin),
  };
}

export function getColumnTypeMeta(column) {
  if (String(column?.formulaExpr || '').trim()) return COLUMN_TYPE_META.formula;
  const typeKey = String(column?.dataType || 'text').trim().toLowerCase();
  return COLUMN_TYPE_META[typeKey] || COLUMN_TYPE_META.text;
}

// Connected/pushed header-kolommen ("Push values to header") worden altijd als
// dataType 'text' opgeslagen, ook als de gekoppelde line-kolom een datum is (#AB:date-filter).
// filterDataType wordt éénmalig berekend in usePurchaseOrdersPage (orderedHeaderColumns) via
// isDateSourceColumn, zodat de datum-filter-UI ook op deze kolommen verschijnt.
export function isDateColumn(column) {
  return column?.dataType === 'date' || column?.filterDataType === 'date';
}

export function isNumberColumn(column, datePeriodDisplayModes = {}) {
  return columnUsesNumberSemantics(column, datePeriodDisplayModes);
}

function getDefaultOperator(column, datePeriodDisplayModes = {}) {
  if (isDateColumn(column)) return 'before';
  if (isNumberColumn(column, datePeriodDisplayModes)) return 'equals';
  return 'contains';
}

export function getDraftsFromFilter(column, filter, datePeriodDisplayModes = {}) {
  const rules = Array.isArray(filter?.rules) ? filter.rules : [];
  const valueFilters = rules.length
    ? rules
    : (filter?.operator && filter.operator !== COLOR_FILTER_OPERATOR ? [filter] : []);
  if (!valueFilters.length) return [getDraftFromFilter(column, null, datePeriodDisplayModes)];
  return valueFilters.map((rule) => getDraftFromFilter(column, rule, datePeriodDisplayModes));
}

export function getDraftFromFilter(column, filter, datePeriodDisplayModes = {}) {
  // Een actief kleurfilter is losgekoppeld van het waarde-filter; val terug op de
  // standaard-operator zodat de waarde-invoer niet met 'colorIs' breekt.
  const operator = filter?.operator && filter.operator !== COLOR_FILTER_OPERATOR
    ? filter.operator
    : getDefaultOperator(column, datePeriodDisplayModes);
  if (operator === 'oneOf') {
    return {
      operator,
      value: filter?.operator === 'oneOf' && Array.isArray(filter.value) ? filter.value : [],
      secondaryValue: '',
    };
  }
  return {
    operator,
    value: filter?.operator === COLOR_FILTER_OPERATOR ? '' : (filter?.value || ''),
    secondaryValue: filter?.operator === COLOR_FILTER_OPERATOR ? '' : (filter?.secondaryValue || ''),
  };
}

export function isColumnFilterActive(column, filter, datePeriodDisplayModes = {}) {
  return hasActiveFilter(column, filter, datePeriodDisplayModes);
}

export function isColumnFormatRuleSetActive(columnFormatRuleSet) {
  const normalizedRuleSet = normalizeColumnFormatRuleSet(columnFormatRuleSet);
  return Boolean(normalizedRuleSet?.rules?.length);
}

export function getTextStyleDraft(columnTextStyle) {
  const textColor = HEX_COLOR_PATTERN.test(String(columnTextStyle?.textColor || ''))
    ? String(columnTextStyle.textColor).toLowerCase()
    : '';
  return {
    textColor,
    bold: columnTextStyle?.bold === true,
    italic: columnTextStyle?.italic === true,
    underline: columnTextStyle?.underline === true,
  };
}

export function getFormatRulesDraft(columnFormatRuleSet) {
  const normalized = normalizeColumnFormatRuleSet(columnFormatRuleSet);
  if (!normalized) {
    return { target: 'cell', rules: [] };
  }
  return {
    target: normalized.target,
    rules: normalized.rules.map((rule, index) => ({
      id: `rule-${index}`,
      op: FORMAT_RULE_OPERATORS.includes(rule?.op) ? rule.op : '=',
      compareMode: rule?.valueRef ? 'column' : 'value',
      value: rule?.value === undefined || rule?.value === null ? '' : String(rule.value),
      valueRef: String(rule?.valueRef || ''),
      color: String(rule?.color || FORMAT_RULE_COLOR_PALETTE[0]).toLowerCase(),
    })),
  };
}

export function buildFormatRulesDraft() {
  return {
    id: `rule-${Date.now()}`,
    op: '=',
    compareMode: 'value',
    value: '',
    valueRef: '',
    color: FORMAT_RULE_COLOR_PALETTE[0],
  };
}

export function serializeFormatRulesDraft(formatTarget, formatRules) {
  return normalizeColumnFormatRuleSet({
    target: formatTarget,
    rules: (Array.isArray(formatRules) ? formatRules : []).map((rule) => ({
      op: rule.op,
      color: rule.color,
      ...(rule.compareMode === 'column' ? { valueRef: rule.valueRef } : { value: rule.value }),
    })),
  });
}

export function getStickyColumnMenuText({ canUnstickSticky, isStickyColumn, stickyColumnCount = 0 }) {
  if (canUnstickSticky) return 'Unstick column';
  if (isStickyColumn) return `Already sticky (${stickyColumnCount})`;
  return 'Make sticky';
}
