'use strict';

const express = require('express');
const sqlPool = require('../utils/sqlPool');
const { createMockPool } = require('../test-utils/mockSqlPool');

const originalGetSqlPool = sqlPool.getSqlPool;
const ADMIN = { id: 1, role: 'admin', email: 'admin@vanbommel.nl' };

afterEach(() => {
  sqlPool.getSqlPool = originalGetSqlPool;
});

function usePool(queries) {
  const pool = createMockPool({ queries });
  sqlPool.getSqlPool = async () => pool;
  return pool;
}

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = ADMIN; next(); });
  app.use('/api/admin', require('./admin'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('PATCH permissions', () => {
  it('weigert odata op een vendor', async () => {
    const pool = usePool([{ recordset: [{ role: 'supplier' }] }]);
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/users/4/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: [{ page_name: 'odata' }] }),
      });
      expect(res.status).toBe(400);
    });
    expect(pool.calls).toHaveLength(1);
  });

  it('slaat de drie comment-ids op voor een vendor', async () => {
    const pool = usePool([{ recordset: [{ role: 'supplier' }] }]);
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/users/4/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissions: [
            { page_name: 'comments.view' },
            { page_name: 'comments.write' },
            { page_name: 'comments.column' },
          ],
        }),
      });
      expect(res.status).toBe(200);
    });
    expect(pool.calls[1].sql).toContain('DELETE FROM dbo.user_permissions');
    expect(pool.calls.map((call) => call.inputs.pageName).filter(Boolean)).toEqual([
      'comments.view',
      'comments.write',
      'comments.column',
    ]);
  });
});
