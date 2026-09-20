import { formatDays, formatItems, formatPct } from './RccpKpiCard';

/**
 * Bouwt dezelfde per-tegel props als RccpKpiCards.jsx, per KPI-sleutel, zodat de kleine
 * tegels in het rechterdeel van de "Performance & Planning" tab (RccpSplitKpiPanel) er
 * identiek uitzien/werken (incl. pie-achtergrond, C/R-toggle) als de grote PO-board tegels.
 * Alle 10 kaarten uit RccpKpiCards zijn hier beschikbaar; capaciteits-KPI's hebben geen
 * per-order match-set, dus die tegels zijn wél zichtbaar maar niet klikbaar (zie
 * RccpSplitKpiPanel.CLICKABLE_SPLIT_PANEL_KPI_KEYS).
 */
const BUILDERS = {
  ordered: (k, c) => ({
    label: 'Total ordered',
    qty: k.totalOrdered,
    hash: true,
    confirmed: c ? { qty: c.totalOrdered, hash: true } : null,
  }),
  delivered: (k, c) => ({
    label: 'Total delivered',
    qty: k.totalDelivered,
    hash: true,
    pct: formatPct(k.deliveredPercent),
    confirmed: c ? { qty: c.totalDelivered, hash: true, pct: formatPct(c.deliveredPercent) } : null,
  }),
  open: (k, c) => ({
    label: 'Total open',
    qty: k.totalOpen,
    hash: true,
    aside: formatItems(k.openItemCount),
    pct: formatPct(k.openPercent),
    confirmed: c ? {
      qty: c.totalOpen, hash: true, aside: formatItems(c.openItemCount), pct: formatPct(c.openPercent),
    } : null,
  }),
  lateDelivery: (k, c) => ({
    label: 'Late delivery',
    qty: k.lateDeliveryUnits,
    hash: true,
    aside: formatItems(k.lateDeliveryItemCount),
    pct: formatPct(k.lateDeliveryPercent),
    confirmed: c ? {
      qty: c.lateDeliveryUnits, hash: true, aside: formatItems(c.lateDeliveryItemCount), pct: formatPct(c.lateDeliveryPercent),
    } : null,
  }),
  onTime: (k, c) => ({
    label: 'On time delivery',
    qty: k.onTimeUnits,
    hash: true,
    aside: formatItems(k.onTimeItemCount),
    pct: formatPct(k.onTimePercent),
    confirmed: c ? {
      qty: c.onTimeUnits, hash: true, aside: formatItems(c.onTimeItemCount), pct: formatPct(c.onTimePercent),
    } : null,
  }),
  openLate: (k, c) => ({
    label: 'Open and late',
    qty: k.openLateUnits,
    hash: true,
    aside: formatItems(k.openLateItemCount),
    detail: formatDays(k.openLateAvgDays),
    confirmed: c ? {
      qty: c.openLateUnits, hash: true, aside: formatItems(c.openLateItemCount), detail: formatDays(c.openLateAvgDays),
    } : null,
  }),
  lateItems: (k, c) => ({
    label: 'Average days late',
    qty: k.lateDeliveryAvgDays,
    hash: 'Ø',
    aside: 'days late',
    confirmed: c ? { qty: c.lateDeliveryAvgDays, hash: 'Ø', aside: 'days late' } : null,
  }),
  unconfirmed: (k, c) => ({
    label: 'Not confirmed',
    qty: k.unconfirmedUnits,
    hash: true,
    aside: formatItems(k.unconfirmedItemCount),
    pct: formatPct(k.unconfirmedPercent),
    confirmed: c ? {
      qty: c.unconfirmedUnits, hash: true, aside: formatItems(c.unconfirmedItemCount), pct: formatPct(c.unconfirmedPercent),
    } : null,
  }),
  // Geen per-order match-set (board-scope kent geen capaciteit) → altijd '—' en niet klikbaar.
  capacityShortfall: (k) => ({ label: 'Capacity shortfall', qty: k.capacityShortfall, hash: true }),
  overloadedWeeks: (k) => ({ label: 'Overloaded weeks', qty: k.overloadedWeeks, hash: true }),
};

export const SPLIT_PANEL_CARD_KPI_KEYS = Object.keys(BUILDERS);
export const SPLIT_PANEL_KPI_LIMIT = SPLIT_PANEL_CARD_KPI_KEYS.length;
// Alleen deze tegels hebben een per-order match-set en kunnen dus de PO-tabel filteren.
export const CLICKABLE_SPLIT_PANEL_KPI_KEYS = Object.freeze([
  'ordered', 'delivered', 'open', 'lateDelivery', 'onTime', 'openLate', 'lateItems', 'unconfirmed',
]);

export function resolveKpiCardProps(kpiKey, kpis, kpisConfirmed) {
  const builder = BUILDERS[kpiKey];
  if (!builder || !kpis) return null;
  return { kpiKey, ...builder(kpis, kpisConfirmed) };
}
