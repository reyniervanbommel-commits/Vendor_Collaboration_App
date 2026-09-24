'use strict';

const sql = require('mssql');
const { logger } = require('../../utils/logger');
const { time } = require('../../utils/timing');
const { MARK_COUNT, buildMarkPattern } = require('../../utils/trackChangeMarks');
const { applyRecordFilter, historyCellKey, buildHistoryByCell } = require('./historyCells');

async function loadHistoryByCell(pool, tableId, recordFilter = null) {
  const request = pool.request().input('tableId', sql.BigInt, tableId);
  const scope = applyRecordFilter(request, recordFilter);
  const result = await request
    .query(`
      SELECT column_id, partition_key, record_key, detail_key
      FROM dbo.tb_cell_history WITH (NOLOCK)
      WHERE table_id = @tableId ${scope}
      GROUP BY column_id, partition_key, record_key, detail_key
      UNION
      SELECT column_id, partition_key, record_key, detail_key
      FROM dbo.tb_field_corrections WITH (NOLOCK)
      WHERE table_id = @tableId ${scope}
      GROUP BY column_id, partition_key, record_key, detail_key
    `);
  return buildHistoryByCell(result.recordset);
}

async function loadTrackMarks(pool, tableId, enabledColumns, mode, boundaries, recordFilter = null) {
  const empty = { trackMarksByCell: new Map(), activeOffsetByColumnId: {}, defaultPattern: {} };
  if (!Array.isArray(enabledColumns) || enabledColumns.length === 0) return empty;

  const maxOffset = MARK_COUNT - 1;
  const activeOffsetByColumnId = {};
  const defaultPattern = {};
  const request = pool.request().input('tableId', sql.BigInt, tableId);

  // Week-mode: bereken de active-offset per kolom mét dezelfde kalender als de
  // bucketing (SQL DATEDIFF(week, ...)). JS-datumrekenen met een vaste 7-daagse
  // deling wijkt rond weekgrenzen/DATEFIRST af van DATEDIFF(week) en zou dan
  // onterecht gele/grijze streepjes tonen. SQL is hier de bron van waarheid.
  let weekOffsetByColumnId = null;
  if (mode === 'week') {
    const weekReq = pool.request();
    const weekRows = [];
    enabledColumns.forEach((col, i) => {
      const cId = 'wc' + i;
      const aId = 'wa' + i;
      weekReq.input(cId, sql.BigInt, col.columnId);
      weekReq.input(aId, sql.DateTime2, col.activatedAt);
      weekRows.push(`(@${cId}, @${aId})`);
    });
    const weekResult = await weekReq.query(`
      SELECT v.column_id, DATEDIFF(week, v.activated_at, SYSUTCDATETIME()) AS week_offset
      FROM (VALUES ${weekRows.join(', ')}) AS v(column_id, activated_at)
    `);
    weekOffsetByColumnId = {};
    for (const r of weekResult.recordset) {
      weekOffsetByColumnId[String(r.column_id)] = Number(r.week_offset);
    }
  }

  // VALUES-join met per-kolom activatedAt (fresh start per kolom).
  const valueRows = [];
  enabledColumns.forEach((col, i) => {
    const cId = 'tc_c' + i;
    const aId = 'tc_a' + i;
    request.input(cId, sql.BigInt, col.columnId);
    request.input(aId, sql.DateTime2, col.activatedAt);
    valueRows.push(`(@${cId}, @${aId})`);

    let activeOffset;
    if (mode === 'week') {
      const weeks = weekOffsetByColumnId?.[String(col.columnId)] ?? 0;
      activeOffset = Math.max(0, Math.min(weeks, maxOffset));
    } else {
      const n = boundaries.filter((b) => b.getTime() >= col.activatedAt.getTime()).length;
      activeOffset = Math.max(0, Math.min(n - 1, maxOffset));
    }
    activeOffsetByColumnId[String(col.columnId)] = activeOffset;
    defaultPattern[String(col.columnId)] = buildMarkPattern([], activeOffset);
  });

  let offsetExpr;
  if (mode === 'week') {
    offsetExpr = 'DATEDIFF(week, ch.changed_at, SYSUTCDATETIME())';
  } else {
    if (!Array.isArray(boundaries) || boundaries.length === 0) {
      return { trackMarksByCell: new Map(), activeOffsetByColumnId, defaultPattern };
    }
    const cases = boundaries.map((b, i) => {
      const bId = 'tc_b' + i;
      request.input(bId, sql.DateTime2, b);
      return `WHEN ch.changed_at >= @${bId} THEN ${i}`;
    });
    offsetExpr = `CASE ${cases.join(' ')} ELSE 99 END`;
  }

  // Wijzigingen komen uit twee bronnen: tb_cell_history (custom-kolommen) en
  // tb_field_corrections (write-back naar D365-kolommen). Alleen toegepaste
  // correcties tellen; applied_at is het echte wijzigingsmoment (fallback created_at).
  if (recordFilter) applyRecordFilter(request, recordFilter);
  const scopeFor = (alias) => (recordFilter
    ? `AND ${alias}.partition_key = @partitionKey AND ${alias}.record_key = @recordKey`
    : '');
  const query = `
    ;WITH changes AS (
      SELECT h.column_id, h.partition_key, h.record_key, h.detail_key, h.changed_at
      FROM dbo.tb_cell_history h WITH (NOLOCK)
      WHERE h.table_id = @tableId ${scopeFor('h')}
      UNION ALL
      SELECT f.column_id, f.partition_key, f.record_key, f.detail_key,
             COALESCE(f.applied_at, f.created_at) AS changed_at
      FROM dbo.tb_field_corrections f WITH (NOLOCK)
      WHERE f.table_id = @tableId AND f.status = 'applied' ${scopeFor('f')}
    )
    SELECT ch.column_id, ch.partition_key, ch.record_key, ch.detail_key, ${offsetExpr} AS mark_offset
    FROM changes ch
    INNER JOIN (VALUES ${valueRows.join(', ')}) AS act(column_id, activated_at)
      ON act.column_id = ch.column_id
    WHERE ch.changed_at >= act.activated_at
    GROUP BY ch.column_id, ch.partition_key, ch.record_key, ch.detail_key, ${offsetExpr}
    HAVING ${offsetExpr} BETWEEN 0 AND ${maxOffset}
  `;
  const result = await request.query(query);

  const redByCellColumn = new Map();
  for (const row of result.recordset) {
    const cellKey = historyCellKey(row.partition_key, row.record_key, row.detail_key);
    if (!redByCellColumn.has(cellKey)) redByCellColumn.set(cellKey, new Map());
    const byCol = redByCellColumn.get(cellKey);
    const colKey = String(row.column_id);
    if (!byCol.has(colKey)) byCol.set(colKey, new Set());
    byCol.get(colKey).add(Number(row.mark_offset));
  }

  const trackMarksByCell = new Map();
  for (const [cellKey, byCol] of redByCellColumn) {
    const patterns = {};
    for (const [colKey, offsets] of byCol) {
      patterns[colKey] = buildMarkPattern([...offsets], activeOffsetByColumnId[colKey]);
    }
    trackMarksByCell.set(cellKey, patterns);
  }

  return { trackMarksByCell, activeOffsetByColumnId, defaultPattern };
}

