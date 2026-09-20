'use strict';

const sqlPool = require('./sqlPool');
const { hasPagePermission, listPagePermissions } = require('./pagePermissions');
const { createMockPool } = require('../test-utils/mockSqlPool');

const originalGetSqlPool = sqlPool.getSqlPool;

afterEach(() => {
  sqlPool.getSqlPool = originalGetSqlPool;
});

function usePool(queries) {
  const pool = createMockPool({ queries });
  sqlPool.getSqlPool = async () => pool;
  return pool;
}

describe('hasPagePermission', () => {
  it('is waar wanneer er een rij voor user + page bestaat', async () => {
    const pool = usePool([{ recordset: [{ found: 1 }] }]);

    await expect(hasPagePermission(7, 'odata')).resolves.toBe(true);
    expect(pool.calls[0].inputs).toEqual({ userId: 7, pageName: 'odata' });
  });

  it('is onwaar zonder rij', async () => {
    usePool([{ recordset: [] }]);

    await expect(hasPagePermission(7, 'odata')).resolves.toBe(false);
  });

  it('is onwaar zonder userId of pageName, zonder query', async () => {
    const pool = usePool([{ recordset: [{ found: 1 }] }]);

    await expect(hasPagePermission(null, 'odata')).resolves.toBe(false);
    await expect(hasPagePermission(7, '')).resolves.toBe(false);
    expect(pool.calls).toHaveLength(0);
  });
});

describe('listPagePermissions', () => {
  it('geeft de page_names van de gebruiker terug', async () => {
    usePool([{ recordset: [{ page_name: 'analytics' }, { page_name: 'external-links' }] }]);

    await expect(listPagePermissions(7)).resolves.toEqual(['analytics', 'external-links']);
  });

  it('geeft een lege lijst zonder userId', async () => {
    const pool = usePool([]);

    await expect(listPagePermissions(null)).resolves.toEqual([]);
    expect(pool.calls).toHaveLength(0);
  });
});
