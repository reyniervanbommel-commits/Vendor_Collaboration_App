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

function formatHoverFilterSummary(column, filter, datePeriodDisplayModes) {
  if (!isColumnFilterActive(column, filter, datePeriodDisplayModes)) return '';
  if (filter.operator === COLOR_FILTER_OPERATOR) {
    const count = Array.isArray(filter.colors) ? filter.colors.length : 0;
    return `color is: ${count} ${count === 1 ? 'color' : 'colors'}`;
  }
  const operatorLabel = getOperatorLabel(column, filter.operator, datePeriodDisplayModes);
  if (filter.operator === 'between') {
    return `${operatorLabel}: ${stringifyFilterValue(filter.value)} and ${stringifyFilterValue(filter.secondaryValue)}`;
  }
  const value = stringifyFilterValue(filter.value).trim();
  if (!operatorLabel) return value;
  if (!value) return operatorLabel;
  return `${operatorLabel}: ${value}`;
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
 * @returns {{ text: string } | null}
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
  const text = formatHoverFilterSummary(column, filter, datePeriodDisplayModes);
  return text ? { text } : null;
}
