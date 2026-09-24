'use strict';

const express = require('express');
const sql = require('mssql');
const router = express.Router();
const authService = require('../services/AuthService');
const emailService = require('../services/EmailService');
const { auditLog } = require('../middleware/auditLog');
const { parsePaginationParams, buildPaginationMeta } = require('../utils/pagination');
const { ROLES, isAllowedRole } = require('../constants/roles');
const settingsService = require('../services/SettingsService');
const trackChangesService = require('../services/TrackChangesService');
const rccpSettingsService = require('../services/RccpSettingsService');
const passwordResetEmailTemplateService = require('../services/PasswordResetEmailTemplateService');
const sqlPool = require('../utils/sqlPool');
const { requireRole, requirePagePermission } = require('../middleware/auth');
const { getAppBaseUrl } = require('../utils/appEnvironment');
const { getSecretExpiryStatus } = require('../utils/secretExpiry');
const { expandRetentionSettings } = require('../utils/syncRetentionSettings');
const refreshRunService = require('../services/RefreshRunService');
const { parseAlertEmails, serializeAlertEmails } = require('../utils/alertEmails');
const poTableZoomSettings = require('../services/PoTableZoomSettings');
const { ONBOARDING_BOARD_KEY, buildOnboardingProgressRow } = require('../utils/onboardingSettings');
const { time } = require('../utils/timing');
const commentPermissions = require('../utils/commentPermissions');

function getPool() {
  return sqlPool.getSqlPool();
}

