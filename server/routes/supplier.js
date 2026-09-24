'use strict';

const express = require('express');
const sql = require('mssql');
const { query, validationResult } = require('express-validator');
const { fetchPurchaseOrders } = require('../services/D365ODataService');
const { getSqlPool } = require('../utils/sqlPool');
const { getSupplierAccount, isStaffUser } = require('../utils/supplierScope');
const { loadRuntimeHeaderLinks, loadStaffRuntimeHeaderLinks, clearRuntimeHeaderLinksCache } = require('../utils/runtimeHeaderLinks');

const router = express.Router();

const purchaseOrdersValidator = [
  query('all').optional().isBoolean().withMessage('all moet true of false zijn').toBoolean(),
  query('top').optional().isInt({ min: 1, max: 500 }).withMessage('top moet tussen 1 en 500 liggen'),
  query('skip').optional().isInt({ min: 0, max: 10000 }).withMessage('skip moet tussen 0 en 10000 liggen'),
];
const SUPPLIER_ACCOUNT_PATTERN = /^[a-zA-Z0-9._+-]{2,40}$/;
const BOARD_KEY_PATTERN = /^[a-z0-9-]{2,64}$/;
const MAX_COLUMNS = 80;
const { HEX_COLOR_PATTERN } = require('../utils/hexColor');
const { normalizeBiSplitPane } = require('../utils/biSplitPane');
const {
  normalizeTabsState,
  normalizeVendorAccount,
  normalizeViewTabSelection,
  vendorCanSeeView,
} = require('../utils/viewTabs');
const { normalizeKpiCardStyles } = require('../utils/kpiCardStyles');
const { ONBOARDING_BOARD_KEY, normalizeOnboarding, mergeOnboarding } = require('../utils/onboardingSettings');
const FORMAT_RULE_OPERATORS = new Set(['=', '<>', '>', '<', '>=', '<=', 'contains']);
const VIEW_ACTIVITY_FILTERS = new Set(['all', 'new', 'changed', 'removed']);

function isValidSupplierAccount(value) {
  return SUPPLIER_ACCOUNT_PATTERN.test(String(value || ''));
}

function getPool() {
  return getSqlPool();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )).slice(0, MAX_COLUMNS);
}

function normalizeColumnWidthMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, MAX_COLUMNS);
  return entries.reduce((acc, [rawKey, rawWidth]) => {
    const key = String(rawKey || '').trim().slice(0, 64);
    const width = Number(rawWidth);
    if (!key || !Number.isFinite(width)) return acc;
    const clamped = Math.min(1000, Math.max(80, Math.round(width)));
    acc[key] = clamped;
    return acc;
  }, {});
}

function normalizeColorMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).slice(0, MAX_COLUMNS).reduce((acc, [rawKey, rawColor]) => {
    const key = normalizeColumnKey(rawKey);
    const color = String(rawColor || '');
    if (key && HEX_COLOR_PATTERN.test(color)) acc[key] = color.toLowerCase();
    return acc;
  }, {});
}

function normalizeColumnTextStyleMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, MAX_COLUMNS);
  return entries.reduce((acc, [rawKey, rawStyle]) => {
    const key = normalizeColumnKey(rawKey);
    if (!key || !rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) return acc;
    const textColor = HEX_COLOR_PATTERN.test(String(rawStyle.textColor || ''))
      ? String(rawStyle.textColor).toLowerCase()
      : '';
    const bold = rawStyle.bold === true;
    const italic = rawStyle.italic === true;
    const underline = rawStyle.underline === true;
    if (!textColor && !bold && !italic && !underline) return acc;
    acc[key] = {};
    if (textColor) acc[key].textColor = textColor;
    if (bold) acc[key].bold = true;
    if (italic) acc[key].italic = true;
    if (underline) acc[key].underline = true;
    return acc;
  }, {});
}

function normalizeColumnKey(value) {
  return String(value || '').trim().slice(0, 64);
}

