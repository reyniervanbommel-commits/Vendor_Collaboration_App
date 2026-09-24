'use strict';

const { time } = require('../utils/timing');
const dataService = require('./TableDataService');
const { contentSignature } = require('./board-cache/boardContentSignature');
const { getOrLoad, peek, invalidate } = require('./board-cache/BoardCacheCoordinator');

function snapshotHasDetails(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  return rows.some((row) => Array.isArray(row.details));
}

function rememberKpiPoRows({ tableKey, supplierAccount = null, signature, rows } = {}) {
  if (!tableKey || !signature || !rows) return;
  if (!snapshotHasDetails(rows)) return;
  return getOrLoad(
    { tableKey, supplierAccount, variant: 'kpi', signature },
    async () => rows,
  );
}

function invalidateBoardSnapshots({ tableKey = null } = {}) {
  invalidate(tableKey, tableKey ? 'sync-settings' : undefined);
}

async function readBoardSnapshot({ tableKey, supplierAccount = null } = {}) {
  const { revision, parts } = await time('snapshot_revision', () => dataService.getRevision({
    tableKey, userId: null, supplierAccount,
  }));
  const signature = contentSignature(parts);
  const loaded = await getOrLoad(
    { tableKey, supplierAccount, variant: 'snapshot', signature },
    async () => {
      const data = await time('snapshot_board_read', () => dataService.read({
        tableKey,
        userId: null,
        supplierAccount,
        includeChangeDecorations: false,
      }));
      const rows = data.rows || [];
      const columns = data.meta?.columns?.master || [];
      await rememberKpiPoRows({ tableKey, supplierAccount, signature, rows });
      return { rows, columns };
    },
  );
  const warmKpi = peek({ tableKey, supplierAccount, variant: 'kpi', signature });
  if (!warmKpi) await rememberKpiPoRows({ tableKey, supplierAccount, signature, rows: loaded.rows });
  return { rows: loaded.rows, columns: loaded.columns, revision };
}

async function readRccpPoRows({
  tableKey,
  supplierAccount = null,
  revision: knownRevision = null,
  parts: knownParts = null,
} = {}) {
  let revision = knownRevision;
  let parts = knownParts;
  if (revision == null || parts == null) {
    const got = await time('kpi_rows_revision', () => dataService.getRevision({
      tableKey, userId: null, supplierAccount,
    }));
    revision = got.revision;
    parts = got.parts;
  }
  const signature = contentSignature(parts);
  const snap = peek({ tableKey, supplierAccount, variant: 'snapshot', signature });
  if (snap && snapshotHasDetails(snap.rows)) {
    await rememberKpiPoRows({ tableKey, supplierAccount, signature, rows: snap.rows });
    return { rows: snap.rows, revision };
  }
  const cached = peek({ tableKey, supplierAccount, variant: 'kpi', signature });
  if (cached && snapshotHasDetails(cached)) return { rows: cached, revision };
  const data = await time('kpi_po_read', () => dataService.read({
    tableKey,
    supplierAccount,
    userId: null,
    includeChangeDecorations: false,
  }));
  const rows = data.rows || [];
  await rememberKpiPoRows({ tableKey, supplierAccount, signature, rows });
  return { rows, revision };
}

module.exports = {
  readBoardSnapshot,
  readRccpPoRows,
  rememberKpiPoRows,
  contentSignature,
  invalidateBoardSnapshots,
};