// Leveranciersaccount normaliseren: getrimd, max 64 tekens, lege waarde -> null.
function normalizeVendorAccount(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

// De 'users'-permissie geeft een employee alleen leesrecht + het aanmaken van een supplier-account.
// Een staff-account aanmaken blijft admin-only, anders is dit een escalatiepad (#AB:326).
function requireUsersCreateGuard(req, res, next) {
  const role = authService.normalizeRole(req.body?.role || ROLES.SUPPLIER);
  if (role === ROLES.SUPPLIER) return requirePagePermission('users')(req, res, next);
  return requireRole(ROLES.ADMIN)(req, res, next);
}

router.get('/users', requirePagePermission('users'), async (req, res, next) => {
  try {
    const { page, pageSize } = parsePaginationParams(req.query);
    const offset = (page - 1) * pageSize;
    const pool = await getPool();

    const countResult = await pool.request().query('SELECT COUNT(*) as total FROM dbo.users');
    const total = countResult.recordset[0].total;

    const result = await pool.request()
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, pageSize)
      .query('SELECT id, email, display_name, role, vendor_account, must_set_password, is_locked, mfa_enabled, mfa_required, last_login, created_at FROM dbo.users ORDER BY created_at DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY');

    res.json({ users: result.recordset, meta: buildPaginationMeta(total, page, pageSize) });
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireUsersCreateGuard, async (req, res, next) => {
  try {
    const { email, role, display_name, vendor_account } = req.body;
    if (!email) return res.status(400).json({ error: 'Email address is required' });
    const normalizedRole = authService.normalizeRole(role || ROLES.SUPPLIER);
    if (!isAllowedRole(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role specified' });
    }
    const pool = await getPool();
    const result = await pool.request()
      .input('email', sql.NVarChar, authService.normalizeEmail(email))
      .input('role', sql.NVarChar, normalizedRole)
      .input('displayName', sql.NVarChar, display_name || null)
      .input('vendorAccount', sql.NVarChar, normalizeVendorAccount(vendor_account))
      .query('INSERT INTO dbo.users (email, role, display_name, vendor_account) OUTPUT INSERTED.* VALUES (@email, @role, @displayName, @vendorAccount)');
    const newUser = result.recordset[0];
    if (commentPermissions.grantsCommentPermissionsByDefault(newUser.role)) {
      await commentPermissions.ensureCommentPermissions(pool, newUser.id);
    }
    const setPasswordUrl = getAppBaseUrl() + '/set-password?email=' + encodeURIComponent(newUser.email);
    await emailService.sendInviteEmail(newUser.email, setPasswordUrl).catch(() => {});
    await auditLog(req.user.id, req.user.email, 'CREATE_USER', 'users', newUser.id, { email: newUser.email, role: newUser.role });
    res.status(201).json({ user: newUser });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, is_locked, mfa_required, vendor_account } = req.body;
    const pool = await getPool();
    const setClauses = [];
    const request = pool.request().input('id', sql.Int, parseInt(id));

    if (role !== undefined) {
      const normalizedRole = authService.normalizeRole(role);
      if (!isAllowedRole(normalizedRole)) {
        return res.status(400).json({ error: 'Invalid role specified' });
      }
      // Voorkomt dat een admin zichzelf uit de admin-rol schrijft en daarmee buitensluit.
      if (parseInt(id) === req.user.id && normalizedRole !== ROLES.ADMIN) {
        return res.status(400).json({ error: 'You cannot change your own role' });
      }
      setClauses.push('role = @role');
      request.input('role', sql.NVarChar, normalizedRole);
    }
    if (is_locked !== undefined) { setClauses.push('is_locked = @locked'); request.input('locked', sql.Bit, is_locked ? 1 : 0); }
    if (mfa_required !== undefined) { setClauses.push('mfa_required = @mfaRequired'); request.input('mfaRequired', sql.Bit, mfa_required ? 1 : 0); }
    if (vendor_account !== undefined) {
      setClauses.push('vendor_account = @vendorAccount');
      request.input('vendorAccount', sql.NVarChar, normalizeVendorAccount(vendor_account));
    }

    if (!setClauses.length) return res.status(400).json({ error: 'No fields specified' });
    setClauses.push('updated_at = SYSUTCDATETIME()');

    const result = await request.query('UPDATE dbo.users SET ' + setClauses.join(', ') + ' OUTPUT INSERTED.id, INSERTED.email, INSERTED.role, INSERTED.vendor_account, INSERTED.is_locked, INSERTED.mfa_required WHERE id = @id');
    if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });

    const updated = result.recordset[0];
    // #AB:326 hield instellingen-rijen alleen voor employees. #AB:328: comment-rijen blijven
    // bij een wissel naar vendor staan; naar admin gaat alles weg; naar employee komen
    // ontbrekende comment-rechten erbij.
    if (role !== undefined) {
      await commentPermissions.applyRoleChangePermissions(pool, parseInt(id), updated.role);
    }

    await auditLog(req.user.id, req.user.email, 'UPDATE_USER', 'users', id, req.body);
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/force-reset', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const userResult = await pool.request().input('id', sql.Int, parseInt(id)).query('SELECT * FROM dbo.users WHERE id = @id');
    const user = userResult.recordset[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const resetResult = await authService.requestPasswordReset(user.email);
    if (resetResult.success) {
      const resetUrl = getAppBaseUrl() + '/reset-password?token=' + resetResult.token;
      await emailService.sendPasswordResetEmail(user.email, resetUrl).catch(() => {});
    }
    await auditLog(req.user.id, req.user.email, 'FORCE_RESET', 'users', id, {});
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM dbo.users OUTPUT DELETED.email WHERE id = @id');
    if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });
    await auditLog(req.user.id, req.user.email, 'DELETE_USER', 'users', id, { email: result.recordset[0].email });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Permissions ────────────────────────────────────────────────────────────

router.get('/users/:id/permissions', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, parseInt(req.params.id))
      .query('SELECT page_name FROM dbo.user_permissions WHERE user_id = @userId');
    res.json(result.recordset);
  } catch (err) { next(err); }
});

