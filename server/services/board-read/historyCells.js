'use strict';

const sql = require('mssql');

function historyCellKey(partitionKey, recordKey, detailKey) {
  return JSON.stringify([String(partitionKey), String(recordKey), Number(detailKey)]);
}

function buildHistoryByCell(rows) {
  const historyByCell = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = historyCellKey(row.partition_key, row.record_key, row.detail_key);
    if (!historyByCell.has(key)) historyByCell.set(key, {});
    historyByCell.get(key)[String(row.column_id)] = true;
  }
  return historyByCell;
}

// recordFilter beperkt de read tot één order — gebruikt door readRowDetails, zodat het
// lazy laden van sublijnen niet de hele historie-tabel hoeft te scannen.
function applyRecordFilter(request, recordFilter, alias = '') {
  if (!recordFilter) return '';
  request.input('partitionKey', sql.NVarChar(32), recordFilter.partitionKey);
  request.input('recordKey', sql.NVarChar(128), recordFilter.recordKey);
  const prefix = alias ? `${alias}.` : '';
  return `AND ${prefix}partition_key = @partitionKey AND ${prefix}record_key = @recordKey`;
}

module.exports = { historyCellKey, buildHistoryByCell, applyRecordFilter };
