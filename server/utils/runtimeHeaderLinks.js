'use strict';

const sql = require('mssql');
const { ROLES } = require('../constants/roles');

const MAX_LINKS = 80;
const STAFF_LINKS_TTL_MS = 60_000;
const staffLinksCache = new Map();

function emptyRuntimeHeaderLinks() {
  return { lineTotalHeaderLinks: [], lineValueHeaderLinks: [] };
}

function normalizeColumnKey(value) {
  return String(value || '').trim().slice(0, 64);
}

function normalizeRuntimeLinkArray(value) {
  const entries = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? [value] : []);
  const seen = new Set();
  return entries.slice(0, MAX_LINKS).reduce((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;
    const lineColumnKey = normalizeColumnKey(entry.lineColumnKey);
    const headerColumnKey = normalizeColumnKey(entry.headerColumnKey);
    if (!lineColumnKey || !headerColumnKey) return acc;
    const signature = `${lineColumnKey}|${headerColumnKey}`;
    if (seen.has(signature)) return acc;
    seen.add(signature);
    acc.push({ lineColumnKey, headerColumnKey });
    return acc;
  }, []);
}

function parseRuntimeHeaderLinks(settingsJsonOrObject) {
  let parsed = settingsJsonOrObject;
  if (typeof settingsJsonOrObject === 'string') {
    try {
      parsed = JSON.parse(settingsJsonOrObject || '{}');
    } catch {
      return emptyRuntimeHeaderLinks();
    }
  }
  if (!parsed || typeof parsed !== 'object') return emptyRuntimeHeaderLinks();
  return {
    lineTotalHeaderLinks: normalizeRuntimeLinkArray(parsed.lineTotalHeaderLinks),
    lineValueHeaderLinks: normalizeRuntimeLinkArray(parsed.lineValueHeaderLinks),
  };
}

function mergeRuntimeHeaderLinks(...groups) {
  const totalsByHeader = new Map();
  const valuesByHeader = new Map();
  for (const group of groups) {
    for (const link of normalizeRuntimeLinkArray(group?.lineTotalHeaderLinks)) {
      totalsByHeader.set(link.headerColumnKey, link);
    }
    for (const link of normalizeRuntimeLinkArray(group?.lineValueHeaderLinks)) {
      valuesByHeader.set(link.headerColumnKey, link);
    }
  }
  return {
    lineTotalHeaderLinks: [...totalsByHeader.values()],
    lineValueHeaderLinks: [...valuesByHeader.values()],
  };
}

function collectLinkedHeaderKinds(runtimeLinks) {
  const kinds = Object.create(null);
  for (const link of normalizeRuntimeLinkArray(runtimeLinks?.lineTotalHeaderLinks)) {
    kinds[link.headerColumnKey] = 'total';
  }
  for (const link of normalizeRuntimeLinkArray(runtimeLinks?.lineValueHeaderLinks)) {
    if (!kinds[link.headerColumnKey]) kinds[link.headerColumnKey] = 'values';
  }
  return kinds;
}

function annotateAdminColumnsWithLineLinks(columns, runtimeLinks) {
  const list = Array.isArray(columns) ? columns : [];
  const kinds = collectLinkedHeaderKinds(runtimeLinks);
  if (!Object.keys(kinds).length) return list;
  return list.map((column) => {
    const kind = kinds[column?.key];
    return kind ? { ...column, linkedFromLine: kind } : column;
  });
}

async function loadOwnRuntimeHeaderLinks(pool, userId, boardKey) {
  if (!pool || !userId || !boardKey) return emptyRuntimeHeaderLinks();
  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .input('boardKey', sql.NVarChar(64), boardKey)
    .query(`
      SELECT settings_json
      FROM dbo.user_board_settings WITH (NOLOCK)
      WHERE user_id = @userId AND board_key = @boardKey
    `);
  if (!result.recordset.length) return emptyRuntimeHeaderLinks();
  return parseRuntimeHeaderLinks(result.recordset[0].settings_json);
}

function clearRuntimeHeaderLinksCache() {
  staffLinksCache.clear();
}

async function loadStaffRuntimeHeaderLinks(pool, boardKey) {
  if (!pool || !boardKey) return emptyRuntimeHeaderLinks();
  const cached = staffLinksCache.get(boardKey);
  if (cached && cached.expiresAt > Date.now()) return cached.links;
  const result = await pool.request()
    .input('boardKey', sql.NVarChar(64), boardKey)
    .input('adminRole', sql.NVarChar(32), ROLES.ADMIN)
    .input('employeeRole', sql.NVarChar(32), ROLES.EMPLOYEE)
    .input('supplyChainRole', sql.NVarChar(32), ROLES.SUPPLY_CHAIN)
    .query(`
      SELECT s.settings_json
      FROM dbo.user_board_settings s WITH (NOLOCK)
      INNER JOIN dbo.users u WITH (NOLOCK) ON u.id = s.user_id
      WHERE s.board_key = @boardKey
        AND LOWER(LTRIM(RTRIM(u.role))) IN (LOWER(@adminRole), LOWER(@employeeRole), LOWER(@supplyChainRole))
      ORDER BY s.updated_at ASC
    `);
  let merged = emptyRuntimeHeaderLinks();
  for (const row of result.recordset) {
    merged = mergeRuntimeHeaderLinks(merged, parseRuntimeHeaderLinks(row.settings_json));
  }
  staffLinksCache.set(boardKey, { expiresAt: Date.now() + STAFF_LINKS_TTL_MS, links: merged });
  return merged;
}

async function loadRuntimeHeaderLinks(pool, userId, boardKey, { includeStaffLinks = false } = {}) {
  const own = await loadOwnRuntimeHeaderLinks(pool, userId, boardKey);
  if (!includeStaffLinks) return own;
  const staff = await loadStaffRuntimeHeaderLinks(pool, boardKey);
  return mergeRuntimeHeaderLinks(staff, own);
}

module.exports = {
  parseRuntimeHeaderLinks,
  mergeRuntimeHeaderLinks,
  loadRuntimeHeaderLinks,
  loadStaffRuntimeHeaderLinks,
  collectLinkedHeaderKinds,
  annotateAdminColumnsWithLineLinks,
  normalizeRuntimeLinkArray,
  clearRuntimeHeaderLinksCache,
};
