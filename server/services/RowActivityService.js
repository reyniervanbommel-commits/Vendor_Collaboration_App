'use strict';

const sql = require('mssql');
const { getPool, getTableByKey, getColumnById } = require('./TableRegistryService');
const { time } = require('../utils/timing');
const { assertSupplierPurchaseOrderRow } = require('../utils/supplierRowAccess');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MASTER_DETAIL_KEY = -1;
const CURSOR_VERSION = 1;
const TYPE_RANK = Object.freeze({ remark: 5, d365: 4, row: 3, custom: 2, writeback: 1 });

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function parseActionFilter(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'all') return null;
  if (normalized === 'updated') return 'updated';
  throw badRequest('actionFilter must be updated or all');
}

function matchesUpdatedAction(action) {
  return String(action || '').trim().toUpperCase() === 'UPDATE';
}

function actionFilterSql(actionExpression) {
  return `(@actionFilter IS NULL OR @actionFilter <> 'updated' OR UPPER(ISNULL(${actionExpression}, '')) = 'UPDATE')`;
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  if (!/^\d+$/.test(String(value))) throw badRequest('limit must be an integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw badRequest(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

function cursorTuple(row) {
  return {
    v: CURSOR_VERSION,
    at: String(row.createdAt),
    r: Number(row.typeRank),
    id: String(row.sourceId),
  };
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify(cursorTuple(row)), 'utf8').toString('base64url');
}

function decodeCursor(value, name = 'cursor') {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw badRequest(`${name} is invalid`);
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('non-canonical');
    const parsed = JSON.parse(decoded.toString('utf8'));
    const keys = Object.keys(parsed).sort().join(',');
    const date = new Date(parsed.at);
    if (
      keys !== 'at,id,r,v'
      || parsed.v !== CURSOR_VERSION
      || typeof parsed.at !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$/.test(parsed.at)
      || Number.isNaN(date.getTime())
      || date.toISOString() !== `${parsed.at.slice(0, 23)}Z`
      || !Object.values(TYPE_RANK).includes(parsed.r)
      || !/^[1-9]\d*$/.test(parsed.id)
    ) {
      throw new Error('shape');
    }
    return parsed;
  } catch {
    throw badRequest(`${name} is invalid`);
  }
}

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function typedValue(row, prefix) {
  const number = row[`${prefix}_value_number`];
  const date = row[`${prefix}_value_date`];
  const bool = row[`${prefix}_value_bool`];
  if (number !== null && number !== undefined) return Number(number);
  if (date !== null && date !== undefined) return iso(date);
  if (bool !== null && bool !== undefined) return Boolean(bool);
  return row[`${prefix}_value_text`] ?? null;
}

function mapActivityRow(row) {
  const type = String(row.activity_type);
  return {
    id: `${type}:${row.source_id}`,
    type,
    typeRank: Number(row.type_rank),
    sourceId: String(row.source_id),
    createdAt: iso(row.created_at_iso || row.created_at),
    action: row.action || null,
    fieldKey: row.field_key || null,
    columnId: row.column_id === null || row.column_id === undefined ? null : Number(row.column_id),
    columnLabel: row.column_label || null,
    oldValue: typedValue(row, 'old'),
    newValue: typedValue(row, 'new'),
    status: row.status || null,
    error: row.error || null,
    body: row.is_deleted ? null : (row.body ?? null),
    isDeleted: Boolean(row.is_deleted),
    actor: row.user_id
      ? { id: Number(row.user_id), name: row.user_name || null, email: row.user_email || null }
      : null,
  };
}

function compareActivity(a, b) {
  const at = b.createdAt.localeCompare(a.createdAt);
  if (at) return at;
  if (b.typeRank !== a.typeRank) return b.typeRank - a.typeRank;
  return BigInt(b.sourceId) > BigInt(a.sourceId) ? 1 : BigInt(b.sourceId) < BigInt(a.sourceId) ? -1 : 0;
}

