'use strict';

// PATCH /api/admin/users/:id — rolwijziging van een bestaande gebruiker.

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

async function withServer(user, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin', require('./admin'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    return await fn((id, body) => fetch(`${baseUrl}/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('rol wijzigen', () => {
  it('promoveert een bestaande user naar admin', async () => {
    const pool = usePool([{ recordset: [{ id: 9, email: 'x@y.nl', role: 'admin' }] }]);

    await withServer(ADMIN, async (patch) => {
      const res = await patch(9, { role: 'admin' });
      expect(res.status).toBe(200);
      expect((await res.json()).user.role).toBe('admin');
    });

    expect(pool.calls[0].sql).toContain('role = @role');
    expect(pool.calls[0].inputs.role).toBe('admin');
  });

  it('ruimt de instellingen-permissies op zodra de rol geen employee meer is', async () => {
    const pool = usePool([{ recordset: [{ id: 9, email: 'x@y.nl', role: 'admin' }] }]);

    await withServer(ADMIN, async (patch) => {
      expect((await patch(9, { role: 'admin' })).status).toBe(200);
    });

    expect(pool.calls[1].sql).toContain('DELETE FROM dbo.user_permissions');
    expect(pool.calls[1].inputs).toEqual({ userId: 9 });
  });

  it('zet ontbrekende comment-rechten aan bij een wijziging naar employee', async () => {
    const pool = usePool([{ recordset: [{ id: 9, email: 'x@y.nl', role: 'employee' }] }]);

    await withServer(ADMIN, async (patch) => {
      expect((await patch(9, { role: 'employee' })).status).toBe(200);
    });

    expect(pool.calls[1].sql).toContain('comments.view');
    expect(pool.calls[1].sql).not.toContain('DELETE');
  });

  it('houdt comment-rechten bij een wissel naar vendor en wist instellingen', async () => {
    const pool = usePool([{ recordset: [{ id: 9, email: 'x@y.nl', role: 'supplier' }] }]);

    await withServer(ADMIN, async (patch) => {
      expect((await patch(9, { role: 'supplier' })).status).toBe(200);
    });

    expect(pool.calls[1].sql).toContain('DELETE FROM dbo.user_permissions');
    expect(pool.calls[1].sql).toContain('comments.view');
    expect(pool.calls[2].sql).toContain('INSERT INTO dbo.user_permissions');
  });

  it('weigert een admin die zijn eigen rol verlaagt', async () => {
    const pool = usePool([]);

    await withServer(ADMIN, async (patch) => {
      const res = await patch(ADMIN.id, { role: 'employee' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('your own role');
    });

    expect(pool.calls).toHaveLength(0);
  });

  it('staat een andere wijziging op het eigen account wel toe', async () => {
    usePool([{ recordset: [{ id: 1, email: 'admin@vanbommel.nl', role: 'admin', mfa_required: true }] }]);

    await withServer(ADMIN, async (patch) => {
      expect((await patch(ADMIN.id, { mfa_required: true })).status).toBe(200);
    });
  });

  it('weigert een onbekende rol met 400', async () => {
    const pool = usePool([]);

    await withServer(ADMIN, async (patch) => {
      expect((await patch(9, { role: 'superuser' })).status).toBe(400);
    });

    expect(pool.calls).toHaveLength(0);
  });
});