router.patch('/users/:id/permissions', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const { permissions = [] } = req.body;
    const pool = await getPool();
    const userResult = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT role FROM dbo.users WHERE id = @userId');
    const target = userResult.recordset[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    const pageNames = (Array.isArray(permissions) ? permissions : [permissions])
      .map((entry) => (entry && typeof entry === 'object' ? entry.page_name : entry));
    const decision = commentPermissions.classifyPermissionPatch(target.role, pageNames);
    if (!decision.ok) return res.status(400).json({ error: decision.error });

    await commentPermissions.replaceUserPermissions(pool, userId, decision.pageNames);

    await auditLog(req.user.id, req.user.email, 'UPDATE_PERMISSIONS', 'user_permissions', userId, { permissions });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Analytics ──────────────────────────────────────────────────────────────

router.post('/analytics/log-route', async (req, res, next) => {
  try {
    const { page_name, session_id } = req.body;
    if (!page_name || !req.user?.id) return res.json({ success: true });
    const pool = await getPool();
    await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('sessionId', sql.NVarChar, session_id || 'unknown')
      .input('pageName', sql.NVarChar, page_name)
      .query(`INSERT INTO dbo.user_activity (user_id, session_id, activity_type, page_name)
              VALUES (@userId, @sessionId, 'route_change', @pageName)`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/analytics/page-usage', requirePagePermission('analytics'), async (req, res, next) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = "activity_type = 'route_change'";
    if (startDate) { where += ' AND created_at >= @startDate'; request.input('startDate', sql.DateTime2, new Date(startDate)); }
    if (endDate) { where += ' AND created_at <= @endDate'; request.input('endDate', sql.DateTime2, new Date(endDate + 'T23:59:59')); }
    if (userId) { where += ' AND user_id = @userId'; request.input('userId', sql.Int, parseInt(userId)); }
    const result = await request.query(`
      SELECT page_name, COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users
      FROM dbo.user_activity WHERE ${where}
      GROUP BY page_name ORDER BY count DESC`);
    res.json({ stats: result.recordset });
  } catch (err) { next(err); }
});

router.get('/analytics/sessions', requirePagePermission('analytics'), async (req, res, next) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = "activity_type = 'login'";
    if (startDate) { where += ' AND created_at >= @startDate'; request.input('startDate', sql.DateTime2, new Date(startDate)); }
    if (endDate) { where += ' AND created_at <= @endDate'; request.input('endDate', sql.DateTime2, new Date(endDate + 'T23:59:59')); }
    if (userId) { where += ' AND user_id = @userId'; request.input('userId', sql.Int, parseInt(userId)); }
    const result = await request.query(`
      SELECT COUNT(*) as total_sessions,
             AVG(CAST(session_duration_seconds AS FLOAT)) as avg_duration_seconds,
             MIN(session_duration_seconds) as min_duration_seconds,
             MAX(session_duration_seconds) as max_duration_seconds
      FROM dbo.user_activity WHERE ${where}`);
    res.json(result.recordset[0] || {});
  } catch (err) { next(err); }
});

router.get('/analytics/login-stats', requirePagePermission('analytics'), async (req, res, next) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = "action = 'LOGIN'";
    if (startDate) { where += ' AND created_at >= @startDate'; request.input('startDate', sql.DateTime2, new Date(startDate)); }
    if (endDate) { where += ' AND created_at <= @endDate'; request.input('endDate', sql.DateTime2, new Date(endDate + 'T23:59:59')); }
    if (userId) { where += ' AND user_id = @userId'; request.input('userId', sql.Int, parseInt(userId)); }
    const result = await request.query(`
      SELECT CAST(created_at AS DATE) as date, COUNT(*) as count
      FROM dbo.audit_log WHERE ${where}
      GROUP BY CAST(created_at AS DATE) ORDER BY date`);
    res.json({ by_day: result.recordset });
  } catch (err) { next(err); }
});

