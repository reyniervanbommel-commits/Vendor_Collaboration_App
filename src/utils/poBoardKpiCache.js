import { apiRequest } from './api';

// Per (refreshKey, dateMode) één gedeelde belofte. De confirmed-set komt alleen mee wanneer de
// C/R-toggle daarom vraagt — hij kost server-side een tweede walk over alle PO-regels en
// verdubbelt de response (gemeten 22-09: 171 KB, waarvan 146 KB de twee orders-maps). De eerste
// klik op Confirmed kost daardoor één roundtrip; daarna serveert de server hem uit zijn eigen
// revisie-cache.
const entries = new Map();

function cacheKey(refreshKey, dateMode) {
  return `${String(refreshKey || '')}::${dateMode === 'confirmed' ? 'confirmed' : 'requested'}`;
}

/**
 * @param {string|number} refreshKey
 * @param {'requested'|'confirmed'} [dateMode]
 * @returns {Promise<object>}
 */
export function getPoBoardKpis(refreshKey, dateMode = 'requested') {
  const key = cacheKey(refreshKey, dateMode);
  const existing = entries.get(key);
  if (existing) return existing.data ? Promise.resolve(existing.data) : existing.inflight;

  const entry = {};
  entry.inflight = apiRequest(
    dateMode === 'confirmed' ? '/rccp/board-kpis?dateMode=confirmed' : '/rccp/board-kpis',
  )
    .then((data) => {
      entry.data = data;
      entry.inflight = null;
      return data;
    })
    .catch((err) => {
      entries.delete(key);
      throw err;
    });
  entries.set(key, entry);
  return entry.inflight;
}

export function clearPoBoardKpiCache() {
  entries.clear();
}
