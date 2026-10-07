'use strict';

/**
 * TrackChangesService — beheert de globale "track changes"-configuratie en de
 * sessie-registratie. De config wordt als één JSON-string in dbo.app_settings
 * bewaard (via SettingsService); de sessie-grenzen komen uit dbo.tb_track_change_sessions.
 *
 * Config-vorm:
 *   { mode: 'session'|'week', sessionRoles: string[], columns: { [columnId]: { activatedAt: ISO } } }
 */

const sql = require('mssql');
const { getSqlPool } = require('../utils/sqlPool');
const settingsService = require('./SettingsService');
const { ALLOWED_ROLES } = require('../constants/roles');

const CONFIG_KEY = 'TRACK_CHANGES_CONFIG';
const VALID_MODES = Object.freeze(['session', 'week']);
const DEFAULT_SESSION_ROLES = Object.freeze(['admin', 'employee', 'supply_chain']);
const MAX_SESSION_BOUNDARIES = 8;

function defaultConfig() {
  return { mode: 'session', sessionRoles: [...DEFAULT_SESSION_ROLES], columns: {} };
}

function isIsoDateString(value) {
  if (typeof value !== 'string' || !value) return false;
  const t = Date.parse(value);
  return !Number.isNaN(t);
}

/**
 * Valideert en normaliseert een inkomende config. Geeft { valid, error, config } terug.
 */
function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Config must be an object' };
  }

  const mode = raw.mode;
  if (!VALID_MODES.includes(mode)) {
    return { valid: false, error: 'mode must be one of: ' + VALID_MODES.join(', ') };
  }

  const sessionRoles = raw.sessionRoles;
  if (!Array.isArray(sessionRoles) || !sessionRoles.every((r) => ALLOWED_ROLES.includes(r))) {
    return { valid: false, error: 'sessionRoles must be a subset of: ' + ALLOWED_ROLES.join(', ') };
  }

  const columns = raw.columns;
  if (columns === undefined || columns === null) {
    return {
      valid: true,
      config: { mode, sessionRoles: [...new Set(sessionRoles)], columns: {} },
    };
  }
  if (typeof columns !== 'object' || Array.isArray(columns)) {
    return { valid: false, error: 'columns must be an object' };
  }

  const normalizedColumns = {};
  for (const [columnId, entry] of Object.entries(columns)) {
    if (!/^\d+$/.test(String(columnId))) {
      return { valid: false, error: 'columns keys must be numeric column ids' };
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { valid: false, error: 'each column entry must be an object' };
    }
    if (!isIsoDateString(entry.activatedAt)) {
      return { valid: false, error: 'each column entry needs an ISO activatedAt date' };
    }
    normalizedColumns[String(columnId)] = {
      activatedAt: new Date(entry.activatedAt).toISOString(),
    };
  }

  return {
    valid: true,
    config: { mode, sessionRoles: [...new Set(sessionRoles)], columns: normalizedColumns },
  };
}

async function getConfig() {
  const raw = await settingsService.getAsync(CONFIG_KEY, '');
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw);
    const result = validateConfig(parsed);
    return result.valid ? result.config : defaultConfig();
  } catch {
    return defaultConfig();
  }
}

async function saveConfig(rawConfig, userId = null) {
  const result = validateConfig(rawConfig);
  if (!result.valid) {
    throw Object.assign(new Error(result.error), { status: 400 });
  }
  await settingsService.set(CONFIG_KEY, JSON.stringify(result.config), userId);
  return result.config;
}

/**
 * Registreert een sessie-start bij login, maar alleen als de globale modus 'session' is
 * én de rol in de geconfigureerde sessionRoles zit. O(1): één conditionele insert.
 */
async function recordSessionOnLogin(userRole) {
  try {
    const config = await getConfig();
    if (config.mode !== 'session') return;
    if (!Array.isArray(config.sessionRoles) || !config.sessionRoles.includes(userRole)) return;
    const pool = await getSqlPool();
    await pool.request()
      .input('role', sql.NVarChar(16), userRole || null)
      .query(`INSERT INTO dbo.tb_track_change_sessions (triggered_by_role) VALUES (@role)`);
  } catch (err) {
    // Sessie-registratie mag een login nooit blokkeren.
    // eslint-disable-next-line no-console
    console.error('[trackChanges] sessie-registratie mislukt:', err.message);
  }
}

/**
 * Laatste (max. 8) sessie-grenzen als Date[] (nieuwste eerst), voor de board-read.
 */
async function getSessionBoundaries(limit = MAX_SESSION_BOUNDARIES) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit) started_at
      FROM dbo.tb_track_change_sessions WITH (NOLOCK)
      ORDER BY started_at DESC
    `);
  return result.recordset.map((r) => new Date(r.started_at));
}

module.exports = {
  CONFIG_KEY,
  VALID_MODES,
  DEFAULT_SESSION_ROLES,
  MAX_SESSION_BOUNDARIES,
  defaultConfig,
  validateConfig,
  getConfig,
  saveConfig,
  recordSessionOnLogin,
  getSessionBoundaries,
};
