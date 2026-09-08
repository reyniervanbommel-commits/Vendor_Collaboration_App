'use strict';

// Beheer van app-native (eigen) kolommen in de Table Builder-registry (tb_columns). Fase A (#AB:152).
// Generalisatie van PurchaseOrderColumnsService: tableKey-gedreven, scope master|detail, source 'custom'.
// Bronvelden (source='source') worden niet hier beheerd maar via de admin TableBuilder (Fase B).

const sql = require('mssql');
const {
  getPool,
  getTableByKey,
  getColumnById,
  mapColumnRow,
  listColumns,
  SCOPES,
  DATA_TYPES,
} = require('./TableRegistryService');
const {
  findDependentFormulaColumn,
  normalizeFormulaExpression,
  validateFormulaReferences,
  validateFormulaResultTypeCompatibility,
} = require('../utils/tableColumnFormulaValidation');
const {
  ensureRemarksColumn,
  validateRemarksColumnRequest,
} = require('./RemarksColumnService');
const {
  normalizeStatusOptions,
  buildStatusLabelRenames,
  buildRemovedStatusOptions,
} = require('../utils/statusColumnOptions');
const { isAllowedDatePeriodSource, validateDatePeriodOptions } = require('../utils/datePeriodColumn');
const { loadRuntimeHeaderLinks } = require('../utils/runtimeHeaderLinks');
const { assertNotPavWritable } = require('../utils/productAttributeValues');

const MAX_LABEL_LENGTH = 128;
const MAX_KEY_LENGTH = 64;

function slugify(label) {
  const base = String(label || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH);
  return base || 'kolom';
}

async function uniqueKeyForScope(pool, tableId, scope, desiredKey) {
  const existing = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('scope', sql.NVarChar(16), scope)
    .query('SELECT [key] FROM dbo.tb_columns WHERE table_id = @tableId AND scope = @scope');
  const taken = new Set(existing.recordset.map((r) => r.key));
  if (!taken.has(desiredKey)) return desiredKey;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = (desiredKey + '_' + i).slice(0, MAX_KEY_LENGTH);
    if (!taken.has(candidate)) return candidate;
  }
  throw Object.assign(new Error('Could not determine a unique column key'), { status: 409 });
}

async function resolveLinkedLineColumn(pool, tableId, headerColumnKey, userId, boardKey) {
  const links = await loadRuntimeHeaderLinks(pool, userId, boardKey);
  const link = (links.lineValueHeaderLinks || [])
    .find((entry) => String(entry?.headerColumnKey || '').trim() === String(headerColumnKey || '').trim());
  const lineColumnKey = String(link?.lineColumnKey || '').trim();
  if (!lineColumnKey) return null;
  const lineCheck = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('lineColumnKey', sql.NVarChar(64), lineColumnKey)
    .query(`
      SELECT [key], label, data_type
      FROM dbo.tb_columns
      WHERE table_id = @tableId
        AND scope = 'detail'
        AND [key] = @lineColumnKey
        AND is_active = 1
    `);
  const row = lineCheck.recordset[0];
  if (!row) return { key: lineColumnKey, label: '', dataType: '' };
  return { key: row.key, label: row.label, dataType: row.data_type };
}

async function assertDatePeriodSourceColumn(pool, {
  tableId,
  tableKey,
  scope,
  sourceColumnKey,
  userId,
}) {
  const sourceCheck = await pool.request()
    .input('tableId', sql.BigInt, tableId)
    .input('scope', sql.NVarChar(16), scope)
    .input('sourceColumnKey', sql.NVarChar(64), sourceColumnKey)
    .query(`
      SELECT data_type
      FROM dbo.tb_columns
      WHERE table_id = @tableId
        AND scope = @scope
        AND [key] = @sourceColumnKey
        AND is_active = 1
    `);
  if (!sourceCheck.recordset.length) {
    throw Object.assign(new Error('sourceColumnKey does not reference an existing column in this scope'), { status: 400 });
  }
  const sourceDataType = String(sourceCheck.recordset[0]?.data_type || '').trim().toLowerCase();
  const linkedLineColumn = isAllowedDatePeriodSource({ sourceDataType })
    ? null
    : await resolveLinkedLineColumn(pool, tableId, sourceColumnKey, userId, tableKey);
  if (!isAllowedDatePeriodSource({ sourceDataType, linkedLineColumn })) {
    throw Object.assign(new Error('sourceColumnKey must reference a date column'), { status: 400 });
  }
}

