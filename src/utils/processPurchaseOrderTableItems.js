import { itemColumnMatchesFilter } from './itemColumnFilterMatch';
import { isDateColumn, partitionColumnFilters } from './tableViewFilterUtils';
import { columnUsesNumberSemantics } from './datePeriodColumnUtils';
import {
  NO_COLOR_FILTER_VALUE,
  resolveColumnFilterCellColor,
  resolveRowFilterColor,
} from '../components/supplier/columnFilterColorUtils';

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function parseDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function compareValues(a, b, column, datePeriodDisplayModes = {}) {
  if (isDateColumn(column)) {
    const left = parseDateValue(a);
    const right = parseDateValue(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  }

  if (columnUsesNumberSemantics(column, datePeriodDisplayModes)) {
    const left = Number(a);
    const right = Number(b);
    const leftIsNumber = Number.isFinite(left);
    const rightIsNumber = Number.isFinite(right);
    if (!leftIsNumber && !rightIsNumber) return 0;
    if (!leftIsNumber) return 1;
    if (!rightIsNumber) return -1;
    return left - right;
  }

  return normalizeText(a).localeCompare(normalizeText(b), 'nl-NL', { sensitivity: 'base' });
}

export function processPurchaseOrderTableItems({
  items,
  columns,
  filterByColumn,
  datePeriodDisplayModes = {},
  columnFormatRules = {},
  sortState,
  columnByKey,
}) {
  const { valueFilters, colorFilters } = partitionColumnFilters(columns, filterByColumn, datePeriodDisplayModes);
  const filtered = (valueFilters.length || colorFilters.length)
    ? items.filter((order) => {
      const valueMatch = valueFilters.every(([column, filter]) => (
        itemColumnMatchesFilter(order, column, filter, datePeriodDisplayModes)
      ));
      if (!valueMatch) return false;
      if (!colorFilters.length) return true;
      const rowColor = resolveRowFilterColor(order, columns, columnFormatRules);
      return colorFilters.every(([column, filter]) => {
        const cellColor = resolveColumnFilterCellColor(column, order, columnFormatRules[column.key]);
        const hasColor = Boolean(cellColor) || Boolean(rowColor);
        if (!hasColor) return filter.colors.includes(NO_COLOR_FILTER_VALUE);
        if (cellColor && filter.colors.includes(cellColor)) return true;
        return Boolean(rowColor) && filter.colors.includes(rowColor);
      });
    })
    : items;

  if (!sortState.columnKey || sortState.direction === 'none') return filtered;
  const sortColumn = columnByKey.get(sortState.columnKey);
  if (!sortColumn) return filtered;
  return [...filtered].sort((leftOrder, rightOrder) => {
    const base = compareValues(
      leftOrder?.values?.[sortColumn.key],
      rightOrder?.values?.[sortColumn.key],
      sortColumn,
      datePeriodDisplayModes
    );
    return sortState.direction === 'desc' ? -base : base;
  });
}
