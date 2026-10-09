const VENDOR_FILTER_KEYS = ['vendorAccount', 'vendorName'];

/**
 * Maps a vendor candidate (account or display name) to a vendor account in the list.
 * @param {string} candidate
 * @param {string[]} vendors
 * @param {Record<string, string>} [vendorNames]
 * @returns {string}
 */
function mapVendorCandidate(candidate, vendors, vendorNames = {}) {
  const trimmed = String(candidate ?? '').trim();
  if (!trimmed) return '';
  const list = Array.isArray(vendors) ? vendors : [];
  if (list.includes(trimmed)) return trimmed;
  const candidateLower = trimmed.toLowerCase();
  const matchByName = list.find(
    (vendor) => (vendorNames?.[vendor] || '').toLowerCase() === candidateLower,
  );
  return matchByName || '';
}

/**
 * Leidt RCCP vendorAccount af uit PO-tabelfilters (exact equals only).
 * @param {Record<string, { operator?: string, value?: string }>} filterByColumn
 * @param {string} [vendorColumnKey='vendorAccount']
 * @returns {string|undefined}
 */
export function resolveRccpVendorFromFilter(filterByColumn, vendorColumnKey = 'vendorAccount') {
  if (!filterByColumn || typeof filterByColumn !== 'object') return undefined;

  const keys = [
    vendorColumnKey,
    ...VENDOR_FILTER_KEYS.filter((key) => key !== vendorColumnKey),
  ];

  for (const key of keys) {
    const filter = filterByColumn[key];
    const rules = Array.isArray(filter?.rules)
      ? filter.rules
      : (filter ? [filter] : []);
    for (const rule of rules) {
      if (rule?.operator !== 'equals') continue;
      const value = String(rule.value ?? '').trim();
      if (value) return value;
    }
  }

  return undefined;
}

/**
 * Bepaalt de vendor waarmee de RCCP-pagina moet openen: als de PO-pagina een vendor-filter
 * (nr of naam, operator "equals") heeft staan én die vendor bestaat in de RCCP-vendorlijst,
 * gebruik die. Anders '' (geen vendor) — de gebruiker zoekt dan zelf een vendor op, in plaats
 * van dat de pagina automatisch de eerste vendor uit de lijst laadt.
 * @param {{ vendors: string[], vendorNames?: Record<string,string>, filterByColumn?: object, vendorColumnKey?: string }} params
 * @returns {string}
 */
export function resolveDefaultRccpVendor({
  vendors,
  vendorNames = {},
  filterByColumn,
  vendorColumnKey = 'vendorAccount',
}) {
  const list = Array.isArray(vendors) ? vendors : [];
  const candidate = resolveRccpVendorFromFilter(filterByColumn, vendorColumnKey);

  if (candidate) {
    return mapVendorCandidate(candidate, list, vendorNames);
  }

  return '';
}

/**
 * Zelfde volgorde als RccpPageContent's vendor-resolve-effect: PO-tabelfilter wint (via
 * resolveDefaultRccpVendor), anders derivedVendor (zichtbare PO-rij), anders de laatst
 * gekozen/opgeslagen vendor (indien nog in de lijst), anders leeg. Gedeeld zodat de
 * idle-prefetch (dataPagesPrefetch.js) altijd exact dezelfde vendor warmt als de RCCP-pagina
 * straks zal opvragen — een losstaande kopie van deze logica loopt uit de pas zodra een van
 * de twee wijzigt.
 *
 * `lastVendorReady` laat de caller de lastVendor-fallback uitstellen totdat `lastVendor`
 * betrouwbaar is geladen (bv. `useRccpWindow().loaded`), zonder de PO-filter- of
 * derivedVendor-tak te vertragen. Zonder filter/derivedVendor én `lastVendorReady: false`
 * geeft dit `undefined` terug — "nog niet resolvable", geen state zetten.
 * @param {{ vendors: string[], vendorNames?: Record<string,string>, filterByColumn?: object, vendorColumnKey?: string, lastVendor?: string, lastVendorReady?: boolean, derivedVendor?: string }} params
 * @returns {string|undefined}
 */
export function resolveDefaultRccpVendorWithFallback({
  vendors,
  vendorNames = {},
  filterByColumn,
  vendorColumnKey = 'vendorAccount',
  lastVendor = '',
  lastVendorReady = true,
  derivedVendor = '',
}) {
  const fromFilter = resolveDefaultRccpVendor({
    vendors, vendorNames, filterByColumn, vendorColumnKey,
  });
  if (fromFilter) return fromFilter;
  const fromDerived = mapVendorCandidate(derivedVendor, vendors, vendorNames);
  if (fromDerived) return fromDerived;
  if (!lastVendorReady) return undefined;
  const list = Array.isArray(vendors) ? vendors : [];
  return lastVendor && list.includes(lastVendor) ? lastVendor : '';
}

/**
 * Vendor voor de RCCP-tab onderaan het PO-board. View-tabs filteren vaak op vendorName
 * (of zetten de naam in vendorAccount); /rccp/analysis verwacht het accountnummer.
 * Zonder mapping laadt de split-pane leeg, terwijl /rccp wél data toont.
 *
 * @returns {string|undefined} account, '' (alle vendors) of undefined (nog niet klaar)
 */
export function resolvePoBoardRccpVendor({
  isSupplier = false,
  supplierAccount = '',
  filterByColumn,
  vendors = [],
  vendorNames = {},
  vendorColumnKey = 'vendorAccount',
  vendorsReady = true,
  derivedVendor = '',
} = {}) {
  if (isSupplier) return supplierAccount || '';
  if (!vendorsReady) return undefined;
  const fromFilter = resolveDefaultRccpVendor({
    vendors, vendorNames, filterByColumn, vendorColumnKey,
  });
  if (fromFilter) return fromFilter;
  return mapVendorCandidate(derivedVendor, vendors, vendorNames);
}
