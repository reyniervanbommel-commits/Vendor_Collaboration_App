'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const sql = require('mssql');
const router = express.Router();
const authService = require('../services/AuthService');
const emailService = require('../services/EmailService');
const { auditLog } = require('../middleware/auditLog');
const { getSqlPool } = require('../utils/sqlPool');
const trackChangesService = require('../services/TrackChangesService');
const poTableZoomSettings = require('../services/PoTableZoomSettings');
const { getAppBaseUrl, isDevLikeApp } = require('../utils/appEnvironment');
const pagePermissions = require('../utils/pagePermissions');

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Try again in one minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function recordLoginAnalytics(userId, sessionId) {
  if (!userId || !sessionId) return;
  try {
    const pool = await getSqlPool();
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('sessionId', sql.NVarChar, sessionId)
      .query(`INSERT INTO dbo.user_activity (user_id, session_id, activity_type, page_name)
              VALUES (@userId, @sessionId, 'login', 'auth/login')`);
  } catch (err) {
    console.error('[auth.analytics] LOGIN activity logging mislukt:', err.message);
  }
}

async function recordLogoutAnalytics(userId, sessionId, loggedInAt) {
  if (!userId) return;
  try {
    const loginDate = loggedInAt ? new Date(loggedInAt) : null;
    const durationSeconds = loginDate && !Number.isNaN(loginDate.getTime())
      ? Math.max(0, Math.round((Date.now() - loginDate.getTime()) / 1000))
      : null;
    const safeSessionId = sessionId || 'unknown';

    const pool = await getSqlPool();
    const latestLoginQuery = sessionId
      ? `;WITH latest_login AS (
           SELECT TOP (1) id
           FROM dbo.user_activity
           WHERE user_id = @userId
             AND session_id = @sessionId
             AND activity_type = 'login'
           ORDER BY created_at DESC
         )
         UPDATE dbo.user_activity
         SET session_duration_seconds = COALESCE(@durationSeconds, session_duration_seconds)
         WHERE id IN (SELECT id FROM latest_login)`
      : `;WITH latest_login AS (
           SELECT TOP (1) id
           FROM dbo.user_activity
           WHERE user_id = @userId
             AND activity_type = 'login'
           ORDER BY created_at DESC
         )
         UPDATE dbo.user_activity
         SET session_duration_seconds = COALESCE(@durationSeconds, session_duration_seconds)
         WHERE id IN (SELECT id FROM latest_login)`;

    const updateRequest = pool.request()
      .input('userId', sql.Int, userId)
      .input('durationSeconds', sql.Int, durationSeconds);
    if (sessionId) {
      updateRequest.input('sessionId', sql.NVarChar, sessionId);
    }
    await updateRequest.query(latestLoginQuery);

    await pool.request()
      .input('userId', sql.Int, userId)
      .input('sessionId', sql.NVarChar, safeSessionId)
      .input('durationSeconds', sql.Int, durationSeconds)
      .query(`INSERT INTO dbo.user_activity (user_id, session_id, activity_type, page_name, session_duration_seconds)
              VALUES (@userId, @sessionId, 'logout', 'auth/logout', @durationSeconds)`);
  } catch (err) {
    console.error('[auth.analytics] LOGOUT activity logging mislukt:', err.message);
  }
}

async function readPoTableZoomSafe(userId = null) {
  try {
    return await poTableZoomSettings.getZoom(userId);
  } catch {
    return poTableZoomSettings.PO_TABLE_ZOOM_DEFAULT;
  }
}

// Permissies komen bewust vers uit de DB en niet uit de sessie: trekt een admin een permissie in,
// dan moet dat bij de eerstvolgende call gelden en niet pas na een herlogin (#AB:326).
async function readPagePermissionsSafe(userId = null) {
  try {
    return await pagePermissions.listPagePermissions(userId);
  } catch {
    return [];
  }
}

router.post('/login', strictLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email address is required' });
    const result = await authService.login(email, password);
    if (result.requiresPasswordSetup) {
      return res.json({ requiresPasswordSetup: true, email: result.user.email });
    }
    req.session.userId = result.user.id;
    req.session.user = result.user;
    req.session.loggedInAt = new Date().toISOString();
    await auditLog(result.user.id, result.user.email, 'LOGIN', 'users', result.user.id, { source: 'password' });
    await recordLoginAnalytics(result.user.id, req.sessionID);
    await trackChangesService.recordSessionOnLogin(result.user.role);
    res.json({
      user: result.user,
      poTableZoom: await readPoTableZoomSafe(result.user.id),
      permissions: await readPagePermissionsSafe(result.user.id),
    });
  } catch (err) {
    if (err.message.includes('incorrect') || err.message.includes('locked')) {
      return res.status(401).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/logout', async (req, res) => {
  const sessionUserId = req.session?.userId || req.session?.user?.id || null;
  const sessionUserEmail = req.session?.user?.email || null;
  const sessionId = req.sessionID;
  const loggedInAt = req.session?.loggedInAt || null;

  if (sessionUserId) {
    await recordLogoutAnalytics(sessionUserId, sessionId, loggedInAt);
    await auditLog(sessionUserId, sessionUserEmail, 'LOGOUT', 'users', sessionUserId, {});
  }

  req.session.destroy(() => res.json({ success: true }));
});