// tb_columns heeft een AFTER INSERT-trigger (trg_tb_columns_original_label, migratie 048).
// SQL Server staat dan geen "OUTPUT ... " zonder INTO toe op DML tegen die tabel — vandaar
// OUTPUT INTO een table-variabele, gevolgd door een losse SELECT om het resultaat terug te geven.
const COLUMN_OUTPUT_DECLARE = `
  DECLARE @columnOutput TABLE (
    id BIGINT, table_id BIGINT, scope NVARCHAR(16), [key] NVARCHAR(64), label NVARCHAR(128),
    original_label NVARCHAR(128) NULL, source NVARCHAR(16), source_field NVARCHAR(128) NULL,
    data_type NVARCHAR(16), options_json NVARCHAR(MAX) NULL, writable BIT,
    write_mechanism NVARCHAR(16) NULL, is_default_visible BIT, filterable BIT, sortable BIT,
    is_active BIT, sort_order INT, visible_at_delete BIT, formula_expr NVARCHAR(MAX) NULL
  );
`;

const COLUMN_OUTPUT = `
  OUTPUT INSERTED.id, INSERTED.table_id, INSERTED.scope, INSERTED.[key], INSERTED.label,
         INSERTED.original_label, INSERTED.source,
         INSERTED.source_field, INSERTED.data_type, INSERTED.options_json, INSERTED.writable,
         INSERTED.write_mechanism, INSERTED.is_default_visible, INSERTED.filterable, INSERTED.sortable,
         INSERTED.is_active, INSERTED.sort_order, INSERTED.visible_at_delete, INSERTED.formula_expr
  INTO @columnOutput
`;

const COLUMN_OUTPUT_SELECT = `SELECT * FROM @columnOutput;`;

const WRITE_MECHANISMS = ['patch', 'action', 'sql'];

// Pure validatie/normalisatie van write-back-config (#AB:170). writable=false => mechanism altijd null.
function resolveWriteback({ writable, mechanism }) {
  const writableBit = writable === true || writable === 'true' || writable === 1 || writable === '1' ? 1 : 0;
  if (!writableBit) return { writable: 0, mechanism: null };
  const mech = mechanism == null || mechanism === '' ? 'patch' : String(mechanism);
  if (!WRITE_MECHANISMS.includes(mech)) {
    throw Object.assign(new Error(`Invalid write mechanism '${mech}' (patch, action or sql)`), { status: 400 });
  }
  return { writable: 1, mechanism: mech };
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function validateImageTransform(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw badRequest(`Transform #${index + 1} must be an object`);
  }
  const type = String(item.type || '').trim();
  switch (type) {
    case 'trim':
      return { type: 'trim' };
    case 'remove':
      if (typeof item.value !== 'string' || item.value.length === 0) {
        throw badRequest("Transform 'remove' requires a non-empty string 'value'");
      }
      return { type: 'remove', value: item.value };
    case 'replace':
      if (typeof item.from !== 'string' || item.from.length === 0) {
        throw badRequest("Transform 'replace' requires a non-empty string 'from'");
      }
      if (typeof item.to !== 'string') {
        throw badRequest("Transform 'replace' requires a string 'to'");
      }
      return { type: 'replace', from: item.from, to: item.to };
    case 'substring': {
      if (!Number.isInteger(item.start) || item.start < 0) {
        throw badRequest("Transform 'substring' requires an integer 'start' >= 0");
      }
      const normalized = { type: 'substring', start: item.start };
      if (item.end !== undefined && item.end !== null) {
        if (!Number.isInteger(item.end)) {
          throw badRequest("Transform 'substring' field 'end' must be an integer");
        }
        normalized.end = item.end;
      }
      return normalized;
    }
    default:
      throw badRequest(`Unknown transform type: ${type || 'empty'}`);
  }
}

function validateImageOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw badRequest('Image options must be an object');
  }
  const { urlTemplate, sourceColumnKey, transforms } = options;
  if (typeof urlTemplate !== 'string' || urlTemplate.trim().length === 0) {
    throw badRequest('urlTemplate is required');
  }
  const template = urlTemplate.trim();
  if (!/^https?:\/\//i.test(template)) {
    throw badRequest('urlTemplate must start with http:// or https://');
  }
  if (!template.includes('{xxx}')) {
    throw badRequest('urlTemplate must contain the placeholder {xxx}');
  }
  if (typeof sourceColumnKey !== 'string' || sourceColumnKey.trim().length === 0) {
    throw badRequest('sourceColumnKey is required');
  }
  let normalizedTransforms = [];
  if (transforms !== undefined && transforms !== null) {
    if (!Array.isArray(transforms)) {
      throw badRequest('transforms must be an array');
    }
    normalizedTransforms = transforms.map(validateImageTransform);
  }
  return {
    urlTemplate: template,
    sourceColumnKey: sourceColumnKey.trim(),
    transforms: normalizedTransforms,
  };
}

async function createColumn({ tableKey, scope, label, dataType, options = null, formulaExpr = null }, userId) {
  const table = await getTableByKey(tableKey);
  if (!SCOPES.includes(scope)) throw Object.assign(new Error('Invalid scope (master or detail)'), { status: 400 });
  if (!DATA_TYPES.includes(dataType)) throw Object.assign(new Error('Invalid data type'), { status: 400 });
  if (dataType === 'remarks') {
    validateRemarksColumnRequest({ scope, options, formulaExpr });
    const pool = await getPool();
    return ensureRemarksColumn({ pool, tableId: table.id, userId });
  }
  const cleanLabel = String(label || '').trim().slice(0, MAX_LABEL_LENGTH);
  if (!cleanLabel) throw Object.assign(new Error('Label is required'), { status: 400 });
  const normalizedFormula = normalizeFormulaExpression(formulaExpr);
  const isFormulaColumn = Boolean(normalizedFormula.expression);
  if (isFormulaColumn && dataType === 'remarks') {
    throw Object.assign(new Error('Formula columns do not support the Remarks data type'), { status: 400 });
  }

  let optionsJson = null;
  let normalizedImageOptions = null;
  let normalizedDatePeriodOptions = null;
  if (dataType === 'select' && !isFormulaColumn) {
    const list = Array.isArray(options) ? options.map((o) => String(o || '').trim()).filter(Boolean) : [];
    if (!list.length) throw Object.assign(new Error('A choice list requires at least one option'), { status: 400 });
    optionsJson = JSON.stringify(list);
  }
  if (dataType === 'status' && !isFormulaColumn) {
    optionsJson = JSON.stringify(normalizeStatusOptions(options));
  }
  if (dataType === 'image') {
    if (scope !== 'master') {
      throw Object.assign(new Error('Image columns are only allowed at master level'), { status: 400 });
    }
    if (isFormulaColumn) {
      throw Object.assign(new Error('Formula columns do not support image data type'), { status: 400 });
    }
    normalizedImageOptions = validateImageOptions(options);
    optionsJson = JSON.stringify(normalizedImageOptions);
  }
  if (isFormulaColumn && scope !== 'master') {
    throw Object.assign(new Error('Formula columns are only allowed at master level'), { status: 400 });
  }
  if (dataType === 'date_period') {
    if (isFormulaColumn) {
      throw Object.assign(new Error('Formula columns do not support date period data type'), { status: 400 });
    }
    normalizedDatePeriodOptions = validateDatePeriodOptions(options);
    optionsJson = JSON.stringify({
      sourceColumnKey: normalizedDatePeriodOptions.sourceColumnKey,
    });
  }
  if (isFormulaColumn && (dataType === 'select' || dataType === 'status' || dataType === 'image' || dataType === 'date_period')) {
    throw Object.assign(new Error('Formula columns do not support choice list, status, image or date period data types'), { status: 400 });
  }

  const pool = await getPool();
  if (dataType === 'date_period') {
    await assertDatePeriodSourceColumn(pool, {
      tableId: table.id,
      tableKey: table.key,
      scope,
      sourceColumnKey: normalizedDatePeriodOptions.sourceColumnKey,
      userId,
    });
  }
  if (dataType === 'image') {
    const sourceCheck = await pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('sourceColumnKey', sql.NVarChar(64), normalizedImageOptions.sourceColumnKey)
      .query(`
        SELECT 1
        FROM dbo.tb_columns
        WHERE table_id = @tableId
          AND scope = 'master'
          AND [key] = @sourceColumnKey
          AND is_active = 1
      `);
    if (!sourceCheck.recordset.length) {
      throw Object.assign(new Error('sourceColumnKey does not reference an existing master column'), { status: 400 });
    }
  }
  const key = await uniqueKeyForScope(pool, table.id, scope, slugify(cleanLabel));
  if (isFormulaColumn) {
    const scopeColumns = await listColumns({ tableId: table.id, scope, includeInactive: false });
    validateFormulaReferences(normalizedFormula.references, scopeColumns, key);
    validateFormulaResultTypeCompatibility(
      normalizedFormula.expression,
      normalizedFormula.references,
      scopeColumns,
      dataType
    );
  }
  const result = await pool.request()
    .input('tableId', sql.BigInt, table.id)
    .input('scope', sql.NVarChar(16), scope)
    .input('key', sql.NVarChar(64), key)
    .input('label', sql.NVarChar(128), cleanLabel)
    .input('dataType', sql.NVarChar(16), dataType)
    .input('options', sql.NVarChar(sql.MAX), optionsJson)
    .input('formulaExpr', sql.NVarChar(sql.MAX), normalizedFormula.expression)
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      INSERT INTO dbo.tb_columns
        (table_id, scope, [key], label, source, data_type, options_json, formula_expr, writable, is_active, sort_order, created_by, updated_by)
      ${COLUMN_OUTPUT}
      VALUES
        (@tableId, @scope, @key, @label, 'custom', @dataType, @options, @formulaExpr, 0, 1,
         (SELECT ISNULL(MAX(sort_order), 0) + 10 FROM dbo.tb_columns WHERE table_id = @tableId AND scope = @scope),
         @userId, @userId);
      ${COLUMN_OUTPUT_SELECT}
    `);
  return mapColumnRow(result.recordset[0]);
}

async function renameColumn(columnId, label, userId) {
  const cleanLabel = String(label || '').trim().slice(0, MAX_LABEL_LENGTH);
  if (!cleanLabel) throw Object.assign(new Error('Label is required'), { status: 400 });
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  // Zowel custom- als D365-bronkolommen mogen een eigen label krijgen — alleen het weergavelabel
  // wijzigt, de onderliggende source/key/mapping (source_field) blijft ongewijzigd.
  if (existing.dataType === 'remarks') {
    throw Object.assign(new Error('The Remarks column has a fixed name'), { status: 400 });
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('label', sql.NVarChar(128), cleanLabel)
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      UPDATE dbo.tb_columns
      SET label = @label, updated_by = @userId, updated_at = SYSUTCDATETIME()
      ${COLUMN_OUTPUT}
      WHERE id = @id;
      ${COLUMN_OUTPUT_SELECT}
    `);
  if (!result.recordset.length) throw Object.assign(new Error('Column not found'), { status: 404 });
  return mapColumnRow(result.recordset[0]);
}

