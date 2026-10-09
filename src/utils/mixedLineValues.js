const EMPTY_VALUES = new Set(['', '-']);
const MAX_SHOWN = 3;
const MAX_LENGTH = 40;

// Zelfde ontdubbeling als de server-rollup (collectLinkedLineValues): trim, lege waarden weg.
export function distinctLineValues(values) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    if (raw === null || raw === undefined) continue;
    const key = String(raw).trim();
    if (EMPTY_VALUES.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function findOrdersWithMixedValues(rows, headerColumnKey) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => distinctLineValues(row?.linkedLineValues?.[headerColumnKey]).length > 1,
  );
}

function shortValue(value) {
  const text = String(value ?? '');
  const display = /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
  return display.length > MAX_LENGTH ? `${display.slice(0, MAX_LENGTH - 1)}…` : display;
}

export function buildMixedValuesMessage({
  rows, mixedRows, headerColumnKey, value,
}) {
  const target = `"${shortValue(value)}"`;
  if (rows.length === 1) {
    const row = rows[0];
    const values = distinctLineValues(row?.linkedLineValues?.[headerColumnKey]);
    const shown = values.slice(0, MAX_SHOWN).map((v) => `"${shortValue(v)}"`).join(', ');
    const more = values.length > MAX_SHOWN ? ', …' : '';
    return `Lines on order ${row.orderNumber} currently have ${values.length} different values (${shown}${more}). All lines will be set to ${target} in D365.`;
  }
  return `${mixedRows.length} of ${rows.length} selected orders have different line values. All their lines will be set to ${target} in D365.`;
}
