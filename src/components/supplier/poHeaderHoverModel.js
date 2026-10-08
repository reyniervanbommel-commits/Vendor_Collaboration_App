import {
  COLOR_FILTER_OPERATOR,
  DATE_FILTER_OPERATORS,
  NUMBER_FILTER_OPERATORS,
  REMARKS_FILTER_OPERATORS,
  TEXT_FILTER_OPERATORS,
} from '../../utils/tableViewFilterUtils';
import {
  isColumnFilterActive,
  isDateColumn,
  isNumberColumn,
} from './purchaseOrderColumnFilterMenuConstants';
import { resolveDatePeriodSourceKey } from '../../utils/datePeriodColumnUtils';

function stringifyFilterValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

function getOperatorLabel(column, operator, datePeriodDisplayModes) {
  if (!operator || operator === COLOR_FILTER_OPERATOR) return '';
  if (column?.dataType === 'remarks') return REMARKS_FILTER_OPERATORS[operator] || operator;
  if (isDateColumn(column)) return DATE_FILTER_OPERATORS[operator] || operator;
  if (isNumberColumn(column, datePeriodDisplayModes)) return NUMBER_FILTER_OPERATORS[operator] || operator;
  return TEXT_FILTER_OPERATORS[operator] || operator;
}

function partsForOneRule(column, filter, datePeriodDisplayModes) {
  if (filter.operator === COLOR_FILTER_OPERATOR) {
    const count = Array.isArray(filter.colors) ? filter.colors.length : 0;
    return [
      { type: 'operator', text: 'color is:' },
      { type: 'value', text: `${count} ${count === 1 ? 'color' : 'colors'}` },
    ];
  }
  const operatorLabel = getOperatorLabel(column, filter.operator, datePeriodDisplayModes);
  if (filter.operator === 'between') {
    return [
      { type: 'operator', text: operatorLabel ? `${operatorLabel}:` : '' },
      { type: 'value', text: stringifyFilterValue(filter.value) },
      { type: 'and', text: 'and' },
      { type: 'value', text: stringifyFilterValue(filter.secondaryValue) },
    ].filter((part) => part.text);
  }
  const value = stringifyFilterValue(filter.value).trim();
  return [
    operatorLabel ? { type: 'operator', text: value ? `${operatorLabel}:` : operatorLabel } : null,
    value ? { type: 'value', text: value } : null,
  ].filter(Boolean);
}

function formatHoverFilterParts(column, filter, datePeriodDisplayModes) {
  if (!isColumnFilterActive(column, filter, datePeriodDisplayModes)) return [];
  const rules = Array.isArray(filter?.rules) ? filter.rules : [];
  const valueRules = rules.length
    ? rules
    : (filter?.operator && filter.operator !== COLOR_FILTER_OPERATOR ? [filter] : []);
  const parts = [];
  valueRules.forEach((rule, index) => {
    if (index > 0) parts.push({ type: 'and', text: 'and' });
    parts.push(...partsForOneRule(column, rule, datePeriodDisplayModes));
  });
  if (Array.isArray(filter?.colors) && filter.colors.length) {
    if (parts.length) parts.push({ type: 'and', text: 'and' });
    parts.push(...partsForOneRule(column, { operator: COLOR_FILTER_OPERATOR, colors: filter.colors }, datePeriodDisplayModes));
  }
  return parts;
}

function lineColumnLabel(lineColumns, columnKey) {
  return lineColumns.find((lineColumn) => lineColumn.key === columnKey)?.label || columnKey;
}

function headerColumnLabel(columns, columnKey) {
  return (Array.isArray(columns) ? columns : [])
    .find((column) => column?.key === columnKey)?.label || columnKey;
}

export function getPoHeaderConnectionTargets({
  columnKey,
  column,
  columns = [],
  linkedLineTotalByHeaderKey = {},
  linkedLineValueByHeaderKey = {},
  lineColumns = [],
} = {}) {
  const targets = [];
  const linkedTotalColumnKey = linkedLineTotalByHeaderKey[columnKey];
  if (linkedTotalColumnKey) {
    targets.push(`Subitem column "${lineColumnLabel(lineColumns, linkedTotalColumnKey)}" (total)`);
  }
  const linkedValueMeta = linkedLineValueByHeaderKey[columnKey];
  if (linkedValueMeta?.lineColumnKey) {
    targets.push(`Subitem column "${lineColumnLabel(lineColumns, linkedValueMeta.lineColumnKey)}" (values)`);
  }
  const resolvedColumn = column
    || (Array.isArray(columns) ? columns.find((entry) => entry?.key === columnKey) : null);
  const sourceKey = resolveDatePeriodSourceKey(resolvedColumn);
  if (sourceKey) {
    targets.push(`Date column "${headerColumnLabel(columns, sourceKey)}"`);
  }
  return targets;
}

/**
 * Builds the PO header hover card model from the active column filter.
 * Returns null when the column has no filter. No row scans and no extra IO.
 *
 * @returns {{ text: string, parts: Array<{ type: string, text: string }> } | null}
 */
export function buildPoHeaderHoverModel({
  column,
  filter,
  datePeriodDisplayMode,
} = {}) {
  if (!column) return null;
  const datePeriodDisplayModes = column.key && datePeriodDisplayMode
    ? { [column.key]: datePeriodDisplayMode }
    : {};
  const parts = formatHoverFilterParts(column, filter, datePeriodDisplayModes);
  const text = parts.map((part) => part.text).join(' ');
  return text ? { text, parts } : null;
}
