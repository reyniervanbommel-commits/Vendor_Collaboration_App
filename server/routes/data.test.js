'use strict';

// Selectieve regressietest bovenop de al-geteste middleware (restrictSupplierDataAccess,
// zie server/middleware/dataAccess.test.js): dit bestand test alleen de routes die zelf nog
// supplier-scoping toepassen op basis van req.user, niet alle 32 routes in data.js.
const express = require('express');
const dataRouter = require('./data');
const dataService = require('../services/TableDataService');
const settingsService = require('../services/SettingsService');
const remarksService = require('../services/RowRemarksService');
const pagePermissions = require('../utils/pagePermissions');

const errorHandler = require('../middleware/errorHandler');

const originalRead = dataService.read;
const originalGetAsync = settingsService.getAsync;
const originalSetReaction = remarksService.setReaction;
const originalHasPagePermission = pagePermissions.hasPagePermission;
const originalListPagePermissions = pagePermissions.listPagePermissions;

beforeEach(() => {
  pagePermissions.hasPagePermission = vi.fn().mockResolvedValue(false);
  pagePermissions.listPagePermissions = vi.fn().mockResolvedValue([
    'comments.view',
    'comments.write',
    'comments.column',
  ]);
});

afterEach(() => {
  dataService.read = originalRead;
  settingsService.getAsync = originalGetAsync;
  remarksService.setReaction = originalSetReaction;
  pagePermissions.hasPagePermission = originalHasPagePermission;
  pagePermissions.listPagePermissions = originalListPagePermissions;
});

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/data', dataRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
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

describe('GET /:tableKey — supplier-scoping', () => {
  it('geeft voor een supplier het eigen vendorAccount + de admin-gekozen filterkolom door aan dataService.read', async () => {
    dataService.read = vi.fn().mockResolvedValue({ rows: [], meta: {} });
    settingsService.getAsync = vi.fn().mockResolvedValue('customVendorColumn');

    await withServer({ id: 5, role: 'supplier', vendorAccount: 'V000583' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders`);
      expect(res.status).toBe(200);
    });

    expect(dataService.read).toHaveBeenCalledWith(expect.objectContaining({
      tableKey: 'purchase-orders',
      supplierAccount: 'V000583',
      supplierFilterColumn: 'customVendorColumn',
    }));
  });

  it('geeft voor staff (employee/admin) geen supplierAccount door — ziet alle orders', async () => {
    dataService.read = vi.fn().mockResolvedValue({ rows: [], meta: {} });
    settingsService.getAsync = vi.fn();

    await withServer({ id: 1, role: 'employee' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders`);
      expect(res.status).toBe(200);
    });

    expect(dataService.read).toHaveBeenCalledWith(expect.objectContaining({
      tableKey: 'purchase-orders',
      supplierAccount: null,
    }));
    // Staff heeft geen supplier-filterkolom nodig — geen extra settings-lookup.
    expect(settingsService.getAsync).not.toHaveBeenCalled();
  });
});

describe('PUT /:tableKey/remarks/:id/reaction — open voor supplier (read-only remarks, wel reacties)', () => {
  it('geeft de reactie door aan remarksService met de juiste actor', async () => {
    remarksService.setReaction = vi.fn().mockResolvedValue({ '👍': 1 });

    await withServer({ id: 9, role: 'supplier' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/remarks/42/reaction`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partitionKey: 'PO', recordKey: '1', emoji: '👍', active: true }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.reactions).toEqual({ '👍': 1 });
    });

    expect(remarksService.setReaction).toHaveBeenCalledWith(
      expect.objectContaining({ tableKey: 'purchase-orders', id: 42, emoji: '👍', active: true }),
      { id: 9, role: 'supplier', vendor_account: null },
    );
  });

  it('geeft 400 voor een ongeldige emoji, zonder remarksService aan te roepen', async () => {
    remarksService.setReaction = vi.fn();

    await withServer({ id: 9, role: 'supplier' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/remarks/42/reaction`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partitionKey: 'PO', recordKey: '1', emoji: '💣', active: true }),
      });
      expect(res.status).toBe(400);
    });
    expect(remarksService.setReaction).not.toHaveBeenCalled();
  });
});

describe('refresh progress en viewed-rechten', () => {
  it('geeft een employee zonder d365-refresh-permissie 403 op GET refresh/progress', async () => {
    await withServer({ id: 2, role: 'employee' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/refresh/progress`);
      expect(res.status).toBe(403);
    });
  });

  it('laat admin progress zien met run maar zonder entities in de default view', async () => {
    await withServer({ id: 1, role: 'admin' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/refresh/progress`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.progress).toEqual(expect.objectContaining({
        status: expect.any(String),
        fetched: expect.any(Number),
        saved: expect.any(Number),
      }));
      expect(data.run).toEqual(expect.objectContaining({
        currentLabel: expect.any(String),
        overall: expect.any(Number),
        entityIndex: expect.any(Number),
        entityCount: expect.any(Number),
      }));
      expect(data.run.entities).toBeUndefined();
      expect(data.run.error_text).toBeUndefined();
    });
  });

  it('laat employee POST /purchase-orders/viewed door', async () => {
    const original = dataService.markViewed;
    dataService.markViewed = vi.fn().mockResolvedValue({ success: true });
    try {
      await withServer({ id: 2, role: 'employee' }, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/data/purchase-orders/viewed`, { method: 'POST' });
        expect(res.status).toBe(200);
      });
    } finally {
      dataService.markViewed = original;
    }
  });
});

describe('POST /:tableKey/correct — D365-foutdetail (#AB:295)', () => {
  const originalCorrect = dataService.correctField;
  const originalAppEnv = process.env.APP_ENV;

  afterEach(() => {
    dataService.correctField = originalCorrect;
    process.env.APP_ENV = originalAppEnv;
  });

  it('geeft err.message door met err.status, ook als errorHandler in productie draait', async () => {
    process.env.APP_ENV = 'production';
    const err = new Error('D365 OData request failed (400): PurchaseOrderName is locked');
    err.status = 400;
    dataService.correctField = vi.fn().mockRejectedValue(err);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1, role: 'employee' }; next(); });
    app.use('/api/data', dataRouter);
    app.use(errorHandler);

    const server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/data/purchase-orders/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columnId: 1, partitionKey: 'WHSL', recordKey: 'PO-1', value: 'x', basedOnValue: 'oud',
        }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe('D365 OData request failed (400): PurchaseOrderName is locked');
      expect(body.error).not.toBe('An error occurred');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