// Uitsluitend de uitnodigingsflow: een account dat zijn eerste wachtwoord nog moet zetten.
// Deze route is onvermijdelijk onbeschermd (de gebruiker heeft nog geen sessie), dus zonder de
// controle hieronder kan iedereen die een e-mailadres kent het wachtwoord van dat account
// overschrijven en direct ingelogd raken — inclusief dat van een admin. Een bestaand account
// hoort via forgot-password/reset-password te gaan, met een token in de mailbox als bewijs.
// Eén generieke fout voor "bestaat niet", "al ingesteld" en "vergrendeld", zodat deze route geen
// geldige e-mailadressen prijsgeeft.
router.post('/set-password', strictLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email address and password are required' });
    const user = await authService.getUserByEmail(email);
    const mayEnroll = user && !user.is_locked && (user.must_set_password || !user.password_hash);
    if (!mayEnroll) {
      return res.status(403).json({
        error: 'This account already has a password. Use "Forgot password" to request a reset link.',
      });
    }
    await authService.setPasswordForUser(user.id, password);
    const safeUser = authService.mapUserForSession(user);
    req.session.userId = user.id;
    req.session.user = safeUser;
    req.session.loggedInAt = new Date().toISOString();
    await auditLog(user.id, user.email, 'LOGIN', 'users', user.id, { source: 'set-password' });
    await recordLoginAnalytics(user.id, req.sessionID);
    await trackChangesService.recordSessionOnLogin(safeUser.role);
    res.json({
      user: safeUser,
      poTableZoom: await readPoTableZoomSafe(safeUser.id),
      permissions: await readPagePermissionsSafe(safeUser.id),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', strictLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await authService.requestPasswordReset(email);

    const response = { success: true, message: 'If the email address is known, you will receive a reset link.' };

    if (result.success) {
      const resetUrl = getAppBaseUrl() + '/reset-password?token=' + result.token;
      const emailResult = await emailService.sendPasswordResetEmail(result.user.email, resetUrl).catch(() => ({ skipped: true }));

      // DEV-fallback: zonder werkende mail (bv. ACS niet ingericht) geven we de resetlink
      // direct terug in de response zodat lokaal/DEV testen mogelijk is. Nooit in productie.
      const mailSkipped = emailResult && emailResult.skipped;
      if (isDevLikeApp() && mailSkipped) {
        response.devResetUrl = resetUrl;
        response.devNotice = 'DEV: email not sent, use this reset link directly.';
      }
    } else if (isDevLikeApp()) {
      // Alleen in DEV: maak expliciet waarom er geen link is (account bestaat nog niet).
      response.devNotice = 'DEV: no account found for this email address. Run migrations (npm run migrate:db) or create the account.';
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    const user = await authService.resetPassword(token, password);
    res.json({ success: true, user });
  } catch (err) {
    if (err.message.includes('invalid') || err.message.includes('Password must be')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    if (req.session && req.session.userId) {
      return res.json({
        user: req.session.user || null,
        poTableZoom: await readPoTableZoomSafe(req.session.userId),
        permissions: await readPagePermissionsSafe(req.session.userId),
      });
    }
    return res.json({ user: null, permissions: [] });
  } catch (err) {
    next(err);
  }
});

router.get('/po-table-zoom', async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const poTableZoom = await readPoTableZoomSafe(req.session.userId);
    res.json({ poTableZoom });
  } catch (err) {
    next(err);
  }
});

router.patch('/po-table-zoom', async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
    if (req.body?.poTableZoom === undefined) {
      return res.status(400).json({ error: 'poTableZoom is required' });
    }
    const poTableZoom = await poTableZoomSettings.setZoom(req.body.poTableZoom, req.session.userId);
    const email = req.session.user?.email || null;
    await auditLog(req.session.userId, email, 'UPDATE_PO_TABLE_ZOOM', 'user_board_settings', req.session.userId, {
      poTableZoom,
    });
    res.json({ success: true, poTableZoom });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
