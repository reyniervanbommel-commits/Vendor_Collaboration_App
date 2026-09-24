'use strict';

function parseJson(raw) {
  if (!raw) return {};
  // De collapsed board-read levert data_json al als object aan (JSON_VALUE-projectie i.p.v. blob).
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

module.exports = { parseJson };
