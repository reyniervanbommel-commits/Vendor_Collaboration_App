export const MAX_COLUMN_FILTER_RULES = 5;
const COLOR_IS = 'colorIs';

function asRule(filter) {
  if (!filter || typeof filter !== 'object' || !filter.operator || filter.operator === COLOR_IS) {
    return null;
  }
  return {
    operator: filter.operator,
    value: filter.value ?? '',
    secondaryValue: filter.secondaryValue ?? '',
  };
}

export function extractColorFilter(filter) {
  if (!filter || typeof filter !== 'object' || !Array.isArray(filter.colors)) return [];
  return filter.colors.filter(Boolean);
}

export function listRawValueRules(filter) {
  if (!filter || typeof filter !== 'object') return [];
  if (Array.isArray(filter.rules)) {
    return filter.rules.map(asRule).filter(Boolean);
  }
  const rule = asRule(filter);
  return rule ? [rule] : [];
}

export function extractValueRules(_column, filter) {
  return listRawValueRules(filter);
}

export function packColumnFilter(rules, colors = []) {
  const nextRules = (Array.isArray(rules) ? rules : []).map(asRule).filter(Boolean).slice(0, MAX_COLUMN_FILTER_RULES);
  const nextColors = (Array.isArray(colors) ? colors : []).filter(Boolean);
  if (!nextRules.length && !nextColors.length) return null;
  if (!nextRules.length) {
    return {
      operator: COLOR_IS,
      colors: nextColors,
      value: '',
      secondaryValue: '',
    };
  }
  if (nextRules.length === 1 && !nextColors.length) return nextRules[0];
  return nextColors.length ? { rules: nextRules, colors: nextColors } : { rules: nextRules };
}

export function writeColumnFilter(prev, columnKey, packed) {
  if (!packed) {
    if (!prev[columnKey]) return prev;
    const next = { ...prev };
    delete next[columnKey];
    return next;
  }
  return { ...prev, [columnKey]: packed };
}

export function appendColumnFilterRule(_column, current, incoming) {
  const colors = extractColorFilter(current);
  const rules = listRawValueRules(current);
  const nextRule = asRule(incoming);
  if (!nextRule) return packColumnFilter(rules, colors);
  if (!rules.length) return packColumnFilter([nextRule], colors);
  if (rules.length >= MAX_COLUMN_FILTER_RULES) {
    return packColumnFilter([...rules.slice(0, MAX_COLUMN_FILTER_RULES - 1), nextRule], colors);
  }
  return packColumnFilter([...rules, nextRule], colors);
}