// Telt hoeveel cellen in tb_custom_values elk van de opgegeven statuslabels gebruikt — nodig om
// te bepalen of een verwijderd label nog "in gebruik" is voordat de kolomconfiguratie wijzigt.
async function countStatusLabelUsage(pool, columnId, labels) {
  const counts = new Map();
  if (!labels.length) return counts;
  const request = pool.request().input('columnId', sql.BigInt, columnId);
  const placeholders = labels.map((label, index) => {
    const paramName = `label${index}`;
    request.input(paramName, sql.NVarChar(64), label);
    return `@${paramName}`;
  });
  const result = await request.query(`
    SELECT value_text, COUNT(*) AS cnt
    FROM dbo.tb_custom_values
    WHERE column_id = @columnId AND value_text IN (${placeholders.join(', ')})
    GROUP BY value_text
  `);
  result.recordset.forEach((row) => counts.set(row.value_text, Number(row.cnt) || 0));
  return counts;
}

async function updateColumn(columnId, { label, options, statusReassignments }, userId) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  if (existing.source !== 'custom') throw Object.assign(new Error('Source columns cannot be changed'), { status: 400 });

  const hasLabel = label !== undefined;
  const hasOptions = options !== undefined;
  if (!hasLabel && !hasOptions) throw Object.assign(new Error('No changes specified'), { status: 400 });

  const cleanLabel = hasLabel
    ? String(label || '').trim().slice(0, MAX_LABEL_LENGTH)
    : String(existing.label || '').trim().slice(0, MAX_LABEL_LENGTH);
  if (!cleanLabel) throw Object.assign(new Error('Label is required'), { status: 400 });

  let optionsJson = existing.options ? JSON.stringify(existing.options) : null;
  let normalizedStatusOptions = null;
  if (hasOptions) {
    if (existing.dataType === 'status') {
      normalizedStatusOptions = normalizeStatusOptions(options);
      optionsJson = JSON.stringify(normalizedStatusOptions);
    } else if (existing.dataType === 'select') {
      const list = Array.isArray(options) ? options.map((o) => String(o || '').trim()).filter(Boolean) : [];
      if (!list.length) throw Object.assign(new Error('A choice list requires at least one option'), { status: 400 });
      optionsJson = JSON.stringify(list);
    } else {
      throw Object.assign(new Error('Options can only be changed for select or status columns'), { status: 400 });
    }
  }

  const pool = await getPool();

  if (hasOptions && existing.dataType === 'status' && normalizedStatusOptions) {
    // Labels die de gebruiker uit de kolom heeft verwijderd (aanwezig in existing.options,
    // afwezig in de nieuwe lijst). Vóór het opslaan controleren we of die labels nog in gebruik
    // zijn — zo niet, gewoon verwijderen; zo wel, verplicht een reassign-keuze (of blokkeren).
    const removedOptions = buildRemovedStatusOptions(existing.options, normalizedStatusOptions);
    if (removedOptions.length) {
      const usageCounts = await countStatusLabelUsage(pool, columnId, removedOptions.map((o) => o.label));
      const conflicts = removedOptions
        .map((option) => ({ ...option, count: usageCounts.get(option.label) || 0 }))
        .filter((option) => option.count > 0);
      if (conflicts.length) {
        const reassignments = statusReassignments && typeof statusReassignments === 'object' && !Array.isArray(statusReassignments)
          ? statusReassignments
          : {};
        const unresolved = conflicts.filter((conflict) => !Object.prototype.hasOwnProperty.call(reassignments, conflict.label));
        if (unresolved.length) {
          throw Object.assign(
            new Error(`${conflicts.length} status label(s) are still in use and cannot be deleted without reassigning affected items first`),
            {
              status: 409,
              code: 'STATUS_LABELS_IN_USE',
              details: conflicts.map(({ id, label: conflictLabel, count }) => ({ id, label: conflictLabel, count })),
            }
          );
        }
        const nextLabels = new Set(normalizedStatusOptions.map((option) => option.label));
        for (const conflict of conflicts) {
          const target = String(reassignments[conflict.label] || '').trim();
          if (target && !nextLabels.has(target)) {
            throw badRequest(`Reassign target '${target}' is not a valid remaining status label`);
          }
          await pool.request()
            .input('columnId', sql.BigInt, columnId)
            .input('oldLabel', sql.NVarChar(64), conflict.label)
            .input('newLabel', sql.NVarChar(64), target || null)
            .input('userId', sql.Int, userId || null)
            .query(`
              UPDATE dbo.tb_custom_values
              SET value_text = @newLabel,
                  updated_by = @userId,
                  updated_at = SYSUTCDATETIME()
              WHERE column_id = @columnId
                AND value_text = @oldLabel
            `);
        }
      }
    }

    const renames = buildStatusLabelRenames(existing.options, normalizedStatusOptions);
    for (const rename of renames) {
      await pool.request()
        .input('columnId', sql.BigInt, columnId)
        .input('oldLabel', sql.NVarChar(64), rename.from)
        .input('newLabel', sql.NVarChar(64), rename.to)
        .input('userId', sql.Int, userId || null)
        .query(`
          UPDATE dbo.tb_custom_values
          SET value_text = @newLabel,
              updated_by = @userId,
              updated_at = SYSUTCDATETIME()
          WHERE column_id = @columnId
            AND value_text = @oldLabel
        `);
    }
  }

  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('label', sql.NVarChar(128), cleanLabel)
    .input('options', sql.NVarChar(sql.MAX), optionsJson)
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      UPDATE dbo.tb_columns
      SET label = @label,
          options_json = @options,
          updated_by = @userId,
          updated_at = SYSUTCDATETIME()
      ${COLUMN_OUTPUT}
      WHERE id = @id;
      ${COLUMN_OUTPUT_SELECT}
    `);
  if (!result.recordset.length) throw Object.assign(new Error('Column not found'), { status: 404 });
  return mapColumnRow(result.recordset[0]);
}

async function updateFormulaColumn(columnId, { label, dataType, formulaExpr }, userId) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  if (existing.source !== 'custom') {
    throw Object.assign(new Error('Only custom columns can have a formula'), { status: 400 });
  }
  if (existing.scope !== 'master') {
    throw Object.assign(new Error('Only master columns can have a formula'), { status: 400 });
  }
  if (!String(existing.formulaExpr || '').trim()) {
    throw Object.assign(new Error('This column is not a formula column'), { status: 400 });
  }

  const cleanLabel = String(label || existing.label || '').trim().slice(0, MAX_LABEL_LENGTH);
  if (!cleanLabel) throw Object.assign(new Error('Label is required'), { status: 400 });
  const nextDataType = dataType || existing.dataType;
  if (!DATA_TYPES.includes(nextDataType)) {
    throw Object.assign(new Error('Invalid data type'), { status: 400 });
  }
  if (nextDataType === 'select' || nextDataType === 'status' || nextDataType === 'image' || nextDataType === 'date_period') {
    throw Object.assign(new Error('Formula columns do not support choice list, status, image or date period data types'), { status: 400 });
  }
  const normalizedFormula = normalizeFormulaExpression(formulaExpr !== undefined ? formulaExpr : existing.formulaExpr);
  if (!normalizedFormula.expression) {
    throw Object.assign(new Error('Formula is required'), { status: 400 });
  }

  const scopeColumns = await listColumns({ tableId: existing.tableId, scope: existing.scope, includeInactive: false });
  validateFormulaReferences(normalizedFormula.references, scopeColumns, existing.key);
  validateFormulaResultTypeCompatibility(
    normalizedFormula.expression,
    normalizedFormula.references,
    scopeColumns,
    nextDataType
  );

  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('label', sql.NVarChar(128), cleanLabel)
    .input('dataType', sql.NVarChar(16), nextDataType)
    .input('formulaExpr', sql.NVarChar(sql.MAX), normalizedFormula.expression)
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      UPDATE dbo.tb_columns
      SET label = @label,
          data_type = @dataType,
          options_json = NULL,
          formula_expr = @formulaExpr,
          writable = 0,
          write_mechanism = NULL,
          updated_by = @userId,
          updated_at = SYSUTCDATETIME()
      ${COLUMN_OUTPUT}
      WHERE id = @id;
      ${COLUMN_OUTPUT_SELECT}
    `);
  if (!result.recordset.length) throw Object.assign(new Error('Column not found'), { status: 404 });
  return mapColumnRow(result.recordset[0]);
}

