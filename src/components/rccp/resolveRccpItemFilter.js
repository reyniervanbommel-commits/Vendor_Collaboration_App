const ITEM_FILTER_KEYS = ['itemNumber', 'items'];

/**
 * Header column used to read/write the PO-board item filter for the RCCP split.
 * Prefers `itemNumber`, then `items`, then a header linked to line `itemNumber`.
 * @param {{ key?: string }[]} [columns]
 * @param {{ headerColumnKey?: string, lineColumnKey?: string }[]} [lineValueLinks]
 * @returns {string}
 */
export function resolveRccpItemColumnKey(columns = [], lineValueLinks = []) {
  const keys = new Set(
    (Array.isArray(columns) ? columns : []).map((column) => column?.key).filter(Boolean),
  );
  if (keys.has('itemNumber')) return 'itemNumber';
  if (keys.has('items')) return 'items';
  const linked = (Array.isArray(lineValueLinks) ? lineValueLinks : []).find(
    (link) => link?.lineColumnKey === 'itemNumber' && keys.has(link.headerColumnKey),
  );
  return linked?.headerColumnKey || '';
}

function oneOfValues(filter) {
  if (Array.isArray(filter?.value)) {
    return filter.value.map((value) => String(value || '').trim()).filter(Boolean);
  }
  const raw = String(filter?.value ?? '').trim();
  if (!raw) return [];
  return raw.split(/[,;]/).map((value) => value.trim()).filter(Boolean);
}

/**
 * Item numbers implied by the PO-board column filter.
 * `contains` is applied as a substring on chart segments (no pre-scan of SKUs).
 * @param {Record<string, { operator?: string, value?: * }>} [filterByColumn]
 * @param {string[]} [chartItems]
 * @param {string} [columnKey]
 * @returns {{ items: string[], active: boolean, containsTerm?: string }}
 */
export function resolveRccpItemsFromFilter(filterByColumn, chartItems = [], columnKey = '') {
  if (!filterByColumn || typeof filterByColumn !== 'object') {
    return { items: [], active: false };
  }
  const keys = [];
  if (columnKey) keys.push(columnKey);
  for (const key of ITEM_FILTER_KEYS) {
    if (!keys.includes(key)) keys.push(key);
  }
  for (const key of keys) {
    const filter = filterByColumn[key];
    if (!filter) continue;
    const rules = Array.isArray(filter.rules) ? filter.rules : [filter];
    for (const rule of rules) {
      if (rule.operator === 'equals') {
        const value = String(rule.value ?? '').trim();
        if (value) return { items: [value], active: true };
      }
      if (rule.operator === 'oneOf') {
        const items = oneOfValues(rule);
        if (items.length) return { items, active: true };
      }
      if (rule.operator === 'contains' || rule.operator === 'startsWith') {
        const term = String(rule.value ?? '').trim().toLowerCase();
        if (!term) continue;
        return { items: [], active: true, containsTerm: term };
      }
    }
  }
  return { items: [], active: false };
}

/**
 * Toggle: same item again clears the filter; otherwise set equals/contains on that SKU.
 * The `items` header stores concatenated SKUs, so contains matches a single number in the cell.
 * @param {string} itemNumber
 * @param {{ operator?: string, value?: * }} [currentFilter]
 * @param {string} [columnKey]
 * @returns {{ action: 'clear' } | { action: 'set', filter: { operator: string, value: string, secondaryValue: string } }}
 */
export function nextRccpItemTableFilter(itemNumber, currentFilter, columnKey = 'itemNumber') {
  const sku = String(itemNumber || '').trim();
  if (!sku) return { action: 'clear' };
  const operator = currentFilter?.operator;
  if (operator === 'equals' || operator === 'contains') {
    if (String(currentFilter?.value ?? '').trim() === sku) return { action: 'clear' };
  }
  if (operator === 'oneOf') {
    const items = oneOfValues(currentFilter);
    if (items.length === 1 && items[0] === sku) return { action: 'clear' };
  }
  const useContains = columnKey === 'items' || (columnKey && columnKey !== 'itemNumber');
  return {
    action: 'set',
    filter: {
      operator: useContains ? 'contains' : 'equals',
      value: sku,
      secondaryValue: '',
    },
  };
}