async function loadD365ChangeLedger({ pool, tableId, tableKey, sinceMs, recordFilter }) {
  if (sinceMs === null) return { d365LedgerRows: [], hasLedgerWindow: false };
  try {
    const ledgerRequest = pool.request()
      .input('tableId', sql.BigInt, tableId)
      .input('sinceAt', sql.DateTime2, new Date(sinceMs));
    const ledgerScope = applyRecordFilter(ledgerRequest, recordFilter);
    const ledgerResult = await time('tb_ledger', () => ledgerRequest
      .query(`
        SELECT partition_key, record_key, detail_key, field_key, action
        FROM dbo.tb_change_ledger WITH (NOLOCK)
        WHERE table_id = @tableId
          AND source = 'D365'
          AND created_at >= @sinceAt
          ${ledgerScope}
        ORDER BY created_at ASC, id ASC
      `));
    return { d365LedgerRows: ledgerResult.recordset, hasLedgerWindow: true };
  } catch (ledgerErr) {
    logger.warn('Change-ledger uitlezen mislukt; fallback naar cache-only diff', {
      tableKey,
      error: ledgerErr.message,
    });
    return { d365LedgerRows: [], hasLedgerWindow: false };
  }
}

module.exports = { loadHistoryByCell, loadTrackMarks, loadD365ChangeLedger };
