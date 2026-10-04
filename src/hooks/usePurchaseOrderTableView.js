import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { columnUsesNumberSemantics } from '../utils/datePeriodColumnUtils';
import { readLastPoTableSession } from '../utils/poTableSessionState';
import { itemColumnMatchesFilter } from '../utils/itemColumnFilterMatch';
import {
  buildFilterFromCellValue,
  hasActiveFilter,
  isDateColumn,
  resolveFilterModel,
  COLOR_FILTER_OPERATOR,
  DATE_FILTER_OPERATORS as DATE_OPS,
  NUMBER_FILTER_OPERATORS as NUMBER_OPS,
  TEXT_FILTER_OPERATORS as TEXT_OPS,
} from '../utils/tableViewFilterUtils';
import {
  NO_COLOR_FILTER_VALUE,
  normalizeFilterColors,
  resolveColumnFilterCellColor,
  resolveRowFilterColor,
} from '../components/supplier/columnFilterColorUtils';

// Re-export zodat bestaande imports vanaf deze hook blijven werken.
export const TEXT_FILTER_OPERATORS = TEXT_OPS;
export const DATE_FILTER_OPERATORS = DATE_OPS;
export const NUMBER_FILTER_OPERATORS = NUMBER_OPS;

const SORT_DIRECTIONS = {
  none: 'none',
  asc: 'asc',
  desc: 'desc',
};

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

  const left = normalizeText(a);
  const right = normalizeText(b);
  return left.localeCompare(right, 'nl-NL', { sensitivity: 'base' });
}

