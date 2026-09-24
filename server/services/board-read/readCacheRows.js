'use strict';

const sql = require('mssql');
const { time } = require('../../utils/timing');
const { buildDetailJsonFromProjection, buildDetailProjectionSql } = require('../../utils/collapsedDetailFields');
const { parseCollapsedRollupRows } = require('../../utils/collapsedDetailRollup');
const { applyRecordFilter } = require('./historyCells');

async function readCacheRows(pool, tableId, includeRemoved, recordFilter = null, detailPlanPromise = null) {
  const mastersRequest = pool.request().input('tableId', sql.BigInt, tableId);
  const mastersScope = applyRecordFilter(mastersRequest, recordFilter, 'c');
  const mastersPromise = time('tb_read_masters', () => mastersRequest
    .query(`
      SELECT c.partition_key, c.record_key, c.data_json, c.source_modified_at, c.removed_at_source,
             c.sync_retained, c.first_seen_at, c.content_changed_at
      FROM dbo.tb_cache c WITH (NOLOCK)
      WHERE c.table_id = @tableId AND c.scope = 'master'
      ${includeRemoved ? '' : `AND NOT EXISTS (
          SELECT 1 FROM dbo.tb_row_exclusions ex WITH (NOLOCK)
          WHERE ex.table_id = @tableId AND ex.partition_key = c.partition_key AND ex.record_key = c.record_key
        )`}
      ${mastersScope}
      ORDER BY c.record_key
    `));

  // De detail-read kent drie vormen, van goedkoop naar duur (zie collapsedDetailRollup.js en
  // collapsedDetailFields.js). Blijven de sublijnen buiten de response, dan rekent SQL de rollup
  // per order uit ('aggregate') of levert het alleen de velden die de rollup nog leest ('fields').
  // Lukt geen van beide, dan komt de volledige data_json mee, zoals voorheen.
  const detailsPromise = time('tb_read_details', async () => {
    const plan = detailPlanPromise ? await detailPlanPromise : null;

    if (plan?.mode === 'aggregate') {
      const request = pool.request().input('tableId', sql.BigInt, tableId);
      if (plan.baselineAt) request.input('baselineAt', sql.DateTime2, plan.baselineAt);
      const result = await request.query(plan.sql);
      return {
        recordset: [],
        rollupByRecord: parseCollapsedRollupRows(result.recordset, plan.rollupPlan),
        rollupPlan: plan.rollupPlan,
      };
    }

    const detailFields = plan?.mode === 'fields' ? plan.fields : null;
    const detailsRequest = pool.request().input('tableId', sql.BigInt, tableId);
    const detailsScope = applyRecordFilter(detailsRequest, recordFilter);
    const projection = detailFields ? buildDetailProjectionSql(detailFields) : 'data_json';
    const result = await detailsRequest
      .query(`
        SELECT partition_key, record_key, detail_key, ${projection}, removed_at_source, first_seen_at, content_changed_at
        FROM dbo.tb_cache WITH (NOLOCK)
        WHERE table_id = @tableId AND scope = 'detail'
        ${detailsScope}
        ORDER BY record_key, detail_key
      `);
    if (detailFields) {
      for (const row of result.recordset) {
        row.data_json = buildDetailJsonFromProjection(row, detailFields);
      }
    }
    return result;
  });

  const customRequest = pool.request().input('tableId', sql.BigInt, tableId);
  const customScope = applyRecordFilter(customRequest, recordFilter, 'cv');
  const customPromise = time('tb_read_custom', () => customRequest
    .query(`
      SELECT cv.column_id, c.[key], c.scope, c.data_type, cv.partition_key, cv.record_key,
             cv.detail_key, cv.value_text, cv.value_number, cv.value_date, cv.value_bool
      FROM dbo.tb_custom_values cv WITH (NOLOCK)
      INNER JOIN dbo.tb_columns c WITH (NOLOCK) ON c.id = cv.column_id
      WHERE cv.table_id = @tableId AND c.is_active = 1
      ${customScope}
    `));

  const [mastersResult, detailsResult, customResult] = await Promise.all([
    mastersPromise, detailsPromise, customPromise,
  ]);
  return {
    mastersResult,
    detailsResult,
    customResult,
    rollupByRecord: detailsResult.rollupByRecord || null,
    rollupPlan: detailsResult.rollupPlan || null,
  };
}

function indexCustomValuesByCell(recordset) {
  const customByCell = new Map();
  for (const row of recordset || []) {
    const cellKey = `${row.partition_key}|${row.record_key}|${row.detail_key}`;
    let value = null;
    if (row.data_type === 'number') value = row.value_number !== null ? Number(row.value_number) : null;
    else if (row.data_type === 'date') value = row.value_date ? new Date(row.value_date).toISOString() : null;
    else if (row.data_type === 'boolean') value = row.value_bool === null ? null : Boolean(row.value_bool);
    else value = row.value_text;
    if (!customByCell.has(cellKey)) customByCell.set(cellKey, {});
    customByCell.get(cellKey)[row.key] = value;
  }
  return customByCell;
}

module.exports = { readCacheRows, indexCustomValuesByCell };
