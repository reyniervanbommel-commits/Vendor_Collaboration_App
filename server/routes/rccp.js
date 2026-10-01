'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { resolveVendorQuery, resolveSupplierAccount } = require('../middleware/rccpAccess');
const capacityService = require('../services/RccpCapacityService');
const importService = require('../services/RccpImportService');
const analysisService = require('../services/RccpAnalysisService');
const settingsService = require('../services/RccpSettingsService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function parseWindowQuery(req) {
  const fromYear = Number(req.query.fromYear);
  const fromWeek = Number(req.query.fromWeek);
  const toYear = Number(req.query.toYear ?? req.query.fromYear);
  const toWeek = Number(req.query.toWeek ?? req.query.fromWeek);
  if (![fromYear, fromWeek, toYear, toWeek].every(Number.isFinite)) {
    const err = new Error('fromYear, fromWeek, toYear and toWeek are required');
    err.status = 400;
    throw err;
  }
  return { fromYear, fromWeek, toYear, toWeek };
}

router.get('/settings', async (req, res, next) => {
  try {
    const config = await settingsService.getConfig();
    res.json({ config, readOnly: Boolean(req.rccpScope?.readOnly) });
  } catch (err) {
    next(err);
  }
});

router.get('/vendors', async (req, res, next) => {
  try {
    const supplierAccount = resolveSupplierAccount(req);
    const data = await analysisService.listMainTableVendors({ supplierAccount });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/item-lookup', async (req, res, next) => {
  try {
    const itemNumbers = String(req.query.itemNumbers || '')
      .split(',')
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const data = await analysisService.listItemPickerLookup({ itemNumbers });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/capacity', async (req, res, next) => {
  try {
    const vendorAccount = resolveVendorQuery(req);
    const periodYear = req.query.periodYear ? Number(req.query.periodYear) : null;
    const fromWeek = req.query.fromWeek ? Number(req.query.fromWeek) : null;
    const toWeek = req.query.toWeek ? Number(req.query.toWeek) : null;
    const rows = await capacityService.listCapacity({ vendorAccount, periodYear, fromWeek, toWeek });
    res.json({ rows, readOnly: Boolean(req.rccpScope?.readOnly) });
  } catch (err) {
    next(err);
  }
});

router.post('/capacity', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { vendorAccount, periodYear, isoWeek, capacityCategory, availableQty } = req.body || {};
    if (!vendorAccount || !capacityCategory) {
      return res.status(400).json({ error: 'vendorAccount and capacityCategory are required' });
    }
    const row = await capacityService.createCapacity({
      vendorAccount: String(vendorAccount).trim(),
      periodYear: Number(periodYear),
      isoWeek: Number(isoWeek),
      capacityCategory: String(capacityCategory).trim(),
      availableQty: Number(availableQty),
    }, req.user?.id ?? null);
    res.status(201).json({ row });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.put('/capacity/:id', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const {
      vendorAccount, periodYear, isoWeek, capacityCategory, availableQty,
    } = req.body || {};
    if (!vendorAccount || !capacityCategory) {
      return res.status(400).json({ error: 'vendorAccount and capacityCategory are required' });
    }
    const row = await capacityService.updateCapacity(req.params.id, {
      vendorAccount: String(vendorAccount).trim(),
      periodYear: Number(periodYear),
      isoWeek: Number(isoWeek),
      capacityCategory: String(capacityCategory).trim(),
      availableQty: Number(availableQty),
    }, req.user?.id ?? null);
    res.json({ row });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/capacity', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const vendorAccount = resolveVendorQuery(req);
    const result = await capacityService.deleteAllCapacity({ vendorAccount });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/capacity/:id', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const result = await capacityService.deleteCapacity(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /capacity/delete-bulk — verwijder een geselecteerde set rijen in één round-trip.
router.post('/capacity/delete-bulk', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const result = await capacityService.deleteCapacityRows(req.body?.ids);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/import/template', requireRole(ROLES.ADMIN), (_req, res) => {
  const buffer = importService.buildTemplateWorkbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="rccp-capacity-template.xlsx"');
  res.send(buffer);
});

router.post('/import/preview', requireRole(ROLES.ADMIN), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'file is required' });
    const preview = await importService.previewImport(req.file.buffer);
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

router.post('/import/commit', requireRole(ROLES.ADMIN), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'file is required' });
    const config = await settingsService.getConfig();
    const duplicatePolicy = String(req.body?.duplicatePolicy || config.duplicatePolicy || 'update');
    const result = await importService.commitImport({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      duplicatePolicy,
      userId: req.user?.id ?? null,
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/board-kpis', async (req, res, next) => {
  try {
    const supplierAccount = resolveSupplierAccount(req);
    // ?dateMode=confirmed levert de tweede, op confirmed delivery date gebaseerde set mee. Zonder
    // die vlag blijft hij weg: hij kost een tweede walk over alle PO-regels en verdubbelt de
    // response, terwijl de C/R-toggle standaard op 'requested' staat.
    const includeConfirmed = String(req.query.dateMode || '').trim().toLowerCase() === 'confirmed';
    const data = await analysisService.boardKpis({ supplierAccount, includeConfirmed });
    res.json({ ...data, readOnly: Boolean(req.rccpScope?.readOnly) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/analysis', async (req, res, next) => {
  try {
    const window = parseWindowQuery(req);
    const vendorAccount = resolveVendorQuery(req);
    const supplierAccount = resolveSupplierAccount(req);
    const data = await analysisService.analyze({
      vendorAccount,
      supplierAccount,
      planningDateMode: req.query.planningDateMode,
      ...window,
    });
    res.json({ ...data, readOnly: Boolean(req.rccpScope?.readOnly) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/drill-down', async (req, res, next) => {
  try {
    const window = parseWindowQuery(req);
    const vendorAccount = resolveVendorQuery(req) || String(req.query.vendorAccount || '').trim();
    if (!vendorAccount) return res.status(400).json({ error: 'vendorAccount is required' });
    const supplierAccount = resolveSupplierAccount(req);
    const data = await analysisService.getDrillDown({
      vendorAccount,
      periodYear: req.query.periodYear,
      isoWeek: req.query.isoWeek,
      measureKey: req.query.measureKey || req.query.capacityCategory,
      supplierAccount,
      planningDateMode: req.query.planningDateMode,
      ...window,
    });
    res.json({ ...data, readOnly: Boolean(req.rccpScope?.readOnly) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