async function updateImageColumn(columnId, { label, dataType, options }, userId) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  if (existing.source !== 'custom') {
    throw Object.assign(new Error('Only custom columns can be edited as an image'), { status: 400 });
  }
  if (existing.scope !== 'master') {
    throw Object.assign(new Error('Image columns are only allowed at master level'), { status: 400 });
  }
  const cleanLabel = String(label || existing.label || '').trim().slice(0, MAX_LABEL_LENGTH);
  if (!cleanLabel) throw Object.assign(new Error('Label is required'), { status: 400 });

  const nextDataType = String(dataType || existing.dataType || '').trim();
  if (nextDataType !== 'image') {
    throw Object.assign(new Error('Only image data type is allowed for this operation'), { status: 400 });
  }

  const normalizedImageOptions = validateImageOptions(options !== undefined ? options : existing.options);
  if (normalizedImageOptions.sourceColumnKey === existing.key) {
    throw Object.assign(new Error('sourceColumnKey cannot reference the same image column'), { status: 400 });
  }

  const pool = await getPool();
  const sourceCheck = await pool.request()
    .input('tableId', sql.BigInt, existing.tableId)
    .input('sourceColumnKey', sql.NVarChar(64), normalizedImageOptions.sourceColumnKey)
    .query(`
      SELECT 1
      FROM dbo.tb_columns
      WHERE table_id = @tableId
        AND scope = 'master'
        AND [key] = @sourceColumnKey
        AND is_active = 1
    `);
  if (!sourceCheck.recordset.length) {
    throw Object.assign(new Error('sourceColumnKey does not reference an existing master column'), { status: 400 });
  }

  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('label', sql.NVarChar(128), cleanLabel)
    .input('options', sql.NVarChar(sql.MAX), JSON.stringify(normalizedImageOptions))
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      UPDATE dbo.tb_columns
      SET label = @label,
          data_type = 'image',
          options_json = @options,
          formula_expr = NULL,
          writable = 0,
          write_mechanism = NULL,
          updated_by = @userId,
          updated_at = SYSUTCDATETIME()
      ${COLUMN_OUTPUT}
      WHERE id = @id;
      ${COLUMN_OUTPUT_SELECT}
    `);
  if (!result.recordset.length) throw Object.assign(new Error('Column not found'), { status: 404 });
  return mapColumnRow(result.recordset[0]);
}

// Soft-delete: alleen eigen kolommen. Bronvelden blijven bestaan (read-only referentie).
async function deactivateColumn(columnId, userId) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  if (existing.source !== 'custom') throw Object.assign(new Error('Source columns cannot be deleted'), { status: 400 });

  const pool = await getPool();
  if (existing.scope === 'master' || existing.scope === 'detail') {
    const formulaRows = await pool.request()
      .input('tableId', sql.BigInt, existing.tableId)
      .input('columnId', sql.BigInt, columnId)
      .input('scope', sql.NVarChar(16), existing.scope)
      .query(`
        SELECT id, [key], label, formula_expr
        FROM dbo.tb_columns
        WHERE table_id = @tableId
          AND scope = @scope
          AND is_active = 1
          AND source = 'custom'
          AND formula_expr IS NOT NULL
          AND id <> @columnId
      `);
    const dependent = findDependentFormulaColumn(formulaRows.recordset, existing.key);
    if (dependent) {
      throw Object.assign(
        new Error(`Column '${existing.label}' is used by formula column '${dependent.label}'`),
        { status: 409 }
      );
    }
  }

  await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('userId', sql.Int, userId || null)
    .query(`
      UPDATE dbo.tb_columns
      SET is_active = 0, updated_by = @userId, updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
  return { id: columnId, isActive: false };
}

