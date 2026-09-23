'use strict';

const { restrictSupplierDataAccess } = require('./dataAccess');
const { createMockReq, createMockRes, createMockNext } = require('../test-utils/mockRequest');

function callMiddleware(overrides) {
  const req = createMockReq(overrides);
  const res = createMockRes();
  const next = createMockNext();
  restrictSupplierDataAccess(req, res, next);
  return { req, res, next };
}

describe('restrictSupplierDataAccess', () => {
  it('weigert zonder req.user met 401', () => {
    const { res, next } = callMiddleware({ user: null, path: '/purchase-orders', method: 'GET' });
    expect(res.statusCode).toBe(401);
    expect(next.calls).toHaveLength(0);
  });

  it('laat admin altijd door, ongeacht het pad', () => {
    const { next } = callMiddleware({ user: { role: 'admin' }, path: '/anything', method: 'DELETE' });
    expect(next.calls).toHaveLength(1);
  });

  it('laat employee altijd door, ongeacht het pad', () => {
    const { next } = callMiddleware({ user: { role: 'employee' }, path: '/anything', method: 'DELETE' });
    expect(next.calls).toHaveLength(1);
  });

  it('laat supplier GET op /purchase-orders door', () => {
    const { next } = callMiddleware({ user: { role: 'supplier' }, path: '/purchase-orders', method: 'GET' });
    expect(next.calls).toHaveLength(1);
  });

  it('laat supplier GET op /purchase-orders/columns door', () => {
    const { next } = callMiddleware({ user: { role: 'supplier' }, path: '/purchase-orders/columns', method: 'GET' });
    expect(next.calls).toHaveLength(1);
  });

  it('laat supplier GET op purchase-order row details door', () => {
    const { next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/rows/whsl/WSPO-0061689/details',
      method: 'GET',
    });
    expect(next.calls).toHaveLength(1);
  });

  it('weigert supplier GET details op een andere tabel met 403', () => {
    const { res, next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/vendors/rows/whsl/V-1/details',
      method: 'GET',
    });
    expect(res.statusCode).toBe(403);
    expect(next.calls).toHaveLength(0);
  });

  it.each(['/purchase-orders/history', '/purchase-orders/remarks/summary', '/purchase-orders/remarks/search', '/purchase-orders/remarks/has-comment', '/purchase-orders/remarks', '/purchase-orders/activity'])(
    'laat supplier GET op %s door',
    (path) => {
      const { next } = callMiddleware({ user: { role: 'supplier' }, path, method: 'GET' });
      expect(next.calls).toHaveLength(1);
    },
  );

  it('laat supplier PUT op een reaction-toggle door', () => {
    const { next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/remarks/42/reaction',
      method: 'PUT',
    });
    expect(next.calls).toHaveLength(1);
  });

  it('weigert supplier PUT op een niet-reaction pad met 403', () => {
    const { res, next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/remarks/42',
      method: 'PUT',
    });
    expect(res.statusCode).toBe(403);
    expect(next.calls).toHaveLength(0);
  });

  it('laat supplier POST op /purchase-orders/viewed door', () => {
    const { next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/viewed',
      method: 'POST',
    });
    expect(next.calls).toHaveLength(1);
  });

  it('weigert supplier POST op /purchase-orders/refresh/start met 403', () => {
    const { res, next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/refresh/start',
      method: 'POST',
    });
    expect(res.statusCode).toBe(403);
    expect(next.calls).toHaveLength(0);
  });

  it('weigert supplier POST viewed op een andere tabel met 403', () => {
    const { res, next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/vendors/viewed',
      method: 'POST',
    });
    expect(res.statusCode).toBe(403);
    expect(next.calls).toHaveLength(0);
  });

  it('weigert supplier POST op /purchase-orders met 403 (geen schrijftoegang)', () => {
    const { res, next } = callMiddleware({ user: { role: 'supplier' }, path: '/purchase-orders', method: 'POST' });
    expect(res.statusCode).toBe(403);
    expect(next.calls).toHaveLength(0);
  });

  it('weigert supplier op een volledig ander tabelpad met 403', () => {
    const { res, next } = callMiddleware({ user: { role: 'supplier' }, path: '/vendors', method: 'GET' });
    expect(res.statusCode).toBe(403);
    expect(next.calls).toHaveLength(0);
  });

  it('laat supplier POST op /purchase-orders/correct-all-details door (kolom-scope wordt verderop afgedwongen)', () => {
    // Padcheck alleen; de echte handhaving (vendor_editable + eigen vendor-scope) gebeurt in de
    // route (assertSupplierPurchaseOrderRow) en TableDataService (column.vendorEditable check).
    const { next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/correct-all-details',
      method: 'POST',
    });
    expect(next.calls).toHaveLength(1);
  });

  it('laat supplier PUT op /purchase-orders/value door (kolom-scope wordt verderop afgedwongen)', () => {
    const { next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/value',
      method: 'PUT',
    });
    expect(next.calls).toHaveLength(1);
  });

  it('laat supplier POST op /purchase-orders/correct door (kolom-scope wordt verderop afgedwongen)', () => {
    const { next } = callMiddleware({
      user: { role: 'supplier' },
      path: '/purchase-orders/correct',
      method: 'POST',
    });
    expect(next.calls).toHaveLength(1);
  });
});
