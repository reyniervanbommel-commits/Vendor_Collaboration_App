/**
 * Fallback (statische) formule-teksten. Gebruikt wanneer er geen RCCP-config
 * beschikbaar is (bijv. nog niet geladen) — anders wint `buildKpiFormulaText`.
 */
export const KPI_FORMULAS = {
  ordered: 'open + delivered\non visible purchase-order lines',
  delivered: 'delivered\n% = delivered / ordered × 100',
  open: 'open\nitems = unique item numbers still open\n% = open / ordered × 100',
  lateDelivery: 'delivered where receipt date > requested delivery date\nitems = unique item numbers on those lines\n% = late / ordered × 100',
  lateItems: 'Ø = average of (receipt date − requested delivery date)\nin calendar days, only where receipt date > requested delivery date',
  onTime: 'delivered where receipt date ≤ requested delivery date\n1-1-1900 and missing receipt dates are excluded\nitems = unique item numbers\n% = on time / ordered × 100',
  openLate: 'open where requested delivery ISO week < current ISO week\nitems = unique item numbers on those lines\nØ days late = average of (today − requested delivery date)',
  planned1900: 'open + delivered where requested delivery date is 1-1-1900\n(D365 empty date)\nitems = unique item numbers on those lines',
  unconfirmed: 'open + delivered on lines without a confirmed date\nitems = unique item numbers on those lines\n% = unconfirmed / ordered × 100',
  capacityShortfall: 'sum of (open load − capacity)\nin weeks where load > capacity\nnot available on the purchase-order board',
  overloadedWeeks: 'count of weeks where open load > capacity\nnot available on the purchase-order board',
};

/**
 * Zoekt het door de gebruiker ingestelde label voor een RCCP quantity-measure
 * (Open / Received-slot uit de instellingen). Valt terug op de meegegeven
 * standaardnaam wanneer er geen config of geen label is.
 * @param {{ quantityMeasures?: Array<{ columnKey?: string, label?: string }> }} config
 * @param {string} measureKey
 * @param {string} fallbackLabel
 * @returns {string}
 */
function resolveMeasureLabel(config, measureKey, fallbackLabel) {
  const key = String(measureKey || '').trim();
  if (!key || !config) return fallbackLabel;
  const measures = Array.isArray(config.quantityMeasures) ? config.quantityMeasures : [];
  const match = measures.find((m) => m?.columnKey === key);
  const label = match?.label && String(match.label).trim();
  return label || fallbackLabel;
}

/**
 * Stelt de formule-tekst per KPI samen op basis van de huidige RCCP-instellingen
 * (Open/Received-labels uit de Quantities-tab). Zonder config vallen we terug op
 * de generieke termen "open"/"delivered" (identiek aan de vorige statische tekst).
 *
 * "Requested delivery date" (settings-tab Data, veld `dateColumnKey`) is de datum
 * die de server voor deze KPI's altijd als "planned"-datum gebruikt (zie
 * `server/utils/rccpKpis.js` → `walkRccpPoKpiLines`, `plannedDate = lineDateValue(...,
 * dateKey)`). De confirmed delivery date (`confirmedDateColumnKey`) telt hier niet mee —
 * die bepaalt alleen de "Not confirmed"-KPI (heeft de regel wel/geen bevestigde datum) en
 * de week-plaatsing in de capaciteitsgrafiek, niet de late/on-time-vergelijking.
 * @param {string} kpiKey
 * @param {object|null|undefined} config RCCP-config (bijv. `analysis.config` of het board-kpis payload-config)
 * @returns {string}
 */
export function buildKpiFormulaText(kpiKey, config) {
  const open = resolveMeasureLabel(config, config?.openMeasureKey, 'open');
  const delivered = resolveMeasureLabel(config, config?.deliveredMeasureKey, 'delivered');
  const ordered = `${open} + ${delivered}`;
  const requestedDate = 'requested delivery date';

  const formulas = {
    ordered: `${ordered}\non visible purchase-order lines`,
    delivered: `${delivered}\n% = ${delivered} / ${ordered} × 100`,
    open: `${open}\nitems = unique item numbers still open\n% = ${open} / ${ordered} × 100`,
    lateDelivery: `${delivered} where receipt date > ${requestedDate}\nitems = unique item numbers on those lines\n% = late / ${ordered} × 100`,
    lateItems: `Ø = average of (receipt date − ${requestedDate})\nin calendar days, only where receipt date > ${requestedDate}`,
    onTime: `${delivered} where receipt date ≤ ${requestedDate}\n1-1-1900 and missing receipt dates are excluded\nitems = unique item numbers\n% = on time / ${ordered} × 100`,
    openLate: `${open} where ${requestedDate} ISO week < current ISO week\nitems = unique item numbers on those lines\nØ days late = average of (today − ${requestedDate})`,
    planned1900: `${ordered} where ${requestedDate} is 1-1-1900\n(D365 empty date)\nitems = unique item numbers on those lines`,
    unconfirmed: `${ordered} on lines without a confirmed date\nitems = unique item numbers on those lines\n% = unconfirmed / ${ordered} × 100`,
    capacityShortfall: `sum of (${open} load − capacity)\nin weeks where load > capacity\nnot available on the purchase-order board`,
    overloadedWeeks: `count of weeks where ${open} load > capacity\nnot available on the purchase-order board`,
  };

  return formulas[kpiKey] || KPI_FORMULAS[kpiKey] || '';
}