function normalizeFormatRule(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  const rawOperator = rule.op ?? rule.operator;
  const op = FORMAT_RULE_OPERATORS.has(rawOperator) ? rawOperator : '=';
  const color = HEX_COLOR_PATTERN.test(String(rule.color || '')) ? String(rule.color).toLowerCase() : '';
  if (!color) return null;
  const valueRef = normalizeColumnKey(rule.valueRef ?? rule.compareColumnKey ?? rule.compareToColumnKey);
  if (valueRef) return { op, valueRef, color };
  const rawValue = Object.prototype.hasOwnProperty.call(rule, 'value')
    ? rule.value
    : rule.compareValue;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return { op, value: rawValue, color };
  if (typeof rawValue === 'boolean') return { op, value: rawValue, color };
  const value = String(rawValue ?? '').trim().slice(0, 200);
  if (!value) return null;
  return { op, value, color };
}

function normalizeColumnFormatRuleSet(ruleSet) {
  if (!ruleSet || (typeof ruleSet !== 'object' && !Array.isArray(ruleSet))) return null;
  const legacyRuleArray = Array.isArray(ruleSet);
  const target = !legacyRuleArray && ruleSet.target === 'row' ? 'row' : 'cell';
  const rawRules = legacyRuleArray
    ? ruleSet
    : (Array.isArray(ruleSet.rules)
      ? ruleSet.rules
      : (Array.isArray(ruleSet.conditions) ? ruleSet.conditions : []));
  const rules = rawRules
    .map(normalizeFormatRule)
    .filter(Boolean)
    .slice(0, 20);
  if (!rules.length) return null;
  return { target, rules };
}

function normalizeColumnFormatRuleMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, MAX_COLUMNS);
  return entries.reduce((acc, [rawKey, rawRuleSet]) => {
    const key = normalizeColumnKey(rawKey);
    if (!key) return acc;
    const normalizedRuleSet = normalizeColumnFormatRuleSet(rawRuleSet);
    if (!normalizedRuleSet) return acc;
    acc[key] = normalizedRuleSet;
    return acc;
  }, {});
}

function normalizeLineTotalLinks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, MAX_COLUMNS).reduce((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;
    const lineColumnKey = normalizeColumnKey(entry.lineColumnKey);
    const headerColumnKey = normalizeColumnKey(entry.headerColumnKey);
    if (!lineColumnKey || !headerColumnKey) return acc;
    const signature = `${lineColumnKey}|${headerColumnKey}`;
    if (seen.has(signature)) return acc;
    seen.add(signature);
    acc.push({ lineColumnKey, headerColumnKey });
    return acc;
  }, []);
}

function normalizeLineValueLinks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, MAX_COLUMNS).reduce((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;
    const lineColumnKey = normalizeColumnKey(entry.lineColumnKey);
    const headerColumnKey = normalizeColumnKey(entry.headerColumnKey);
    if (!lineColumnKey || !headerColumnKey) return acc;
    const signature = `${lineColumnKey}|${headerColumnKey}`;
    if (seen.has(signature)) return acc;
    seen.add(signature);
    acc.push({ lineColumnKey, headerColumnKey });
    return acc;
  }, []);
}

// RCCP ISO-weekrange (#AB:224): gedeeld tussen /rccp en split-pane, board-key `rccp`.
function normalizeIsoWindow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fromYear = Number(value.fromYear);
  const fromWeek = Number(value.fromWeek);
  const toYear = Number(value.toYear);
  const toWeek = Number(value.toWeek);
  if (!Number.isFinite(fromYear) || !Number.isFinite(fromWeek) || !Number.isFinite(toYear) || !Number.isFinite(toWeek)) {
    return null;
  }
  return {
    fromYear: Math.round(fromYear),
    fromWeek: Math.max(1, Math.min(53, Math.round(fromWeek))),
    toYear: Math.round(toYear),
    toWeek: Math.max(1, Math.min(53, Math.round(toWeek))),
  };
}

// RCCP laatst gekozen vendor-account (#AB:224 vervolg): onthoudt de vendor-week-combinatie zodat
// de RCCP-pagina bij openen exact terugkomt. Gesanitiseerde string, leeg = geen voorkeur.
function normalizeLastVendorAccount(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 64);
}

