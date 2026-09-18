'use strict';

// Autorisatiematrix voor /api/admin: per route vastgelegd wie erbij mag.
//
// Doel is regressie voorkomen, niet Ã©Ã©n scenario bewijzen. De laatste test vergelijkt de matrix
// met de daadwerkelijk geregistreerde routes, zodat een nieuwe route hier een bewuste keuze
// afdwingt in plaats van stilzwijgend open te staan.

const express = require('express');
const pagePermissions = require('../utils/pagePermissions');
const sqlPool = require('../utils/sqlPool');
const adminRouter = require('./admin');

const originalHasPagePermission = pagePermissions.hasPagePermission;
const originalGetSqlPool = sqlPool.getSqlPool;

const EMPLOYEE = { id: 7, role: 'employee', email: 'employee@vanbommel.nl' };

// Spiegelt PAGE_PERMISSIONS / SETTINGS_NAV_SECTIONS in de frontend; bewust hier uitgeschreven
// zodat de test faalt als iemand de backend-guards en de frontend-catalogus uit elkaar laat lopen.
const ALL_PERMISSIONS = [
  'users', 'analytics', 'mail-template', 'odata',
  'datamodel', 'external-links', 'track-changes', 'd365-refresh',
];

// ADMIN = alleen voor een admin; PERMISSION = employee mag met de genoemde permissie;
// OPEN = elke staff-gebruiker; CONDITIONAL = guard hangt van de body af (POST /users).
const ADMIN = 'admin-only';
const OPEN = 'open-to-staff';
const CONDITIONAL = 'role-conditional';
const perm = (id) => `permission:${id}`;

const MATRIX = {
  'GET /users': { guard: perm('users'), path: '/users' },
  'POST /users': { guard: CONDITIONAL, path: '/users' },
  'PATCH /users/:id': { guard: ADMIN, path: '/users/9', body: { is_locked: true } },
  'POST /users/:id/force-reset': { guard: ADMIN, path: '/users/9/force-reset', body: {} },
  'DELETE /users/:id': { guard: ADMIN, path: '/users/9' },
  'GET /users/:id/permissions': { guard: ADMIN, path: '/users/9/permissions' },
  'PATCH /users/:id/permissions': { guard: ADMIN, path: '/users/9/permissions', body: { permissions: [] } },
  'POST /analytics/log-route': { guard: OPEN, path: '/analytics/log-route', body: { page_name: 'x' } },
  'GET /analytics/page-usage': { guard: perm('analytics'), path: '/analytics/page-usage' },
  'GET /analytics/sessions': { guard: perm('analytics'), path: '/analytics/sessions' },
  'GET /analytics/login-stats': { guard: perm('analytics'), path: '/analytics/login-stats' },
  'GET /analytics/user-login-stats': { guard: perm('analytics'), path: '/analytics/user-login-stats' },
  'GET /analytics/click-stats': { guard: perm('analytics'), path: '/analytics/click-stats' },
  'GET /analytics/onboarding': { guard: perm('analytics'), path: '/analytics/onboarding' },
  'GET /settings/odata': { guard: perm('odata'), path: '/settings/odata' },
  'POST /settings/odata': { guard: perm('odata'), path: '/settings/odata', body: {} },
  'GET /settings/password-reset-email-template': { guard: perm('mail-template'), path: '/settings/password-reset-email-template' },
  'PATCH /settings/password-reset-email-template': { guard: perm('mail-template'), path: '/settings/password-reset-email-template', body: {} },
  'GET /settings/track-changes': { guard: perm('track-changes'), path: '/settings/track-changes' },
  'POST /settings/track-changes': { guard: perm('track-changes'), path: '/settings/track-changes', body: {} },
  'GET /supplier-filter-column': { guard: OPEN, path: '/supplier-filter-column' },
  'PUT /supplier-filter-column': { guard: ADMIN, path: '/supplier-filter-column', body: { columnKey: 'vendorAccount' } },
  'GET /rccp/settings': { guard: ADMIN, path: '/rccp/settings' },
  'PUT /rccp/settings': { guard: ADMIN, path: '/rccp/settings', body: {} },
  'PUT /rccp/settings/split-panel-kpis': { guard: ADMIN, path: '/rccp/settings/split-panel-kpis', body: {} },
  'GET /d365-refresh/alert-emails': { guard: perm('d365-refresh'), path: '/d365-refresh/alert-emails' },
  'PUT /d365-refresh/alert-emails': { guard: perm('d365-refresh'), path: '/d365-refresh/alert-emails', body: { emails: '' } },
  'GET /d365-refresh/runs': { guard: perm('d365-refresh'), path: '/d365-refresh/runs' },
  'DELETE /d365-refresh/runs': { guard: perm('d365-refresh'), path: '/d365-refresh/runs' },
  'GET /settings/general': { guard: OPEN, path: '/settings/general' },
  'PATCH /settings/general': { guard: OPEN, path: '/settings/general', body: { poTableZoom: 1 } },
};

