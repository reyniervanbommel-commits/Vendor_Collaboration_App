// Gedeeld tussen useChartData (de echte /bi-lezing) en biBoardPrefetch (idle-prefetch vanaf de
// PO-pagina) zodat beide exact dezelfde cache-key voor `biBoardCache` bouwen. Elk verschil hier
// is de directe oorzaak van een prefetch die nooit een cache-hit oplevert.

/** Vertaalt een `filterByColumn`-map (zoals de PO-tabel gebruikt) naar de filter-array die het
 * BI-aggregate-endpoint verwacht. */
export function filtersFromColumnMap(filterByColumn) {
  if (!filterByColumn || typeof filterByColumn !== 'object') return [];
  return Object.entries(filterByColumn).flatMap(([columnKey, filter]) => {
    if (columnKey === 'remarks' || !filter) return [];
    const rules = Array.isArray(filter.rules)
      ? filter.rules
      : (filter.operator && filter.operator !== 'colorIs' ? [filter] : []);
    return rules
      .filter((rule) => rule?.operator && rule.operator !== 'colorIs')
      .map((rule) => ({
        columnKey,
        operator: rule.operator,
        value: rule.value ?? '',
        secondaryValue: rule.secondaryValue ?? '',
      }));
  });
}

/**
 * Genereert het generieke week/jaar-filter voor één chart: alleen wanneer de dimensie van die
 * chart een datumkolom is, wordt een `between`-filter op díe kolom toegevoegd.
 */
export function dateFilterForChart(chart, columnTypeByKey, dateRange) {
  if (!dateRange) return null;
  const dimension = chart?.config?.dimension;
  if (!dimension || columnTypeByKey[dimension] !== 'date') return null;
  return {
    columnKey: dimension,
    operator: 'between',
    value: dateRange.start,
    secondaryValue: dateRange.end,
  };
}

// Cache-key per chart: config + overgeërfde filters + (optioneel) client-dataRevision + datumfilter.
export function chartFetchKey(chart, inheritedFilters, dataRevision, dateFilter) {
  return JSON.stringify({
    config: chart?.config || {},
    inheritedFilters,
    dateFilter: dateFilter || null,
    dataRevision: dataRevision ?? null,
  });
}
