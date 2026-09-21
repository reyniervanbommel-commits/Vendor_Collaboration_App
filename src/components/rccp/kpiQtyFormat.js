function hasQty(value) {
  return value !== null && value !== undefined;
}

export function formatQty(value) {
  if (!hasQty(value)) return '—';
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function formatPct(value) {
  if (!hasQty(value)) return '';
  return `${(Number(value) || 0).toFixed(1)}%`;
}

export function formatDays(value) {
  if (!hasQty(value)) return '—';
  const rounded = Math.round(Number(value) * 10) / 10;
  return `Ø ${rounded} days late`;
}

export function formatItems(value) {
  if (!hasQty(value)) return '';
  return `${formatQty(value)} items`;
}

export { hasQty };