// Zichtbaarheid op het bord (admin): toggelt is_active. Werkt op elke kolom (bron + eigen).
// Pariteit met po_* setColumnVisibility; read()/listColumns tonen alleen is_active=1 kolommen.
async function setColumnVisibility(columnId, visible, userId) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('active', sql.Bit, visible ? 1 : 0)
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      UPDATE dbo.tb_columns
      SET is_active = @active, updated_by = @userId, updated_at = SYSUTCDATETIME()
      ${COLUMN_OUTPUT}
      WHERE id = @id;
      ${COLUMN_OUTPUT_SELECT}
    `);
  if (!result.recordset.length) throw Object.assign(new Error('Column not found'), { status: 404 });
  return mapColumnRow(result.recordset[0]);
}

// Zichtbaar in de "verborgen orders in D365-filter"-popup (Fase 2). Los van is_active. Elke kolom.
async function setVisibleAtDelete(columnId, flag, userId) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('flag', sql.Bit, flag ? 1 : 0)
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      UPDATE dbo.tb_columns
      SET visible_at_delete = @flag, updated_by = @userId, updated_at = SYSUTCDATETIME()
      ${COLUMN_OUTPUT}
      WHERE id = @id;
      ${COLUMN_OUTPUT_SELECT}
    `);
  if (!result.recordset.length) throw Object.assign(new Error('Column not found'), { status: 404 });
  return mapColumnRow(result.recordset[0]);
}

