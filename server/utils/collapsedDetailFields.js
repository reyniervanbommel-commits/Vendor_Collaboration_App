'use strict';

// Zolang een order dichtgeklapt is vraagt het board de sublijnen niet op (includeDetails=false),
// maar de read las tot nu toe wél elke detail-blob uit tb_cache om er de rollup van te maken.
// Op een remote database is dat veruit het duurste deel van de board-read: ~52 MB JSON voor ~73k
// regels, die SQL Server naar de app moet streamen (wait_type ASYNC_NETWORK_IO).
//
// Deze module bepaalt welke velden er dan nog echt uit data_json moeten komen, zodat de query een
// smalle JSON_VALUE-projectie kan doen in plaats van de hele blob. Kan de set niet met zekerheid
// bepaald worden — een formule zonder bekende referenties, een lookup zonder bronveld, een
// veldnaam die niet veilig in een JSON-pad past — dan geeft resolveCollapsedDetailFields() null
// terug en leest de caller gewoon de volledige blob (huidig gedrag).

// Velden die de rollup zelf nodig heeft: buildDetailRollup leest detail.values.itemNumber voor de
// productfoto-samenvatting. De new/changed/removed-vlaggen komen uit eigen kolommen (first_seen_at,
// content_changed_at, removed_at_source) en het ledger — niet uit data_json.
const ROLLUP_COLUMN_KEYS = ['itemNumber'];

// Een formulekolom mag naar een andere formulekolom verwijzen; dieper dan dit volgen we niet.
const MAX_FORMULA_DEPTH = 3;

// JSON-pad wordt als letterlijke string in de query gezet. Alleen deze vorm is veilig zonder
// escaping; alles daarbuiten (punten, haken, quotes) valt terug op de volledige blob.
const SAFE_JSON_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isFormulaColumn(column) {
  return Boolean(String(column?.formulaExpr || '').trim());
}

function isProductAttributeColumn(column) {
  return String(column?.options?.kind || '') === 'product-attribute';
}

/** Kolomtype → hoe de JSON_VALUE-string terug te zetten naar de oorspronkelijke waarde. */
function valueTypeFor(column) {
  const dataType = String(column?.dataType || '').trim().toLowerCase();
  if (dataType === 'number' || dataType === 'decimal' || dataType === 'int') return 'number';
  if (dataType === 'bool' || dataType === 'boolean') return 'bool';
  return 'string';
}

function collectLinkedLineColumnKeys(runtimeLinks) {
  const keys = [];
  for (const group of ['lineTotalHeaderLinks', 'lineValueHeaderLinks']) {
    const links = Array.isArray(runtimeLinks?.[group]) ? runtimeLinks[group] : [];
    for (const link of links) {
      const lineColumnKey = normalizeKey(link?.lineColumnKey);
      if (lineColumnKey) keys.push(lineColumnKey);
    }
  }
  return keys;
}

/** Bronvelden waarmee een lookup zijn doelrij zoekt (enkel FK of samengestelde join). */
function lookupSourceFields(lookup) {
  const joinKeys = Array.isArray(lookup?.joinKeys) ? lookup.joinKeys : [];
  if (joinKeys.length) {
    const fields = joinKeys.map((join) => String(join?.sourceKey || '').trim()).filter(Boolean);
    return fields.length === joinKeys.length ? fields : null;
  }
  const sourceField = String(lookup?.sourceFieldKey || lookup?.sourceField || '').trim();
  return sourceField ? [sourceField] : null;
}

/**
 * Bepaalt de minimale set data_json-velden voor een collapsed board-read.
 *
 * @param {object} input
 * @param {object[]} input.detailColumns - actieve detail-kolommen (tb_columns, scope 'detail')
 * @param {object} input.runtimeLinks - push-total/push-values koppelingen van het board
 * @param {object[]} input.lookups - verrijkte lookups (enrichment.lookups)
 * @param {string[]} [input.alwaysFields] - rauwe JSON-velden die altijd mee moeten (items-filter)
 * @param {Map<string,string[]>} [input.formulaReferences] - kolom-key → referenties uit de formule
 * @returns {{ field: string, type: 'string'|'number'|'bool' }[]|null} null = niet reduceerbaar
 */
