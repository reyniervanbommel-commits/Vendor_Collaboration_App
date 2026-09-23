'use strict';

const sql = require('mssql');
const { getSqlPool } = require('../utils/sqlPool');
const { time } = require('../utils/timing');
const { logger } = require('../utils/logger');
const settingsService = require('./SettingsService');
const emailService = require('./EmailService');
const { parseAlertEmails } = require('../utils/alertEmails');

const { randomUUID } = require('crypto');

const ALERT_EMAILS_KEY = 'NIGHT_REFRESH_ALERT_EMAILS';
const MAX_ERROR_TEXT = 500;
const HISTORY_LIMIT_MAX = 20;
const INSTANCE_ID = randomUUID();
const HEARTBEAT_INTERVAL_MS = 20_000;
const STALE_HEARTBEAT_SECONDS = 90;
const STALE_INTERRUPT_TEXT = 'Refresh owner stopped (replica restart or crash)';

let heartbeatTimer = null;

const ENTITY_LABELS = {
  'purchase-orders': 'Purchase orders',
  vendors: 'Vendors',
  items: 'Items',
  'product-receipt-lines': 'Product receipt lines',
  'product-attribute-values': 'Product attribute values',
};

let activeRun = null;
let lastRun = null;

function entityLabel(tableKey) {
  const key = String(tableKey || '').trim();
  if (ENTITY_LABELS[key]) return ENTITY_LABELS[key];
  return key.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) || key;
}

function stripErrorText(value) {
  if (!value) return null;
  const firstLine = String(value).split(/\r?\n/)[0].replace(/\s+at\s+.+$/i, '').trim();
  if (!firstLine) return null;
  return firstLine.slice(0, MAX_ERROR_TEXT);
}

function createEntity(tableKey, sortOrder) {
  return {
    tableKey,
    label: entityLabel(tableKey),
    sortOrder,
    status: 'queued',
    fetched: 0,
    totalToFetch: null,
    saved: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    started_at: null,
    finished_at: null,
    error_text: null,
    notice_text: null,
  };
}

function currentRun() {
  return activeRun || lastRun;
}

function isActive() {
  return Boolean(activeRun && activeRun.status === 'running');
}

function getActiveRunId() {
  return currentRun()?.id || null;
}

function seedEntities(entityKeys) {
  const keys = [...new Set((entityKeys || []).map((key) => String(key || '').trim()).filter(Boolean))];
  if (!keys.includes('purchase-orders')) keys.unshift('purchase-orders');
  return keys.map((key, index) => createEntity(key, index));
}

function create({ source = 'manual', triggeredByUserId = null, entityKeys = ['purchase-orders'] } = {}) {
  const run = {
    id: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    status: 'running',
    source: source === 'night' ? 'night' : 'manual',
    triggered_by_user_id: triggeredByUserId || null,
    error_text: null,
    alert_status: null,
    nightAttached: false,
    entities: seedEntities(entityKeys),
  };
  activeRun = run;
  lastRun = run;
  return run;
}

function attachNight() {
  const run = activeRun || lastRun;
  if (!run || run.status !== 'running') return { attached: false, runId: run?.id || null };
  run.nightAttached = true;
  return { attached: true, runId: run.id };
}

function findEntity(tableKey) {
  const run = currentRun();
  if (!run) return null;
  return run.entities.find((entity) => entity.tableKey === tableKey) || null;
}

function updateEntity(tableKey, patch = {}) {
  const entity = findEntity(tableKey);
  if (!entity) return null;
  if (patch.fetched != null) entity.fetched += Number(patch.fetched) || 0;
  if (patch.saved != null) entity.saved += Number(patch.saved) || 0;
  if (patch.inserted != null) entity.inserted += Number(patch.inserted) || 0;
  if (patch.updated != null) entity.updated += Number(patch.updated) || 0;
  if (patch.deleted != null) entity.deleted += Number(patch.deleted) || 0;
  if (patch.status) entity.status = patch.status;
  if (patch.error_text !== undefined) entity.error_text = stripErrorText(patch.error_text);
  if (patch.notice_text !== undefined) entity.notice_text = stripErrorText(patch.notice_text);
  if (patch.started_at) entity.started_at = patch.started_at;
  if (patch.finished_at) entity.finished_at = patch.finished_at;
  return entity;
}