// Pool die elke query beantwoordt, zodat een toegestane route niet op ontbrekende data struikelt.
function permissivePool() {
  const request = {
    input() { return request; },
    async query() { return { recordset: [{ id: 9, email: 'x@y.nl', role: 'supplier', total: 0 }], rowsAffected: [1] }; },
    async batch() { return request.query(); },
  };
  return { request: () => request };
}

beforeEach(() => {
  sqlPool.getSqlPool = async () => permissivePool();
});

afterEach(() => {
  pagePermissions.hasPagePermission = originalHasPagePermission;
  sqlPool.getSqlPool = originalGetSqlPool;
});

function grantPermissions(granted) {
  pagePermissions.hasPagePermission = vi.fn(async (_userId, pageName) => granted.includes(pageName));
}

async function callAsEmployee(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = EMPLOYEE; next(); });
  app.use('/api/admin', adminRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/admin${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.status;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const entries = Object.entries(MATRIX).map(([key, spec]) => {
  const [method] = key.split(' ');
  return { key, method, ...spec };
});

const adminOnly = entries.filter((e) => e.guard === ADMIN);
const permissionBased = entries.filter((e) => e.guard.startsWith('permission:'));
const openRoutes = entries.filter((e) => e.guard === OPEN);

describe('admin-only routes blijven dicht voor een employee', () => {
  it.each(adminOnly.map((e) => [e.key, e]))('%s geeft 403, zelfs met alle permissies', async (_key, spec) => {
    grantPermissions(ALL_PERMISSIONS);

    expect(await callAsEmployee(spec.method, spec.path, spec.body)).toBe(403);
  });
});

describe('routes achter een instellingen-permissie', () => {
  it.each(permissionBased.map((e) => [e.key, e]))('%s geeft 403 zonder de permissie', async (_key, spec) => {
    const required = spec.guard.split(':')[1];
    grantPermissions(ALL_PERMISSIONS.filter((id) => id !== required));

    expect(await callAsEmployee(spec.method, spec.path, spec.body)).toBe(403);
  });

  it.each(permissionBased.map((e) => [e.key, e]))('%s laat door mÃ©t de permissie', async (_key, spec) => {
    grantPermissions([spec.guard.split(':')[1]]);

    expect(await callAsEmployee(spec.method, spec.path, spec.body)).not.toBe(403);
  });
});

describe('routes die bewust open staan voor staff', () => {
  it.each(openRoutes.map((e) => [e.key, e]))('%s blokkeert een employee niet', async (_key, spec) => {
    grantPermissions([]);

    expect(await callAsEmployee(spec.method, spec.path, spec.body)).not.toBe(403);
  });
});

describe('POST /users â€” guard hangt van de gevraagde rol af', () => {
  it('weigert een staff-account zonder admin-rol', async () => {
    grantPermissions(ALL_PERMISSIONS);

    expect(await callAsEmployee('POST', '/users', { email: 'x@y.nl', role: 'employee' })).toBe(403);
  });

  it('staat een vendor-account toe met de users-permissie', async () => {
    grantPermissions(['users']);

    expect(await callAsEmployee('POST', '/users', { email: 'x@y.nl', role: 'supplier' })).not.toBe(403);
  });

  it('weigert een vendor-account zonder de users-permissie', async () => {
    grantPermissions([]);

    expect(await callAsEmployee('POST', '/users', { email: 'x@y.nl', role: 'supplier' })).toBe(403);
  });
});

describe('matrixdekking', () => {
  it('bevat exact de routes die de admin-router registreert', () => {
    const registered = adminRouter.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods)
        .map((method) => `${method.toUpperCase()} ${layer.route.path}`))
      .sort();

    expect(registered).toEqual(Object.keys(MATRIX).sort());
  });
});