function enrichRemarkActivity(item, reactions, currentUser) {
  if (item.type !== 'remark') return item;
  const author = item.actor
    ? { id: item.actor.id, displayName: item.actor.name || item.actor.email || null }
    : null;
  return {
    ...item,
    author,
    column: item.columnId ? { id: item.columnId, label: item.columnLabel } : null,
    reactions: reactions || [],
    canDelete: !item.isDeleted && Boolean(
      currentUser?.role === 'admin'
      || (author?.id && String(author.id) === String(currentUser?.id))
    ),
  };
}

function validateRowKeys(partitionKey, recordKey) {
  const partition = String(partitionKey ?? '').trim();
  const record = String(recordKey ?? '').trim();
  if (!partition || !record) throw badRequest('partitionKey and recordKey are required');
  if (partition.length > 32 || record.length > 128) {
    throw badRequest('partitionKey or recordKey is too long');
  }
  return { partition, record };
}

function buildQuery() {
  return `
    ;WITH activity AS (
      SELECT l.id source_id, CASE WHEN l.source='D365' THEN 'd365' ELSE 'row' END activity_type,
        CASE WHEN l.source='D365' THEN 4 ELSE 3 END type_rank, l.created_at, l.action,
        l.field_key, c.id column_id, c.label column_label, l.old_value old_value_text,
        CAST(NULL AS DECIMAL(38,10)) old_value_number, CAST(NULL AS DATETIME2) old_value_date,
        CAST(NULL AS BIT) old_value_bool, l.new_value new_value_text,
        CAST(NULL AS DECIMAL(38,10)) new_value_number, CAST(NULL AS DATETIME2) new_value_date,
        CAST(NULL AS BIT) new_value_bool, CAST(NULL AS NVARCHAR(16)) status,
        CAST(NULL AS NVARCHAR(MAX)) error, CAST(NULL AS NVARCHAR(2000)) body,
        CAST(0 AS BIT) is_deleted, u.id user_id, COALESCE(u.display_name, u.email) user_name, u.email user_email
      FROM dbo.tb_change_ledger l
      OUTER APPLY (
        SELECT TOP (1) matched.id, matched.label
        FROM dbo.tb_columns matched
        WHERE matched.table_id=l.table_id AND matched.scope='master'
          AND (matched.[key]=l.field_key OR matched.source_field=l.field_key)
        ORDER BY CASE WHEN matched.[key]=l.field_key THEN 0 ELSE 1 END, matched.id
      ) c
      LEFT JOIN dbo.users u ON u.id=l.changed_by_user_id
      WHERE l.table_id=@tableId AND l.partition_key=@partitionKey AND l.record_key=@recordKey
        AND l.detail_key=-1 AND (l.source='D365' OR (l.source='USER' AND l.field_key IS NULL))
        AND (@columnId IS NULL OR c.id=@columnId)
        AND ${actionFilterSql('l.action')}
      UNION ALL
      SELECT h.id, 'custom', 2, h.changed_at, h.action, c.[key], c.id, c.label,
        h.old_value_text, h.old_value_number, h.old_value_date, h.old_value_bool,
        h.new_value_text, h.new_value_number, h.new_value_date, h.new_value_bool,
        NULL, NULL, NULL, CAST(0 AS BIT), u.id, COALESCE(u.display_name, u.email), u.email
      FROM dbo.tb_cell_history h
      INNER JOIN dbo.tb_columns c ON c.id=h.column_id
      LEFT JOIN dbo.users u ON u.id=h.changed_by
      WHERE h.table_id=@tableId AND h.partition_key=@partitionKey AND h.record_key=@recordKey
        AND h.detail_key=-1 AND (@columnId IS NULL OR h.column_id=@columnId)
        AND ${actionFilterSql('h.action')}
      UNION ALL
      SELECT f.id, 'writeback', 1, f.created_at, 'correct', c.[key], c.id, c.label,
        f.old_value, NULL, NULL, NULL, f.new_value, NULL, NULL, NULL,
        f.status, f.error, NULL, CAST(0 AS BIT), u.id, COALESCE(u.display_name, u.email), u.email
      FROM dbo.tb_field_corrections f
      INNER JOIN dbo.tb_columns c ON c.id=f.column_id
      LEFT JOIN dbo.users u ON u.id=f.created_by
      WHERE f.table_id=@tableId AND f.partition_key=@partitionKey AND f.record_key=@recordKey
        AND f.detail_key=-1 AND (@columnId IS NULL OR f.column_id=@columnId)
        AND (@actionFilter IS NULL OR @actionFilter <> 'updated')
      UNION ALL
      SELECT r.id, 'remark', 5, r.created_at, 'remark', NULL, r.column_id, c.label,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        CASE WHEN r.is_deleted=1 THEN NULL ELSE r.body END, r.is_deleted,
        u.id, COALESCE(u.display_name, u.email), u.email
      FROM dbo.tb_row_remarks r
      LEFT JOIN dbo.tb_columns c ON c.id=r.column_id
      LEFT JOIN dbo.users u ON u.id=r.created_by
      WHERE @includeRemarks=1 AND r.table_id=@tableId AND r.partition_key=@partitionKey
        AND r.record_key=@recordKey AND r.detail_key=-1
        AND (@columnId IS NULL OR r.column_id=@columnId)
    )
    SELECT *, CONVERT(NVARCHAR(27), created_at, 126)+'Z' created_at_iso
    INTO #activity FROM activity;
    SELECT TOP (@take) *
    FROM #activity
    WHERE (@cursorAt IS NULL OR created_at < CONVERT(DATETIME2(7), @cursorAt, 127)
      OR (created_at=CONVERT(DATETIME2(7), @cursorAt, 127) AND type_rank < @cursorRank)
      OR (created_at=CONVERT(DATETIME2(7), @cursorAt, 127) AND type_rank=@cursorRank AND source_id < @cursorId))
      AND (@afterAt IS NULL OR created_at > CONVERT(DATETIME2(7), @afterAt, 127)
      OR (created_at=CONVERT(DATETIME2(7), @afterAt, 127) AND type_rank > @afterRank)
      OR (created_at=CONVERT(DATETIME2(7), @afterAt, 127) AND type_rank=@afterRank AND source_id > @afterId))
    ORDER BY
      CASE WHEN @afterAt IS NULL THEN created_at END DESC,
      CASE WHEN @afterAt IS NULL THEN type_rank END DESC,
      CASE WHEN @afterAt IS NULL THEN source_id END DESC,
      CASE WHEN @afterAt IS NOT NULL THEN created_at END ASC,
      CASE WHEN @afterAt IS NOT NULL THEN type_rank END ASC,
      CASE WHEN @afterAt IS NOT NULL THEN source_id END ASC;
    SELECT
      SUM(CASE WHEN activity_type='remark' AND is_deleted=0 THEN 1 ELSE 0 END) remarks,
      SUM(CASE WHEN activity_type<>'remark' THEN 1 ELSE 0 END) history,
      SUM(CASE WHEN activity_type<>'remark' AND UPPER(ISNULL(action, '')) = 'UPDATE' THEN 1 ELSE 0 END) history_updated
    FROM #activity;
    SELECT reactions.remark_id, reactions.emoji, COUNT_BIG(*) reaction_count,
      MAX(CASE WHEN reactions.user_id=@currentUserId THEN 1 ELSE 0 END) reacted_by_current_user
    FROM dbo.tb_row_remark_reactions reactions
    INNER JOIN #activity activity
      ON activity.activity_type='remark' AND activity.source_id=reactions.remark_id
    GROUP BY reactions.remark_id, reactions.emoji;
  `;
}

