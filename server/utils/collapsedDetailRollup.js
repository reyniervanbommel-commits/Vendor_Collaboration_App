'use strict';

// Derde en snelste variant van de detail-read voor een dichtgeklapt bord. De read heeft dan per
// order alleen een rollup nodig (aantal regels, activiteitsvlaggen, productfoto-samenvatting en de
// waarde van gekoppelde regelkolommen). Die rollup kan SQL Server zelf berekenen, waarna er per
// order één rij over de lijn gaat in plaats van één rij per regel — op het PO-bord ~6.900 in plaats
// van ~73.000. Dat is het verschil tussen tientallen seconden en een paar seconden zodra de
// database niet naast de app staat.
//
// Lukt de aggregatie niet (items-filter actief, een koppeling naar een formule-, lookup- of
// product-attribuutkolom), dan geeft resolveCollapsedRollupPlan() null terug en valt de read terug
// op de rij-voor-rij-read met smalle veldprojectie, en die zo nodig weer op de volledige blob.

const SAFE_JSON_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Scheidingsteken voor STRING_AGG: unit separator komt niet voor in D365-veldwaarden.
const LIST_SEPARATOR = '\u001f';
const MAX_AGGREGATED_LINKS = 8;

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isFormulaColumn(column) {
  return Boolean(String(column?.formulaExpr || '').trim());
}

/**
 * De JSON-velden achter een kolom, of null als de waarde niet rechtstreeks uit data_json komt.
 * Twee kandidaten, in dezelfde volgorde als resolveSourceColumnValue(): eerst het bronveld van de
 * kolom, dan de kolomsleutel. In de praktijk dragen de blobs de kolomsleutel.
 */