function normalizeBoardSettings(rawSettings, boardKey) {
  const input = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const settings = {
    biSplitPane: normalizeBiSplitPane(input.biSplitPane),
    isoWindow: normalizeIsoWindow(input.isoWindow),
    lastVendorAccount: normalizeLastVendorAccount(input.lastVendorAccount),
    allOrdersShowHistoryIndicators: input.allOrdersShowHistoryIndicators !== false,
    visibleColumns: normalizeStringArray(input.visibleColumns),
    columnOrder: normalizeStringArray(input.columnOrder),
    lineColumnOrder: normalizeStringArray(input.lineColumnOrder),
    headerColumnWidths: normalizeColumnWidthMap(input.headerColumnWidths),
    lineColumnWidths: normalizeColumnWidthMap(input.lineColumnWidths),
    headerColumnTextStyles: normalizeColumnTextStyleMap(input.headerColumnTextStyles),
    headerColumnFormatRules: normalizeColumnFormatRuleMap(input.headerColumnFormatRules),
    lineColumnTextStyles: normalizeColumnTextStyleMap(input.lineColumnTextStyles),
    lineColumnFormatRules: normalizeColumnFormatRuleMap(input.lineColumnFormatRules),
    lineTotalColumns: normalizeStringArray(input.lineTotalColumns),
    lineTotalHeaderLinks: normalizeLineTotalLinks(input.lineTotalHeaderLinks),
    lineValueHeaderLinks: normalizeLineValueLinks(input.lineValueHeaderLinks),
    collapsedHeaderColumnKeys: normalizeStringArray(input.collapsedHeaderColumnKeys),
    collapsedLineColumnKeys: normalizeStringArray(input.collapsedLineColumnKeys),
    productImageColumnVisible: input.productImageColumnVisible !== false,
    viewTabSelection: normalizeViewTabSelection(input.viewTabSelection),
    kpiCardStyles: normalizeKpiCardStyles(input.kpiCardStyles),
  };
  // Onboarding-voortgang hoort alleen bij de eigen board key; andere boards dragen de sleutel niet.
  if (boardKey === ONBOARDING_BOARD_KEY) settings.onboarding = normalizeOnboarding(input.onboarding);
  return settings;
}

// --- Saved views (opgeslagen filter/sort/grouping + kolomlayout per board) ---

const VIEW_SCOPES = new Set(['personal', 'global', 'vendor']);
const VIEW_SORT_DIRECTIONS = new Set(['asc', 'desc', 'none']);
const MAX_VIEW_NAME = 120;
const MAX_VIEW_STATE_LENGTH = 100000;

function normalizeViewName(value) {
  return String(value === null || value === undefined ? '' : value).trim().slice(0, MAX_VIEW_NAME);
}

// Server valideert alleen structuur/operator-whitelist/lengte. Kolom-keys zijn dynamisch
// (D365-metamodel) en worden client-side genormaliseerd bij toepassen van een view.
function normalizeViewState(rawState) {
  const input = rawState && typeof rawState === 'object' ? rawState : {};
  const columns = input.columns && typeof input.columns === 'object' ? input.columns : {};
  const table = input.table && typeof input.table === 'object' ? input.table : {};
  const sortState = table.sortState && typeof table.sortState === 'object' ? table.sortState : {};
  const grouping = table.grouping && typeof table.grouping === 'object' ? table.grouping : {};
  const filterByColumn = table.filterByColumn && typeof table.filterByColumn === 'object' ? table.filterByColumn : {};

  const normalizedFilters = {};
  Object.keys(filterByColumn).slice(0, MAX_COLUMNS).forEach((rawKey) => {
    const filter = filterByColumn[rawKey];
    if (!filter || typeof filter !== 'object') return;
    const key = String(rawKey).slice(0, 64);
    normalizedFilters[key] = {
      operator: String(filter.operator || '').slice(0, 32),
      value: String(filter.value === null || filter.value === undefined ? '' : filter.value).slice(0, 200),
      secondaryValue: String(filter.secondaryValue === null || filter.secondaryValue === undefined ? '' : filter.secondaryValue).slice(0, 200),
    };
  });

  return {
    showHistoryIndicators: input.showHistoryIndicators !== false,
    columns: {
      visibleColumns: normalizeStringArray(columns.visibleColumns),
      columnOrder: normalizeStringArray(columns.columnOrder),
      stickyColumnKeys: normalizeStringArray(columns.stickyColumnKeys),
      lineColumnOrder: normalizeStringArray(columns.lineColumnOrder),
      headerColumnWidths: normalizeColumnWidthMap(columns.headerColumnWidths),
      lineColumnWidths: normalizeColumnWidthMap(columns.lineColumnWidths),
      headerColumnTextStyles: normalizeColumnTextStyleMap(columns.headerColumnTextStyles),
      headerColumnFormatRules: normalizeColumnFormatRuleMap(columns.headerColumnFormatRules),
      lineColumnTextStyles: normalizeColumnTextStyleMap(columns.lineColumnTextStyles),
      lineColumnFormatRules: normalizeColumnFormatRuleMap(columns.lineColumnFormatRules),
      lineTotalColumns: normalizeStringArray(columns.lineTotalColumns),
      lineTotalHeaderLinks: normalizeLineTotalLinks(columns.lineTotalHeaderLinks),
      lineValueHeaderLinks: normalizeLineValueLinks(columns.lineValueHeaderLinks),
      collapsedHeaderColumnKeys: normalizeStringArray(columns.collapsedHeaderColumnKeys),
      collapsedLineColumnKeys: normalizeStringArray(columns.collapsedLineColumnKeys),
      productImageColumnVisible: columns.productImageColumnVisible !== false,
    },
    table: {
      activityFilter: VIEW_ACTIVITY_FILTERS.has(table.activityFilter) ? table.activityFilter : 'all',
      filterByColumn: normalizedFilters,
      sortState: {
        columnKey: String(sortState.columnKey || '').slice(0, 64),
        direction: VIEW_SORT_DIRECTIONS.has(sortState.direction) ? sortState.direction : 'none',
      },
        grouping: {
        columnKeys: normalizeStringArray(grouping.columnKeys),
        columnKey: String(grouping.columnKey || '').slice(0, 64),
        color: HEX_COLOR_PATTERN.test(String(grouping.color || '')) ? grouping.color : '',
        colorsByColumn: normalizeColorMap(grouping.colorsByColumn),
        summaryColumnKeys: normalizeStringArray(grouping.summaryColumnKeys),
      },
      columnSumKeys: normalizeStringArray(table.columnSumKeys),
    },
    tabs: normalizeTabsState(input.tabs),
    vendorAccount: normalizeVendorAccount(input.vendorAccount),
  };
}

