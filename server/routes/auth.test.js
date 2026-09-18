'use strict';

const express = require('express');
const Module = require('module');
const { createMockPool } = require('../test-utils/mockSqlPool');

// auth.js's rate-limiter (5/min, gedeeld door /login én /forgot-password) wordt éénmalig op
// module-scope aangemaakt — zonder stub zou dit hele testbestand na 5 requests overal 429 zien
// (vi.resetModules() bleek geen betrouwbare fresh-module-garantie te geven voor deze CJS-bestanden,
// zie AuthService.test.js/SettingsService.test.js). Zelfde Module._load-patroon als elders in de
// repo voor 'mssql': alleen actief tijdens het requiren van ./auth, direct daarna hersteld.
const originalLoad = Module._load;
Module._load = function loadWithRateLimitStub(request, parent, isMain) {
  if (request !== 'express-rate-limit') return originalLoad.call(this, request, parent, isMain);
  return () => (req, res, next) => next();
};

const sqlPoolModule = require('../utils/sqlPool');
const mockState = { pool: null };
sqlPoolModule.getSqlPool = async () => mockState.pool;

const authRouter = require('./auth');
const authService = require('../services/AuthService');
const emailService = require('../services/EmailService');

Module._load = originalLoad;

function buildApp({ session } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session || { destroy: (cb) => cb() };
    req.sessionID = 'test-session-id';
    next();
  });
  app.use('/api/auth', authRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

async function withServer(sessionOpts, fn) {
  const app = buildApp(sessionOpts);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postJson(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

beforeEach(() => {
  mockState.pool = createMockPool();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /login', () => {
  it('zet de sessie en geeft de user terug bij geldige credentials', async () => {
    authService.login = vi.fn().mockResolvedValue({ user: { id: 1, email: 'a@b.com', role: 'employee' } });
    const session = {};

    await withServer({ session }, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/login', { email: 'a@b.com', password: 'pw' });
      expect(status).toBe(200);
      expect(data.user.id).toBe(1);
    });

    expect(session.userId).toBe(1);
    expect(session.user.email).toBe('a@b.com');
  });

  it('geeft requiresPasswordSetup terug zonder de sessie te zetten', async () => {
    authService.login = vi.fn().mockResolvedValue({ requiresPasswordSetup: true, user: { email: 'a@b.com' } });
    const session = {};

    await withServer({ session }, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/login', { email: 'a@b.com', password: 'pw' });
      expect(status).toBe(200);
      expect(data).toEqual({ requiresPasswordSetup: true, email: 'a@b.com' });
    });
    expect(session.userId).toBeUndefined();
  });

  it('geeft 401 met de foutmelding bij onjuiste/vergrendelde credentials — geen 500', async () => {
    authService.login = vi.fn().mockRejectedValue(new Error('Account locked after 3 failed attempts. Request a new password.'));

    await withServer({}, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/login', { email: 'a@b.com', password: 'pw' });
      expect(status).toBe(401);
      expect(data.error).toContain('Account locked');
    });
  });

  it('geeft 400 zonder e-mailadres, zonder authService aan te roepen', async () => {
    authService.login = vi.fn();

    await withServer({}, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/auth/login', { password: 'pw' });
      expect(status).toBe(400);
    });
    expect(authService.login).not.toHaveBeenCalled();
  });
});

describe('POST /logout', () => {
  it('vernietigt de sessie en geeft success terug', async () => {
    const destroy = vi.fn((cb) => cb());
    const session = { userId: 1, user: { id: 1, email: 'a@b.com' }, loggedInAt: new Date().toISOString(), destroy };

    await withServer({ session }, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/logout');
      expect(status).toBe(200);
      expect(data).toEqual({ success: true });
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('werkt ook zonder actieve sessie (geen crash op ontbrekende userId)', async () => {
    const destroy = vi.fn((cb) => cb());

    await withServer({ session: { destroy } }, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/auth/logout');
      expect(status).toBe(200);
    });
  });
});

describe('POST /set-password', () => {
  it('zet het wachtwoord van een uitgenodigd account, start de sessie en geeft de gemapte user terug', async () => {
    authService.getUserByEmail = vi.fn().mockResolvedValue({ id: 2, email: 'new@b.com', must_set_password: 1, password_hash: null });
    authService.setPasswordForUser = vi.fn().mockResolvedValue();
    authService.mapUserForSession = vi.fn().mockReturnValue({ id: 2, email: 'new@b.com', role: 'supplier' });
    const session = {};

    await withServer({ session }, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/set-password', { email: 'new@b.com', password: 'longenoughpw' });
      expect(status).toBe(200);
      expect(data.user.role).toBe('supplier');
    });
    expect(session.userId).toBe(2);
  });

  // Account-overname: zonder rol- of tokencontrole kon iedereen die een e-mailadres kende het
  // wachtwoord van dat account overschrijven en direct als die gebruiker ingelogd raken.
  it('weigert een account dat al een wachtwoord heeft en wijzigt niets', async () => {
    authService.getUserByEmail = vi.fn().mockResolvedValue({
      id: 1, email: 'admin@b.com', role: 'admin', must_set_password: 0, password_hash: '$2b$12$hash',
    });
    authService.setPasswordForUser = vi.fn().mockResolvedValue();
    const session = {};

    await withServer({ session }, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/auth/set-password', { email: 'admin@b.com', password: 'overgenomen1' });
      expect(status).toBe(403);
    });

    expect(authService.setPasswordForUser).not.toHaveBeenCalled();
    expect(session.userId).toBeUndefined();
  });

  it('weigert een vergrendeld account, ook als het nog geen wachtwoord heeft', async () => {
    authService.getUserByEmail = vi.fn().mockResolvedValue({
      id: 3, email: 'locked@b.com', must_set_password: 1, password_hash: null, is_locked: 1,
    });
    authService.setPasswordForUser = vi.fn().mockResolvedValue();

    await withServer({}, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/auth/set-password', { email: 'locked@b.com', password: 'longenoughpw' });
      expect(status).toBe(403);
    });

    expect(authService.setPasswordForUser).not.toHaveBeenCalled();
  });

  it('geeft voor een onbekend e-mailadres dezelfde 403 — geen user enumeration', async () => {
    authService.getUserByEmail = vi.fn().mockResolvedValue(null);

    await withServer({}, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/auth/set-password', { email: 'x@b.com', password: 'longenoughpw' });
      expect(status).toBe(403);
    });
  });

  it('geeft 400 zonder e-mailadres of wachtwoord', async () => {
    await withServer({}, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/auth/set-password', { email: 'x@b.com' });
      expect(status).toBe(400);
    });
  });
});