router.get('/analytics/user-login-stats', requirePagePermission('analytics'), async (req, res, next) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = "action = 'LOGIN'";
    if (startDate) { where += ' AND created_at >= @startDate'; request.input('startDate', sql.DateTime2, new Date(startDate)); }
    if (endDate) { where += ' AND created_at <= @endDate'; request.input('endDate', sql.DateTime2, new Date(endDate + 'T23:59:59')); }
    if (userId) { where += ' AND user_id = @userId'; request.input('userId', sql.Int, parseInt(userId)); }
    const result = await request.query(`
      SELECT user_email, COUNT(*) as login_count
      FROM dbo.audit_log WHERE ${where}
      GROUP BY user_email ORDER BY login_count DESC`);
    res.json(result.recordset);
  } catch (err) { next(err); }
});

router.get('/analytics/click-stats', requirePagePermission('analytics'), async (req, res, next) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = "activity_type = 'click'";
    if (startDate) { where += ' AND created_at >= @startDate'; request.input('startDate', sql.DateTime2, new Date(startDate)); }
    if (endDate) { where += ' AND created_at <= @endDate'; request.input('endDate', sql.DateTime2, new Date(endDate + 'T23:59:59')); }
    if (userId) { where += ' AND user_id = @userId'; request.input('userId', sql.Int, parseInt(userId)); }
    const result = await request.query(`
      SELECT page_name, element_type, COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users
      FROM dbo.user_activity WHERE ${where}
      GROUP BY page_name, element_type ORDER BY count DESC`);
    res.json({ stats: result.recordset });
  } catch (err) { next(err); }
});

// Welke gebruiker welke product tours/guides heeft doorlopen, en tot welke stap (staff-only via /api/admin).
router.get('/analytics/onboarding', requirePagePermission('analytics'), async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await time('onboarding_progress_sql', () => pool.request()
      .input('boardKey', sql.NVarChar(64), ONBOARDING_BOARD_KEY)
      .query(`
        SELECT u.id, u.email, u.display_name, u.role, u.vendor_account, s.settings_json
        FROM dbo.users u
        LEFT JOIN dbo.user_board_settings s ON s.user_id = u.id AND s.board_key = @boardKey
        ORDER BY u.email`));
    res.json({ users: result.recordset.map(buildOnboardingProgressRow) });
  } catch (err) { next(err); }
});

// ─── OData settings ──────────────────────────────────────────────────────────

