'use strict';

// Comment-rechten (#AB:328). Drie ids in dbo.user_permissions, los van de instellingen-tabs.
// Admin heeft ze altijd, zonder rijen. Eén list-query per request, gememoïseerd op req.

const sql = require('mssql');
const { ROLES } = require('../constants/roles');
const pagePermissions = require('./pagePermissions');
const { time } = require('./timing');

const COMMENT_PERMISSION_IDS = Object.freeze([
  'comments.view',
  'comments.write',
  'comments.column',
]);

// Zelfde ids als src/constants/pagePermissions.js. Instellingen blijven employee-only.
const SETTINGS_PERMISSION_IDS = Object.freeze([
  'purchase-orders',
  'users',
  'analytics',
  'mail-template',
  'odata',
  'datamodel',
  'external-links',
  'track-changes',
  'd365-refresh',
]);

const COMMENT_SET = new Set(COMMENT_PERMISSION_IDS);
const SETTINGS_SET = new Set(SETTINGS_PERMISSION_IDS);
const KNOWN_SET = new Set([...COMMENT_PERMISSION_IDS, ...SETTINGS_PERMISSION_IDS]);

function isCommentPermissionId(id) {
  return COMMENT_SET.has(id);
}

/**
 * PATCH-whitelist. Employee: instellingen + comments. Vendor: alleen comments.
 * Admin: comment-ids weigeren.
 * @returns {{ ok: true, pageNames: string[] } | { ok: false, error: string }}
 */
function classifyPermissionPatch(role, pageNames) {
  const names = [...new Set((Array.isArray(pageNames) ? pageNames : []).filter(Boolean))];
  if (!Array.isArray(pageNames)) {
    return { ok: false, error: 'Permissions must be a list' };
  }
  if (names.some((name) => !KNOWN_SET.has(name))) {
    return { ok: false, error: 'Unknown permission' };
  }
  if (role === ROLES.ADMIN && names.some((name) => COMMENT_SET.has(name))) {
    return { ok: false, error: 'Comment permissions cannot be stored for an admin' };
  }
  if (role === ROLES.SUPPLIER && names.some((name) => SETTINGS_SET.has(name))) {
    return { ok: false, error: 'Settings permissions can only be granted to employees' };
  }
  if (role !== ROLES.ADMIN && role !== ROLES.EMPLOYEE && role !== ROLES.SUPPLIER) {
    return { ok: false, error: 'Invalid role' };
  }
  return { ok: true, pageNames: names };
}

function grantsCommentPermissionsByDefault(role) {
  return role === ROLES.EMPLOYEE || role === ROLES.SUPPLIER;
}

async function deleteAllPermissions(pool, userId) {
  await pool.request()
    .input('userId', sql.Int, userId)
    .query('DELETE FROM dbo.user_permissions WHERE user_id = @userId');
}

async function deleteSettingsPermissions(pool, userId) {
  await pool.request()
    .input('userId', sql.Int, userId)
    .query(`DELETE FROM dbo.user_permissions
            WHERE user_id = @userId
              AND page_name NOT IN ('comments.view', 'comments.write', 'comments.column')`);
}

async function ensureCommentPermissions(pool, userId) {
  await pool.request()
    .input('userId', sql.Int, userId)
    .query(`INSERT INTO dbo.user_permissions (user_id, page_name)
            SELECT @userId, v.page_name
            FROM (VALUES ('comments.view'), ('comments.write'), ('comments.column')) AS v(page_name)
            WHERE NOT EXISTS (
              SELECT 1 FROM dbo.user_permissions p
              WHERE p.user_id = @userId AND p.page_name = v.page_name
            )`);
}

async function replaceUserPermissions(pool, userId, pageNames) {
  await deleteAllPermissions(pool, userId);
  for (const pageName of pageNames) {
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('pageName', sql.NVarChar, pageName)
      .query('INSERT INTO dbo.user_permissions (user_id, page_name) VALUES (@userId, @pageName)');
  }
}

/**
 * Rolwissel (#AB:328 §4a). Admin: alles weg. Vendor: alleen instellingen weg, comments aan.
 * Employee: niets weg, ontbrekende comments aan.
 */
async function applyRoleChangePermissions(pool, userId, newRole) {
  if (newRole === ROLES.ADMIN) {
    await deleteAllPermissions(pool, userId);
    return;
  }
  if (newRole === ROLES.SUPPLIER) {
    await deleteSettingsPermissions(pool, userId);
    await ensureCommentPermissions(pool, userId);
    return;
  }
  if (newRole === ROLES.EMPLOYEE) {
    await ensureCommentPermissions(pool, userId);
  }
}

async function loadCommentPermissionSet(req) {
  if (req._commentPermissions) return req._commentPermissions;
  const list = await time('perm_check', () => pagePermissions.listPagePermissions(req.user.id));
  req._commentPermissions = new Set(list);
  return req._commentPermissions;
}

async function hasCommentPermission(req, id) {
  if (!req?.user || !isCommentPermissionId(id)) return false;
  if (req.user.role === ROLES.ADMIN) return true;
  const set = await loadCommentPermissionSet(req);
  if (id === 'comments.write' || id === 'comments.column') {
    return set.has(id) && set.has('comments.view');
  }
  return set.has(id);
}

function requireCommentPermission(id) {
  return async (req, res, next) => {
    try {
      const allowed = await hasCommentPermission(req, id);
      if (!allowed) {
        return res.status(403).json({ error: 'Access denied — insufficient permissions' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function filterRemarksColumns(columns, canSeeColumn) {
  if (canSeeColumn) return columns;
  if (!Array.isArray(columns)) return columns;
  return columns.filter((column) => column?.dataType !== 'remarks');
}

module.exports = {
  COMMENT_PERMISSION_IDS,
  SETTINGS_PERMISSION_IDS,
  isCommentPermissionId,
  classifyPermissionPatch,
  grantsCommentPermissionsByDefault,
  deleteAllPermissions,
  deleteSettingsPermissions,
  ensureCommentPermissions,
  replaceUserPermissions,
  applyRoleChangePermissions,
  hasCommentPermission,
  requireCommentPermission,
  filterRemarksColumns,
};
