'use strict';

const express = require('express');
const refreshRunService = require('../services/RefreshRunService');
const pagePermissions = require('../utils/pagePermissions');

const originalListRuns = refreshRunService.listRuns;
const originalClearHistory = refreshRunService.clearHistory;
const originalHasPagePermission = pagePermissions.hasPagePermission;

beforeEach(() => {
  pagePermissions.hasPagePermission = vi.fn().mockResolvedValue(false);
});

afterEach(() => {
  refreshRunService.listRuns = originalListRuns;
  refreshRunService.clearHistory = originalClearHistory;
  pagePermissions.hasPagePermission = originalHasPagePermission;
});

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/admin', require('./admin'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

async function withServer(user, fn) {
  const app = buildApp(user);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('GET /api/admin/d365-refresh/runs', () => {
  it('geeft een employee zonder d365-refresh-permissie 403', async () => {
    await withServer({ id: 2, role: 'employee' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/d365-refresh/runs`);
      expect(res.status).toBe(403);
    });
  });

  it('laat admin de historie lezen', async () => {
    refreshRunService.listRuns = vi.fn().mockResolvedValue([]);
    await withServer({ id: 1, role: 'admin' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/d365-refresh/runs`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ runs: [] });
    });
  });
});

describe('DELETE /api/admin/d365-refresh/runs', () => {
  it('geeft een employee zonder d365-refresh-permissie 403', async () => {
    await withServer({ id: 2, role: 'employee' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/d365-refresh/runs`, { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });

  it('laat admin de historie wissen', async () => {
    refreshRunService.clearHistory = vi.fn().mockResolvedValue({ deletedRuns: 3, keptRunning: false });
    await withServer({ id: 1, role: 'admin' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/d365-refresh/runs`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, deletedRuns: 3, keptRunning: false });
    });
  });
});
