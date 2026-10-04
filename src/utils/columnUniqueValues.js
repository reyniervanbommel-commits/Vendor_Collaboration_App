import { columnUsesNumberSemantics } from './datePeriodColumnUtils';
import { rawValuesForColumnFilter } from './itemColumnFilterMatch';
import { filterItemsByColumnFilters } from './tableViewFilterUtils';

export const UNIQUE_VALUE_SUGGESTION_LIMIT = 100;

/**
 * Berekent de gesorteerde, gededupliceerde unieke waarden voor één kolom, cascading t.o.v. alle
 * andere actieve kolomfilters (zie filterItemsByColumnFilters). Puur client-side over de al
 * geladen `items` — geen backend-call.
 */
export function getUniqueColumnValues(column, items, columns, filterByColumn, datePeriodDisplayModes = {}) {
  const scopedItems = filterItemsByColumnFilters(items, columns, filterByColumn, datePeriodDisplayModes, column?.key);
  const isNumber = columnUsesNumberSemantics(column, datePeriodDisplayModes);
  const seen = new Set();
  const values = [];
  scopedItems.forEach((item) => {
    rawValuesForColumnFilter(item, column?.key).forEach((raw) => {
      if (raw === null || raw === undefined || raw === '') return;
      if (isNumber) {
        const num = Number(raw);
        if (!Number.isFinite(num) || seen.has(num)) return;
        seen.add(num);
        values.push(num);
        return;
      }
      const text = String(raw);
      const dedupeKey = text.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      values.push(text);
    });
  });
  values.sort((a, b) => (
    isNumber ? a - b : String(a).localeCompare(String(b), 'nl-NL', { sensitivity: 'base' })
  ));
  return values;
}

/**
 * Filtert een al berekende unieke-waardenlijst op een zoekterm en kapt af op `limit`.
 * `formatDisplay` is optioneel: er wordt ook op het weergavelabel gematcht.
 */
export function getValueSuggestions(uniqueValues, query, limit = UNIQUE_VALUE_SUGGESTION_LIMIT, formatDisplay = null) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const matches = normalizedQuery
    ? uniqueValues.filter((value) => {
      const raw = String(value).toLowerCase();
      const display = String(typeof formatDisplay === 'function' ? formatDisplay(value) : value).toLowerCase();
      return raw.includes(normalizedQuery) || display.includes(normalizedQuery);
    })
    : uniqueValues;
  return {
    items: matches.slice(0, limit),
    totalMatches: matches.length,
    truncated: matches.length > limit,
  };
}
