'use strict';

// Toegangscontrole voor de generieke Table Builder-data-API (/api/data).
// - admin / employee: volledige toegang (lezen, muteren, admin-functies).
// - supplier: lezen van eigen purchase-orders (board + opengeklapte sublijnen) +
//   remarks/history/activity op eigen rijen, reaction-toggle op remarks en het
//   plaatsen van eigen comments (rij-scope via assertSupplierPurchaseOrderRow).
const { ROLES } = require('../constants/roles');

const SUPPLIER_READ_PATHS = new Set(['/purchase-orders', '/purchase-orders/columns']);

function normalizeDataPath(req) {
  return (req.path || '/').replace(/\/+$/, '') || '/';
}

function isSupplierAllowedDataRequest(req) {
  const rel = normalizeDataPath(req);
  const { method } = req;

  if (method === 'GET' && SUPPLIER_READ_PATHS.has(rel)) return true;
  if (!rel.startsWith('/purchase-orders/')) return false;

  if (method === 'GET') {
    if (rel === '/purchase-orders/history') return true;
    if (rel === '/purchase-orders/remarks/summary') return true;
    if (rel === '/purchase-orders/remarks/search') return true;
    if (rel === '/purchase-orders/remarks/has-comment') return true;
    if (rel === '/purchase-orders/remarks') return true;
    if (rel === '/purchase-orders/activity') return true;
    // Sublijnen bij openklappen: rij-scope wordt in de route afgedwongen via
    // assertSupplierPurchaseOrderRow (alleen orders in de eigen vendor-scope).
    if (/^\/purchase-orders\/rows\/[^/]+\/[^/]+\/details$/.test(rel)) return true;
  }

  if (method === 'PUT' && /^\/purchase-orders\/remarks\/\d+\/reaction$/.test(rel)) return true;

  // Suppliers mogen een eigen comment plaatsen op een order binnen hun scope. De
  // rij-scope wordt server-side afgedwongen in RowRemarksService.context().
  if (method === 'POST' && rel === '/purchase-orders/remarks') return true;

  // Waarde opslaan / D365-write-back: de padcheck hier is alleen de eerste laag. De echte
  // handhaving (kolom vendor_editable=1 én rij binnen eigen vendor-scope) gebeurt in de route/
  // TableDataService (assertSupplierPurchaseOrderRow + column.vendorEditable check).
  if (method === 'PUT' && rel === '/purchase-orders/value') return true;
  if (method === 'POST' && rel === '/purchase-orders/correct') return true;
  if (method === 'POST' && rel === '/purchase-orders/correct-all-details') return true;
  if (method === 'POST' && rel === '/purchase-orders/viewed') return true;

  return false;
}

function restrictSupplierDataAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  const role = req.user.role;
  if (role === ROLES.ADMIN || role === ROLES.EMPLOYEE) return next();

  if (role === ROLES.SUPPLIER && isSupplierAllowedDataRequest(req)) return next();

  return res.status(403).json({ error: 'Access denied — insufficient permissions' });
}

module.exports = { restrictSupplierDataAccess };