/**
 * Kan RCCP deze kolom technisch uitlezen?
 *
 * RCCP leest de tabel zonder userId. Custom kolommen zonder formule worden alleen gevuld vanuit
 * persoonlijke bord-instellingen (de line-total-links uit user_board_settings) en zijn in de
 * RCCP-context dus altijd leeg. Aanzetten zou een stil lege matrix opleveren.
 *
 * Wélke van de bruikbare kolommen zinvol is, bepaalt de admin — dat is geen codebeslissing.
 */
function resolveRccpQuantityEligibility(column) {
  if (!column) return { eligible: false, reason: 'Column not found' };
  if (column.dataType !== 'number') {
    return { eligible: false, reason: 'Only number columns can be used as an RCCP value' };
  }
  // Een inactieve kolom wordt niet meegesynct en staat niet in de board-read (includeInactive:
  // false), dus hij is in RCCP altijd leeg. De admin-tab toont inactieve kolommen wél — anders kon
  // je ze nooit heractiveren — dus zonder deze check is de toggle daar zichtbaar maar zinloos.
  if (!column.isActive) {
    return { eligible: false, reason: 'Inactive columns are not synced, so they are always empty in RCCP' };
  }
  if (column.source === 'custom' && !column.formulaExpr) {
    return {
      eligible: false,
      reason: 'Custom columns without a formula are filled from personal board settings and are always empty in RCCP',
    };
  }
  return { eligible: true, reason: null };
}