function setEntityProgress(tableKey, patch = {}) {
  const entity = findEntity(tableKey);
  if (!entity) return null;
  if (patch.fetched != null) {
    const next = Number(patch.fetched) || 0;
    entity.fetched = Math.max(Number(entity.fetched) || 0, next);
  }
  if (patch.saved != null) entity.saved = Number(patch.saved) || 0;
  if (patch.totalToFetch != null && Number.isFinite(Number(patch.totalToFetch))) {
    const nextTotal = Number(patch.totalToFetch);
    entity.totalToFetch = entity.totalToFetch == null
      ? nextTotal
      : Math.max(Number(entity.totalToFetch) || 0, nextTotal);
  }
  return entity;
}

function markEntityRunning(tableKey) {
  const entity = findEntity(tableKey);
  if (!entity) return null;
  entity.status = 'running';
  entity.started_at = new Date().toISOString();
  entity.finished_at = null;
  entity.fetched = 0;
  entity.saved = 0;
  entity.inserted = 0;
  entity.updated = 0;
  entity.deleted = 0;
  entity.totalToFetch = null;
  entity.error_text = null;
  entity.notice_text = null;
  return entity;
}

function markEntityDone(tableKey) {
  const entity = findEntity(tableKey);
  return updateEntity(tableKey, {
    status: 'done',
    finished_at: new Date().toISOString(),
    error_text: entity?.notice_text || null,
  });
}

function markEntityError(tableKey, errorText) {
  return updateEntity(tableKey, {
    status: 'error',
    finished_at: new Date().toISOString(),
    error_text: errorText,
  });
}

function totals(run) {
  return (run?.entities || []).reduce((acc, entity) => ({
    fetched: acc.fetched + (Number(entity.fetched) || 0),
    saved: acc.saved + (Number(entity.saved) || 0),
    inserted: acc.inserted + (Number(entity.inserted) || 0),
    updated: acc.updated + (Number(entity.updated) || 0),
    deleted: acc.deleted + (Number(entity.deleted) || 0),
  }), { fetched: 0, saved: 0, inserted: 0, updated: 0, deleted: 0 });
}

function entityErrorSummary(run) {
  const parts = (run?.entities || [])
    .filter((entity) => entity.status === 'error')
    .map((entity) => `${entity.tableKey}: ${entity.error_text || 'Refresh failed'}`);
  return stripErrorText(parts.join('; '));
}

function shouldSendNightMail(run) {
  if (!run) return false;
  if (run.source !== 'night' && !run.nightAttached) return false;
  if (run.status === 'error' || run.status === 'interrupted') return true;
  return (run.entities || []).some((entity) => entity.status === 'error');
}

function snapshotRun(mode = 'board') {
  const run = currentRun();
  if (!run) {
    const empty = { currentLabel: '', overall: 0, entityIndex: 0, entityCount: 0 };
    return mode === 'full' ? { ...empty, entities: [], error_text: null } : empty;
  }
  const doneCount = run.entities.filter((entity) => entity.status === 'done' || entity.status === 'error').length;
  const running = run.entities.find((entity) => entity.status === 'running');
  const current = running || run.entities[Math.min(doneCount, run.entities.length - 1)] || null;
  const entityCount = run.entities.length;
  const entityIndex = current ? run.entities.indexOf(current) + 1 : 0;
  let overall = entityCount ? doneCount / entityCount : 0;
  if (running) {
    const total = Number(running.totalToFetch);
    const fetched = Number(running.fetched) || 0;
    const fetchFrac = Number.isFinite(total) && total > 0
      ? Math.min(0.9, (fetched / total) * 0.9)
      : (fetched > 0 ? 0.5 : 0.15);
    overall = Math.min(0.99, (doneCount + fetchFrac) / entityCount);
  }
  if (run.status === 'done' || run.status === 'error' || run.status === 'interrupted') {
    overall = 1;
  }
  const board = {
    currentLabel: current?.label || '',
    overall,
    entityIndex,
    entityCount,
  };
  if (mode !== 'full') return board;
  return {
    ...board,
    entities: run.entities.map((entity) => ({
      tableKey: entity.tableKey,
      label: entity.label,
      status: entity.status,
      fetched: entity.fetched,
      totalToFetch: entity.totalToFetch,
      saved: entity.saved,
      inserted: entity.inserted,
      updated: entity.updated,
      deleted: entity.deleted,
      error_text: entity.status === 'error' ? entity.error_text : null,
      notice_text: entity.status === 'error' ? null : (entity.notice_text || entity.error_text),
    })),
    error_text: run.error_text,
  };
}