describe('POST /forgot-password', () => {
  it('geeft altijd hetzelfde succes-bericht, ongeacht of het e-mailadres bestaat — voorkomt user enumeration', async () => {
    vi.stubEnv('APP_ENV', 'production');
    authService.requestPasswordReset = vi.fn().mockResolvedValue({ success: false, code: 'EMAIL_NOT_FOUND' });

    await withServer({}, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/forgot-password', { email: 'unknown@b.com' });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.devNotice).toBeUndefined();
      expect(data.devResetUrl).toBeUndefined();
    });
  });

  it('verstuurt de resetlink en geeft geen dev-velden terug in een productie-achtige omgeving', async () => {
    vi.stubEnv('APP_ENV', 'production');
    authService.requestPasswordReset = vi.fn().mockResolvedValue({
      success: true,
      user: { email: 'a@b.com' },
      token: 'reset-token',
    });
    emailService.sendPasswordResetEmail = vi.fn().mockResolvedValue({ sent: true });

    await withServer({}, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/forgot-password', { email: 'a@b.com' });
      expect(status).toBe(200);
      expect(data.devResetUrl).toBeUndefined();
    });
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith('a@b.com', expect.stringContaining('reset-token'));
  });

  it('geeft een dev-resetlink terug als het mailen wordt overgeslagen in een dev-achtige omgeving', async () => {
    vi.stubEnv('APP_ENV', 'dev');
    authService.requestPasswordReset = vi.fn().mockResolvedValue({
      success: true,
      user: { email: 'a@b.com' },
      token: 'reset-token',
    });
    emailService.sendPasswordResetEmail = vi.fn().mockRejectedValue(new Error('ACS not configured'));

    await withServer({}, async (baseUrl) => {
      const { data } = await postJson(baseUrl, '/api/auth/forgot-password', { email: 'a@b.com' });
      expect(data.devResetUrl).toContain('reset-token');
    });
  });
});

describe('POST /reset-password', () => {
  it('zet het wachtwoord voor een geldig token', async () => {
    authService.resetPassword = vi.fn().mockResolvedValue({ id: 1, email: 'a@b.com' });

    await withServer({}, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/reset-password', { token: 't', password: 'longenoughpw' });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  it('geeft 400 voor een ongeldig/verlopen token', async () => {
    authService.resetPassword = vi.fn().mockRejectedValue(new Error('Reset link is invalid or expired'));

    await withServer({}, async (baseUrl) => {
      const { status, data } = await postJson(baseUrl, '/api/auth/reset-password', { token: 'bad', password: 'longenoughpw' });
      expect(status).toBe(400);
      expect(data.error).toContain('invalid or expired');
    });
  });

  it('geeft 400 zonder token of wachtwoord', async () => {
    await withServer({}, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/auth/reset-password', { token: 't' });
      expect(status).toBe(400);
    });
  });
});

describe('GET /me', () => {
  it('geeft de user en persoonlijke tabelzoom uit de sessie terug', async () => {
    const session = { userId: 1, user: { id: 1, email: 'a@b.com' } };

    await withServer({ session }, async (baseUrl) => {
      const { data } = await getJson(baseUrl, '/api/auth/me');
      expect(data.user.email).toBe('a@b.com');
      expect(data.poTableZoom).toBe(0.85);
    });
  });

  it('geeft user: null terug zonder sessie', async () => {
    await withServer({ session: {} }, async (baseUrl) => {
      const { data } = await getJson(baseUrl, '/api/auth/me');
      expect(data).toEqual({ user: null, permissions: [] });
    });
  });
});

describe('PO table zoom voorkeur', () => {
  it('GET /po-table-zoom geeft 401 zonder sessie', async () => {
    await withServer({ session: {} }, async (baseUrl) => {
      const { status } = await getJson(baseUrl, '/api/auth/po-table-zoom');
      expect(status).toBe(401);
    });
  });

  it('PATCH /po-table-zoom slaat de zoom van de sessie-gebruiker op', async () => {
    const poTableZoomSettings = require('../services/PoTableZoomSettings');
    const originalSetZoom = poTableZoomSettings.setZoom;
    poTableZoomSettings.setZoom = vi.fn().mockResolvedValue(1);
    const session = { userId: 4, user: { id: 4, email: 'v@b.com' } };

    try {
      await withServer({ session }, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/auth/po-table-zoom`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poTableZoom: 1 }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, poTableZoom: 1 });
      });
      expect(poTableZoomSettings.setZoom).toHaveBeenCalledWith(1, 4);
    } finally {
      poTableZoomSettings.setZoom = originalSetZoom;
    }
  });
});