export function usePurchaseOrderTableView({ items, columns, datePeriodDisplayModes = {}, columnFormatRules = {} }) {
  const [sortState, setSortState] = useState(() => {
    const last = readLastPoTableSession()?.sortState;
    return last && typeof last === 'object' ? last : { columnKey: '', direction: SORT_DIRECTIONS.none };
  });
  const [filterByColumn, setFilterByColumn] = useState(() => {
    const last = readLastPoTableSession()?.filterByColumn;
    return last && typeof last === 'object' ? last : {};
  });
  // Keep header filter chips snappy; defer the heavy filter→sort pass for board rows.
  const deferredFilterByColumn = useDeferredValue(filterByColumn);

  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns]
  );

  const setFilterOperator = useCallback((columnKey, operator) => {
    setFilterByColumn((prev) => {
      const column = columnByKey.get(columnKey);
      const current = resolveFilterModel(column, prev[columnKey], datePeriodDisplayModes);
      return {
        ...prev,
        [columnKey]: {
          ...current,
          operator,
        },
      };
    });
  }, [columnByKey, datePeriodDisplayModes]);

  const setFilterValue = useCallback((columnKey, value) => {
    setFilterByColumn((prev) => {
      const column = columnByKey.get(columnKey);
      const current = resolveFilterModel(column, prev[columnKey], datePeriodDisplayModes);
      return {
        ...prev,
        [columnKey]: {
          ...current,
          value,
        },
      };
    });
  }, [columnByKey, datePeriodDisplayModes]);

  const setFilterSecondaryValue = useCallback((columnKey, secondaryValue) => {
    setFilterByColumn((prev) => {
      const column = columnByKey.get(columnKey);
      const current = resolveFilterModel(column, prev[columnKey], datePeriodDisplayModes);
      return {
        ...prev,
        [columnKey]: {
          ...current,
          secondaryValue,
        },
      };
    });
  }, [columnByKey, datePeriodDisplayModes]);

  // Single setState for Apply — avoids three sequential filterByColumn updates.
  const applyColumnFilter = useCallback((columnKey, next) => {
    setFilterByColumn((prev) => {
      const column = columnByKey.get(columnKey);
      const current = resolveFilterModel(column, prev[columnKey], datePeriodDisplayModes);
      return {
        ...prev,
        [columnKey]: {
          ...current,
          operator: next?.operator ?? current.operator,
          value: next?.value ?? '',
          secondaryValue: next?.operator === 'between' ? (next?.secondaryValue ?? '') : '',
        },
      };
    });
  }, [columnByKey, datePeriodDisplayModes]);

  const clearColumnFilter = useCallback((columnKey) => {
    setFilterByColumn((prev) => {
      if (!prev[columnKey]) return prev;
      const next = { ...prev };
      delete next[columnKey];
      return next;
    });
  }, []);

  // Zet (of wist) een kleurfilter voor één kolom. Een lege lijst verwijdert het filter.
  const setColumnColorFilter = useCallback((columnKey, colors) => {
    setFilterByColumn((prev) => {
      const normalized = normalizeFilterColors(colors);
      if (!normalized.length) {
        if (!prev[columnKey]) return prev;
        const next = { ...prev };
        delete next[columnKey];
        return next;
      }
      return {
        ...prev,
        [columnKey]: {
          operator: COLOR_FILTER_OPERATOR,
          colors: normalized,
          value: '',
          secondaryValue: '',
        },
      };
    });
  }, []);

  const applyFilterFromCellValue = useCallback((columnKey, rawValue) => {
    const column = columnByKey.get(columnKey);
    if (!column) return;
    const filter = buildFilterFromCellValue(column, rawValue);
    setFilterByColumn((prev) => ({
      ...prev,
      [columnKey]: filter,
    }));
  }, [columnByKey]);

  const clearAllFilters = useCallback(() => {
    setFilterByColumn({});
  }, []);

  const toggleSort = useCallback((columnKey) => {
    setSortState((prev) => {
      if (prev.columnKey !== columnKey) {
        return { columnKey, direction: SORT_DIRECTIONS.asc };
      }
      if (prev.direction === SORT_DIRECTIONS.asc) {
        return { columnKey, direction: SORT_DIRECTIONS.desc };
      }
      if (prev.direction === SORT_DIRECTIONS.desc) {
        return { columnKey: '', direction: SORT_DIRECTIONS.none };
      }
      return { columnKey, direction: SORT_DIRECTIONS.asc };
    });
  }, []);

  const clearSort = useCallback(() => {
    setSortState({ columnKey: '', direction: SORT_DIRECTIONS.none });
  }, []);

  const setSortDirection = useCallback((columnKey, direction) => {
    const normalizedDirection = direction === SORT_DIRECTIONS.asc || direction === SORT_DIRECTIONS.desc
      ? direction
      : SORT_DIRECTIONS.none;
    if (!columnKey || normalizedDirection === SORT_DIRECTIONS.none) {
      setSortState({ columnKey: '', direction: SORT_DIRECTIONS.none });
      return;
    }
    setSortState({ columnKey, direction: normalizedDirection });
  }, []);

  // Serialiseer de huidige filter/sort-state voor opslag in een saved view.
  const exportState = useCallback(() => ({
    filterByColumn,
    sortState,
  }), [filterByColumn, sortState]);

  // Pas een opgeslagen filter/sort-state in één keer toe. Onbekende kolom-keys
  // (bijv. verwijderde/hernoemde D365-kolommen) worden genegeerd.
  const applyState = useCallback((state) => {
    const rawFilters = state?.filterByColumn && typeof state.filterByColumn === 'object'
      ? state.filterByColumn
      : {};
    const nextFilters = {};
    Object.entries(rawFilters).forEach(([key, filter]) => {
      const column = columnByKey.get(key);
      if (!column || !filter) return;
      nextFilters[key] = resolveFilterModel(column, filter, datePeriodDisplayModes);
    });
    setFilterByColumn(nextFilters);

    const rawSort = state?.sortState && typeof state.sortState === 'object' ? state.sortState : {};
    const validSortColumn = rawSort.columnKey && columnByKey.has(rawSort.columnKey);
    const validDirection = rawSort.direction === SORT_DIRECTIONS.asc || rawSort.direction === SORT_DIRECTIONS.desc;
    if (validSortColumn && validDirection) {
      setSortState({ columnKey: rawSort.columnKey, direction: rawSort.direction });
    } else {
      setSortState({ columnKey: '', direction: SORT_DIRECTIONS.none });
    }
  }, [columnByKey, datePeriodDisplayModes]);

  const processedItems = useMemo(() => {
    const activeFilters = columns
      .map((column) => [column, resolveFilterModel(column, deferredFilterByColumn[column.key], datePeriodDisplayModes)])
      .filter(([column, filter]) => hasActiveFilter(column, filter, datePeriodDisplayModes));

    // Kleurfilters worden apart afgehandeld: ze hebben de volledige rij + de
    // format-regelset nodig i.p.v. alleen de ruwe celwaarde.
    const valueFilters = activeFilters.filter(([, filter]) => filter.operator !== COLOR_FILTER_OPERATOR);
    const colorFilters = activeFilters.filter(([, filter]) => filter.operator === COLOR_FILTER_OPERATOR);

    const filtered = (valueFilters.length || colorFilters.length)
      ? items.filter((order) => {
        const valueMatch = valueFilters.every(([column, filter]) => (
          itemColumnMatchesFilter(order, column, filter, datePeriodDisplayModes)
        ));
        if (!valueMatch) return false;
        if (!colorFilters.length) return true;
        // Rij-brede kleur (row-target regels) één keer per order bepalen zodat een
        // kleurfilter op élke kolom ook op een rijkleur matcht.
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

    if (!sortState.columnKey || sortState.direction === SORT_DIRECTIONS.none) {
      return filtered;
    }

    const sortColumn = columnByKey.get(sortState.columnKey);
    if (!sortColumn) {
      return filtered;
    }

    const sorted = [...filtered].sort((leftOrder, rightOrder) => {
      const leftValue = leftOrder?.values?.[sortColumn.key];
      const rightValue = rightOrder?.values?.[sortColumn.key];
      const base = compareValues(leftValue, rightValue, sortColumn, datePeriodDisplayModes);
      if (sortState.direction === SORT_DIRECTIONS.desc) return -base;
      return base;
    });
    return sorted;
  }, [columns, deferredFilterByColumn, items, sortState, columnByKey, datePeriodDisplayModes, columnFormatRules]);

  const activeFilterCount = useMemo(
    () => columns.reduce(
      (count, column) => count + (hasActiveFilter(
        column,
        resolveFilterModel(column, filterByColumn[column.key], datePeriodDisplayModes),
        datePeriodDisplayModes
      ) ? 1 : 0),
      0
    ),
    [columns, filterByColumn, datePeriodDisplayModes]
  );

  return useMemo(() => ({
    processedItems,
    sortState,
    filterByColumn,
    activeFilterCount,
    hasActiveSort: Boolean(sortState.columnKey && sortState.direction !== SORT_DIRECTIONS.none),
    setFilterOperator,
    setFilterValue,
    setFilterSecondaryValue,
    applyColumnFilter,
    clearColumnFilter,
    setColumnColorFilter,
    applyFilterFromCellValue,
    clearAllFilters,
    toggleSort,
    clearSort,
    setSortDirection,
    exportState,
    applyState,
  }), [
    processedItems,
    sortState,
    filterByColumn,
    activeFilterCount,
    setFilterOperator,
    setFilterValue,
    setFilterSecondaryValue,
    applyColumnFilter,
    clearColumnFilter,
    setColumnColorFilter,
    applyFilterFromCellValue,
    clearAllFilters,
    toggleSort,
    clearSort,
    setSortDirection,
    exportState,
    applyState,
  ]);
}