function serializeLivePayload(progress, { view, running } = {}) {
  return {
    running: running != null ? Boolean(running) : isActive(),
    progress,
    run: snapshotRun(view === 'full' ? 'full' : 'board'),
  };
}

function getNightStatus() {
  const run = currentRun();
  if (!run) {
    return { running: false, status: null, finishedAt: null, error_text: null };
  }
  return {
    running: run.status === 'running',
    status: run.status,
    finishedAt: run.finished_at,
    error_text: run.error_text,
  };
}

function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function persistHeartbeat(runId) {
  if (!runId) return;
  const pool = await getSqlPool();
  await pool.request()
    .input('id', sql.BigInt, runId)
    .input('ownerInstanceId', sql.NVarChar(64), INSTANCE_ID)
    .query(`
      UPDATE dbo.tb_refresh_runs
      SET heartbeat_at = SYSUTCDATETIME()
      WHERE id = @id
        AND status = 'running'
        AND owner_instance_id = @ownerInstanceId
    `);
}

function startHeartbeat(runId) {
  stopHeartbeat();
  if (!runId) return;
  heartbeatTimer = setInterval(() => {
    persistHeartbeat(runId).catch((err) => {
      logger.warn('Refresh-run heartbeat mislukt', { error: err.message, runId });
    });
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

async function persistStart(run) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input('source', sql.NVarChar(16), run.source)
    .input('triggeredBy', sql.Int, run.triggered_by_user_id)
    .input('ownerInstanceId', sql.NVarChar(64), INSTANCE_ID)
    .query(`
      INSERT INTO dbo.tb_refresh_runs
        (status, source, triggered_by_user_id, owner_instance_id, heartbeat_at)
      OUTPUT inserted.id
      VALUES ('running', @source, @triggeredBy, @ownerInstanceId, SYSUTCDATETIME())
    `);
  run.id = result.recordset[0]?.id || null;
  startHeartbeat(run.id);
  return run.id;
}

async function persistFinish(run) {
  if (!run?.id) return;
  const pool = await getSqlPool();
  const sums = totals(run);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('id', sql.BigInt, run.id)
      .input('status', sql.NVarChar(16), run.status)
      .input('errorText', sql.NVarChar(500), run.error_text)
      .input('alertStatus', sql.NVarChar(16), run.alert_status)
      .input('fetched', sql.Int, sums.fetched)
      .input('saved', sql.Int, sums.saved)
      .input('inserted', sql.Int, sums.inserted)
      .input('updated', sql.Int, sums.updated)
      .input('deleted', sql.Int, sums.deleted)
      .query(`
        UPDATE dbo.tb_refresh_runs
        SET finished_at = SYSUTCDATETIME(),
            status = @status,
            error_text = @errorText,
            alert_status = @alertStatus,
            fetched_total = @fetched,
            saved_total = @saved,
            inserted_total = @inserted,
            updated_total = @updated,
            deleted_total = @deleted
        WHERE id = @id
      `);
    for (const entity of run.entities) {
      await new sql.Request(tx)
        .input('runId', sql.BigInt, run.id)
        .input('tableKey', sql.NVarChar(64), entity.tableKey)
        .input('label', sql.NVarChar(128), entity.label)
        .input('sortOrder', sql.Int, entity.sortOrder)
        .input('status', sql.NVarChar(16), entity.status)
        .input('fetched', sql.Int, entity.fetched)
        .input('saved', sql.Int, entity.saved)
        .input('inserted', sql.Int, entity.inserted)
        .input('updated', sql.Int, entity.updated)
        .input('deleted', sql.Int, entity.deleted)
        .input('startedAt', sql.DateTime2, entity.started_at ? new Date(entity.started_at) : null)
        .input('finishedAt', sql.DateTime2, entity.finished_at ? new Date(entity.finished_at) : null)
        .input('errorText', sql.NVarChar(500), entity.error_text)
        .query(`
          INSERT INTO dbo.tb_refresh_run_entities
            (run_id, table_key, entity_label, sort_order, status, fetched, saved, inserted, updated, deleted,
             started_at, finished_at, error_text)
          VALUES
            (@runId, @tableKey, @label, @sortOrder, @status, @fetched, @saved, @inserted, @updated, @deleted,
             @startedAt, @finishedAt, @errorText)
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function persistAlertStatus(runId, alertStatus) {
  if (!runId) return;
  const pool = await getSqlPool();
  await pool.request()
    .input('id', sql.BigInt, runId)
    .input('alertStatus', sql.NVarChar(16), alertStatus)
    .query('UPDATE dbo.tb_refresh_runs SET alert_status = @alertStatus WHERE id = @id');
}

async function sendNightMailSafe(run) {
  if (!shouldSendNightMail(run)) return;
  try {
    const raw = await settingsService.getAsync(ALERT_EMAILS_KEY, '');
    const recipients = parseAlertEmails(raw);
    const result = await emailService.sendNightRefreshDigest({ recipients, run });
    run.alert_status = result?.skipped ? 'skipped' : 'sent';
  } catch (err) {
    logger.warn('Night-refresh mail mislukt; run-status blijft ongewijzigd', { error: err.message, runId: run.id });
    run.alert_status = 'failed';
  }
  try {
    await persistAlertStatus(run.id, run.alert_status);
  } catch (err) {
    logger.warn('alert_status bijwerken mislukt', { error: err.message, runId: run.id });
  }
}

function queueNightMail(run) {
  Promise.resolve()
    .then(() => sendNightMailSafe(run))
    .catch((err) => logger.warn('Night-refresh mail async fout', { error: err.message }));
}

async function beginPurchaseOrderRun({ source = 'manual', triggeredByUserId = null, entityKeys } = {}) {
  const run = create({ source, triggeredByUserId, entityKeys });
  try {
    await time('refresh_run_sql', () => persistStart(run));
  } catch (err) {
    logger.warn('Refresh-run start-insert mislukt; geheugenrun gaat door', { error: err.message });
  }
  return run;
}

function closeLeftoverEntities(run, status) {
  const finishedAt = run.finished_at;
  (run.entities || []).forEach((entity) => {
    if (entity.status !== 'queued' && entity.status !== 'running') return;
    if (status === 'interrupted') {
      entity.status = 'interrupted';
    } else if (entity.status === 'running') {
      entity.status = status === 'error' ? 'error' : 'done';
    } else {
      entity.status = 'interrupted';
    }
    entity.finished_at = entity.finished_at || finishedAt;
  });
}

async function finishRun({ status, errorText = null } = {}) {
  stopHeartbeat();
  const run = activeRun;
  if (!run) return lastRun;
  run.status = status;
  run.finished_at = new Date().toISOString();
  if (status === 'done') {
    run.error_text = entityErrorSummary(run);
  } else {
    run.error_text = stripErrorText(errorText) || entityErrorSummary(run);
  }
  closeLeftoverEntities(run, status);
  try {
    await time('refresh_run_sql', () => persistFinish(run));
  } catch (err) {
    logger.warn('Refresh-run finish-batch mislukt; geheugenrun is wel afgerond', { error: err.message, runId: run.id });
  }
  lastRun = run;
  activeRun = null;
  queueNightMail(run);
  // Een geslaagde sync maakt élke gecachete board-snapshot ongeldig (syncedAt zit in de
  // content-signatuur). Meteen opnieuw opbouwen, zodat de eerste bezoeker van de dag niet de
  // koude read betaalt. Fire-and-forget: de run is klaar zodra de data er staat, en een
  // mislukte warmup mag de run niet raken.
  if (status === 'done') {
    // eslint-disable-next-line global-require
    require('./BoardWarmup').warmBoardCaches({ reason: 'refresh-done' }).catch(() => {});
  }
  return run;
}

async function finishSuccess() {
  return finishRun({ status: 'done' });
}

async function failPurchaseOrders(errorText) {
  markEntityError('purchase-orders', errorText);
  return finishRun({ status: 'error', errorText });
}

function mapHistoryRow(row, entities) {
  return {
    id: row.id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    source: row.source,
    triggered_by_user_id: row.triggered_by_user_id,
    error_text: stripErrorText(row.error_text),
    alert_status: row.alert_status,
    fetched_total: Number(row.fetched_total) || 0,
    saved_total: Number(row.saved_total) || 0,
    inserted_total: Number(row.inserted_total) || 0,
    updated_total: Number(row.updated_total) || 0,
    deleted_total: Number(row.deleted_total) || 0,
    entities: (entities || [])
      .filter((entity) => Number(entity.run_id) === Number(row.id))
      .map((entity) => ({
        tableKey: entity.table_key,
        label: entity.entity_label,
        status: entity.status,
        fetched: Number(entity.fetched) || 0,
        saved: Number(entity.saved) || 0,
        inserted: Number(entity.inserted) || 0,
        updated: Number(entity.updated) || 0,
        deleted: Number(entity.deleted) || 0,
        error_text: entity.status === 'error' ? stripErrorText(entity.error_text) : null,
        notice_text: entity.status === 'error' ? null : stripErrorText(entity.error_text),
      })),
  };
}

async function clearHistory() {
  const running = isActive();
  const keepId = running ? (Number(getActiveRunId()) || 0) : 0;
  const pool = await getSqlPool();
  await pool.request()
    .input('keepId', sql.BigInt, keepId)
    .query('DELETE FROM dbo.tb_refresh_run_entities WHERE @keepId = 0 OR run_id <> @keepId');
  const result = await pool.request()
    .input('keepId', sql.BigInt, keepId)
    .query(`
      DELETE FROM dbo.tb_refresh_runs WHERE @keepId = 0 OR id <> @keepId;
      SELECT @@ROWCOUNT AS deletedRuns;
    `);
  lastRun = null;
  return {
    deletedRuns: Number(result.recordset?.[0]?.deletedRuns) || 0,
    keptRunning: running,
  };
}

async function listRuns({ limit = HISTORY_LIMIT_MAX } = {}) {
  const safeLimit = Math.min(HISTORY_LIMIT_MAX, Math.max(1, Number(limit) || HISTORY_LIMIT_MAX));
  const pool = await getSqlPool();
  const runs = await pool.request()
    .input('limit', sql.Int, safeLimit)
    .query(`
      SELECT TOP (@limit)
        id, started_at, finished_at, status, source, triggered_by_user_id, error_text, alert_status,
        fetched_total, saved_total, inserted_total, updated_total, deleted_total
      FROM dbo.tb_refresh_runs
      ORDER BY started_at DESC
    `);
  const ids = (runs.recordset || []).map((row) => row.id);
  if (!ids.length) return [];
  const entityRequest = pool.request();
  const idParams = ids.map((id, index) => {
    const name = `id${index}`;
    entityRequest.input(name, sql.BigInt, id);
    return `@${name}`;
  });
  const entities = await entityRequest.query(`
    SELECT run_id, table_key, entity_label, status, fetched, saved, inserted, updated, deleted, error_text
    FROM dbo.tb_refresh_run_entities
    WHERE run_id IN (${idParams.join(', ')})
    ORDER BY sort_order ASC
  `);
  return (runs.recordset || []).map((row) => mapHistoryRow(row, entities.recordset));
}

async function interruptStaleRunningRows() {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input('staleSeconds', sql.Int, STALE_HEARTBEAT_SECONDS)
    .input('errorText', sql.NVarChar(500), STALE_INTERRUPT_TEXT)
    .query(`
      UPDATE dbo.tb_refresh_runs
      SET status = 'interrupted',
          finished_at = SYSUTCDATETIME(),
          error_text = @errorText
      OUTPUT inserted.id, inserted.source, inserted.status, inserted.started_at, inserted.finished_at, inserted.error_text
      WHERE status = 'running'
        AND COALESCE(heartbeat_at, started_at) < DATEADD(second, -@staleSeconds, SYSUTCDATETIME())
    `);
  const interrupted = result.recordset || [];
  if (interrupted.length) {
    const idRequest = pool.request().input('errorText', sql.NVarChar(500), STALE_INTERRUPT_TEXT);
    const idParams = interrupted.map((row, index) => {
      const name = `id${index}`;
      idRequest.input(name, sql.BigInt, row.id);
      return `@${name}`;
    });
    await idRequest.query(`
      UPDATE dbo.tb_refresh_run_entities
      SET status = 'interrupted',
          finished_at = SYSUTCDATETIME(),
          error_text = COALESCE(error_text, @errorText)
      WHERE status IN ('queued', 'running')
        AND run_id IN (${idParams.join(', ')})
    `);
  }
  for (const row of interrupted) {
    if (row.source !== 'night') continue;
    queueNightMail({
      id: row.id,
      source: 'night',
      status: 'interrupted',
      started_at: row.started_at,
      finished_at: row.finished_at,
      error_text: stripErrorText(row.error_text),
      nightAttached: false,
      entities: [],
    });
  }
  return interrupted;
}

async function interruptRunningRowsOnProcessStart() {
  return interruptStaleRunningRows();
}

async function markInterruptedOnShutdown() {
  if (!activeRun || activeRun.status !== 'running') {
    stopHeartbeat();
    return null;
  }
  return finishRun({ status: 'interrupted', errorText: STALE_INTERRUPT_TEXT });
}

function resetMemoryForTests() {
  stopHeartbeat();
  activeRun = null;
  lastRun = null;
}

module.exports = {
  ALERT_EMAILS_KEY,
  HISTORY_LIMIT_MAX,
  STALE_HEARTBEAT_SECONDS,
  STALE_INTERRUPT_TEXT,
  entityLabel,
  stripErrorText,
  create,
  attachNight,
  updateEntity,
  setEntityProgress,
  markEntityRunning,
  markEntityDone,
  markEntityError,
  shouldSendNightMail,
  snapshotRun,
  serializeLivePayload,
  getNightStatus,
  getActiveRunId,
  isActive,
  beginPurchaseOrderRun,
  finishSuccess,
  failPurchaseOrders,
  finishRun,
  listRuns,
  clearHistory,
  interruptRunningRowsOnProcessStart,
  interruptStaleRunningRows,
  markInterruptedOnShutdown,
  sendNightMailSafe,
  resetMemoryForTests,
  attachNight,
  getActiveRunId,
  getNightStatus,
  beginPurchaseOrderRun,
  finishSuccess,
  failPurchaseOrders,
  snapshotRun,
  shouldSendNightMail,
  markEntityDone,
  markEntityError,
  markEntityRunning,
  setEntityProgress,
  serializeLivePayload,
  stripErrorText,
  listRuns,
  clearHistory,
  interruptRunningRowsOnProcessStart,
  interruptRunningRowsOnProcessStart: interruptRunningRowsOnProcessStart,
  resetMemoryForTests,
  resetMemoryForTests: resetMemoryForTests,
  beginPurchaseOrderRun: beginPurchaseOrderRun,
  finishSuccess: finishSuccess,
  failPurchaseOrders: failPurchaseOrders,
  attachNight: attachNight,
  getActiveRunId: getActiveRunId,
  getNightStatus: getNightStatus,
  listRuns: listRuns,
  clearHistory: clearHistory,
};
