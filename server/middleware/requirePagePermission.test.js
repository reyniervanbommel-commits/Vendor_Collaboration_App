'use strict';

const pagePermissions = require('../utils/pagePermissions');
const { requirePagePermission } = require('./auth');
const { createMockReq, createMockRes, createMockNext } = require('../test-utils/mockRequest');

const originalHasPagePermission = pagePermissions.hasPagePermission;

afterEach(() => {
  pagePermissions.hasPagePermission = originalHasPagePermission;
});

describe('requirePagePermission', () => {
  it('laat admin altijd door zonder permissie-query', async () => {
    pagePermissions.hasPagePermission = vi.fn();
    const req = createMockReq({ user: { id: 1, role: 'admin' } });
    const res = createMockRes();
    const next = createMockNext();

    await requirePagePermission('odata')(req, res, next);

    expect(next.calls).toHaveLength(1);
    expect(pagePermissions.hasPagePermission).not.toHaveBeenCalled();
  });

  it('laat een employee met de permissie door', async () => {
    pagePermissions.hasPagePermission = vi.fn().mockResolvedValue(true);
    const req = createMockReq({ user: { id: 7, role: 'employee' } });
    const res = createMockRes();
    const next = createMockNext();

    await requirePagePermission('odata')(req, res, next);

    expect(next.calls).toHaveLength(1);
    expect(pagePermissions.hasPagePermission).toHaveBeenCalledWith(7, 'odata');
  });

  it('weigert een employee zonder de permissie met 403', async () => {
    pagePermissions.hasPagePermission = vi.fn().mockResolvedValue(false);
    const req = createMockReq({ user: { id: 7, role: 'employee' } });
    const res = createMockRes();
    const next = createMockNext();

    await requirePagePermission('odata')(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain("'odata' permission required");
    expect(next.calls).toHaveLength(0);
  });

  it('weigert een supplier met 403, ook als er een permissierij zou bestaan', async () => {
    pagePermissions.hasPagePermission = vi.fn().mockResolvedValue(true);
    const req = createMockReq({ user: { id: 9, role: 'supplier' } });
    const res = createMockRes();
    const next = createMockNext();

    await requirePagePermission('odata')(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(pagePermissions.hasPagePermission).not.toHaveBeenCalled();
  });

  it('weigert zonder req.user met 401', async () => {
    const req = createMockReq({ user: null });
    const res = createMockRes();
    const next = createMockNext();

    await requirePagePermission('odata')(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next.calls).toHaveLength(0);
  });

  it('geeft een DB-fout door aan next() in plaats van de server te laten crashen', async () => {
    const dbError = new Error('SQL down');
    pagePermissions.hasPagePermission = vi.fn().mockRejectedValue(dbError);
    const req = createMockReq({ user: { id: 7, role: 'employee' } });
    const res = createMockRes();
    const next = createMockNext();

    await requirePagePermission('odata')(req, res, next);

    expect(next.calls).toEqual([[dbError]]);
    expect(res.statusCode).toBe(200);
  });
});