function mapViewRow(row) {
  let parsedState = {};
  try {
    parsedState = JSON.parse(row.view_state_json || '{}');
  } catch {
    parsedState = {};
  }
  return {
    id: Number(row.id),
    boardKey: row.board_key,
    name: row.name,
    scope: row.scope,
    userId: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    isDefault: Boolean(row.is_default),
    viewState: normalizeViewState(parsedState),
    vendorAccount: normalizeVendorAccount(parsedState.vendorAccount),
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(err) {
  const number = err && (err.number || (err.originalError && err.originalError.info && err.originalError.info.number));
  return number === 2601 || number === 2627;
}

// Zet binnen een transactie de bestaande default van dezelfde scope terug op 0,
// zodat er hooguit één default per (board, scope[, user]) overblijft.
async function unsetDefaultView(transaction, boardKey, scope, userId) {
  const request = new sql.Request(transaction);
  request.input('boardKey', sql.NVarChar(64), boardKey);
  if (scope === 'personal') {
    request.input('userId', sql.Int, userId);
    await request.query(`
      UPDATE dbo.po_saved_views SET is_default = 0
      WHERE board_key = @boardKey AND scope = 'personal' AND user_id = @userId AND is_default = 1
    `);
  } else if (scope === 'vendor') {
    await request.query(`
      UPDATE dbo.po_saved_views SET is_default = 0
      WHERE board_key = @boardKey AND scope = 'vendor' AND is_default = 1
    `);
  } else {
    await request.query(`
      UPDATE dbo.po_saved_views SET is_default = 0
      WHERE board_key = @boardKey AND scope = 'global' AND is_default = 1
    `);
  }
}

async function loadViewRow(pool, boardKey, viewId) {
  const result = await pool.request()
    .input('viewId', sql.BigInt, viewId)
    .input('boardKey', sql.NVarChar(64), boardKey)
    .query(`
      SELECT id, board_key, name, scope, user_id, view_state_json, is_default, updated_at
      FROM dbo.po_saved_views
      WHERE id = @viewId AND board_key = @boardKey
    `);
  return result.recordset.length ? result.recordset[0] : null;
}

// True als de huidige gebruiker deze view mag bewerken/verwijderen:
// personal → alleen de eigenaar; global/vendor → alleen staff (admin/employee).
function canManageView(user, viewRow) {
  if (viewRow.scope === 'global' || viewRow.scope === 'vendor') return isStaffUser(user);
  return Number(viewRow.user_id) === Number(user.id);
}

router.get('/board-settings/:boardKey', async (req, res, next) => {
  try {
    const boardKey = String(req.params.boardKey || '').trim();
    if (!BOARD_KEY_PATTERN.test(boardKey)) {
      return res.status(400).json({ error: 'Invalid board key' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('boardKey', sql.NVarChar(64), boardKey)
      .query(`
        SELECT settings_json
        FROM dbo.user_board_settings
        WHERE user_id = @userId AND board_key = @boardKey
      `);

    let parsedSettings = null;
    if (result.recordset.length) {
      try {
        parsedSettings = JSON.parse(result.recordset[0].settings_json || '{}');
      } catch {
        parsedSettings = {};
      }
    }

    // Push-total/push-values koppelingen zijn een gedeelde, board-brede instelling (niet
    // persoonlijk per gebruiker) — zie 2026-09-02-header-push-line-writeback-design.md.
    // Zowel vendors als staff moeten daarom de samengevoegde staff-links krijgen; anders
    // toont het bord een kolom als "los" (bewerkbaar) zodra een ándere staff-gebruiker de
    // koppeling heeft aangemaakt, terwijl de Data model-pagina 'm wel als gekoppeld laat zien.
    const sharedLinks = isStaffUser(req.user)
      ? await loadRuntimeHeaderLinks(pool, req.user.id, boardKey, { includeStaffLinks: true })
      : await loadStaffRuntimeHeaderLinks(pool, boardKey);
    parsedSettings = {
      ...(parsedSettings && typeof parsedSettings === 'object' ? parsedSettings : {}),
      lineTotalHeaderLinks: sharedLinks.lineTotalHeaderLinks,
      lineValueHeaderLinks: sharedLinks.lineValueHeaderLinks,
    };
    return res.json({ boardKey, settings: normalizeBoardSettings(parsedSettings, boardKey) });
  } catch (err) {
    return next(err);
  }
});

router.patch('/board-settings/:boardKey', async (req, res, next) => {
  try {
    const boardKey = String(req.params.boardKey || '').trim();
    if (!BOARD_KEY_PATTERN.test(boardKey)) {
      return res.status(400).json({ error: 'Invalid board key' });
    }

    const pool = await getPool();
    if (isStaffUser(req.user)) clearRuntimeHeaderLinksCache();
    const existingResult = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('boardKey', sql.NVarChar(64), boardKey)
      .query(`
        SELECT settings_json
        FROM dbo.user_board_settings
        WHERE user_id = @userId AND board_key = @boardKey
      `);
    let existing = {};
    if (existingResult.recordset.length) {
      try {
        existing = JSON.parse(existingResult.recordset[0].settings_json || '{}') || {};
      } catch {
        existing = {};
      }
    }
    const merged = normalizeBoardSettings({
      ...existing,
      ...req.body?.settings,
      viewTabSelection: {
        ...(existing.viewTabSelection && typeof existing.viewTabSelection === 'object' ? existing.viewTabSelection : {}),
        ...(req.body?.settings?.viewTabSelection && typeof req.body.settings.viewTabSelection === 'object'
          ? req.body.settings.viewTabSelection
          : {}),
      },
      onboarding: req.body?.settings?.onboarding !== undefined
        ? mergeOnboarding(existing.onboarding, req.body.settings.onboarding)
        : existing.onboarding,
    }, boardKey);
    if (!isStaffUser(req.user)) {
      delete merged.lineTotalHeaderLinks;
      delete merged.lineValueHeaderLinks;
    }
    await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('boardKey', sql.NVarChar(64), boardKey)
      .input('settingsJson', sql.NVarChar(sql.MAX), JSON.stringify(merged))
      .query(`
        MERGE dbo.user_board_settings AS target
        USING (SELECT @userId AS user_id, @boardKey AS board_key) AS source
          ON target.user_id = source.user_id AND target.board_key = source.board_key
        WHEN MATCHED THEN
          UPDATE SET settings_json = @settingsJson, updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (user_id, board_key, settings_json, updated_at)
          VALUES (@userId, @boardKey, @settingsJson, SYSUTCDATETIME());
      `);

    let settings = merged;
    if (!isStaffUser(req.user)) {
      const shared = await loadRuntimeHeaderLinks(pool, null, boardKey, { includeStaffLinks: true });
      settings = {
        ...merged,
        lineTotalHeaderLinks: shared.lineTotalHeaderLinks,
        lineValueHeaderLinks: shared.lineValueHeaderLinks,
      };
    }
    return res.json({ success: true, boardKey, settings });
  } catch (err) {
    return next(err);
  }
});

// Lijst de views die voor deze gebruiker zichtbaar zijn:
// - staff: personal + global + vendor
// - supplier: personal + vendor (geen staff-only global views)
router.get('/board-views/:boardKey', async (req, res, next) => {
  try {
    const boardKey = String(req.params.boardKey || '').trim();
    if (!BOARD_KEY_PATTERN.test(boardKey)) {
      return res.status(400).json({ error: 'Invalid board key' });
    }

    const pool = await getPool();
    const staff = isStaffUser(req.user);
    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('boardKey', sql.NVarChar(64), boardKey)
      .input('isStaff', sql.Bit, staff ? 1 : 0)
      .query(`
        SELECT id, board_key, name, scope, user_id, view_state_json, is_default, updated_at
        FROM dbo.po_saved_views
        WHERE board_key = @boardKey
          AND (
            (scope = 'personal' AND user_id = @userId)
            OR scope = 'vendor'
            OR (scope = 'global' AND @isStaff = 1)
          )
        ORDER BY scope, name
      `);

    let views = result.recordset.map(mapViewRow);
    if (!staff) {
      const supplierAccount = getSupplierAccount(req.user);
      views = views.filter((view) => view.scope !== 'vendor' || vendorCanSeeView(view, supplierAccount));
    }

    return res.json({ boardKey, views });
  } catch (err) {
    return next(err);
  }
});

// Maak een nieuwe view. Global-views mogen alleen door staff (admin/employee) worden aangemaakt.
router.post('/board-views/:boardKey', async (req, res, next) => {
  try {
    const boardKey = String(req.params.boardKey || '').trim();
    if (!BOARD_KEY_PATTERN.test(boardKey)) {
      return res.status(400).json({ error: 'Invalid board key' });
    }

    const name = normalizeViewName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const scope = String(req.body?.scope || 'personal');
    if (!VIEW_SCOPES.has(scope)) {
      return res.status(400).json({ error: 'Invalid scope' });
    }
    if ((scope === 'global' || scope === 'vendor') && !isStaffUser(req.user)) {
      return res.status(403).json({ error: 'Access denied — shared views require employee or admin role' });
    }

    const viewState = normalizeViewState(req.body?.viewState);
    const viewStateJson = JSON.stringify(viewState);
    if (viewStateJson.length > MAX_VIEW_STATE_LENGTH) {
      return res.status(400).json({ error: 'View state is too large' });
    }

    const isDefault = req.body?.isDefault === true;
    const userId = scope === 'personal' ? req.user.id : null;

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      if (isDefault) {
        await unsetDefaultView(transaction, boardKey, scope, userId);
      }
      const insertResult = await new sql.Request(transaction)
        .input('boardKey', sql.NVarChar(64), boardKey)
        .input('name', sql.NVarChar(120), name)
        .input('scope', sql.NVarChar(16), scope)
        .input('userId', sql.Int, userId)
        .input('viewStateJson', sql.NVarChar(sql.MAX), viewStateJson)
        .input('isDefault', sql.Bit, isDefault)
        .input('createdBy', sql.Int, req.user.id)
        .query(`
          INSERT INTO dbo.po_saved_views (board_key, name, scope, user_id, view_state_json, is_default, created_by)
          OUTPUT INSERTED.id, INSERTED.board_key, INSERTED.name, INSERTED.scope, INSERTED.user_id,
                 INSERTED.view_state_json, INSERTED.is_default, INSERTED.updated_at
          VALUES (@boardKey, @name, @scope, @userId, @viewStateJson, @isDefault, @createdBy)
        `);
      await transaction.commit();
      return res.status(201).json({ view: mapViewRow(insertResult.recordset[0]) });
    } catch (err) {
      await transaction.rollback();
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'A view with this name already exists' });
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

// Werk een view bij: hernoemen, view-state overschrijven en/of default zetten.
router.patch('/board-views/:boardKey/:viewId', async (req, res, next) => {
  try {
    const boardKey = String(req.params.boardKey || '').trim();
    if (!BOARD_KEY_PATTERN.test(boardKey)) {
      return res.status(400).json({ error: 'Invalid board key' });
    }
    const viewId = Number(req.params.viewId);
    if (!Number.isInteger(viewId) || viewId <= 0) {
      return res.status(400).json({ error: 'Invalid view id' });
    }

    const pool = await getPool();
    const existing = await loadViewRow(pool, boardKey, viewId);
    if (!existing) {
      return res.status(404).json({ error: 'View not found' });
    }
    if (!canManageView(req.user, existing)) {
      return res.status(403).json({ error: 'Access denied to this view' });
    }

    let nextName = existing.name;
    if (req.body?.name !== undefined) {
      nextName = normalizeViewName(req.body.name);
      if (!nextName) {
        return res.status(400).json({ error: 'Name is required' });
      }
    }

    let nextViewStateJson = existing.view_state_json;
    if (req.body?.viewState !== undefined) {
      nextViewStateJson = JSON.stringify(normalizeViewState(req.body.viewState));
      if (nextViewStateJson.length > MAX_VIEW_STATE_LENGTH) {
        return res.status(400).json({ error: 'View state is too large' });
      }
    }

    const nextIsDefault = req.body?.isDefault !== undefined
      ? req.body.isDefault === true
      : Boolean(existing.is_default);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      if (nextIsDefault && !existing.is_default) {
        await unsetDefaultView(transaction, boardKey, existing.scope, existing.user_id);
      }
      const updateResult = await new sql.Request(transaction)
        .input('viewId', sql.BigInt, viewId)
        .input('name', sql.NVarChar(120), nextName)
        .input('viewStateJson', sql.NVarChar(sql.MAX), nextViewStateJson)
        .input('isDefault', sql.Bit, nextIsDefault)
        .query(`
          UPDATE dbo.po_saved_views
          SET name = @name, view_state_json = @viewStateJson, is_default = @isDefault, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id, INSERTED.board_key, INSERTED.name, INSERTED.scope, INSERTED.user_id,
                 INSERTED.view_state_json, INSERTED.is_default, INSERTED.updated_at
          WHERE id = @viewId
        `);
      await transaction.commit();
      return res.json({ view: mapViewRow(updateResult.recordset[0]) });
    } catch (err) {
      await transaction.rollback();
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'A view with this name already exists' });
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

router.delete('/board-views/:boardKey/:viewId', async (req, res, next) => {
  try {
    const boardKey = String(req.params.boardKey || '').trim();
    if (!BOARD_KEY_PATTERN.test(boardKey)) {
      return res.status(400).json({ error: 'Invalid board key' });
    }
    const viewId = Number(req.params.viewId);
    if (!Number.isInteger(viewId) || viewId <= 0) {
      return res.status(400).json({ error: 'Invalid view id' });
    }

    const pool = await getPool();
    const existing = await loadViewRow(pool, boardKey, viewId);
    if (!existing) {
      return res.status(404).json({ error: 'View not found' });
    }
    if (!canManageView(req.user, existing)) {
      return res.status(403).json({ error: 'Access denied to this view' });
    }

    await pool.request()
      .input('viewId', sql.BigInt, viewId)
      .query('DELETE FROM dbo.po_saved_views WHERE id = @viewId');

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/purchase-orders', purchaseOrdersValidator, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid query parameters', details: errors.array() });
    }

    const staffUser = isStaffUser(req.user);
    const supplierAccount = staffUser ? null : getSupplierAccount(req.user);

    if (!staffUser) {
      if (!supplierAccount) {
        return res.status(400).json({ error: 'Supplier account is missing for the current user' });
      }
      if (!isValidSupplierAccount(supplierAccount)) {
        return res.status(400).json({ error: 'Supplier account has an invalid format' });
      }
    }

    const fetchAll = req.query.all === true;
    const defaultTop = fetchAll ? '200' : '25';
    const top = Number.parseInt(req.query.top || defaultTop, 10);
    const skip = Number.parseInt(req.query.skip || '0', 10);
    const result = await fetchPurchaseOrders({ supplierAccount, top, skip, fetchAll });

    return res.json({
      supplierAccount: supplierAccount || null,
      scope: staffUser ? 'company' : 'supplier',
      meta: {
        top,
        skip,
        total: result.total,
        requestedAll: fetchAll,
        fetchedAll: result.fetchedAll,
        hasMore: result.hasMore,
        truncated: result.truncated,
        pagesFetched: result.pagesFetched,
      },
      purchaseOrders: result.items,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
router.normalizeViewState = normalizeViewState;
