/**
 * Herkomst van een PO-bordkolom (entiteit / lines / Excel), los van header↔line-koppelingen.
 */

function trimText(value) {
  return String(value || '').trim();
}

function lookupTargetKey(column) {
  return trimText(column?.lookup?.targetTableKey).toLowerCase();
}

function lookupFieldLabel(column) {
  const fromMeta = trimText(column?.lookup?.targetColumnLabel);
  if (fromMeta) return fromMeta;
  const label = trimText(column?.label);
  const tableLabel = trimText(column?.lookup?.targetTableLabel);
  if (tableLabel && label.endsWith(`(${tableLabel})`)) {
    return trimText(label.slice(0, label.length - tableLabel.length - 2));
  }
  const wrapped = label.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (wrapped) return trimText(wrapped[1]);
  return label || trimText(column?.lookup?.targetColumnKey || column?.d365Field || column?.key);
}

function nativeFieldLabel(column) {
  return trimText(column?.label || column?.d365Field || column?.key);
}

/**
 * Als de kolom hernoemd is (huidig label != originalLabel), toon de oorspronkelijke naam erbij —
 * zo weet de gebruiker altijd waar de kolom origineel vandaan kwam, ook na een rename.
 */
function renameSuffix(column) {
  const original = trimText(column?.originalLabel);
  const current = trimText(column?.label);
  if (!original || !current || original === current) return '';
  return ` (originally "${original}")`;
}

function lookupDatasetLabel(column) {
  return trimText(column?.lookup?.targetTableLabel);
}

/**
 * @param {object} [column]
 * @returns {{ key: string, groupLabel: string, fieldLabel: string }}
 */
export function getColumnOriginMeta(column) {
  if (trimText(column?.formulaExpr)) {
    return { key: 'formula', groupLabel: 'Formula', fieldLabel: '' };
  }
  const source = trimText(column?.source).toLowerCase();
  if (source === 'custom') {
    return { key: 'user', groupLabel: 'Custom', fieldLabel: '' };
  }
  const target = lookupTargetKey(column);
  if (target === 'vendors') {
    return { key: 'vendors', groupLabel: 'Vendors', fieldLabel: lookupFieldLabel(column) };
  }
  if (target === 'items') {
    return { key: 'items', groupLabel: 'Items', fieldLabel: lookupFieldLabel(column) };
  }
  if (target === 'product-receipt-lines') {
    return { key: 'receipt-lines', groupLabel: 'Receipt lines', fieldLabel: lookupFieldLabel(column) };
  }
  if (source === 'lookup' || target) {
    const dataset = lookupDatasetLabel(column);
    const field = lookupFieldLabel(column);
    return {
      key: 'excel',
      groupLabel: 'Excel',
      fieldLabel: dataset && field ? `${dataset} · ${field}` : (dataset || field),
    };
  }
  if (column?.level === 'line') {
    return { key: 'lines', groupLabel: 'Lines', fieldLabel: `${nativeFieldLabel(column)}${renameSuffix(column)}` };
  }
  return {
    key: 'purchase-orders',
    groupLabel: 'Purchase orders',
    fieldLabel: `${nativeFieldLabel(column)}${renameSuffix(column)}`,
  };
}

/**
 * @param {{ groupLabel?: string, fieldLabel?: string } | null | undefined} origin
 * @returns {string}
 */
export function formatColumnOriginTooltip(origin) {
  const groupLabel = trimText(origin?.groupLabel) || 'Custom';
  const fieldLabel = trimText(origin?.fieldLabel);
  if (!fieldLabel) return groupLabel;
  return `${groupLabel} · ${fieldLabel}`;
}

/**
 * Eén tooltiptekst voor het icooncluster: databron én eventuele header↔line-koppeling.
 * @param {string} originLabel
 * @param {string} [connectionTooltip]
 * @returns {string}
 */
export function formatColumnClusterTooltip(originLabel, connectionTooltip) {
  const origin = trimText(originLabel) || 'Custom';
  const connection = trimText(connectionTooltip);
  if (!connection) return origin;
  return `${origin}\n${connection}`;
}

function quotedName(text) {
  const match = String(text || '').match(/"([^"]+)"/);
  return trimText(match?.[1]);
}

export function isDateColumnConnectionTarget(target) {
  return trimText(target).startsWith('Date column "');
}

/**
 * Tooltip voor het ketting-icoon (header↔line of Date W/M-bron), los van de databron.
 * @param {object} [column]
 * @param {string[]} [connectionTargets]
 * @returns {string}
 */
export function getColumnConnectionTooltip(column, connectionTargets = []) {
  const targets = (Array.isArray(connectionTargets) ? connectionTargets : [])
    .map((target) => trimText(target))
    .filter(Boolean);
  if (!targets.length) return '';
  const isLine = column?.level === 'line';
  if (targets.length === 1) {
    const name = quotedName(targets[0]) || 'column';
    if (isDateColumnConnectionTarget(targets[0])) {
      return `Connected to date column "${name}"`;
    }
    return isLine
      ? `Connected to header column "${name}"`
      : `Connected to line column "${name}"`;
  }
  return isLine
    ? `Connected to ${targets.length} header columns`
    : `Connected to ${targets.length} line columns`;
}
