'use strict';

// Guards rond de granulaire instellingen-permissies (#AB:326). Kern van deze suite: een employee
// met de 'users'-permissie mag lezen, maar nooit escaleren (rol wijzigen, verwijderen,
// force-reset, permissies uitdelen) — die routes blijven hard admin-only.

const express = require('express');
const pagePermissions = require('../utils/pagePermissions');
const sqlPool = require('../utils/sqlPool');
const { createMockPool } = require('../test-utils/mockSqlPool');

const originalHasPagePermission = pagePermissions.hasPagePermission;
const originalGetSqlPool = sqlPool.getSqlPool;

const EMPLOYEE = { id: 7, role: 'employee', email: 'employee@vanbommel.nl' };

beforeEach(() => {
  pagePermissions.hasPagePermission = vi.fn(async (_userId, pageName) => pageName === 'users');
  sqlPool.getSqlPool = async () => createMockPool();
});

afterEach(() => {
  pagePermissions.hasPagePermission = originalHasPagePermission;
  sqlPool.getSqlPool = originalGetSqlPool;
});

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin', require('./admin'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

async function withServer(user, fn) {
  const server = await new Promise((resolve) => {
    const instance = buildApp(user).listen(0, () => resolve(instance));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    return await fn((path, method = 'GET', body) => fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('employee met alleen de users-permissie', () => {
  it('mag de gebruikerslijst lezen', async () => {
    const pool = createMockPool({
      queries: [{ recordset: [{ total: 1 }] }, { recordset: [{ id: 9, email: 'v@x.nl' }] }],
    });
    sqlPool.getSqlPool = async () => pool;

    await withServer(EMPLOYEE, async (send) => {
      const res = await send('/api/admin/users');
      expect(res.status).toBe(200);
      expect((await res.json()).users).toHaveLength(1);
    });
  });

  it('krijgt 403 bij het promoveren van een user naar admin', async () => {
    await withServer(EMPLOYEE, async (send) => {
      expect((await send('/api/admin/users/9', 'PATCH', { role: 'admin' })).status).toBe(403);
    });
  });

  it('krijgt 403 bij het aanmaken van een staff-account', async () => {
    await withServer(EMPLOYEE, async (send) => {
      expect((await send('/api/admin/users', 'POST', { email: 'x@y.nl', role: 'admin' })).status).toBe(403);
    });
  });

  it('krijgt 403 bij het verwijderen van een user', async () => {
    await withServer(EMPLOYEE, async (send) => {
      expect((await send('/api/admin/users/9', 'DELETE')).status).toBe(403);
    });
  });

  it('krijgt 403 bij een force-reset', async () => {
    await withServer(EMPLOYEE, async (send) => {
      expect((await send('/api/admin/users/9/force-reset', 'POST', {})).status).toBe(403);
    });
  });

  it('krijgt 403 bij het wijzigen van permissies, ook van zichzelf', async () => {
    await withServer(EMPLOYEE, async (send) => {
      const res = await send(`/api/admin/users/${EMPLOYEE.id}/permissions`, 'PATCH', {
        permissions: [{ page_name: 'odata' }],
      });
      expect(res.status).toBe(403);
    });
  });

  it('krijgt 403 op tabs zonder permissie', async () => {
    await withServer(EMPLOYEE, async (send) => {
      expect((await send('/api/admin/settings/odata')).status).toBe(403);
      expect((await send('/api/admin/analytics/page-usage')).status).toBe(403);
      expect((await send('/api/admin/d365-refresh/runs')).status).toBe(403);
    });
  });
});

describe('PUT /api/admin/supplier-filter-column', () => {
  it('weigert een niet-admin met 403 (route was ongeguard)', async () => {
    pagePermissions.hasPagePermission = vi.fn().mockResolvedValue(true);

    await withServer(EMPLOYEE, async (send) => {
      const res = await send('/api/admin/supplier-filter-column', 'PUT', { columnKey: 'vendorAccount' });
      expect(res.status).toBe(403);
    });
  });
});