function directSourceFields(column) {
  if (!column || isFormulaColumn(column)) return null;
  if (String(column?.options?.kind || '') === 'product-attribute') return null;
  if (column.source !== 'source') return null;
  const primary = String(column.sourceField || column.key || '').trim();
  const fallback = String(column.key || '').trim();
  if (!SAFE_JSON_FIELD.test(primary)) return null;
  if (fallback && fallback !== primary && !SAFE_JSON_FIELD.test(fallback)) return null;
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

/** JSON_VALUE over de kandidaten, de eerste niet-lege wint. */
function jsonValueExpr(fields) {
  const parts = fields.map((field) => `JSON_VALUE(data_json, '$.${field}')`);
  return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`;
}

function numericColumn(column) {
  const dataType = String(column?.dataType || '').trim().toLowerCase();
  return dataType === 'number' || dataType === 'decimal' || dataType === 'int';
}

function linkList(runtimeLinks, group) {
  return Array.isArray(runtimeLinks?.[group]) ? runtimeLinks[group] : [];
}

/**
 * Bepaalt of de rollup volledig in SQL berekend kan worden, en met welke velden.
 *
 * @returns {{ itemField: string|null, totalLinks: object[], valueLinks: object[] }|null}
 */
function resolveCollapsedRollupPlan({
  detailColumns = [],
  runtimeLinks = null,
  itemsFilterActive = false,
} = {}) {
  // Een actief items-syncfilter bepaalt per régel of die meetelt (en of de order zichtbaar blijft).
  // Dat oordeel zit in Node, dus dan blijven we de regels zelf lezen.
  if (itemsFilterActive) return null;

  const columnsByKey = new Map();
  for (const column of detailColumns) {
    const key = normalizeKey(column?.key);
    if (key) columnsByKey.set(key, column);
  }

  const itemFields = directSourceFields(columnsByKey.get('itemnumber'));

  const resolveLinks = (group) => {
    const resolved = [];
    for (const link of linkList(runtimeLinks, group)) {
      const headerColumnKey = String(link?.headerColumnKey || '').trim();
      const lineColumnKey = normalizeKey(link?.lineColumnKey);
      if (!headerColumnKey || !lineColumnKey) continue;
      const column = columnsByKey.get(lineColumnKey);
      const fields = directSourceFields(column);
      // Koppeling naar een berekende, opgezochte of custom kolom: die waarde kent SQL niet.
      if (!fields) return null;
      resolved.push({ headerColumnKey, fields, numeric: numericColumn(column) });
    }
    return resolved;
  };

  const totalLinks = resolveLinks('lineTotalHeaderLinks');
  const valueLinks = resolveLinks('lineValueHeaderLinks');
  if (!totalLinks || !valueLinks) return null;
  if (totalLinks.length + valueLinks.length > MAX_AGGREGATED_LINKS) return null;

  return { itemFields, totalLinks, valueLinks };
}

/**
 * Bouwt de aggregatiequery. `baseline` bepaalt hoe nieuw/gewijzigd per regel wordt geteld; is er
 * geen baseline (of telt alleen het ledger), dan blijven die vlaggen 0 en vult de caller ze uit
 * het change-ledger.
 *
 * @param {object} plan - resultaat van resolveCollapsedRollupPlan
 * @param {{ enabled: boolean, exclusive: boolean }} baseline - exclusive = '>' i.p.v. '>='
 */
function buildCollapsedRollupSql(plan, baseline = { enabled: false, exclusive: false }) {
  const operator = baseline.exclusive ? '>' : '>=';
  const isNewExpr = baseline.enabled
    ? `CASE WHEN first_seen_at ${operator} @baselineAt THEN 1 ELSE 0 END`
    : '0';
  const isChangedExpr = baseline.enabled
    ? `CASE WHEN first_seen_at ${operator} @baselineAt THEN 0
            WHEN content_changed_at ${operator} @baselineAt THEN 1 ELSE 0 END`
    : '0';

  const projections = [
    `${isNewExpr} AS is_new`,
    `${isChangedExpr} AS is_changed`,
  ];
  if (plan.itemFields) {
    projections.push(`NULLIF(LTRIM(RTRIM(${jsonValueExpr(plan.itemFields)})), '') AS item_no`);
  }
  plan.totalLinks.forEach((link, i) => {
    // toLineNumeric() in de service accepteert ook een komma als decimaalteken.
    projections.push(`TRY_CONVERT(float, REPLACE(${jsonValueExpr(link.fields)}, ',', '.')) AS t${i}`);
  });
  plan.valueLinks.forEach((link, i) => {
    projections.push(`NULLIF(LTRIM(RTRIM(${jsonValueExpr(link.fields)})), '') AS v${i}`);
  });

  const aggregates = [
    'COUNT(*) AS detail_count',
    'MAX(is_new) AS has_new_line',
    'MAX(is_changed) AS has_changed_line',
    'MAX(CASE WHEN removed_at_source = 1 THEN 1 ELSE 0 END) AS has_removed_line',
  ];
  if (plan.itemFields) {
    aggregates.push('COUNT(DISTINCT CASE WHEN removed_at_source = 0 THEN item_no END) AS unique_item_count');
    // Het bord toont het itemnummer van de eerste niet-verwijderde regel. Door detail_key als
    // vaste-breedte prefix voor de waarde te zetten, levert MIN() exact die regel op; de caller
    // knipt de prefix er weer af. Scheelt een tweede pass over dezelfde 73k regels.
    aggregates.push(`MIN(CASE WHEN removed_at_source = 0 AND item_no IS NOT NULL
        THEN CONCAT(RIGHT(CONCAT('000000000000', CAST(detail_key + 1000000000 AS varchar(12))), 12), item_no) END)
      AS first_item_marker`);
  }
  plan.totalLinks.forEach((_, i) => aggregates.push(`SUM(t${i}) AS total${i}`));
  plan.valueLinks.forEach((_, i) => aggregates.push(
    `STRING_AGG(CAST(v${i} AS nvarchar(max)), CHAR(31)) WITHIN GROUP (ORDER BY detail_key) AS list${i}`,
  ));

  return `
    WITH lines AS (
      SELECT partition_key, record_key, detail_key, removed_at_source,
             ${projections.join(',\n             ')}
      FROM dbo.tb_cache WITH (NOLOCK)
      WHERE table_id = @tableId AND scope = 'detail'
    )
    SELECT partition_key, record_key,
           ${aggregates.join(',\n           ')}
    FROM lines
    GROUP BY partition_key, record_key`;
}

/** Dedupliceert een STRING_AGG-lijst met dezelfde regels als collectLinkedLineValues(). */
function parseValueList(raw, numeric) {
  if (!raw) return [];
  const seen = new Set();
  const list = [];
  for (const part of String(raw).split(LIST_SEPARATOR)) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '-' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (numeric) {
      const parsed = Number(trimmed.replace(',', '.'));
      list.push(Number.isFinite(parsed) ? parsed : trimmed);
    } else {
      list.push(trimmed);
    }
  }
  return list;
}

/**
 * Zet de geaggregeerde rijen om naar rollups per order-sleutel (`partitionKey|recordKey`).
 * @returns {Map<string, object>}
 */
function parseCollapsedRollupRows(recordset, plan) {
  const byRecord = new Map();
  for (const row of Array.isArray(recordset) ? recordset : []) {
    const marker = row.first_item_marker || '';
    const firstItemNumber = marker ? String(marker).slice(12) : '';
    const uniqueItemCount = Number(row.unique_item_count) || 0;

    const totals = {};
    plan.totalLinks.forEach((link, i) => {
      const value = row[`total${i}`];
      totals[link.headerColumnKey] = value === null || value === undefined ? 0 : Number(value);
    });
    const values = {};
    plan.valueLinks.forEach((link, i) => {
      values[link.headerColumnKey] = parseValueList(row[`list${i}`], link.numeric);
    });

    byRecord.set(`${row.partition_key}|${row.record_key}`, {
      detailCount: Number(row.detail_count) || 0,
      hasNewLine: Boolean(row.has_new_line),
      hasChangedLine: Boolean(row.has_changed_line),
      hasRemovedLine: Boolean(row.has_removed_line),
      firstItemNumber,
      uniqueItemCount,
      totals,
      values,
    });
  }
  return byRecord;
}

module.exports = {
  resolveCollapsedRollupPlan,
  buildCollapsedRollupSql,
  parseCollapsedRollupRows,
  parseValueList,
  LIST_SEPARATOR,
};
