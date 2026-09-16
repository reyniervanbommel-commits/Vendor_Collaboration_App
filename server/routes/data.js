'use strict';

// Generieke Table Builder-data-API (#AB:152, Fase A). Gemonteerd op /api/data achter requireSession +
// medewerker/admin-rol (zie server.js). tableKey-gedreven; lezen gaat uit tb_cache, bron alleen via refresh.
// Strangler-fig: dit pad staat NAAST /api/purchase-orders (dat blijft het bestaande PO-scherm voeden).

const express = require('express');
const dataService = require('../services/TableDataService');
const columnsService = require('../services/TableColumnsService');
const remarksService = require('../services/RowRemarksService');
const { getRowActivity } = require('../services/RowActivityService');
const registry = require('../services/TableRegistryService');
const {
  normalizeActive,
  normalizeBody,
  normalizeCursor,
  normalizeEmoji,
  normalizeLimit,
  normalizeOptionalColumnId,
  normalizePositiveId,
  normalizeRowIdentity,
  normalizeSearchQuery,
  normalizeTableKey,
} = require('../services/RowRemarksValidation');
const { hasRemarks, searchRemarks } = require('../services/RowRemarksSearchService');
const { requireRole, requireAnyRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const pavBoardColumns = require('../services/ProductAttributeBoardColumnsService');
const { getSupplierAccount } = require('../utils/supplierScope');
const { assertSupplierPurchaseOrderRow } = require('../utils/supplierRowAccess');
const settingsService = require('../services/SettingsService');

// Instelling die bepaalt op welke master-kolom het supplier-filter matcht (admin-instelbaar).
const SUPPLIER_FILTER_COLUMN_KEY = 'SUPPLIER_FILTER_COLUMN_KEY';
const DEFAULT_SUPPLIER_FILTER_COLUMN = 'vendorAccount';

const router = express.Router();
const PAV_TABLE_KEY = 'product-attribute-values';

function requirePavAdmin(req, res, next) {
  const tableKey = String(req.params.tableKey || '').trim();
  if (tableKey !== PAV_TABLE_KEY) return next();
  return requireRole(ROLES.ADMIN)(req, res, next);
}

router.use('/:tableKey', requirePavAdmin);

function remarksActor(req) {
  return { id: req.user?.id, role: req.user?.role, vendor_account: req.user?.vendor_account || null };
}

function toColumnId(raw) {
  if (!/^\d+$/.test(String(raw || '').trim())) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// GET /api/data/:tableKey/remarks/summary — actieve remarktellers per masterrij.
router.get('/:tableKey/remarks/summary', async (req, res, next) => {
  try {
    const tableKey = normalizeTableKey(req.params.tableKey);
    const rows = await remarksService.summarizeRemarks(tableKey, remarksActor(req));
    return res.json({ rows });
  } catch (err) {
    return next(err);
  }
});

router.get('/:tableKey/remarks/search', async (req, res, next) => {
  try {
    const tableKey = normalizeTableKey(req.params.tableKey);
    const query = normalizeSearchQuery(req.query.q);
    return res.json(await searchRemarks(tableKey, query, remarksActor(req)));
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/remarks/has-comment — sleutels van rijen met minstens één actieve
// remark, voor de Remarks-kolomfilter-operator "has a comment" (geen zoekterm).
router.get('/:tableKey/remarks/has-comment', async (req, res, next) => {
  try {
    const tableKey = normalizeTableKey(req.params.tableKey);
    return res.json(await hasRemarks(tableKey, remarksActor(req)));
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/remarks — stabiel cursor-gepagineerde remarks, inclusief tombstones.
router.get('/:tableKey/remarks', async (req, res, next) => {
  try {
    const tableKey = normalizeTableKey(req.params.tableKey);
    const row = normalizeRowIdentity(req.query.partitionKey, req.query.recordKey);
    normalizeCursor(req.query.cursor);
    const limit = normalizeLimit(req.query.limit);
    return res.json(await remarksService.listRemarks(
      { tableKey, ...row, cursor: req.query.cursor || null, limit },
      remarksActor(req),
    ));
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/remarks — immutable remark toevoegen aan een bestaande masterrij.
// Staff + suppliers: suppliers mogen uitsluitend op orders binnen hun eigen vendor-scope
// reageren; die rij-scope wordt afgedwongen in RowRemarksService.context().
router.post('/:tableKey/remarks', async (req, res, next) => {
  try {
    const tableKey = normalizeTableKey(req.params.tableKey);
    const row = normalizeRowIdentity(req.body?.partitionKey, req.body?.recordKey);
    const body = normalizeBody(req.body?.body);
    const columnId = normalizeOptionalColumnId(req.body?.columnId);
    const remark = await remarksService.addRemark(
      { tableKey, ...row, body, columnId },
      remarksActor(req),
    );
    return res.status(201).json({ remark });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/data/:tableKey/remarks/:id — owner/admin soft delete met rijbinding.
router.delete('/:tableKey/remarks/:id', requireAnyRole([ROLES.ADMIN, ROLES.EMPLOYEE]), async (req, res, next) => {
  try {
    const tableKey = normalizeTableKey(req.params.tableKey);
    const id = normalizePositiveId(req.params.id, 'remarkId');
    const row = normalizeRowIdentity(req.body?.partitionKey, req.body?.recordKey);
    const remark = await remarksService.deleteRemark(
      { tableKey, id, ...row },
      remarksActor(req),
    );
    return res.json({ remark });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/data/:tableKey/remarks/:id/reaction — atomische, idempotente reaction-toggle.
router.put('/:tableKey/remarks/:id/reaction', async (req, res, next) => {
  try {
    const tableKey = normalizeTableKey(req.params.tableKey);
    const id = normalizePositiveId(req.params.id, 'remarkId');
    const row = normalizeRowIdentity(req.body?.partitionKey, req.body?.recordKey);
    const emoji = normalizeEmoji(req.body?.emoji);
    const active = normalizeActive(req.body?.active);
    const reactions = await remarksService.setReaction(
      { tableKey, id, ...row, emoji, active },
      remarksActor(req),
    );
    return res.json({ reactions });
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/activity — row history of gecombineerde remarks/activity-feed.
router.get('/:tableKey/activity', async (req, res, next) => {
  try {
    const activity = await getRowActivity({
      tableKey: normalizeTableKey(req.params.tableKey),
      partitionKey: req.query.partitionKey,
      recordKey: req.query.recordKey,
      kind: req.query.kind,
      columnId: req.query.columnId,
      actionFilter: req.query.actionFilter,
      cursor: req.query.cursor,
      afterCursor: req.query.afterCursor,
      limit: req.query.limit,
      currentUser: remarksActor(req),
    });
    return res.json(activity);
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/revision — lichtgewicht "is het board gewijzigd?"-token.
// Statisch pad, dus geregistreerd vóór GET /:tableKey (anders vangt de tableKey-route 'revision' op).
router.get('/:tableKey/revision', async (req, res, next) => {
  try {
    const { tableKey } = req.params;
    const isSupplier = req.user?.role === ROLES.SUPPLIER;
    const supplierAccount = isSupplier ? getSupplierAccount(req.user) : null;
    const result = await dataService.getRevision({ tableKey, userId: req.user.id, supplierAccount });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey?autoRefresh=1 — lezen (lazy refresh bij stale cache).
router.get('/:tableKey', async (req, res, next) => {
  try {
    const { tableKey } = req.params;
    // Suppliers zien uitsluitend hun eigen orders: geef het leveranciersaccount + de
    // admin-gekozen filterkolom door zodat de read de rijen filtert. Staff geeft null door.
    const isSupplier = req.user?.role === ROLES.SUPPLIER;
    const supplierAccount = isSupplier ? getSupplierAccount(req.user) : null;
    const supplierFilterColumn = isSupplier
      ? await settingsService.getAsync(SUPPLIER_FILTER_COLUMN_KEY, DEFAULT_SUPPLIER_FILTER_COLUMN)
      : DEFAULT_SUPPLIER_FILTER_COLUMN;
    // Sublijnen blijven standaard buiten de board-payload; het board haalt ze per order op bij
    // het openklappen (GET .../rows/:partitionKey/:recordKey/details). ?includeDetails=1 geeft
    // de oude, volledige vorm terug — handig om te vergelijken bij het debuggen.
    const includeDetails = req.query.includeDetails === '1' || req.query.includeDetails === 'true';
    const data = await dataService.read({
      tableKey, userId: req.user.id, supplierAccount, supplierFilterColumn, includeDetails,
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/refresh — forceer een bron-refresh.
// body.baseline = true: nulmeting. Haalt alles opnieuw op zonder wijzigingen in het dagboek te
// zetten — bedoeld na een datamodel-wijziging, zodat de nieuwe uitgangssituatie niet als duizenden
// "nieuwe" rijen op het bord verschijnt.
router.post('/:tableKey/refresh', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { tableKey } = req.params;
    const baseline = req.body?.baseline === true;
    const summary = await dataService.refresh(tableKey, { baseline });
    const data = await dataService.read({ tableKey, userId: req.user.id, includeDetails: false });
    return res.json({ ...data, refresh: summary, refreshed: true });
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/refresh/start — start refresh op de achtergrond.
router.post('/:tableKey/refresh/start', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { tableKey } = req.params;
    const result = await dataService.startRefresh(tableKey, { triggeredByUserId: req.user?.id });
    return res.status(result.started ? 202 : 200).json(result);
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/refresh/progress — voortgang van de lopende/laatste bron-refresh.
router.get('/:tableKey/refresh/progress', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { tableKey } = req.params;
    const refreshRunService = require('../services/RefreshRunService');
    return res.json(refreshRunService.serializeLivePayload(
      dataService.getRefreshProgress(tableKey),
      { view: String(req.query.view || ''), running: dataService.isRefreshRunning(tableKey) }
    ));
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/viewed — per-gebruiker last_viewed_at (purchase-orders: elke rol).
function viewedRoleGuard(req, res, next) {
  if (req.params.tableKey === 'purchase-orders') return next();
  return requireRole(ROLES.ADMIN)(req, res, next);
}

router.post('/:tableKey/viewed', viewedRoleGuard, async (req, res, next) => {
  try {
    const isSupplier = req.user?.role === ROLES.SUPPLIER;
    const supplierAccount = isSupplier ? getSupplierAccount(req.user) : null;
    const result = await dataService.markViewed(req.user.id, req.params.tableKey, { supplierAccount });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.get('/:tableKey/board-columns', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    if (req.params.tableKey !== PAV_TABLE_KEY) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json({ names: await pavBoardColumns.listBoardAttributeNames() });
  } catch (err) { return next(err); }
});

router.post('/:tableKey/board-columns', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    if (req.params.tableKey !== PAV_TABLE_KEY) {
      return res.status(404).json({ error: 'Not found' });
    }
    const body = pavBoardColumns.normalizeBoardColumnBody(req.body);
    return res.json(await pavBoardColumns.setBoardAttributeVisible(body, req.user.id));
  } catch (err) { return next(err); }
});

// GET /api/data/:tableKey/columns?scope=&includeInactive=&enriched=
router.get('/:tableKey/columns', async (req, res, next) => {
  try {
    const scope = req.query.scope ? String(req.query.scope) : null;
    if (scope && !registry.SCOPES.includes(scope)) {
      return res.status(400).json({ error: 'Invalid scope' });
    }
    const enriched = req.query.enriched === '1' || req.query.enriched === 'true';
    if (enriched && req.params.tableKey === 'purchase-orders') {
      const defs = await dataService.getBoardColumnDefinitions(req.params.tableKey, { scope });
      if (scope === 'master') return res.json({ columns: defs.master || [] });
      if (scope === 'detail') return res.json({ columns: defs.detail || [] });
      return res.json({ columns: [...(defs.master || []), ...(defs.detail || [])] });
    }
    const table = await registry.getTableByKey(req.params.tableKey);
    const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
    const columns = await registry.listColumns({ tableId: table.id, scope, includeInactive });
    return res.json({ columns });
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/columns — app-native kolom toevoegen.
router.post('/:tableKey/columns', async (req, res, next) => {
  try {
    const { scope, label, dataType, options, formulaExpr } = req.body || {};
    const column = await columnsService.createColumn(
      { tableKey: req.params.tableKey, scope, label, dataType, options, formulaExpr },
      req.user.id,
    );
    return res.status(201).json({ column });
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/columns/validate-formula — valideer formule + refs zonder opslaan.
router.post('/:tableKey/columns/validate-formula', async (req, res, next) => {
  try {
    const table = await registry.getTableByKey(req.params.tableKey);
    const scope = String(req.body?.scope || 'master').trim() === 'detail' ? 'detail' : 'master';
    const ownColumnKey = String(req.body?.ownColumnKey || '').trim();
    const resultType = String(req.body?.dataType || 'number').trim() || 'number';
    const normalized = columnsService.normalizeFormulaExpression(req.body?.formulaExpr);
    if (!normalized.expression) {
      return res.status(400).json({ error: 'Formula is required' });
    }
    const scopeColumns = await registry.listColumns({ tableId: table.id, scope, includeInactive: false });
    columnsService.validateFormulaReferences(normalized.references, scopeColumns, ownColumnKey, scope);
    columnsService.validateFormulaResultTypeCompatibility(
      normalized.expression,
      normalized.references,
      scopeColumns,
      resultType
    );
    return res.json({
      valid: true,
      normalizedExpression: normalized.expression,
      references: normalized.references,
    });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/data/:tableKey/columns/:id — app-native kolom hernoemen.
router.patch('/:tableKey/columns/:id', async (req, res, next) => {
  try {
    const columnId = toColumnId(req.params.id);
    if (!columnId) return res.status(400).json({ error: 'Invalid column id' });
    const hasFormulaPayload = req.body && (
      Object.prototype.hasOwnProperty.call(req.body, 'formulaExpr')
      || Object.prototype.hasOwnProperty.call(req.body, 'dataType')
    );
    const hasOptionsPayload = req.body && Object.prototype.hasOwnProperty.call(req.body, 'options');
    const column = hasFormulaPayload
      ? await columnsService.updateFormulaColumn(
        columnId,
        {
          label: req.body?.label,
          dataType: req.body?.dataType,
          formulaExpr: req.body?.formulaExpr,
        },
        req.user.id,
      )
      : hasOptionsPayload
        ? await columnsService.updateColumn(
          columnId,
          {
            label: req.body?.label,
            options: req.body?.options,
            statusReassignments: req.body?.statusReassignments,
          },
          req.user.id,
        )
        : await columnsService.renameColumn(columnId, req.body?.label, req.user.id);
    return res.json({ column });
  } catch (err) {
    // Statuslabel-verwijdering die nog in gebruik is: details (welke labels, hoeveel items) zijn
    // niet gevoelig en de UI heeft ze nodig om een reassign-keuze te tonen. De generieke
    // errorHandler verbergt in productie het bericht + strip extra velden, dus hier expliciet.
    if (err.status === 409 && err.code === 'STATUS_LABELS_IN_USE') {
      return res.status(409).json({ error: err.message, code: err.code, details: err.details });
    }
    return next(err);
  }
});

// DELETE /api/data/:tableKey/columns/:id — soft-delete (waarden blijven behouden).
// Admin-only: een kolom weghalen raakt het bord voor iedereen (grootste blast radius van de
// datamodel-routes). De overige beheerroutes blijven bewust open voor employees.
router.delete('/:tableKey/columns/:id', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const columnId = toColumnId(req.params.id);
    if (!columnId) return res.status(400).json({ error: 'Invalid column id' });
    const result = await columnsService.deactivateColumn(columnId, req.user.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/data/:tableKey/columns/:id/visibility — kolom tonen/verbergen op het bord (is_active). #AB:170
router.patch('/:tableKey/columns/:id/visibility', async (req, res, next) => {
  try {
    const columnId = toColumnId(req.params.id);
    if (!columnId) return res.status(400).json({ error: 'Invalid column id' });
    const column = await columnsService.setColumnVisibility(columnId, Boolean(req.body?.visible), req.user.id);
    return res.json({ column });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/data/:tableKey/columns/:id/visible-at-delete — zichtbaar in de verborgen-orders-popup. #AB:170
router.patch('/:tableKey/columns/:id/visible-at-delete', async (req, res, next) => {
  try {
    const columnId = toColumnId(req.params.id);
    if (!columnId) return res.status(400).json({ error: 'Invalid column id' });
    const column = await columnsService.setVisibleAtDelete(columnId, Boolean(req.body?.visible), req.user.id);
    return res.json({ column });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/data/:tableKey/columns/:id/vendor-editable — mag een vendor deze kolom bewerken? (admin-only)
router.patch('/:tableKey/columns/:id/vendor-editable', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const columnId = toColumnId(req.params.id);
    if (!columnId) return res.status(400).json({ error: 'Invalid column id' });
    const column = await columnsService.setVendorEditable(columnId, Boolean(req.body?.editable), req.user.id);
    return res.json({ column });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/data/:tableKey/columns/:id/writeback — write-back-config (writable + mechanisme). #AB:170
router.patch('/:tableKey/columns/:id/writeback', async (req, res, next) => {
  try {
    const columnId = toColumnId(req.params.id);
    if (!columnId) return res.status(400).json({ error: 'Invalid column id' });
    const column = await columnsService.setWriteBackConfig(
      columnId,
      { writable: req.body?.writable, mechanism: req.body?.mechanism },
      req.user.id,
      req.params.tableKey,
    );
    return res.json({ column });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/data/:tableKey/value — app-native kolomwaarde opslaan (instant).
router.put('/:tableKey/value', async (req, res, next) => {
  try {
    const { columnId, partitionKey, recordKey, detailKey, value } = req.body || {};
    const id = toColumnId(columnId);
    if (!id) return res.status(400).json({ error: 'Invalid column id' });
    await assertSupplierPurchaseOrderRow(req.user, {
      tableKey: req.params.tableKey,
      partitionKey,
      recordKey,
    });
    const saved = await dataService.saveCustomValue(
      { tableKey: req.params.tableKey, columnId: id, partitionKey, recordKey, detailKey, value },
      req.user,
    );
    return res.json({ success: true, ...saved });
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/datamodel — admin: entiteiten, relatie, kolommen, cache-stats, sync-filter. #AB:175
router.get('/:tableKey/datamodel', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    return res.json(await dataService.getDataModel(req.params.tableKey));
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/discover-fields — admin: ontdek alle beschikbare bronvelden (kleine sample,
// geen cache-write) en registreer nieuwe velden als beschikbare (inactieve) kolommen om te kiezen. #AB:177
router.post('/:tableKey/discover-fields', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    return res.json(await dataService.discoverSourceFields(req.params.tableKey));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/data/:tableKey/sync-filters — admin: gestructureerde D365-syncfilterregels opslaan. #AB:174
router.put('/:tableKey/sync-filters', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    return res.json(await dataService.saveSyncFilters(req.params.tableKey, req.body?.layers || req.body?.rules));
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/sync-filters/count — admin: tel hoeveel bron-rijen de filter matcht. #AB:174
router.post('/:tableKey/sync-filters/count', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    return res.json(await dataService.countSyncFilter(req.params.tableKey, req.body?.layers || req.body?.rules));
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/history?columnId=&partitionKey=&recordKey=&detailKey= — cel-geschiedenis. #AB:173
router.get('/:tableKey/history', async (req, res, next) => {
  try {
    const id = toColumnId(req.query.columnId);
    if (!id) return res.status(400).json({ error: 'Invalid column id' });
    await assertSupplierPurchaseOrderRow(req.user, {
      tableKey: req.params.tableKey,
      partitionKey: req.query.partitionKey,
      recordKey: req.query.recordKey,
    });
    const history = await dataService.getCellHistory({
      tableKey: req.params.tableKey,
      columnId: id,
      partitionKey: req.query.partitionKey,
      recordKey: req.query.recordKey,
      detailKey: req.query.detailKey,
    });
    return res.json({ history });
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/correct — D365-veldcorrectie terugschrijven (write-back). #AB:172
router.post('/:tableKey/correct', async (req, res, next) => {
  try {
    const { columnId, partitionKey, recordKey, detailKey, value, basedOnValue } = req.body || {};
    const id = toColumnId(columnId);
    if (!id) return res.status(400).json({ error: 'Invalid column id' });
    await assertSupplierPurchaseOrderRow(req.user, {
      tableKey: req.params.tableKey,
      partitionKey,
      recordKey,
    });
    const result = await dataService.correctField(
      { tableKey: req.params.tableKey, columnId: id, partitionKey, recordKey, detailKey, value, basedOnValue },
      req.user,
    );
    return res.json(result);
  } catch (err) {
    // Productie-errorHandler verbergt err.message; deze route moet D365-detail tonen (#AB:295).
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// POST /api/data/:tableKey/correct-all-details — header-fan-out naar alle D365-regels van één PO. #AB:302
router.post('/:tableKey/correct-all-details', async (req, res, next) => {
  try {
    const { columnId, partitionKey, recordKey, value } = req.body || {};
    const id = toColumnId(columnId);
    if (!id) return res.status(400).json({ error: 'Invalid column id' });
    await assertSupplierPurchaseOrderRow(req.user, {
      tableKey: req.params.tableKey,
      partitionKey,
      recordKey,
    });
    const result = await dataService.correctAllDetailFields(
      { tableKey: req.params.tableKey, columnId: id, partitionKey, recordKey, value },
      req.user,
    );
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/rows/exclude — bulk "verwijderen" (persistente exclusion). #AB:171
router.post('/:tableKey/rows/exclude', async (req, res, next) => {
  try {
    const result = await dataService.excludeRows(
      { tableKey: req.params.tableKey, rows: req.body?.rows },
      req.user.id,
    );
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/rows/hidden-in-filter — verborgen rijen die nog binnen de bron-scope vallen. #AB:171
router.get('/:tableKey/rows/hidden-in-filter', async (req, res, next) => {
  try {
    const result = await dataService.listHiddenInFilterRows(req.params.tableKey);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/purchase-orders/lookup-debug � diagnostisch: toont lookup-state voor items (admin only)
router.get('/purchase-orders/lookup-debug', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const table = await registry.getTableByKey('purchase-orders');
    const pool = await registry.getPool();
    const enrichment = await dataService.loadLookupEnrichment(table);
    const itemsLookup = enrichment.lookups.find((lk) => lk.targetTableKey === 'items');
    if (!itemsLookup) return res.json({ error: 'Items lookup niet gevonden in enrichment' });

    const sampleKeys = [...itemsLookup.byKey.keys()].slice(0, 10);
    const sampleEntries = sampleKeys.map((k) => {
      const v = itemsLookup.byKey.get(k);
      return { key: k, itemNumber: v?.itemNumber, searchName: v?.searchName };
    });

    const detailSample = await pool.request()
      .input('tableId', require('mssql').BigInt, table.id)
      .query(`SELECT TOP 5 partition_key, record_key, detail_key,
                JSON_VALUE(data_json, '$.itemNumber') AS item_number_in_json
              FROM dbo.tb_cache
              WHERE table_id = @tableId AND scope = 'detail' AND removed_at_source = 0`);

    return res.json({
      sourceScope: itemsLookup.sourceScope,
      sourceFieldKey: itemsLookup.sourceFieldKey,
      byKeySize: itemsLookup.byKey.size,
      sampleByKeyEntries: sampleEntries,
      fieldEntries: itemsLookup.fieldEntries,
      poDetailSample: detailSample.recordset,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/data/:tableKey/rows/:partitionKey/:recordKey/details � sublijnen van ��n rij.
// GET /api/data/:tableKey/rows/:partitionKey/:recordKey/details — sublijnen van één rij.
// Het board krijgt de regels niet meer mee in de board-read (die zou bij ~2000 orders
// tientallen MB's worden) en haalt ze hiermee op zodra een order wordt opengeklapt.
router.get('/:tableKey/rows/:partitionKey/:recordKey/details', async (req, res, next) => {
  try {
    const { tableKey, partitionKey, recordKey } = req.params;
    await assertSupplierPurchaseOrderRow(req.user, { tableKey, partitionKey, recordKey });
    const result = await dataService.readRowDetails({
      tableKey,
      partitionKey,
      recordKey,
      userId: req.user?.id,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// POST /api/data/:tableKey/rows/include — "terugzetten": hef de exclusion op. #AB:171
router.post('/:tableKey/rows/include', async (req, res, next) => {
  try {
    const result = await dataService.includeRows(
      { tableKey: req.params.tableKey, rows: req.body?.rows },
      req.user.id,
    );
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
