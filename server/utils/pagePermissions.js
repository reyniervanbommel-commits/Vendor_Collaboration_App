'use strict';

// Granulaire instellingen-permissies (#AB:326). Leest dbo.user_permissions (migratie 004) zodat
// een employee per Instellingen-onderdeel toegang kan krijgen. Bewust geen cache: een door de
// admin ingetrokken permissie moet direct effect hebben, niet pas na een herlogin.

const sql = require('mssql');
const sqlPool = require('./sqlPool');

async function hasPagePermission(userId, pageName) {
  if (!userId || !pageName) return false;
  const pool = await sqlPool.getSqlPool();
  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .input('pageName', sql.NVarChar, pageName)
    .query('SELECT TOP (1) 1 AS found FROM dbo.user_permissions WHERE user_id = @userId AND page_name = @pageName');
  return result.recordset.length > 0;
}

async function listPagePermissions(userId) {
  if (!userId) return [];
  const pool = await sqlPool.getSqlPool();
  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .query('SELECT page_name FROM dbo.user_permissions WHERE user_id = @userId');
  return result.recordset.map((row) => row.page_name);
}

module.exports = { hasPagePermission, listPagePermissions };
