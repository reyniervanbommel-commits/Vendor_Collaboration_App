'use strict';

// Kan een ingelogde vendor bij de data van een ándere vendor?
//
// De middleware (server/middleware/dataAccess.test.js) en de rij-scope-helper
// (server/utils/supplierRowAccess.test.js) zijn los getest; hier gaat een echt HTTP-verzoek door
// de volledige keten mount-guard -> route -> rij-scope, zoals in server.js gemonteerd.

const express = require('express');
const dataRouter = require('./data');
const dataService = require('../services/TableDataService');
const settingsService = require('../services/SettingsService');
const { restrictSupplierDataAccess } = require('../middleware/dataAccess');
const { clearSupplierVisibleRowKeyCache } = require('../utils/supplierRowAccess');
const pagePermissions = require('../utils/pagePermissions');

const originalRead = dataService.read;
const originalReadRowDetails = dataService.readRowDetails;
const originalSaveCustomValue = dataService.saveCustomValue;
const originalGetAsync = settingsService.getAsync;
const originalListPagePermissions = pagePermissions.listPagePermissions;

// De ingelogde vendor en een order dat aan een ándere vendor toebehoort.
const VENDOR = { id: 5, role: 'supplier', email: 'vendor@x.nl', vendor_account: 'V000583' };
const OWN_ROW = { partitionKey: 'whsl', recordKey: 'WSPO-0000001' };
const FOREIGN_ROW = { partitionKey: 'whsl', recordKey: 'WSPO-9999999' };

beforeEach(() => {
  clearSupplierVisibleRowKeyCache();
  pagePermissions.listPagePermissions = vi.fn().mockResolvedValue([
    'comments.view',
    'comments.write',
    'comments.column',
  ]);
  settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
  // De read-pipeline levert alleen rijen binnen de eigen vendor-scope; een order van een andere
  // vendor komt er dus niet uit, ook niet als de client de sleutel raadt.
  dataService.read = vi.fn(async ({ recordKey }) => ({
    rows: recordKey === OWN_ROW.recordKey ? [{ ...OWN_ROW, values: { vendorAccount: 'V000583' } }] : [],
    meta: {},
  }));
  dataService.readRowDetails = vi.fn().mockResolvedValue({ details: [] });
  dataService.saveCustomValue = vi.fn().mockResolvedValue({ value: 'x' });
});

afterEach(() => {
  dataService.read = originalRead;
  dataService.readRowDetails = originalReadRowDetails;
  dataService.saveCustomValue = originalSaveCustomValue;
  settingsService.getAsync = originalGetAsync;
  pagePermissions.listPagePermissions = originalListPagePermissions;
});

async function withServer(user, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/data', restrictSupplierDataAccess, dataRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
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

describe('vendor bij een order van een andere vendor', () => {
  it('krijgt 403 op de sublijnen van dat order', async () => {
    await withServer(VENDOR, async (send) => {
      const res = await send(`/api/data/purchase-orders/rows/${FOREIGN_ROW.partitionKey}/${FOREIGN_ROW.recordKey}/details`);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('not in your vendor scope');
    });

    expect(dataService.readRowDetails).not.toHaveBeenCalled();
  });

  it('krijgt 403 op de celgeschiedenis van dat order', async () => {
    await withServer(VENDOR, async (send) => {
      const res = await send(`/api/data/purchase-orders/history?columnId=1&partitionKey=${FOREIGN_ROW.partitionKey}&recordKey=${FOREIGN_ROW.recordKey}`);
      expect(res.status).toBe(403);
    });
  });

  it('krijgt 403 bij het opslaan van een waarde op dat order', async () => {
    await withServer(VENDOR, async (send) => {
      const res = await send('/api/data/purchase-orders/value', 'PUT', {
        columnId: 1, ...FOREIGN_ROW, value: 'gehackt',
      });
      expect(res.status).toBe(403);
    });

    expect(dataService.saveCustomValue).not.toHaveBeenCalled();
  });

  it('kan het eigen order wél openklappen', async () => {
    await withServer(VENDOR, async (send) => {
      const res = await send(`/api/data/purchase-orders/rows/${OWN_ROW.partitionKey}/${OWN_ROW.recordKey}/details`);
      expect(res.status).toBe(200);
    });

    expect(dataService.readRowDetails).toHaveBeenCalledTimes(1);
  });

  it('gebruikt bij de board-read altijd het eigen vendoraccount, ook met een gespooft veld', async () => {
    const spoofed = { ...VENDOR, supplierAccount: undefined };

    await withServer(spoofed, async (send) => {
      const res = await send('/api/data/purchase-orders?supplierAccount=V999999');
      expect(res.status).toBe(200);
    });

    expect(dataService.read).toHaveBeenCalledWith(expect.objectContaining({ supplierAccount: 'V000583' }));
  });
});

describe('vendor buiten de purchase-orders-tabel', () => {
  it.each([
    ['/api/data/vendors', 'GET'],
    ['/api/data/items', 'GET'],
    ['/api/data/purchase-orders/datamodel', 'GET'],
    ['/api/data/purchase-orders/board-columns', 'GET'],
    ['/api/data/purchase-orders/refresh/start', 'POST'],
    ['/api/data/purchase-orders/columns', 'POST'],
  ])('krijgt 403 op %s (%s)', async (path, method) => {
    await withServer(VENDOR, async (send) => {
      expect((await send(path, method, method === 'POST' ? {} : undefined)).status).toBe(403);
    });
  });

  it('krijgt 403 op de details van een rij in een andere tabel', async () => {
    await withServer(VENDOR, async (send) => {
      expect((await send('/api/data/vendors/rows/whsl/V-1/details')).status).toBe(403);
    });
  });
});