function createRowActivityService(deps = {}) {
  const registry = {
    getPool: deps.getPool || getPool,
    getTableByKey: deps.getTableByKey || getTableByKey,
    getColumnById: deps.getColumnById || getColumnById,
    time: deps.time || time,
  };

  return async function getRowActivity(options = {}) {
    const { partition, record } = validateRowKeys(options.partitionKey, options.recordKey);
    await assertSupplierPurchaseOrderRow(options.currentUser, {
      tableKey: options.tableKey,
      partitionKey: partition,
      recordKey: record,
    });
    const kind = options.kind || 'history';
    if (!['history', 'all'].includes(kind)) throw badRequest('kind must be history or all');
    const actionFilter = parseActionFilter(options.actionFilter);
    if (options.cursor && options.afterCursor) throw badRequest('cursor and afterCursor cannot be combined');
    const limit = parseLimit(options.limit);
    const cursor = options.cursor ? decodeCursor(options.cursor, 'cursor') : null;
    const after = options.afterCursor ? decodeCursor(options.afterCursor, 'afterCursor') : null;
    const table = await registry.getTableByKey(options.tableKey);
    let columnId = null;
    if (options.columnId !== undefined && options.columnId !== null && options.columnId !== '') {
      if (!/^[1-9]\d*$/.test(String(options.columnId))) throw badRequest('columnId is invalid');
      const column = await registry.getColumnById(options.columnId);
      if (!column || !column.isActive || column.tableId !== table.id || column.scope !== 'master') {
        throw badRequest('columnId must be an active master column from this table');
      }
      columnId = column.id;
    }
    const pool = await registry.getPool();
    const request = pool.request()
      .input('tableId', sql.BigInt, table.id)
      .input('partitionKey', sql.NVarChar(32), partition)
      .input('recordKey', sql.NVarChar(128), record)
      .input('columnId', sql.BigInt, columnId)
      .input('includeRemarks', sql.Bit, kind === 'all')
      .input('actionFilter', sql.NVarChar(16), actionFilter)
      .input('take', sql.Int, after ? limit : limit + 1)
      .input('cursorAt', sql.NVarChar(32), cursor?.at || null)
      .input('cursorRank', sql.Int, cursor?.r || null)
      .input('cursorId', sql.BigInt, cursor?.id || null)
      .input('afterAt', sql.NVarChar(32), after?.at || null)
      .input('afterRank', sql.Int, after?.r || null)
      .input('afterId', sql.BigInt, after?.id || null)
      .input('currentUserId', sql.Int, options.currentUser?.id || null);
    const result = await registry.time('remarks_activity', () => request.query(buildQuery()));
    const mapped = (result.recordsets?.[0] || result.recordset || [])
      .map(mapActivityRow)
      .filter((item) => item.type !== 'row' || item.fieldKey === null)
      .sort(compareActivity);
    const hasMore = mapped.length > limit;
    const reactionsByRemark = new Map();
    (result.recordsets?.[2] || []).forEach((row) => {
      const key = String(row.remark_id);
      const current = reactionsByRemark.get(key) || [];
      current.push({
        emoji: row.emoji,
        count: Number(row.reaction_count) || 0,
        reactedByCurrentUser: Boolean(row.reacted_by_current_user),
      });
      reactionsByRemark.set(key, current);
    });
    const items = mapped
      .slice(0, limit)
      .map((item) => enrichRemarkActivity(
        item,
        reactionsByRemark.get(String(item.sourceId)),
        options.currentUser
      ));
    const totalsRow = result.recordsets?.[1]?.[0] || {};
    return {
      items,
      totals: {
        remarks: options.canViewComments === false ? 0 : Number(totalsRow.remarks || 0),
        history: Number(totalsRow.history || 0),
        historyUpdated: Number(totalsRow.history_updated || 0),
      },
      nextCursor: !after && hasMore && items.length ? encodeCursor(items[items.length - 1]) : null,
      newestCursor: items.length ? encodeCursor(items[0]) : (after ? options.afterCursor : null),
    };
  };
}

const getRowActivity = createRowActivityService();

module.exports = {
  TYPE_RANK,
  compareActivity,
  createRowActivityService,
  decodeCursor,
  encodeCursor,
  enrichRemarkActivity,
  getRowActivity,
  mapActivityRow,
  matchesUpdatedAction,
  parseActionFilter,
  parseLimit,
};
