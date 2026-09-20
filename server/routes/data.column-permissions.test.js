'use strict';

// Grens tussen kolombeheer via Instellingen > Data model (achter de 'datamodel'-permissie) en
// kolomacties in het PO-board-kolommenu (bewust open voor elke staff-gebruiker, #AB:326).
//
// Deze suite legt die grens vast: schuift iemand later een board-route achter de permissie of
// andersom, dan valt dat hier om in plaats van stilletjes door te gaan.

const express = require('express');
const columnsService = require('../services/TableColumnsService');
const pagePermissions = require('../utils/pagePermissions');
const dataRouter = require('./data');

const originalHasPagePermission = pagePermissions.hasPagePermission;
const originalSetColumnVisibility = columnsService.setColumnVisibility;
const originalSetVisibleAtDelete = columnsService.setVisibleAtDelete;
const originalSetWriteBackConfig = columnsService.setWriteBackConfig;
const originalRenameColumn = columnsService.renameColumn;

const EMPLOYEE = { id: 7, role: 'employee', email: 'employee@vanbommel.nl' };

beforeEach(() => {
  columnsService.setColumnVisibility = vi.fn().mockResolvedValue({ id: 1 });
  columnsService.setVisibleAtDelete = vi.fn().mockResolvedValue({ id: 1 });
  columnsService.setWriteBackConfig = vi.fn().mockResolvedValue({ id: 1 });
});

afterEach(() => {
  pagePermissions.hasPagePermission = originalHasPagePermission;
  columnsService.setColumnVisibility = originalSetColumnVisibility;
  columnsService.setVisibleAtDelete = originalSetVisibleAtDelete;
  columnsService.setWriteBackConfig = originalSetWriteBackConfig;
  columnsService.renameColumn = originalRenameColumn;
});

function grantDatamodel(granted) {
  pagePermissions.hasPagePermission = vi.fn(async (_userId, pageName) => granted && pageName === 'datamodel');
}

async function patchAsEmployee(path, body = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = EMPLOYEE; next(); });
  app.use('/api/data', dataRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/data${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.status;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const DATAMODEL_ONLY = [
  ['/purchase-orders/columns/1/writeback', { writable: true, mechanism: 'patch' }],
  ['/purchase-orders/columns/1/visibility', { visible: false }],
  ['/purchase-orders/columns/1/visible-at-delete', { visible: true }],
];

describe('kolomroutes achter de datamodel-permissie', () => {
  it.each(DATAMODEL_ONLY)('%s geeft 403 zonder de permissie', async (path, body) => {
    grantDatamodel(false);

    expect(await patchAsEmployee(path, body)).toBe(403);
  });

  it.each(DATAMODEL_ONLY)('%s laat door mét de permissie', async (path, body) => {
    grantDatamodel(true);

    expect(await patchAsEmployee(path, body)).toBe(200);
  });

  it('raakt de service niet aan wanneer de permissie ontbreekt', async () => {
    grantDatamodel(false);

    await patchAsEmployee('/purchase-orders/columns/1/writeback', { writable: true });

    expect(columnsService.setWriteBackConfig).not.toHaveBeenCalled();
  });
});

describe('kolomacties uit het board-kolommenu', () => {
  it('blijven open voor staff zonder datamodel-permissie', async () => {
    // Bewuste keuze: hernoemen en toevoegen zit in het kolommenu van het PO-board en hoort bij
    // het dagelijks werk van een employee, niet bij het beheer van het datamodel.
    grantDatamodel(false);
    columnsService.renameColumn = vi.fn().mockResolvedValue({ id: 1, label: 'Nieuw' });

    expect(await patchAsEmployee('/purchase-orders/columns/1', { label: 'Nieuw' })).toBe(200);
    expect(columnsService.renameColumn).toHaveBeenCalled();
  });
});