router.get('/settings/odata', requirePagePermission('odata'), async (req, res, next) => {
  try {
    const config = await settingsService.getODataConfig();

    // Geheimen nooit als waarde teruggeven; alleen of ze ingesteld zijn.
    const secretKeys = settingsService.ODATA_SECRET_KEYS || ['D365_ODATA_CLIENT_SECRET', 'D365_ODATA_BEARER_TOKEN'];
    for (const key of secretKeys) {
      config[key + '_SET'] = !!config[key];
      config[key] = '';
    }

    // Afgeleide, leesbare status zodat de admin ziet wat er gebeurt.
    const baseUrl = (config.D365_ODATA_BASE_URL || '').replace(/\/$/, '');
    const usingClientCredentials = !!(config.D365_ODATA_TENANT_ID && config.D365_ODATA_CLIENT_ID && config.D365_ODATA_CLIENT_SECRET_SET);
    const derived = {
      authMethod: usingClientCredentials ? 'oauth_client_credentials' : (config.D365_ODATA_BEARER_TOKEN_SET ? 'static_bearer_token' : 'none'),
      scope: baseUrl ? baseUrl + '/.default' : '',
      tokenEndpoint: config.D365_ODATA_TENANT_ID
        ? 'https://login.microsoftonline.com/' + config.D365_ODATA_TENANT_ID + '/oauth2/v2.0/token'
        : '',
      entityUrl: baseUrl ? baseUrl + (config.D365_ODATA_PURCHASE_ORDERS_PATH || '') : '',
      clientSecretExpiry: getSecretExpiryStatus(config.D365_ODATA_CLIENT_SECRET_EXPIRES_AT),
    };

    res.json({ settings: config, derived, source: 'app_settings' });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/odata', requirePagePermission('odata'), async (req, res, next) => {
  try {
    const allowed = [...settingsService.ODATA_KEYS];
    const incoming = req.body || {};

    // Leeg secret/token = niet overschrijven (behoud bestaande waarde).
    const secretKeys = settingsService.ODATA_SECRET_KEYS || ['D365_ODATA_CLIENT_SECRET', 'D365_ODATA_BEARER_TOKEN'];
    for (const key of secretKeys) {
      if (incoming[key] === '') delete incoming[key];
    }

    const filtered = Object.fromEntries(
      Object.entries(incoming).filter(([k]) => allowed.includes(k))
    );
    const toSave = expandRetentionSettings(filtered);

    await settingsService.saveODataConfig(toSave, req.user?.id ?? null);
    await auditLog(req.user.id, req.user.email, 'UPDATE_ODATA_SETTINGS', 'app_settings', null, { keys: Object.keys(toSave) });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Password reset email template (admin only) ─────────────────────────────

router.get('/settings/password-reset-email-template', requirePagePermission('mail-template'), async (req, res, next) => {
  try {
    const template = await passwordResetEmailTemplateService.getPasswordResetTemplate();
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

router.patch('/settings/password-reset-email-template', requirePagePermission('mail-template'), async (req, res, next) => {
  try {
    const template = await passwordResetEmailTemplateService.updatePasswordResetTemplate(req.body || {}, req.user?.id ?? null);
    await auditLog(
      req.user.id,
      req.user.email,
      'UPDATE_PASSWORD_RESET_EMAIL_TEMPLATE',
      'app_settings',
      null,
      { key: 'auth.passwordResetEmailTemplate' }
    );
    res.json({ success: true, template });
  } catch (err) {
    next(err);
  }
});

// ─── Track changes settings ─────────────────────────────────────────────────
// De /api/admin-mount staat ook employees toe; alleen met de 'track-changes'-permissie.

router.get('/settings/track-changes', requirePagePermission('track-changes'), async (req, res, next) => {
  try {
    const config = await trackChangesService.getConfig();
    res.json({ config });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/track-changes', requirePagePermission('track-changes'), async (req, res, next) => {
  try {
    const config = await trackChangesService.saveConfig(req.body || {}, req.user?.id ?? null);
    await auditLog(req.user.id, req.user.email, 'UPDATE_TRACK_CHANGES_SETTINGS', 'app_settings', null, {
      mode: config.mode,
      sessionRoles: config.sessionRoles,
      columnCount: Object.keys(config.columns).length,
    });
    res.json({ success: true, config });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── Supplier filter column (admin only) ────────────────────────────────────
// Bepaalt op welke purchase-orders master-kolom het supplier-filter matcht.

const SUPPLIER_FILTER_COLUMN_KEY = 'SUPPLIER_FILTER_COLUMN_KEY';
const DEFAULT_SUPPLIER_FILTER_COLUMN = 'vendorAccount';

router.get('/supplier-filter-column', async (req, res, next) => {
  try {
    const columnKey = await settingsService.getAsync(SUPPLIER_FILTER_COLUMN_KEY, DEFAULT_SUPPLIER_FILTER_COLUMN);
    res.json({ columnKey: columnKey || DEFAULT_SUPPLIER_FILTER_COLUMN });
  } catch (err) {
    next(err);
  }
});

router.put('/supplier-filter-column', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const columnKey = String(req.body?.columnKey || '').trim();
    if (!columnKey) return res.status(400).json({ error: 'columnKey is required' });
    await settingsService.set(SUPPLIER_FILTER_COLUMN_KEY, columnKey, req.user?.id ?? null);
    await auditLog(req.user.id, req.user.email, 'UPDATE_SUPPLIER_FILTER_COLUMN', 'app_settings', null, { columnKey });
    res.json({ success: true, columnKey });
  } catch (err) {
    next(err);
  }
});

// ─── RCCP settings (admin only) ─────────────────────────────────────────────

router.get('/rccp/settings', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const config = await rccpSettingsService.getConfig();
    res.json({ config });
  } catch (err) {
    next(err);
  }
});

router.put('/rccp/settings', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const config = await rccpSettingsService.saveConfig(req.body || {}, req.user?.id ?? null);
    await auditLog(req.user.id, req.user.email, 'UPDATE_RCCP_SETTINGS', 'app_settings', null, {
      dateColumnKey: config.dateColumnKey,
      vendorColumnKey: config.vendorColumnKey,
      confirmedDateColumnKey: config.confirmedDateColumnKey,
      receiptDateColumnKey: config.receiptDateColumnKey,
      orderedMeasureKey: config.orderedMeasureKey,
      quantityMeasures: (config.quantityMeasures || []).map((m) => m.columnKey),
    });
    res.json({ success: true, config });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Losse toggle per KPI-kaart ("Show in PO table panel", via de vouw in het hoekje van elke
// kaart) — spaart de admin het openen van het volledige Settings-scherm. Leest/schrijft
// dezelfde RCCP_CONFIG als hierboven, alleen het veld splitPanelKpiKeys.
router.put('/rccp/settings/split-panel-kpis', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const current = await rccpSettingsService.getConfig();
    const config = await rccpSettingsService.saveConfig({
      ...current,
      splitPanelKpiKeys: req.body?.kpiKeys,
    }, req.user?.id ?? null);
    await auditLog(req.user.id, req.user.email, 'UPDATE_RCCP_SETTINGS', 'app_settings', null, {
      splitPanelKpiKeys: config.splitPanelKpiKeys,
    });
    res.json({ success: true, config });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/d365-refresh/alert-emails', requirePagePermission('d365-refresh'), async (req, res, next) => {
  try {
    const raw = await settingsService.getAsync(refreshRunService.ALERT_EMAILS_KEY, '');
    res.json({ emails: parseAlertEmails(raw) });
  } catch (err) {
    next(err);
  }
});

router.put('/d365-refresh/alert-emails', requirePagePermission('d365-refresh'), async (req, res, next) => {
  try {
    const serialized = serializeAlertEmails(req.body?.emails ?? req.body?.value ?? '');
    await settingsService.set(refreshRunService.ALERT_EMAILS_KEY, serialized, req.user?.id ?? null);
    await auditLog(req.user.id, req.user.email, 'UPDATE_D365_REFRESH_ALERT_EMAILS', 'app_settings', null, {
      count: parseAlertEmails(serialized).length,
    });
    res.json({ success: true, emails: parseAlertEmails(serialized) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/d365-refresh/runs', requirePagePermission('d365-refresh'), async (req, res, next) => {
  try {
    const runs = await refreshRunService.listRuns({ limit: req.query.limit });
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

router.delete('/d365-refresh/runs', requirePagePermission('d365-refresh'), async (req, res, next) => {
  try {
    const result = await refreshRunService.clearHistory();
    await auditLog(
      req.user.id,
      req.user.email,
      'CLEAR_D365_REFRESH_HISTORY',
      'tb_refresh_runs',
      null,
      result,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ─── General settings (PO table zoom, per user) ──────────────────────────────

router.get('/settings/general', async (req, res, next) => {
  try {
    const poTableZoom = await poTableZoomSettings.getZoom(req.user?.id ?? null);
    res.json({ poTableZoom });
  } catch (err) {
    next(err);
  }
});

router.patch('/settings/general', async (req, res, next) => {
  try {
    if (req.body?.poTableZoom === undefined) {
      return res.status(400).json({ error: 'poTableZoom is required' });
    }
    const poTableZoom = await poTableZoomSettings.setZoom(req.body.poTableZoom, req.user?.id ?? null);
    await auditLog(req.user.id, req.user.email, 'UPDATE_GENERAL_SETTINGS', 'user_board_settings', req.user.id, {
      poTableZoom,
    });
    res.json({ success: true, poTableZoom });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