function resolveCollapsedDetailFields({
  detailColumns = [],
  runtimeLinks = null,
  lookups = [],
  alwaysFields = [],
  formulaReferences = null,
} = {}) {
  const columnsByKey = new Map();
  for (const column of detailColumns) {
    const key = normalizeKey(column?.key);
    if (key) columnsByKey.set(key, column);
  }

  const lookupByDerivedKey = new Map();
  for (const lookup of lookups) {
    if (lookup?.sourceScope !== 'detail') continue;
    for (const [derivedKey] of Array.isArray(lookup.fieldEntries) ? lookup.fieldEntries : []) {
      const key = normalizeKey(derivedKey);
      if (key) lookupByDerivedKey.set(key, lookup);
    }
  }

  const fieldsByName = new Map();
  let reducible = true;

  // `fallback` volgt resolveSourceColumnValue(): die kijkt eerst naar het bronveld van de kolom en
  // daarna naar de kolomsleutel. In de praktijk dragen de blobs de kolomsleutel, dus beide zijn
  // nodig om dezelfde waarde te vinden als de volledige-blob-variant.
  const addField = (field, type, fallback = null) => {
    const name = String(field || '').trim();
    if (!name) return;
    const fallbackName = String(fallback || '').trim();
    if (!SAFE_JSON_FIELD.test(name) || (fallbackName && !SAFE_JSON_FIELD.test(fallbackName))) {
      reducible = false;
      return;
    }
    // Een veld dat zowel als tekst als als getal wordt gevraagd houden we op de ruwe string:
    // dat is wat de huidige code ook uit de blob zou krijgen bij een tekstkolom.
    const existing = fieldsByName.get(name);
    if (existing) {
      if (existing.type !== type) existing.type = 'string';
      if (!existing.fallback && fallbackName && fallbackName !== name) existing.fallback = fallbackName;
      return;
    }
    fieldsByName.set(name, {
      field: name,
      type,
      ...(fallbackName && fallbackName !== name ? { fallback: fallbackName } : {}),
    });
  };

  const visited = new Set();
  const resolveColumnKey = (rawKey, depth) => {
    if (!reducible) return;
    const key = normalizeKey(rawKey);
    if (!key || visited.has(`${key}@${depth}`)) return;
    visited.add(`${key}@${depth}`);

    const column = columnsByKey.get(key);
    if (!column) {
      // Geen eigen kolom: dan is het een door een lookup afgeleide sleutel, of de kolom bestaat
      // niet (meer) — in dat laatste geval levert de huidige code ook null op, dus veilig.
      const lookup = lookupByDerivedKey.get(key);
      if (!lookup) return;
      const sourceFields = lookupSourceFields(lookup);
      if (!sourceFields) {
        reducible = false;
        return;
      }
      for (const field of sourceFields) addField(field, 'string');
      return;
    }

    if (isFormulaColumn(column)) {
      const references = formulaReferences?.get(key);
      if (!Array.isArray(references) || depth >= MAX_FORMULA_DEPTH) {
        reducible = false;
        return;
      }
      for (const reference of references) resolveColumnKey(reference, depth + 1);
      return;
    }

    // Product-attribuutkolommen worden uit de PAV-pivot gevuld op basis van itemNumber; dat veld
    // staat al in de set omdat de rollup het sowieso nodig heeft.
    if (isProductAttributeColumn(column)) return;

    // Custom-kolommen komen uit tb_custom_values (eigen query), niet uit data_json.
    if (column.source !== 'source') return;

    addField(column.sourceField || column.key, valueTypeFor(column), column.key);
  };

  for (const field of alwaysFields) addField(field, 'string');
  for (const key of ROLLUP_COLUMN_KEYS) resolveColumnKey(key, 0);
  for (const key of collectLinkedLineColumnKeys(runtimeLinks)) resolveColumnKey(key, 0);

  if (!reducible) return null;
  return [...fieldsByName.values()];
}

/** Zet de nvarchar-resultaten van JSON_VALUE terug naar een data_json-achtig object. */
function buildDetailJsonFromProjection(row, fields) {
  const json = {};
  for (let i = 0; i < fields.length; i += 1) {
    const raw = row[`f${i}`];
    if (raw === null || raw === undefined) continue;
    const { field, type } = fields[i];
    if (type === 'number') {
      const parsed = Number(raw);
      json[field] = Number.isFinite(parsed) ? parsed : raw;
    } else if (type === 'bool') {
      json[field] = raw === 'true' || raw === '1';
    } else {
      json[field] = raw;
    }
  }
  return json;
}

/** SELECT-fragment voor de gereduceerde detail-read. Velden zijn al op veiligheid getoetst. */
function buildDetailProjectionSql(fields) {
  return fields.map((entry, i) => {
    const primary = `JSON_VALUE(data_json, '$.${entry.field}')`;
    const expression = entry.fallback
      ? `COALESCE(${primary}, JSON_VALUE(data_json, '$.${entry.fallback}'))`
      : primary;
    return `${expression} AS f${i}`;
  }).join(', ');
}

module.exports = {
  resolveCollapsedDetailFields,
  buildDetailJsonFromProjection,
  buildDetailProjectionSql,
  collectLinkedLineColumnKeys,
};
