import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { readLastPoTableSession } from '../utils/poTableSessionState';
import {
  appendColumnFilterRule,
  extractColorFilter,
  listRawValueRules,
  packColumnFilter,
  writeColumnFilter,
} from '../utils/columnFilterState';
import { processPurchaseOrderTableItems } from '../utils/processPurchaseOrderTableItems';
import {
  buildFilterFromCellValue,
  hasActiveFilter,
  resolveFilterModel,
  DATE_FILTER_OPERATORS as DATE_OPS,
  NUMBER_FILTER_OPERATORS as NUMBER_OPS,
  TEXT_FILTER_OPERATORS as TEXT_OPS,
} from '../utils/tableViewFilterUtils';
import { normalizeFilterColors } from '../components/supplier/columnFilterColorUtils';

// Re-export zodat bestaande imports vanaf deze hook blijven werken.
export const TEXT_FILTER_OPERATORS = TEXT_OPS;
export const DATE_FILTER_OPERATORS = DATE_OPS;
export const NUMBER_FILTER_OPERATORS = NUMBER_OPS;

const SORT_DIRECTIONS = {
  none: 'none',
  asc: 'asc',
  desc: 'desc',
};

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

  const patchFirstRule = useCallback((columnKey, patch) => {
    setFilterByColumn((prev) => {
      const column = columnByKey.get(columnKey);
      const current = prev[columnKey];
      const colors = extractColorFilter(current);
      const rules = listRawValueRules(current);
      const first = resolveFilterModel(column, rules[0] || current, datePeriodDisplayModes);
      return writeColumnFilter(prev, columnKey, packColumnFilter([{ ...first, ...patch }, ...rules.slice(1)], colors));
    });
  }, [columnByKey, datePeriodDisplayModes]);

  const setFilterOperator = useCallback((columnKey, operator) => {
    patchFirstRule(columnKey, { operator });
  }, [patchFirstRule]);

  const setFilterValue = useCallback((columnKey, value) => {
    patchFirstRule(columnKey, { value });
  }, [patchFirstRule]);

  const setFilterSecondaryValue = useCallback((columnKey, secondaryValue) => {
    patchFirstRule(columnKey, { secondaryValue });
  }, [patchFirstRule]);

  const applyColumnFilter = useCallback((columnKey, next) => {
    setFilterByColumn((prev) => {
      const column = columnByKey.get(columnKey);
      const colors = extractColorFilter(prev[columnKey]);
      if (Array.isArray(next?.rules)) {
        return writeColumnFilter(prev, columnKey, packColumnFilter(next.rules, colors));
      }
      const current = resolveFilterModel(column, listRawValueRules(prev[columnKey])[0] || prev[columnKey], datePeriodDisplayModes);
      const rule = {
        operator: next?.operator ?? current.operator,
        value: next?.value ?? '',
        secondaryValue: next?.operator === 'between' ? (next?.secondaryValue ?? '') : '',
      };
      return writeColumnFilter(prev, columnKey, packColumnFilter([rule], colors));
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
      const rules = listRawValueRules(prev[columnKey]);
      return writeColumnFilter(prev, columnKey, packColumnFilter(rules, normalizeFilterColors(colors)));
    });
  }, []);

  const applyFilterFromCellValue = useCallback((columnKey, rawValue) => {
    const column = columnByKey.get(columnKey);
    if (!column) return;
    const filter = buildFilterFromCellValue(column, rawValue);
    setFilterByColumn((prev) => writeColumnFilter(
      prev,
      columnKey,
      appendColumnFilterRule(column, prev[columnKey], filter)
    ));
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
      const rules = listRawValueRules(filter).map((rule) => resolveFilterModel(column, rule, datePeriodDisplayModes));
      const packed = packColumnFilter(rules, extractColorFilter(filter));
      if (packed) nextFilters[key] = packed;
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

  const processedItems = useMemo(() => processPurchaseOrderTableItems({
    items,
    columns,
    filterByColumn: deferredFilterByColumn,
    datePeriodDisplayModes,
    columnFormatRules,
    sortState,
    columnByKey,
  }), [columns, deferredFilterByColumn, items, sortState, columnByKey, datePeriodDisplayModes, columnFormatRules]);

  const activeFilterCount = useMemo(
    () => columns.reduce(
      (count, column) => count + (hasActiveFilter(
        column,
        filterByColumn[column.key],
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
