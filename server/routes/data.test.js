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
const columnsService = require('../services/TableColumnsService');
const mentionsService = require('../services/RemarkMentionsService');
const registry = require('../services/TableRegistryService');

const errorHandler = require('../middleware/errorHandler');

const originalRead = dataService.read;
const originalGetAsync = settingsService.getAsync;
const originalSetReaction = remarksService.setReaction;
const originalAddRemark = remarksService.addRemark;
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
  remarksService.addRemark = originalAddRemark;
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

describe('POST /:tableKey/remarks — zichtbaarheid', () => {
  const post = (baseUrl, body) => fetch(`${baseUrl}/api/data/purchase-orders/remarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partitionKey: 'whsl', recordKey: 'PO-1', body: 'Hi', ...body }),
  });

  it('geeft visibility door aan de service', async () => {
    remarksService.addRemark = vi.fn().mockResolvedValue({ id: 1 });
    await withServer({ id: 4, role: 'supply_chain' }, async (baseUrl) => {
      expect((await post(baseUrl, { visibility: 'internal' })).status).toBe(201);
    });
    expect(remarksService.addRemark).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'internal' }),
      { id: 4, role: 'supply_chain', vendor_account: null },
    );
  });

  it('laat een 400 uit de service door als 400 met de melding', async () => {
    remarksService.addRemark = vi.fn().mockRejectedValue(
      Object.assign(new Error('Choose who can see this remark'), { status: 400 }),
    );
    await withServer({ id: 4, role: 'supply_chain' }, async (baseUrl) => {
      const res = await post(baseUrl, {});
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Choose who can see this remark');
    });
  });

  it('geeft parentId door', async () => {
    remarksService.addRemark = vi.fn().mockResolvedValue({ id: 1 });
    await withServer({ id: 4, role: 'employee' }, async (baseUrl) => {
      expect((await post(baseUrl, { parentId: 41 })).status).toBe(201);
    });
    expect(remarksService.addRemark.mock.calls[0][0].parentId).toBe(41);
  });

  it('weigert een ongeldige parentId met 400', async () => {
    remarksService.addRemark = vi.fn();
    await withServer({ id: 4, role: 'employee' }, async (baseUrl) => {
      expect((await post(baseUrl, { parentId: 'abc' })).status).toBe(400);
    });
    expect(remarksService.addRemark).not.toHaveBeenCalled();
  });

  it('negeert een niet-string visibility', async () => {
    remarksService.addRemark = vi.fn().mockResolvedValue({ id: 1 });
    await withServer({ id: 4, role: 'supply_chain' }, async (baseUrl) => {
      await post(baseUrl, { visibility: ['internal'] });
    });
    expect(remarksService.addRemark.mock.calls[0][0].visibility).toBeUndefined();
  });
});

describe('PATCH /:tableKey/columns/:id/mentionable', () => {
  const original = columnsService.setMentionable;
  afterEach(() => { columnsService.setMentionable = original; });

  const patch = (baseUrl, body) => fetch(`${baseUrl}/api/data/purchase-orders/columns/7/mentionable`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('is admin-only', async () => {
    columnsService.setMentionable = vi.fn();
    await withServer({ id: 2, role: 'employee' }, async (baseUrl) => {
      expect((await patch(baseUrl, { mentionable: true })).status).toBe(403);
    });
    expect(columnsService.setMentionable).not.toHaveBeenCalled();
  });

  it('zet de vlag als admin', async () => {
    columnsService.setMentionable = vi.fn().mockResolvedValue({ id: 7, mentionable: true });
    await withServer({ id: 1, role: 'admin' }, async (baseUrl) => {
      const res = await patch(baseUrl, { mentionable: true });
      expect(res.status).toBe(200);
      expect((await res.json()).column).toEqual({ id: 7, mentionable: true });
    });
    expect(columnsService.setMentionable).toHaveBeenCalledWith(7, true, 1);
  });
});

describe('@mentions routes', () => {
  const originals = {
    suggest: mentionsService.suggestMentions,
    resolve: mentionsService.resolveMentionTargets,
    getTable: registry.getTableByKey,
    add: remarksService.addRemark,
  };
  beforeEach(() => {
    registry.getTableByKey = vi.fn().mockResolvedValue({ id: 7, key: 'purchase-orders' });
  });
  afterEach(() => {
    mentionsService.suggestMentions = originals.suggest;
    mentionsService.resolveMentionTargets = originals.resolve;
    registry.getTableByKey = originals.getTable;
    remarksService.addRemark = originals.add;
  });

  it('GET mentions geeft suggesties met de actor', async () => {
    mentionsService.suggestMentions = vi.fn().mockResolvedValue([{ value: 'A-1' }]);
    await withServer({ id: 4, role: 'supply_chain' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/remarks/mentions?q=A-`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ suggestions: [{ value: 'A-1' }] });
    });
    expect(mentionsService.suggestMentions).toHaveBeenCalledWith(expect.objectContaining({
      q: 'A-', actor: expect.objectContaining({ id: 4, role: 'supply_chain' }), table: { id: 7, key: 'purchase-orders' },
    }));
  });

  it('POST preview geeft aantallen terug', async () => {
    mentionsService.resolveMentionTargets = vi.fn().mockResolvedValue({ rows: [], orderCount: 14, vendorCount: 3 });
    await withServer({ id: 4, role: 'supply_chain' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/remarks/mentions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partitionKey: 'whsl', recordKey: 'PO-1', mentions: [{ columnId: 11, value: 'A-1' }] }),
      });
      expect(await res.json()).toEqual({ orderCount: 14, vendorCount: 3 });
    });
    expect(mentionsService.resolveMentionTargets).toHaveBeenCalledWith(expect.objectContaining({
      currentRow: { partitionKey: 'whsl', recordKey: 'PO-1' }, mentions: [{ columnId: 11, value: 'A-1' }],
    }));
  });

  it('POST remarks: mentions moet een lijst zijn', async () => {
    remarksService.addRemark = vi.fn();
    await withServer({ id: 4, role: 'employee' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/remarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partitionKey: 'whsl', recordKey: 'PO-1', body: 'x', mentions: 'A-1' }),
      });
      expect(res.status).toBe(400);
    });
    expect(remarksService.addRemark).not.toHaveBeenCalled();
  });

  it('POST remarks: geeft mentions door', async () => {
    remarksService.addRemark = vi.fn().mockResolvedValue({ id: 1 });
    await withServer({ id: 4, role: 'employee' }, async (baseUrl) => {
      await fetch(`${baseUrl}/api/data/purchase-orders/remarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partitionKey: 'whsl', recordKey: 'PO-1', body: 'x', mentions: [{ columnId: 11, value: 'A-1' }] }),
      });
    });
    expect(remarksService.addRemark.mock.calls[0][0].mentions).toEqual([{ columnId: 11, value: 'A-1' }]);
  });

  it('POST preview controleert de rij-scope van een supplier', async () => {
    mentionsService.resolveMentionTargets = vi.fn();
    dataService.read = vi.fn(async () => ({ rows: [] }));
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    await withServer({ id: 5, role: 'supplier', vendor_account: 'V1' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/data/purchase-orders/remarks/mentions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partitionKey: 'whsl', recordKey: 'PO-OTHER', mentions: [{ columnId: 11, value: 'A' }] }),
      });
      expect(res.status).toBe(403);
    });
    expect(mentionsService.resolveMentionTargets).not.toHaveBeenCalled();
  });
});
