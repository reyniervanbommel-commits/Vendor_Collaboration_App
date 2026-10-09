'use strict';

// Maakt een D365 OData-schrijffout leesbaar voor de gebruiker: alleen de Infolog-reden,
// zonder prefix, entity-pad en generieke ruis. De ruwe tekst blijft in tb_field_corrections.
const ODATA_PREFIX = /^D365 OData request failed \(\d+\)\s*:\s*/i;
const ENTITY_PATH = /^\/data\/[^:]*?\)\s*:\s*/i;
const LEVEL_PREFIX = /^(warning|error|info)\s*:\s*/i;
const NOISE = [
  /^validateWrite failed on data source\b/i,
  /^Write failed for table row of type\b/i,
];

function cleanPart(part) {
  return String(part || '').trim().replace(LEVEL_PREFIX, '').trim();
}

function isNoise(text) {
  return !text || NOISE.some((re) => re.test(text));
}

function uniqueParts(parts) {
  const seen = new Set();
  const result = [];
  for (const raw of parts) {
    const text = cleanPart(raw);
    if (isNoise(text) || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function summarizeD365WriteError(message) {
  const original = String(message || '').trim();
  if (!original) return '';
  if (!ODATA_PREFIX.test(original)) return original;

  const infologIndex = original.search(/Infolog\s*:/i);
  if (infologIndex >= 0) {
    const infolog = original.slice(infologIndex).replace(/^Infolog\s*:\s*/i, '');
    const parts = uniqueParts(infolog.split(';'));
    if (parts.length) return parts.join(' ');
  }

  const detail = original.replace(ODATA_PREFIX, '').replace(ENTITY_PATH, '').trim();
  const parts = uniqueParts(detail.split(/(?<=\.)\s+/));
  return parts.length ? parts.join(' ') : original;
}

module.exports = { summarizeD365WriteError };