// Write-back-config (admin): welke kolommen naar de bron terugschrijfbaar zijn en via welk mechanisme.
async function setWriteBackConfig(columnId, config, userId, tableKey = null) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  assertNotPavWritable(tableKey, existing);
  if (existing.dataType === 'remarks') {
    throw Object.assign(new Error('The Remarks column is read-only'), { status: 400 });
  }
  const { writable, mechanism } = resolveWriteback(config || {});
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('writable', sql.Bit, writable)
    .input('mechanism', sql.NVarChar(16), mechanism)
    .input('userId', sql.Int, userId || null)
    .query(`
      ${COLUMN_OUTPUT_DECLARE}
      UPDATE dbo.tb_columns
      SET writable = @writable, write_mechanism = @mechanism, updated_by = @userId, updated_at = SYSUTCDATETIME()
      ${COLUMN_OUTPUT}
      WHERE id = @id;
      ${COLUMN_OUTPUT_SELECT}
    `);
  if (!result.recordset.length) throw Object.assign(new Error('Column not found'), { status: 404 });
  return mapColumnRow(result.recordset[0]);
}

module.exports = {
  SCOPES,
  DATA_TYPES,
  slugify,
  uniqueKeyForScope,
  resolveWriteback,
  validateImageOptions,
  validateDatePeriodOptions,
  ensureRemarksColumn,
  validateRemarksColumnRequest,
  normalizeFormulaExpression,
  validateFormulaReferences,
  findDependentFormulaColumn,
  validateFormulaResultTypeCompatibility,
  createColumn,
  renameColumn,
  updateColumn,
  updateFormulaColumn,
  updateImageColumn,
  deactivateColumn,
  setColumnVisibility,
  setVisibleAtDelete,
  setWriteBackConfig,
  resolveRccpQuantityEligibility,
};
