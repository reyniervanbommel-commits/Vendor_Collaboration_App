'use strict';

// Staff-only API (admin/employee) voor Excel-koppelingen naar hoofdtabellen (#AB:162). Gemonteerd op /api/data-links
// achter requireSession + requireAnyRole([admin, employee]) (zie server.js). Upload -> parse/snapshot; publish -> fk_join-lookup.

const express = require('express');
const multer = require('multer');
const excelLink = require('../services/ExcelLinkService');
const { requirePagePermission } = require('../middleware/auth');

const router = express.Router();

// Elke route hier hoort bij de Instellingen-tab "External links" (#AB:326). Eén guard op
// routerniveau i.p.v. per route, zodat een nieuwe route hier niet per ongeluk ongeguard blijft.
router.use(requirePagePermission('external-links'));

// Upload in-memory (geen tijdelijke bestanden); harde grootte-limiet.
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_EXT = /\.(xlsx|xls|csv)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_EXT.test(file.originalname || '')) {
      return cb(Object.assign(new Error('Only .xlsx, .xls or .csv files are allowed'), { status: 400 }));
    }
    return cb(null, true);
  },
});

// GET /api/data-links/main-tables — kandidaat-hoofdtabellen + kolommen
router.get('/main-tables', async (req, res, next) => {
  try { return res.json(await excelLink.listMainTables()); } catch (err) { return next(err); }
});

// GET /api/data-links/datasets — bestaande Excel-datasets
router.get('/datasets', async (req, res, next) => {
  try { return res.json(await excelLink.listDatasets()); } catch (err) { return next(err); }
});

// Multer-fouten (te groot bestand, verkeerd type) vertalen naar een nette 400 i.p.v. 500.
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large (max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB)`
        : `Upload error: ${err.message}`;
      return res.status(400).json({ error: msg });
    }
    return res.status(err.status || 400).json({ error: err.message });
  });
}

// POST /api/data-links/datasets — upload + parse + snapshot (multipart: file, label)
router.post('/datasets', uploadSingle, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No file received' });
    const dataset = await excelLink.createOrReplaceDataset(
      { label: req.body?.label, fileName: req.file.originalname, buffer: req.file.buffer },
      req.user.id,
    );
    return res.status(201).json({ dataset });
  } catch (err) { return next(err); }
});

// DELETE /api/data-links/datasets/:tableKey — dataset + eventuele koppelingen verwijderen
router.delete('/datasets/:tableKey', async (req, res, next) => {
  try { return res.json(await excelLink.deleteDataset(req.params.tableKey)); } catch (err) { return next(err); }
});

// POST /api/data-links/validate — duplicate + match-rate (geen writes)
router.post('/validate', async (req, res, next) => {
  try {
    const { datasetTableKey, datasetKeyField, mainTableKey, sourceScope, mainKeyField } = req.body || {};
    if (!datasetTableKey || !datasetKeyField || !mainTableKey || !mainKeyField) {
      return res.status(400).json({ error: 'datasetTableKey, datasetKeyField, mainTableKey and mainKeyField are required' });
    }
    return res.json(await excelLink.validateLink({ datasetTableKey, datasetKeyField, mainTableKey, sourceScope, mainKeyField }));
  } catch (err) { return next(err); }
});

// POST /api/data-links/publish — koppeling publiceren (hard-fail bij duplicaten)
router.post('/publish', async (req, res, next) => {
  try {
    const { mainTableKey, datasetTableKey, sourceScope, mainKeyField, datasetKeyField, fields } = req.body || {};
    return res.status(201).json(await excelLink.publishLink({ mainTableKey, datasetTableKey, sourceScope, mainKeyField, datasetKeyField, fields }));
  } catch (err) { return next(err); }
});

// GET /api/data-links/links — bestaande excel-koppelingen
router.get('/links', async (req, res, next) => {
  try { return res.json(await excelLink.listLinks()); } catch (err) { return next(err); }
});

// DELETE /api/data-links/links/:id — koppeling verwijderen
router.delete('/links/:id', async (req, res, next) => {
  try { return res.json(await excelLink.deleteLink(req.params.id)); } catch (err) { return next(err); }
});

module.exports = router;
